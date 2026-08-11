#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUNDLE_FORMAT_VERSION = 2;
export const RUNTIME_RELATIVE_PATH = 'runtime/node/bin/node';
export const RUNTIME_LICENSE_RELATIVE_PATH = 'runtime/node/LICENSE';
export const MIN_STANDALONE_NODE_BYTES = 20 * 1024 * 1024;
export const MIN_LICENSE_BYTES = 1024;

function fail(message) {
  const error = new Error(message);
  error.code = 'OFFLINE_RUNTIME_CONTRACT';
  throw error;
}

export function parseVersion(value) {
  const match = String(value ?? '').trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/u);
  if (!match) fail(`Некорректная версия Node.js: ${value}`);
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

export function compareVersions(left, right) {
  const a = Array.isArray(left) ? left : parseVersion(left);
  const b = Array.isArray(right) ? right : parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
}

export function satisfiesNodeEngine(version, range) {
  const normalizedRange = String(range ?? '').trim();
  if (!normalizedRange || normalizedRange === '*') return true;
  if (normalizedRange.includes('||')) {
    fail(`Диапазон Node.js с оператором || не поддерживается контрактом поставки: ${normalizedRange}`);
  }
  const current = parseVersion(version);
  const clauses = normalizedRange.split(/\s+/u).filter(Boolean);
  if (clauses.length === 0) return true;
  return clauses.every((clause) => {
    const match = clause.match(/^(>=|<=|>|<|=)?(v?\d+(?:\.\d+){0,2})$/u);
    if (!match) fail(`Неподдерживаемое условие engines.node: ${clause}`);
    const operator = match[1] ?? '=';
    const comparison = compareVersions(current, parseVersion(match[2]));
    switch (operator) {
      case '>=': return comparison >= 0;
      case '<=': return comparison <= 0;
      case '>': return comparison > 0;
      case '<': return comparison < 0;
      case '=': return comparison === 0;
      default: fail(`Неподдерживаемый оператор engines.node: ${operator}`);
    }
  });
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    fail(`Не удалось прочитать JSON ${path}: ${error.message}`);
  }
}

async function sha256File(path) {
  const hash = createHash('sha256');
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', rejectPromise);
    stream.on('end', resolvePromise);
  });
  return hash.digest('hex');
}

function requiredNodeEngine(packageJson) {
  const engine = packageJson?.engines?.node;
  if (typeof engine !== 'string' || !engine.trim()) {
    fail('В package.json отсутствует обязательный диапазон engines.node');
  }
  return engine.trim();
}

async function inspectRuntime({ packageJsonPath, runtimePath }) {
  const packageJson = await readJson(packageJsonPath);
  const engine = requiredNodeEngine(packageJson);
  const runtimeRealPath = await realpath(runtimePath);
  const processRealPath = await realpath(process.execPath);
  if (runtimeRealPath !== processRealPath) {
    fail(`Контракт runtime должен выполняться проверяемым Node.js: ожидался ${runtimeRealPath}, запущен ${processRealPath}`);
  }
  if (process.platform !== 'linux') {
    fail(`Автономный runtime должен быть собран для Linux, получена платформа ${process.platform}`);
  }
  if (!['x64', 'arm64'].includes(process.arch)) {
    fail(`Неподдерживаемая архитектура автономного runtime: ${process.arch}`);
  }
  if (!satisfiesNodeEngine(process.version, engine)) {
    fail(`Node.js ${process.version} не соответствует engines.node ${engine}`);
  }
  const runtimeStat = await stat(runtimeRealPath);
  if (!runtimeStat.isFile()) fail(`Runtime не является обычным файлом: ${runtimeRealPath}`);
  if (runtimeStat.size < MIN_STANDALONE_NODE_BYTES) {
    fail(`Node.js runtime подозрительно мал (${runtimeStat.size} байт). Нужен автономный бинарник, а не системный launcher с libnode.so`);
  }
  const components = {
    sqlite: process.versions.sqlite ?? null,
    icu: process.versions.icu ?? null,
    openssl: process.versions.openssl ?? null
  };
  if (!components.sqlite) fail('В Node.js runtime отсутствует встроенная SQLite');
  if (!components.icu || !Intl.DateTimeFormat.supportedLocalesOf(['ru-RU']).length) {
    fail('В Node.js runtime отсутствует ICU с поддержкой русской локали');
  }
  if (!components.openssl) fail('В Node.js runtime отсутствует OpenSSL');
  const report = typeof process.report?.getReport === 'function' ? process.report.getReport() : null;
  return {
    engine,
    version: process.version,
    platform: process.platform,
    arch: process.arch,
    executableBytes: runtimeStat.size,
    executableSha256: await sha256File(runtimeRealPath),
    glibcRuntime: report?.header?.glibcVersionRuntime ?? null,
    components
  };
}

async function inspectRuntimeLicense(runtimePath) {
  const licensePath = join(dirname(dirname(runtimePath)), 'LICENSE');
  const licenseStat = await stat(licensePath);
  if (!licenseStat.isFile() || licenseStat.size < MIN_LICENSE_BYTES) {
    fail(`Лицензия Node.js отсутствует или неполна: ${licensePath}`);
  }
  return {
    path: RUNTIME_LICENSE_RELATIVE_PATH,
    bytes: licenseStat.size,
    sha256: await sha256File(licensePath)
  };
}

function buildTimestamp() {
  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;
  if (!sourceDateEpoch) return new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z');
  const epoch = Number(sourceDateEpoch);
  if (!Number.isInteger(epoch) || epoch < 0) fail(`Некорректный SOURCE_DATE_EPOCH: ${sourceDateEpoch}`);
  return new Date(epoch * 1000).toISOString().replace(/\.\d{3}Z$/u, 'Z');
}

async function writeRelease(options) {
  const packageJson = await readJson(options.packageJsonPath);
  const version = (await readFile(options.versionFile, 'utf8')).trim();
  if (!version) fail('Файл VERSION пуст');
  if (packageJson.name !== 'kafedra-planner') fail(`Неожиданное имя пакета: ${packageJson.name}`);
  if (packageJson.version !== version) {
    fail(`Версия package.json (${packageJson.version}) не совпадает с VERSION (${version})`);
  }
  const runtime = await inspectRuntime(options);
  const license = await inspectRuntimeLicense(options.runtimePath);
  const release = {
    bundleFormat: BUNDLE_FORMAT_VERSION,
    name: packageJson.name,
    version,
    builtAt: buildTimestamp(),
    gitCommit: options.gitCommit || 'unknown',
    nodeRuntimeIncluded: true,
    nodeVersion: runtime.version,
    nodePlatform: runtime.platform,
    nodeArch: runtime.arch,
    nodeRuntime: {
      path: RUNTIME_RELATIVE_PATH,
      engine: runtime.engine,
      version: runtime.version,
      platform: runtime.platform,
      arch: runtime.arch,
      executableBytes: runtime.executableBytes,
      executableSha256: runtime.executableSha256,
      buildHostGlibc: runtime.glibcRuntime,
      components: runtime.components,
      license
    }
  };
  await writeFile(options.output, `${JSON.stringify(release, null, 2)}\n`, 'utf8');
  return release;
}

async function verifyBundle(root) {
  const bundleRoot = resolve(root);
  const applicationRoot = join(bundleRoot, 'application');
  const runtimePath = join(bundleRoot, RUNTIME_RELATIVE_PATH);
  const packageJsonPath = join(applicationRoot, 'package.json');
  const versionFile = join(applicationRoot, 'VERSION');
  const releasePath = join(bundleRoot, 'release.json');
  const [release, packageJson, runtime, license] = await Promise.all([
    readJson(releasePath),
    readJson(packageJsonPath),
    inspectRuntime({ packageJsonPath, runtimePath }),
    inspectRuntimeLicense(runtimePath)
  ]);
  const version = (await readFile(versionFile, 'utf8')).trim();
  if (release.bundleFormat !== BUNDLE_FORMAT_VERSION) {
    fail(`Неподдерживаемый формат offline bundle: ${release.bundleFormat}; ожидается ${BUNDLE_FORMAT_VERSION}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(release.builtAt ?? '')) {
    fail('Некорректное время builtAt в release.json');
  }
  if (release.gitCommit !== 'unknown' && !/^[0-9a-f]{7,64}$/u.test(release.gitCommit ?? '')) {
    fail('Некорректный gitCommit в release.json');
  }
  if (release.name !== 'kafedra-planner' || packageJson.name !== release.name) {
    fail('Имя продукта в release.json и package.json не совпадает');
  }
  if (!version || release.version !== version || packageJson.version !== version) {
    fail('Версии release.json, package.json и VERSION не совпадают');
  }
  if (basename(bundleRoot) !== `${release.name}-${version}`) {
    fail(`Корневой каталог должен называться ${release.name}-${version}`);
  }
  if (release.nodeRuntimeIncluded !== true) fail('release.json не подтверждает наличие встроенного Node.js');
  if (!release.nodeRuntime || typeof release.nodeRuntime !== 'object') fail('В release.json отсутствует nodeRuntime');
  const expected = release.nodeRuntime;
  const checks = [
    ['path', expected.path, RUNTIME_RELATIVE_PATH],
    ['engine', expected.engine, runtime.engine],
    ['version', expected.version, runtime.version],
    ['platform', expected.platform, runtime.platform],
    ['arch', expected.arch, runtime.arch],
    ['executableBytes', expected.executableBytes, runtime.executableBytes],
    ['executableSha256', expected.executableSha256, runtime.executableSha256],
    ['sqlite', expected.components?.sqlite, runtime.components.sqlite],
    ['icu', expected.components?.icu, runtime.components.icu],
    ['openssl', expected.components?.openssl, runtime.components.openssl],
    ['licensePath', expected.license?.path, license.path],
    ['licenseBytes', expected.license?.bytes, license.bytes],
    ['licenseSha256', expected.license?.sha256, license.sha256],
    ['nodeVersion', release.nodeVersion, runtime.version],
    ['nodePlatform', release.nodePlatform, runtime.platform],
    ['nodeArch', release.nodeArch, runtime.arch]
  ];
  for (const [name, actual, required] of checks) {
    if (actual !== required) fail(`Несовпадение ${name} в release.json`);
  }
  const rootInstallerHash = await sha256File(join(bundleRoot, 'install.sh'));
  const applicationInstallerHash = await sha256File(join(applicationRoot, 'deploy', 'install.sh'));
  if (rootInstallerHash !== applicationInstallerHash) {
    fail('Корневой install.sh не совпадает с application/deploy/install.sh');
  }
  return {
    bundleFormat: release.bundleFormat,
    name: release.name,
    version,
    gitCommit: release.gitCommit,
    embeddedRuntime: true,
    nodeVersion: runtime.version,
    nodeEngine: runtime.engine,
    platform: runtime.platform,
    arch: runtime.arch,
    runtimeBytes: runtime.executableBytes,
    runtimeSha256: runtime.executableSha256,
    glibcRuntime: runtime.glibcRuntime,
    components: runtime.components,
    licenseSha256: license.sha256
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) fail(`Неожиданный аргумент: ${key}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`Для ${key} не задано значение`);
    options[key.slice(2)] = value;
    index += 1;
  }
  return options;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);
  let result;
  switch (command) {
    case 'inspect':
      if (!options['package-json'] || !options.runtime) fail('inspect требует --package-json и --runtime');
      result = await inspectRuntime({ packageJsonPath: options['package-json'], runtimePath: options.runtime });
      break;
    case 'write-release':
      for (const name of ['package-json', 'version-file', 'runtime', 'output']) {
        if (!options[name]) fail(`write-release требует --${name}`);
      }
      result = await writeRelease({
        packageJsonPath: options['package-json'],
        versionFile: options['version-file'],
        runtimePath: options.runtime,
        output: options.output,
        gitCommit: options['git-commit']
      });
      break;
    case 'verify-bundle':
      if (!options.root) fail('verify-bundle требует --root');
      result = await verifyBundle(options.root);
      break;
    default:
      fail('Использование: runtime-contract.mjs inspect|write-release|verify-bundle [параметры]');
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`Ошибка offline runtime: ${error.message}\n`);
    process.exitCode = 1;
  });
}
