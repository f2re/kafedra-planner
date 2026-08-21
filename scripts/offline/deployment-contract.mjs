#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FORMAT = 'kafedra-planner-full-offline';
const FORMAT_VERSION = 2;
const PACKAGE_CLOSURE = 'full-airgap-v2';
const TARGET_INSTALL_POLICY = 'additive-only-v2';

function fail(message) {
  const error = new Error(message);
  error.code = 'DEPLOYMENT_CONTRACT';
  throw error;
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { fail(`Не удалось прочитать ${path}: ${error.message}`); }
}

function sha256(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function readEnv(path) {
  const result = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const split = line.indexOf('=');
    if (split <= 0) fail(`Некорректная строка ${path}: ${raw}`);
    result[line.slice(0, split)] = line.slice(split + 1);
  }
  return result;
}

function packageRows(path) {
  const rows = readFileSync(path, 'utf8').trim().split(/\r?\n/u);
  if (rows.shift() !== 'sha256\tpackage\tversion\tarchitecture\tfilename') fail(`Некорректный заголовок ${path}`);
  return rows.filter(Boolean);
}

function normalizeMachine(value) {
  const machine = String(value || '').trim().toLowerCase();
  if (machine === 'amd64') return 'x86_64';
  if (machine === 'arm64') return 'aarch64';
  return machine;
}

function expectedMachine(debArchitecture) {
  if (debArchitecture === 'amd64') return 'x86_64';
  if (debArchitecture === 'arm64') return 'aarch64';
  fail(`Неподдерживаемая Debian-архитектура full bundle: ${debArchitecture}`);
}

function inspect(root) {
  const packageRoot = join(root, 'os-packages');
  const sourceOsPath = join(packageRoot, 'source-os.env');
  const packagesPath = join(packageRoot, 'packages.tsv');
  const osManifestPath = join(packageRoot, 'manifest.sha256');
  const pythonRoot = join(root, 'runtime', 'python');
  const pythonLauncher = join(pythonRoot, 'python');
  const pythonMetadataPath = join(pythonRoot, 'runtime.json');
  const recognitionScript = join(root, 'application', 'scripts', 'recognition', 'ocr.py');
  const sourceOs = readEnv(sourceOsPath);
  const python = readJson(pythonMetadataPath);
  const count = packageRows(packagesPath).length;
  if (!count) fail('Набор пакетов ОС пуст');
  if (sourceOs.DEPENDENCY_CLOSURE !== PACKAGE_CLOSURE) fail(`Набор .deb использует устаревший closure contract: ${sourceOs.DEPENDENCY_CLOSURE || 'не указан'}`);
  if (sourceOs.TARGET_INSTALL_POLICY !== TARGET_INSTALL_POLICY) fail(`Набор .deb не подтверждает ${TARGET_INSTALL_POLICY}`);
  if (sourceOs.REFERENCE_APT_CHECK !== 'passed') fail('Package layer собран без подтверждённого apt-get check reference-системы');
  if (!['debian', 'astra'].includes(sourceOs.OS_FAMILY)) fail(`Неподдерживаемый OS_FAMILY: ${sourceOs.OS_FAMILY}`);
  if (!['amd64', 'arm64'].includes(sourceOs.DEB_ARCHITECTURE)) fail(`Неподдерживаемая архитектура: ${sourceOs.DEB_ARCHITECTURE}`);
  if (!statSync(pythonLauncher).isFile()) fail('В full bundle отсутствует managed Python launcher');
  if (!statSync(recognitionScript).isFile()) fail('В full bundle отсутствует Python OCR adapter');
  if (String(python.platform || '').toLowerCase() !== 'linux') fail(`Python runtime собран не для Linux: ${python.platform}`);
  if (normalizeMachine(python.architecture) !== expectedMachine(sourceOs.DEB_ARCHITECTURE)) fail(`Python runtime ${python.architecture} не соответствует ${sourceOs.DEB_ARCHITECTURE}`);
  let probe;
  try {
    probe = JSON.parse(execFileSync(pythonLauncher, ['-c', [
      'import json,platform,sqlite3,ssl,sys',
      "print(json.dumps({'version':platform.python_version(),'architecture':platform.machine().lower(),'implementation':platform.python_implementation()}))"
    ].join(';')], { encoding: 'utf8', env: { PATH: process.env.PATH || '/usr/bin:/bin' } }));
    execFileSync(pythonLauncher, ['-c', [
      'from pathlib import Path',
      `p=Path(${JSON.stringify(recognitionScript)})`,
      "compile(p.read_text(encoding='utf-8'),str(p),'exec')"
    ].join(';')], { stdio: 'ignore', env: { PATH: process.env.PATH || '/usr/bin:/bin' } });
  } catch (error) {
    fail(`Managed Python runtime или OCR adapter не запускается: ${error.message}`);
  }
  if (normalizeMachine(probe.architecture) !== expectedMachine(sourceOs.DEB_ARCHITECTURE)) fail(`Запущенный Python ${probe.architecture} не соответствует ${sourceOs.DEB_ARCHITECTURE}`);
  const result = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    profile: 'full',
    target: { family: sourceOs.OS_FAMILY, id: sourceOs.OS_ID, versionId: sourceOs.OS_VERSION_ID, debArchitecture: sourceOs.DEB_ARCHITECTURE },
    python: {
      path: 'runtime/python/python', metadataPath: 'runtime/python/runtime.json', version: String(python.version || probe.version),
      implementation: String(python.implementation || probe.implementation), architecture: String(python.architecture || probe.architecture),
      runtimeId: String(python.runtime_id || ''), glibcRequired: String(python.glibc_required || ''), metadataSha256: sha256(pythonMetadataPath)
    },
    recognition: { script: 'application/scripts/recognition/ocr.py', defaultLanguages: 'rus+eng' },
    osPackages: {
      path: 'os-packages',
      count,
      dependencyClosure: PACKAGE_CLOSURE,
      targetInstallPolicy: TARGET_INSTALL_POLICY,
      packagesTsvSha256: sha256(packagesPath),
      manifestSha256: sha256(osManifestPath),
      sourceOsSha256: sha256(sourceOsPath)
    }
  };
  const llmManifestPath = join(root, 'llm', 'manifest.json');
  if (existsSync(llmManifestPath)) {
    const llm = readJson(llmManifestPath);
    if (llm.format !== 'kafedra-planner-llm-payload' || llm.formatVersion !== 1) fail('Некорректный LLM payload в full bundle');
    result.llm = {
      path: 'llm', manifestSha256: sha256(llmManifestPath),
      defaultModel: String(llm.defaultModel || ''), modelCount: Array.isArray(llm.models) ? llm.models.length : 0,
      enabledByDefault: Boolean(llm.enabledByDefault)
    };
    if (!result.llm.defaultModel || !result.llm.modelCount) fail('LLM payload не содержит модели');
  }
  return result;
}

function writeContract(root, output) {
  const contract = inspect(root);
  writeFileSync(output, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  return contract;
}

function verifyContract(root) {
  const actual = inspect(root);
  const saved = readJson(join(root, 'deployment.json'));
  if (JSON.stringify(saved) !== JSON.stringify(actual)) fail('deployment.json не соответствует фактическому full bundle');
  return actual;
}

function parse(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    if (!rest[index]?.startsWith('--') || rest[index + 1] === undefined) fail(`Некорректные аргументы: ${rest.join(' ')}`);
    options[rest[index].slice(2)] = rest[index + 1];
  }
  return { command, options };
}

try {
  const { command, options } = parse(process.argv.slice(2));
  const root = resolve(options.root || '.');
  let result;
  if (command === 'write') {
    if (!options.output) fail('write требует --output');
    result = writeContract(root, resolve(options.output));
  } else if (command === 'verify') result = verifyContract(root);
  else fail('Использование: deployment-contract.mjs write|verify --root DIR [--output FILE]');
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`Ошибка full offline deployment: ${error.message}\n`);
  process.exitCode = 1;
}
