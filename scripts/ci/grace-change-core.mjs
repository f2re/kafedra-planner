import {
  changedPaths,
  extractObservedWriteScope,
  isGovernedPath,
  normalizePath,
  validateObservedWriteScope
} from './grace-scope-core.mjs';

const CHANGE_ID_PATTERN = /^C-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

function assertArtifact(xml, rootTag, changeId, expectedStatus, file) {
  if (!CHANGE_ID_PATTERN.test(changeId)) {
    throw new Error(`Invalid GRACE change id: ${changeId}`);
  }
  const root = String(xml).match(new RegExp(`<${rootTag}\\b([^>]*)>`));
  if (!root) throw new Error(`${file}: expected <${rootTag}> root.`);
  if (!/\bgraceVersion="4\.0"/.test(root[1])) {
    throw new Error(`${file}: graceVersion must be 4.0.`);
  }
  if (!new RegExp(`\\bstatus="${expectedStatus}"`).test(root[1])) {
    throw new Error(`${file}: status must be ${expectedStatus}.`);
  }
  if (!new RegExp(`<${changeId}(?:>|\\s)`).test(String(xml))) {
    throw new Error(`${file}: missing ${changeId} wrapper.`);
  }
}

export function evaluateGovernance({ entries, changeId, specXml, planXml }) {
  const errors = [];
  const paths = changedPaths(entries);
  const governed = paths.filter(isGovernedPath);
  if (governed.length === 0 && !changeId) return { errors, governed, paths };
  if (!changeId) {
    errors.push(
      `Governed diff requires exactly one active C-* change; changed paths: ${governed.join(', ')}`
    );
    return { errors, governed, paths };
  }

  try {
    assertArtifact(specXml, 'GraceChangeSpec', changeId, 'approved', `${changeId}/spec.xml`);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    assertArtifact(planXml, 'GraceChangePlan', changeId, 'approved', `${changeId}/plan.xml`);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    const scope = extractObservedWriteScope(planXml);
    if (scope.files.length === 0 && scope.globs.length === 0) {
      errors.push(`${changeId}/plan.xml: ObservedWriteScope is empty.`);
    } else {
      const outOfScope = validateObservedWriteScope(paths, scope);
      if (outOfScope.length) {
        errors.push(`Observed writes outside ${changeId} scope: ${outOfScope.join(', ')}`);
      }
    }
  } catch (error) {
    errors.push(error.message);
  }
  return { errors, governed, paths };
}

function sourcePaths(entries) {
  const paths = [];
  for (const entry of entries) {
    if (entry.oldPath) paths.push(entry.oldPath);
    else if (entry.status === 'D') paths.push(entry.path);
  }
  return new Set(paths.map(normalizePath));
}

function targetPaths(entries) {
  const paths = [];
  for (const entry of entries) {
    if (entry.oldPath) paths.push(entry.path);
    else if (entry.status !== 'D') paths.push(entry.path);
  }
  return new Set(paths.map(normalizePath));
}

export function evaluateArchiveTransition({ entries, changeId, specXml, planXml }) {
  const errors = [];
  const activePrefix = `.grace/changes/active/${changeId}/`;
  const archivePrefix = `.grace/changes/archive/${changeId}/`;
  const paths = changedPaths(entries);
  const outside = paths.filter(
    (path) => !path.startsWith(activePrefix) && !path.startsWith(archivePrefix)
  );
  if (outside.length) {
    errors.push(`Archive-only transition contains unrelated writes: ${outside.join(', ')}`);
  }

  const sources = sourcePaths(entries);
  const targets = targetPaths(entries);
  const activeRelative = [...sources]
    .filter((path) => path.startsWith(activePrefix))
    .map((path) => path.slice(activePrefix.length))
    .sort();
  const archiveRelative = [...targets]
    .filter((path) => path.startsWith(archivePrefix))
    .map((path) => path.slice(archivePrefix.length))
    .sort();

  if (activeRelative.length === 0 || JSON.stringify(activeRelative) !== JSON.stringify(archiveRelative)) {
    errors.push(
      `Archive transition must move one complete ${changeId} bundle without adding, dropping or renaming bundle files.`
    );
  }
  for (const name of ['spec.xml', 'plan.xml']) {
    if (!activeRelative.includes(name)) {
      errors.push(`Archive transition must remove ${activePrefix}${name}.`);
    }
    if (!archiveRelative.includes(name)) {
      errors.push(`Archive transition must add ${archivePrefix}${name}.`);
    }
  }

  try {
    assertArtifact(specXml, 'GraceChangeSpec', changeId, 'applied', `${changeId}/spec.xml`);
  } catch (error) {
    errors.push(error.message);
  }
  try {
    assertArtifact(planXml, 'GraceChangePlan', changeId, 'applied', `${changeId}/plan.xml`);
  } catch (error) {
    errors.push(error.message);
  }
  return { errors, paths };
}
