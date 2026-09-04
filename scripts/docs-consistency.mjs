import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function walkMarkdown(path) {
  const result = [];
  if (!(await exists(path))) return result;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) result.push(...await walkMarkdown(child));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') result.push(child);
  }
  return result;
}

function lineNumber(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) if (text.charCodeAt(cursor) === 10) line += 1;
  return line;
}

function cleanTarget(value) {
  return String(value || '')
    .trim()
    .replace(/^<|>$/g, '')
    .replace(/[.,;:]+$/g, '');
}

function isExternalTarget(target) {
  return !target
    || target.startsWith('#')
    || target.startsWith('/')
    || /^[a-z][a-z0-9+.-]*:/i.test(target);
}

function stripFragmentAndQuery(target) {
  return target.split('#', 1)[0].split('?', 1)[0];
}

function record(errors, file, text, index, kind, target, message) {
  errors.push({ file, line: lineNumber(text, Math.max(0, index || 0)), kind, target, message });
}

async function checkUniversalReleaseWorkflows({ absoluteRoot, errors }) {
  const markers = [
    {
      file: '.github/workflows/release-gate.yml',
      pattern: /^name:\s*Release gate\s*$/mu,
      description: 'универсальный release gate'
    },
    {
      file: '.github/workflows/release.yml',
      pattern: /workflows:\s*\["Release gate"\]/u,
      description: 'publisher универсального release gate'
    }
  ];
  for (const marker of markers) {
    const absoluteFile = join(absoluteRoot, marker.file);
    if (!(await exists(absoluteFile))) continue;
    const text = await readFile(absoluteFile, 'utf8');
    if (!marker.pattern.test(text)) {
      record(errors, marker.file, text, 0, 'release-workflow', 'Release gate',
        `${marker.description}: workflow должен быть version-neutral.`);
    }
  }
}

async function checkReleaseVersion({ absoluteRoot, pkg, packageText, errors }) {
  const versionPath = join(absoluteRoot, 'VERSION');
  if (!(await exists(versionPath))) return;

  const versionText = await readFile(versionPath, 'utf8');
  const version = versionText.trim();
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    record(errors, 'VERSION', versionText, 0, 'release-version', version, 'VERSION должен содержать обычную semver-версию.');
    return;
  }

  if (pkg.version !== version) {
    record(errors, 'package.json', packageText, packageText.indexOf('"version"'), 'release-version', pkg.version || '',
      `package.json должен использовать текущую версию ${version}.`);
  }

  const releaseNoteRelative = `docs/releases/${version}.md`;
  const releaseNotePath = join(absoluteRoot, releaseNoteRelative);
  if (!(await exists(releaseNotePath))) {
    record(errors, 'VERSION', versionText, 0, 'release-version', releaseNoteRelative,
      'Для текущей версии отсутствует release note.');
  } else {
    const releaseText = await readFile(releaseNotePath, 'utf8');
    const title = releaseText.match(/^# Kafedra Planner (\d+\.\d+\.\d+)\s*$/mu);
    if (!title || title[1] !== version) {
      record(errors, releaseNoteRelative, releaseText, title?.index || 0, 'release-version', title?.[1] || '',
        `Заголовок release note должен указывать ${version}.`);
    }
  }

  const markers = [
    { file: 'README.md', pattern: /Текущий рубеж:\s+\*\*`([^`]+)`\*\*/u, description: 'русский README' },
    { file: 'README.en.md', pattern: /Current milestone:\s+\*\*`([^`]+)`\*\*/u, description: 'английский README' },
    { file: 'docs/ROADMAP.md', pattern: /^## Текущий рубеж — `([^`]+)`\s*$/mu, description: 'ROADMAP' },
    { file: 'docs/RELEASE_CANDIDATE.md', pattern: /^# Release candidate (\d+\.\d+\.\d+)\s*$/mu, description: 'release candidate' },
    { file: 'docs/VALIDATION.md', pattern: /Актуальный рубеж:\s*`([^`]+)`/u, description: 'validation contract' },
    { file: 'docs/UX_FLOWS.md', pattern: /Статус: рабочие контуры версии `([^`]+)`/u, description: 'UX contract' }
  ];

  for (const marker of markers) {
    const absoluteFile = join(absoluteRoot, marker.file);
    if (!(await exists(absoluteFile))) continue;
    const text = await readFile(absoluteFile, 'utf8');
    const match = text.match(marker.pattern);
    if (!match) {
      record(errors, marker.file, text, 0, 'release-version', version,
        `${marker.description}: не найден маркер текущей версии.`);
    } else if (match[1] !== version) {
      record(errors, marker.file, text, match.index || 0, 'release-version', match[1],
        `${marker.description}: указан рубеж ${match[1]}, ожидается ${version}.`);
    }
  }
  await checkUniversalReleaseWorkflows({ absoluteRoot, errors });
}

export async function checkDocumentation({ root = process.cwd() } = {}) {
  const absoluteRoot = resolve(root);
  const packagePath = join(absoluteRoot, 'package.json');
  const packageText = await readFile(packagePath, 'utf8');
  const pkg = JSON.parse(packageText);
  const scripts = new Set(Object.keys(pkg.scripts || {}));
  const files = [];
  for (const name of ['README.md', 'README.en.md']) {
    const readme = join(absoluteRoot, name);
    if (await exists(readme)) files.push(readme);
  }
  files.push(...await walkMarkdown(join(absoluteRoot, 'docs')));
  files.sort();

  const errors = [];
  await checkReleaseVersion({ absoluteRoot, pkg, packageText, errors });

  for (const absoluteFile of files) {
    const file = relative(absoluteRoot, absoluteFile).split(sep).join('/');
    const text = await readFile(absoluteFile, 'utf8');

    const markdownLink = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g;
    for (const match of text.matchAll(markdownLink)) {
      const raw = cleanTarget(match[1]);
      if (isExternalTarget(raw)) continue;
      let decoded;
      try {
        decoded = decodeURIComponent(stripFragmentAndQuery(raw));
      } catch {
        record(errors, file, text, match.index, 'markdown-link', raw, 'Некорректное URL-кодирование относительной ссылки.');
        continue;
      }
      if (!decoded) continue;
      const target = resolve(dirname(absoluteFile), decoded);
      const rel = relative(absoluteRoot, target);
      if (rel.startsWith(`..${sep}`) || rel === '..' || !(await exists(target))) {
        record(errors, file, text, match.index, 'markdown-link', raw, 'Относительная Markdown-ссылка не существует.');
      }
    }

    const referenceLink = /^\s*\[[^\]]+\]:\s*(\S+)/gm;
    for (const match of text.matchAll(referenceLink)) {
      const raw = cleanTarget(match[1]);
      if (isExternalTarget(raw)) continue;
      const decoded = stripFragmentAndQuery(raw);
      if (!decoded) continue;
      const target = resolve(dirname(absoluteFile), decoded);
      if (!(await exists(target))) {
        record(errors, file, text, match.index, 'markdown-link', raw, 'Относительная reference-ссылка не существует.');
      }
    }

    const npmRun = /\bnpm\s+run(?:\s+--silent)?\s+([A-Za-z0-9][A-Za-z0-9:._-]*)/g;
    for (const match of text.matchAll(npmRun)) {
      const name = match[1];
      if (!scripts.has(name)) record(errors, file, text, match.index, 'npm-script', name, 'В package.json нет такого npm script.');
    }

    const repoPath = /\b((?:scripts|deploy|config)\/[A-Za-z0-9._@+/-]+\.(?:mjs|js|sh|py|service|txt|json|md|ya?ml|env))\b/g;
    for (const match of text.matchAll(repoPath)) {
      const target = match[1];
      if (!(await exists(join(absoluteRoot, target)))) record(errors, file, text, match.index, 'repo-path', target, 'Указанного файла в репозитории нет.');
    }

    const installedScript = /\/opt\/kafedra-planner\/current\/(scripts\/[A-Za-z0-9._@+/-]+\.(?:mjs|js|sh|py))\b/g;
    for (const match of text.matchAll(installedScript)) {
      const target = match[1];
      if (!(await exists(join(absoluteRoot, target)))) record(errors, file, text, match.index, 'installed-script', target, 'Путь установленной системы не соответствует существующему repository script.');
    }

    const systemdUnit = /\b(kafedra-planner-[A-Za-z0-9_-]+\.service)\b/g;
    for (const match of text.matchAll(systemdUnit)) {
      const target = join('deploy', 'systemd', match[1]);
      if (!(await exists(join(absoluteRoot, target)))) record(errors, file, text, match.index, 'systemd-unit', match[1], 'Указанный systemd unit отсутствует в deploy/systemd.');
    }
  }

  return errors.sort((a, b) => a.file.localeCompare(b.file, 'en') || a.line - b.line || a.kind.localeCompare(b.kind, 'en'));
}

export function formatDocumentationErrors(errors) {
  return errors.map((error) => `${error.file}:${error.line} [${error.kind}] ${error.target}: ${error.message}`).join('\n');
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  const errors = await checkDocumentation();
  if (errors.length) {
    console.error(`Документация содержит ${errors.length} несогласованных ссылок/команд:`);
    console.error(formatDocumentationErrors(errors));
    process.exitCode = 1;
  } else {
    console.log('Документация согласована с package.json и деревом репозитория.');
  }
}
