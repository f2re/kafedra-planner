import { pathToFileURL } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+$/u;
const SHA = /^[0-9a-f]{40}$/u;

export class ReleaseDecisionError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ReleaseDecisionError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new ReleaseDecisionError(code, message, details);
}

function bool(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0' || text === '') return false;
  fail('release_decision_boolean_invalid', `Некорректное логическое значение «${text}».`);
}

function version(value, field, { optional = false } = {}) {
  const text = String(value ?? '').trim();
  if (!text && optional) return null;
  if (!SEMVER.test(text)) {
    fail('release_decision_version_invalid', `Поле ${field} не содержит версию X.Y.Z.`, { field, value: text });
  }
  return text;
}

function sha(value, field, { optional = false } = {}) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text && optional) return null;
  if (!SHA.test(text)) {
    fail('release_decision_sha_invalid', `Поле ${field} не содержит полный commit SHA.`, { field, value: text });
  }
  return text;
}

export function decideRelease(input = {}) {
  const currentVersion = version(input.version, 'version');
  const sourceSha = sha(input.sourceSha, 'sourceSha');
  const parentVersion = version(input.parentVersion, 'parentVersion', { optional: true });
  const releaseExists = bool(input.releaseExists);
  const tagExists = bool(input.tagExists);
  const tagSha = sha(input.tagSha, 'tagSha', { optional: true });
  const tagIsAncestor = bool(input.tagIsAncestor);
  const tag = `v${currentVersion}`;

  if (!releaseExists) {
    if (tagExists) {
      fail(
        'release_tag_without_release',
        `Тег ${tag} существует без GitHub Release; автоматическая публикация запрещена.`,
        { tag, tagSha }
      );
    }
    return {
      version: currentVersion,
      tag,
      publish: true,
      exists: false,
      reason: 'new_version',
      releaseSha: null
    };
  }

  if (!tagExists || !tagSha) {
    fail(
      'release_without_tag',
      `GitHub Release ${tag} существует, но соответствующий git tag отсутствует или повреждён.`,
      { tag }
    );
  }

  if (tagSha === sourceSha) {
    return {
      version: currentVersion,
      tag,
      publish: false,
      exists: true,
      reason: 'already_published_current',
      releaseSha: tagSha
    };
  }

  if (parentVersion !== currentVersion) {
    fail(
      'release_version_reused',
      `VERSION изменена с ${parentVersion || 'неизвестной'} на уже опубликованную ${currentVersion}; тег ${tag} указывает на ${tagSha}.`,
      { version: currentVersion, parentVersion, tag, tagSha, sourceSha }
    );
  }

  if (!tagIsAncestor) {
    fail(
      'release_tag_not_ancestor',
      `Опубликованный commit ${tagSha} для ${tag} не является предком текущего main ${sourceSha}.`,
      { tag, tagSha, sourceSha }
    );
  }

  return {
    version: currentVersion,
    tag,
    publish: false,
    exists: true,
    reason: 'version_already_published',
    releaseSha: tagSha
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) fail('release_decision_argument_invalid', `Неизвестный аргумент «${token}».`);
    const key = token.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail('release_decision_argument_missing', `Для --${token.slice(2)} не задано значение.`);
    values[key] = value;
    index += 1;
  }
  return values;
}

export function githubOutput(decision) {
  return [
    `version=${decision.version}`,
    `tag=${decision.tag}`,
    `publish=${decision.publish}`,
    `exists=${decision.exists}`,
    `reason=${decision.reason}`,
    `release_sha=${decision.releaseSha || ''}`
  ].join('\n') + '\n';
}

export function main(argv = process.argv.slice(2)) {
  try {
    const decision = decideRelease(parseArgs(argv));
    process.stdout.write(githubOutput(decision));
    const message = decision.publish
      ? `Версия ${decision.version} ещё не опубликована: требуется проверка, сборка и публикация ${decision.tag}.`
      : decision.reason === 'already_published_current'
        ? `Release ${decision.tag} уже опубликован из текущего commit ${decision.releaseSha}; повтор является идемпотентным.`
        : `Версия ${decision.version} не менялась; сохраняется существующий release ${decision.tag} из commit ${decision.releaseSha}.`;
    process.stderr.write(`${message}\n`);
  } catch (error) {
    const code = error?.code || 'release_decision_failed';
    process.stderr.write(`${code}: ${error?.message || error}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
