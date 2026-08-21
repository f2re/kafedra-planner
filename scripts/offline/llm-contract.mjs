#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const FORMAT = 'kafedra-planner-llm-payload';
const FORMAT_VERSION = 1;
const ALIAS_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

function fail(message) {
  const error = new Error(message);
  error.code = 'LLM_BUNDLE_CONTRACT';
  throw error;
}

function sha256(path) {
  const hash = createHash('sha256');
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytes = readSync(descriptor, buffer, 0, buffer.length, null);
      if (!bytes) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest('hex');
}

function filePrefix(path, bytes = 4) {
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.alloc(bytes);
  try {
    const read = readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read);
  } finally {
    closeSync(descriptor);
  }
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  fail(`Некорректное логическое значение: ${value}`);
}

function integer(value, fallback, min, max, label) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed)) return fallback;
  if (parsed < min || parsed > max) fail(`${label}: ожидается ${min}..${max}`);
  return parsed;
}

function safeRelative(value, label) {
  const normalized = String(value || '').replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) fail(`${label}: небезопасный путь`);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.includes('..')) fail(`${label}: небезопасный путь`);
  return normalized;
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { fail(`Не удалось прочитать ${path}: ${error.message}`); }
}

function payloadRoot(root) {
  const nested = join(root, 'llm');
  return existsSync(join(nested, 'manifest.json')) ? nested : root;
}

function walkRegularFiles(root, current = root) {
  const result = [];
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = join(current, entry.name);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) fail(`LLM payload содержит симлинк: ${path}`);
    if (entry.isDirectory()) result.push(...walkRegularFiles(root, path));
    else if (entry.isFile()) result.push(path);
    else fail(`LLM payload содержит специальный файл: ${path}`);
  }
  return result;
}

function runtimeDigest(runtimeRoot) {
  const files = walkRegularFiles(runtimeRoot);
  const hash = createHash('sha256');
  for (const path of files) {
    const name = relative(runtimeRoot, path).split(sep).join('/');
    hash.update(name); hash.update('\0'); hash.update(sha256(path)); hash.update('\n');
  }
  return { count: files.length, sha256: hash.digest('hex') };
}

function serverVersion(server) {
  try {
    const output = execFileSync(server, ['--version'], {
      encoding: 'utf8', timeout: 5000,
      env: { ...process.env, LD_LIBRARY_PATH: [dirname(server), join(dirname(server), '..', 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }
    });
    return String(output || '').trim().slice(0, 1000) || 'unknown';
  } catch {
    return null;
  }
}

function modelRecords(root) {
  const modelsRoot = join(root, 'models');
  if (!existsSync(modelsRoot)) fail('В LLM payload отсутствует каталог models');
  const allEntries = readdirSync(modelsRoot, { withFileTypes: true });
  for (const entry of allEntries) {
    const info = lstatSync(join(modelsRoot, entry.name));
    if (info.isSymbolicLink() || !entry.isFile() || !entry.name.toLowerCase().endsWith('.gguf')) {
      fail(`Каталог models содержит неподдерживаемый объект: ${entry.name}`);
    }
  }
  const entries = allEntries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  if (!entries.length) fail('LLM payload должен содержать хотя бы одну GGUF-модель');
  return entries.map((entry) => {
    const alias = entry.name.slice(0, -5);
    if (!ALIAS_RE.test(alias)) fail(`Некорректный alias модели: ${alias}`);
    const path = join(modelsRoot, entry.name);
    const info = statSync(path);
    if (info.size < 4 || filePrefix(path).toString('ascii') !== 'GGUF') fail(`Файл ${entry.name} не имеет сигнатуры GGUF`);
    return {
      alias,
      path: `models/${entry.name}`,
      sha256: sha256(path),
      sizeBytes: info.size
    };
  });
}

function inspectPayload(root, options = {}) {
  const actualRoot = payloadRoot(root);
  const server = join(actualRoot, 'runtime', 'bin', 'llama-server');
  if (!existsSync(server) || !statSync(server).isFile()) fail('В LLM runtime отсутствует runtime/bin/llama-server');
  const runtimeRoot = join(actualRoot, 'runtime');
  const runtime = runtimeDigest(runtimeRoot);
  const license = ['LICENSE', 'LICENSE.md', 'COPYING'].find((name) => existsSync(join(runtimeRoot, name)));
  if (!license) fail('В LLM runtime отсутствует лицензия llama.cpp');
  const version = serverVersion(server);
  if (!version) fail('llama-server не запускается с --version на build host');
  const models = modelRecords(actualRoot);
  const defaultModel = String(options.defaultModel || models[0].alias).trim();
  if (!ALIAS_RE.test(defaultModel) || !models.some((model) => model.alias === defaultModel)) {
    fail(`Модель по умолчанию не найдена: ${defaultModel}`);
  }
  const host = String(options.host || '127.0.0.1').trim();
  if (host !== '127.0.0.1') fail('Managed llama-server разрешено слушать только 127.0.0.1');
  const port = integer(options.port, 8081, 1, 65535, 'port');
  const contextSize = integer(options.contextSize, 8192, 512, 131072, 'context-size');
  const threads = integer(options.threads, 0, 0, 1024, 'threads');
  const parallel = integer(options.parallel, 1, 1, 32, 'parallel');
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    enabledByDefault: bool(options.enabledByDefault, true),
    defaultModel,
    server: {
      host, port, contextSize, threads, parallel,
      path: 'runtime/bin/llama-server',
      sha256: sha256(server),
      runtimeFiles: runtime.count,
      runtimeSha256: runtime.sha256,
      version, license: `runtime/${license}`
    },
    models
  };
}

function writeManifest(root, output, options) {
  const manifest = inspectPayload(root, options);
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function verify(root) {
  const actualRoot = payloadRoot(root);
  const manifestPath = join(actualRoot, 'manifest.json');
  if (!existsSync(manifestPath)) fail('В LLM payload отсутствует manifest.json');
  const saved = readJson(manifestPath);
  if (saved.format !== FORMAT || saved.formatVersion !== FORMAT_VERSION) fail('Неподдерживаемый формат LLM manifest');
  if (!ALIAS_RE.test(String(saved.defaultModel || ''))) fail('Некорректный defaultModel');
  if (!saved.server || saved.server.host !== '127.0.0.1') fail('Managed llama-server должен слушать 127.0.0.1');
  const expected = inspectPayload(actualRoot, {
    defaultModel: saved.defaultModel,
    enabledByDefault: saved.enabledByDefault,
    host: saved.server.host,
    port: saved.server.port,
    contextSize: saved.server.contextSize,
    threads: saved.server.threads,
    parallel: saved.server.parallel
  });
  if (JSON.stringify(saved) !== JSON.stringify(expected)) fail('LLM manifest не соответствует runtime/models');
  return expected;
}

function fixedValues(root) {
  const manifest = verify(root);
  const model = manifest.models.find((item) => item.alias === manifest.defaultModel);
  return [
    manifest.enabledByDefault ? 'true' : 'false',
    manifest.defaultModel,
    model.sha256,
    manifest.server.host,
    String(manifest.server.port),
    String(manifest.server.contextSize),
    String(manifest.server.threads),
    String(manifest.server.parallel),
    String(manifest.models.length)
  ];
}

function modelRows(root) {
  return verify(root).models.map((model) => [model.alias, model.sha256, String(model.sizeBytes), model.path].join('\t'));
}

function parse(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token?.startsWith('--')) fail(`Некорректный аргумент: ${token}`);
    const key = token.slice(2);
    if (rest[index + 1] === undefined || rest[index + 1].startsWith('--')) fail(`${token} требует значение`);
    options[key] = rest[index + 1];
    index += 1;
  }
  return { command, options };
}

try {
  const { command, options } = parse(process.argv.slice(2));
  const root = resolve(options.root || '.');
  let result;
  if (command === 'write') {
    if (!options.output) fail('write требует --output');
    result = writeManifest(root, resolve(options.output), {
      defaultModel: options['default-model'],
      enabledByDefault: options['enabled-by-default'],
      host: options.host,
      port: options.port,
      contextSize: options['context-size'],
      threads: options.threads,
      parallel: options.parallel
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (command === 'verify') {
    result = verify(root);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (command === 'values') {
    process.stdout.write(`${fixedValues(root).join('\n')}\n`);
  } else if (command === 'models') {
    process.stdout.write(`${modelRows(root).join('\n')}\n`);
  } else {
    fail('Использование: llm-contract.mjs write|verify|values|models --root DIR [параметры]');
  }
} catch (error) {
  process.stderr.write(`Ошибка LLM offline bundle: ${error.message}\n`);
  process.exitCode = 1;
}
