import { appendFile } from 'node:fs/promises';
import { isAbsolute, posix, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const CHANGE_ID_PATTERN = /^C-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
export const MIGRATION_FILE_PATTERN = /^migrations\/(\d{3})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

const SIGNIFICANT_PREFIXES = [
  'apps/', 'packages/', 'public/', 'scripts/', 'tests/', 'migrations/',
  'deploy/', 'config/', '.github/workflows/', '.grace/context/',
  '.grace/graph/', '.grace/verification/'
];
const SIGNIFICANT_FILES = new Set(['AGENTS.md', 'package.json', 'package-lock.json', 'VERSION']);

export function parseArguments(argv) {
  const result = { positional: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      result.positional.push(token);
      continue;
    }
    const [name, inlineValue] = token.slice(2).split('=', 2);
    if (!name) throw new Error(`Некорректный аргумент: ${token}`);
    if (inlineValue !== undefined) {
      result[name] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      result[name] = next;
      index += 1;
    } else {
      result[name] = true;
    }
  }
  return result;
}

export function runCommand(command, args = [], {
  cwd = process.cwd(), env = process.env, allowFailure = false, stdio = 'pipe'
} = {}) {
  const result = spawnSync(command, args, {
    cwd, env, encoding: 'utf8', stdio, maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    const stdout = String(result.stdout || '').trim();
    const stderr = String(result.stderr || '').trim();
    throw new Error([
      `Команда завершилась с кодом ${result.status}: ${[command, ...args].join(' ')}`,
      stdout && `stdout:\n${stdout}`,
      stderr && `stderr:\n${stderr}`
    ].filter(Boolean).join('\n'));
  }
  return result;
}

export function runGit(args, options = {}) {
  return String(runCommand('git', args, options).stdout || '');
}

export function resolveCommit(ref, { cwd = process.cwd(), label = 'commit' } = {}) {
  if (!ref || typeof ref !== 'string') throw new Error(`Не задан ${label}.`);
  const value = runGit(['rev-parse', '--verify', `${ref}^{commit}`], { cwd }).trim();
  if (!/^[0-9a-f]{40}$/i.test(value)) throw new Error(`Не удалось разрешить ${label}: ${ref}`);
  return value.toLowerCase();
}

export function normalizeRepositoryPath(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Пустой путь репозитория.');
  const replaced = value.replaceAll('\\', '/');
  if (isAbsolute(replaced) || replaced.startsWith('/')) throw new Error(`Абсолютный путь запрещён: ${value}`);
  const normalized = posix.normalize(replaced);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Путь выходит за пределы репозитория: ${value}`);
  }
  return normalized;
}

export function readChangedEntries(baseRef, headRef, { cwd = process.cwd() } = {}) {
  const base = resolveCommit(baseRef, { cwd, label: 'base SHA' });
  const head = resolveCommit(headRef, { cwd, label: 'head SHA' });
  const output = runGit(['diff', '--name-status', '-z', '--find-renames', `${base}...${head}`], { cwd });
  const tokens = output.split('\0');
  if (tokens.at(-1) === '') tokens.pop();
  const entries = [];
  for (let index = 0; index < tokens.length;) {
    const statusToken = tokens[index++];
    const status = statusToken?.[0];
    if (!status) throw new Error('Git вернул пустой статус изменения.');
    if (status === 'R' || status === 'C') {
      const oldPath = normalizeRepositoryPath(tokens[index++]);
      const newPath = normalizeRepositoryPath(tokens[index++]);
      entries.push({ status, statusToken, oldPath, newPath, paths: [oldPath, newPath] });
    } else {
      const filePath = normalizeRepositoryPath(tokens[index++]);
      entries.push({
        status, statusToken,
        oldPath: status === 'D' ? filePath : null,
        newPath: status === 'D' ? null : filePath,
        paths: [filePath]
      });
    }
  }
  return { base, head, entries };
}

export function listTreeFiles(ref, prefix, { cwd = process.cwd() } = {}) {
  const commit = resolveCommit(ref, { cwd });
  return runGit(['ls-tree', '-r', '--name-only', commit, '--', prefix], { cwd })
    .split(/\r?\n/).map((value) => value.trim()).filter(Boolean).map(normalizeRepositoryPath);
}

export function changedPaths(entries) {
  return [...new Set(entries.flatMap((entry) => entry.paths))].sort();
}

export function isSignificantPath(filePath) {
  const normalized = normalizeRepositoryPath(filePath);
  return SIGNIFICANT_FILES.has(normalized)
    || SIGNIFICANT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function changeIdFromPath(filePath) {
  const match = normalizeRepositoryPath(filePath).match(
    /^\.grace\/changes\/(active|archive)\/(C-[A-Z0-9]+(?:-[A-Z0-9]+)*)\//
  );
  return match ? { location: match[1], changeId: match[2] } : null;
}

export function collectChangedChangeIds(entries) {
  const result = new Map();
  for (const filePath of changedPaths(entries)) {
    const parsed = changeIdFromPath(filePath);
    if (!parsed) continue;
    const locations = result.get(parsed.changeId) || new Set();
    locations.add(parsed.location);
    result.set(parsed.changeId, locations);
  }
  return result;
}

export async function writeGithubOutput(values, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) return;
  const lines = Object.entries(values)
    .map(([key, value]) => `${key}=${String(value).replaceAll('\n', '%0A')}`)
    .join('\n');
  await appendFile(outputPath, `${lines}\n`, 'utf8');
}

export function repositoryRoot(cwd = process.cwd()) {
  return resolve(runGit(['rev-parse', '--show-toplevel'], { cwd }).trim());
}
