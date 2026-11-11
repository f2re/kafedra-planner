#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (message) => { throw new Error(message); };
const required = ['AGENTS_GUIDE.md', 'README.md', 'bundle.json', 'department-agents.json', 'manifest.sha256', 'test-remote-agents.sh'];
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

function verify(archive) {
  const checksum = readFileSync(`${archive}.sha256`, 'utf8').trimEnd();
  const match = /^([0-9a-f]{64})  ([^\r\n/\\]+)$/u.exec(checksum);
  if (!match || match[2] !== basename(archive)) fail('Некорректный внешний SHA-256 или имя архива');
  const sha256 = hash(readFileSync(archive));
  if (sha256 !== match[1]) fail('SHA-256 архива не совпадает');

  const tar = (...args) => execFileSync('tar', [...args, archive], { maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const entries = tar('-tzf').toString('utf8').trimEnd().split('\n');
  const root = entries[0]?.replace(/\/$/u, '');
  if (!root?.startsWith('kafedra-llm-catalogue-') || !versionPattern.test(root.slice('kafedra-llm-catalogue-'.length))) {
    fail('Некорректный корневой каталог архива');
  }
  const expected = [`${root}/`, ...required.map((name) => `${root}/${name}`)];
  if (new Set(entries).size !== entries.length || entries.length !== expected.length || entries.some((name) => !expected.includes(name))) {
    fail('Архив должен содержать только каталог, документацию, диагностику и контрольные суммы');
  }
  const modes = tar('-tvzf').toString('utf8').trimEnd().split('\n').map((line) => line.slice(0, 10));
  if (modes.length !== entries.length || modes.some((mode, index) => mode !== (entries[index] === `${root}/`
    ? 'drwxr-xr-x' : entries[index] === `${root}/test-remote-agents.sh` ? '-rwxr-xr-x' : '-rw-r--r--'))) {
    fail('Архив содержит ссылку, специальный файл или неверные права доступа');
  }
  // Read members into memory only; verification never extracts or executes an archive.
  const files = new Map(required.map((name) => [name, execFileSync('tar', ['-xOzf', archive, `${root}/${name}`], {
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
  })]));
  const manifest = files.get('manifest.sha256').toString('utf8').trimEnd().split('\n');
  const seen = new Set();
  for (const line of manifest) {
    const entry = /^([0-9a-f]{64})  ([A-Za-z0-9_.-]+)$/u.exec(line);
    if (!entry || entry[2] === 'manifest.sha256' || !files.has(entry[2]) || seen.has(entry[2])) fail('Некорректный manifest.sha256');
    if (hash(files.get(entry[2])) !== entry[1]) fail(`SHA-256 файла ${entry[2]} не совпадает`);
    seen.add(entry[2]);
  }
  if (seen.size !== required.length - 1) fail('manifest.sha256 не покрывает все файлы');

  const metadata = JSON.parse(files.get('bundle.json').toString('utf8'));
  if (metadata.format !== 'kafedra-agent-catalogue-v1' || !versionPattern.test(metadata.applicationVersion)
    || root !== `kafedra-llm-catalogue-${metadata.applicationVersion}`
    || !Number.isSafeInteger(metadata.schemaVersion) || metadata.schemaVersion < 1
    || !Number.isSafeInteger(metadata.sourceDateEpoch) || metadata.sourceDateEpoch < 0
    || !(metadata.sourceCommit === null || /^[0-9a-f]{40}$/u.test(metadata.sourceCommit))
    || !(metadata.sourceCommit === null ? metadata.sourceDirty === null : typeof metadata.sourceDirty === 'boolean')) {
    fail('Некорректные сведения о версии, схеме или Git в bundle.json');
  }
  const catalogue = JSON.parse(files.get('department-agents.json').toString('utf8'));
  if (catalogue.schema !== 'kafedra-agents-v1' || !Array.isArray(catalogue.agents) || !catalogue.agents.length
    || catalogue.catalogueSha256 !== hash(JSON.stringify(catalogue.agents))
    || metadata.catalogueSha256 !== catalogue.catalogueSha256 || metadata.taskCount !== catalogue.agents.length) {
    fail('Каталог задач не соответствует bundle.json или своему SHA-256');
  }
  const ids = new Set();
  for (const agent of catalogue.agents) {
    if (typeof agent.id !== 'string' || !agent.id || ids.has(agent.id)
      || typeof agent.systemPrompt !== 'string' || !agent.systemPrompt
      || agent.systemSha256 !== hash(agent.systemPrompt)
      || agent.request?.method !== 'POST' || agent.request?.path !== '/v1/chat/completions') {
      fail('Некорректная задача, системный промпт или запрос в каталоге');
    }
    ids.add(agent.id);
  }
  for (const id of ['plan-extract-v1', 'plan-department-selection-v1']) {
    const agent = catalogue.agents.find((item) => item.id === id);
    if (!agent || agent.promptVersion !== id || !agent.responseSchema
      || JSON.stringify(agent.responseSchema) !== JSON.stringify(agent.request.options?.response_format?.schema)) {
      fail(`Отсутствует актуальный промпт или схема ответа ${id}`);
    }
  }
  return { ...metadata, status: 'ok', archive, sha256, files: required };
}

if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) {
  console.log('Usage: node scripts/offline/verify-agent-catalogue.mjs <catalogue.tar.gz>');
  console.log('Checks the adjacent SHA-256, safe archive entries, full manifest and catalogue metadata; does not execute payloads.');
} else if (process.argv.length !== 3) {
  console.error('Usage: node scripts/offline/verify-agent-catalogue.mjs <catalogue.tar.gz>');
  process.exitCode = 2;
} else {
  try { console.log(JSON.stringify(verify(resolve(process.argv[2])), null, 2)); }
  catch (error) { console.error(`Проверка каталога: ${error.message}`); process.exitCode = 1; }
}
