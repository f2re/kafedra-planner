import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHANGE_ID_PATTERN, normalizeRepositoryPath } from './grace-runtime.mjs';

function xmlDecode(value) {
  return value.replaceAll('&lt;', '<').replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');
}

function rootStatus(xml, rootTag) {
  const root = xml.match(new RegExp(`<${rootTag}\\b([^>]*)>`, 'i'));
  return root?.[1].match(/\bstatus\s*=\s*"([^"]+)"/i)?.[1] || null;
}

function directChangeWrapper(xml) {
  const matches = [...xml.matchAll(/<(C-[A-Z0-9]+(?:-[A-Z0-9]+)*)>/g)].map((match) => match[1]);
  return matches.length === 1 ? matches[0] : null;
}

export function inspectChangeBundle(root, location, changeId) {
  if (!['active', 'archive'].includes(location)) throw new Error(`Неизвестное расположение change bundle: ${location}`);
  if (!CHANGE_ID_PATTERN.test(changeId)) throw new Error(`Некорректный change id: ${changeId}`);
  const bundleDir = resolve(root, '.grace', 'changes', location, changeId);
  const specPath = resolve(bundleDir, 'spec.xml');
  const planPath = resolve(bundleDir, 'plan.xml');
  if (!existsSync(specPath) || !existsSync(planPath)) {
    return { changeId, location, bundleDir, specPath, planPath, valid: false,
      errors: [`${location}/${changeId} должен содержать spec.xml и plan.xml.`] };
  }
  const specXml = readFileSync(specPath, 'utf8');
  const planXml = readFileSync(planPath, 'utf8');
  const specStatus = rootStatus(specXml, 'GraceChangeSpec');
  const planStatus = rootStatus(planXml, 'GraceChangePlan');
  const specWrapper = directChangeWrapper(specXml);
  const planWrapper = directChangeWrapper(planXml);
  const expectedStatus = location === 'active' ? 'approved' : 'applied';
  const errors = [];
  if (specStatus !== expectedStatus || planStatus !== expectedStatus) {
    errors.push(`${location}/${changeId}: spec и plan должны иметь status="${expectedStatus}".`);
  }
  if (specWrapper !== changeId || planWrapper !== changeId) {
    errors.push(`${location}/${changeId}: C-* wrapper должен совпадать с именем каталога.`);
  }
  const scope = extractObservedWriteScope(planXml);
  errors.push(...scope.errors.map((error) => `${location}/${changeId}: ${error}`));
  return {
    changeId, location, bundleDir, specPath, planPath, specXml, planXml,
    specStatus, planStatus, specWrapper, planWrapper, scope,
    valid: errors.length === 0, errors
  };
}

export function extractObservedWriteScope(planXml) {
  const sections = [...planXml.matchAll(/<ObservedWriteScope>([\s\S]*?)<\/ObservedWriteScope>/g)];
  if (sections.length !== 1) {
    return { files: [], globs: [], none: false, errors: ['требуется ровно один ObservedWriteScope.'] };
  }
  const body = sections[0][1];
  const files = [...body.matchAll(/<(?:File|Path)>([\s\S]*?)<\/(?:File|Path)>/g)]
    .map((match) => xmlDecode(match[1].trim()));
  const globs = [...body.matchAll(/<Glob>([\s\S]*?)<\/Glob>/g)]
    .map((match) => xmlDecode(match[1].trim()));
  const none = /<None\s*\/>/.test(body);
  const errors = [];
  if (none && (files.length || globs.length)) errors.push('None нельзя сочетать с File/Path/Glob.');
  if (!none && !files.length && !globs.length) errors.push('scope не может быть пустым.');
  for (const file of files) {
    try { normalizeRepositoryPath(file); } catch (error) { errors.push(error.message); }
  }
  for (const glob of globs) {
    try { validateScopeGlob(glob); } catch (error) { errors.push(error.message); }
  }
  return {
    files: [...new Set(files.map(normalizeRepositoryPath))],
    globs: [...new Set(globs.map(validateScopeGlob))],
    none, errors
  };
}

export function validateScopeGlob(glob) {
  const normalized = normalizeRepositoryPath(glob);
  if (/[{}\[\]()]/.test(normalized) || normalized.startsWith('!')) {
    throw new Error(`Неподдерживаемый GRACE glob: ${glob}`);
  }
  for (const segment of normalized.split('/')) {
    if (segment.includes('**') && segment !== '**') {
      throw new Error(`Globstar должен занимать целый сегмент: ${glob}`);
    }
  }
  return normalized;
}

function segmentMatches(pattern, value) {
  let source = '^';
  for (const character of pattern) {
    if (character === '*') source += '[^/]*';
    else if (character === '?') source += '[^/]';
    else source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${source}$`).test(value);
}

function matchSegments(pattern, value, pi = 0, vi = 0, memo = new Map()) {
  const key = `${pi}:${vi}`;
  if (memo.has(key)) return memo.get(key);
  let result;
  if (pi === pattern.length) result = vi === value.length;
  else if (pattern[pi] === '**') {
    result = matchSegments(pattern, value, pi + 1, vi, memo)
      || (vi < value.length && matchSegments(pattern, value, pi, vi + 1, memo));
  } else {
    result = vi < value.length && segmentMatches(pattern[pi], value[vi])
      && matchSegments(pattern, value, pi + 1, vi + 1, memo);
  }
  memo.set(key, result);
  return result;
}

export function scopeMatches(scope, filePath) {
  const normalized = normalizeRepositoryPath(filePath);
  if (scope.none) return false;
  if (scope.files.includes(normalized)) return true;
  const pathSegments = normalized.split('/');
  return scope.globs.some((glob) => matchSegments(validateScopeGlob(glob).split('/'), pathSegments));
}
