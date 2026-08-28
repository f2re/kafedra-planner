import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateGovernance,
  evaluateMigrationPolicy,
  extractObservedWriteScope,
  globToRegExp,
  parseNameStatus,
  validateObservedWriteScope
} from '../scripts/grace-governance.mjs';

test('ObservedWriteScope supports exact files and GRACE-style ** globs', () => {
  const xml = `
    <ObservedWriteScope>
      <File>AGENTS.md</File>
      <Glob>scripts/**/*.mjs</Glob>
      <Glob>.grace/**</Glob>
    </ObservedWriteScope>`;
  const scope = extractObservedWriteScope(xml);
  assert.deepEqual(scope.files, ['AGENTS.md']);
  assert.match('scripts/ci/check.mjs', globToRegExp('scripts/**/*.mjs'));
  assert.match('.grace/context/requirements.xml', globToRegExp('.grace/**'));
  assert.deepEqual(validateObservedWriteScope([
    'AGENTS.md',
    'scripts/grace-governance.mjs',
    'scripts/ci/check.mjs',
    '.grace/graph/main.xml'
  ], scope), []);
  assert.deepEqual(validateObservedWriteScope(['apps/api/src/main.mjs'], scope), ['apps/api/src/main.mjs']);
});

test('governed diff fails closed when a write escapes the approved plan', () => {
  const entries = parseNameStatus([
    'M\tAGENTS.md',
    'A\t.grace/changes/active/C-TEST/spec.xml',
    'A\t.grace/changes/active/C-TEST/plan.xml',
    'M\tapps/api/src/main.mjs'
  ].join('\n'));
  const specXml = '<GraceChangeSpec graceVersion="4.0" status="approved"><C-TEST><Summary>x</Summary></C-TEST></GraceChangeSpec>';
  const planXml = '<GraceChangePlan graceVersion="4.0" status="approved"><C-TEST><ObservedWriteScope><File>AGENTS.md</File><Glob>.grace/**</Glob></ObservedWriteScope></C-TEST></GraceChangePlan>';
  const result = evaluateGovernance({ entries, changeId: 'C-TEST', specXml, planXml });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /apps\/api\/src\/main\.mjs/);
});

test('applied migrations are immutable', () => {
  const result = evaluateMigrationPolicy({
    baseMigrationFiles: ['migrations/001_initial.sql', 'migrations/002_next.sql'],
    entries: parseNameStatus('M\tmigrations/002_next.sql'),
    changedTestFiles: []
  });
  assert.ok(result.errors.some((message) => /immutable/.test(message)));
});

test('new migrations must be contiguous, tested and declared as database work', () => {
  const valid = evaluateMigrationPolicy({
    baseMigrationFiles: ['migrations/001_initial.sql', 'migrations/002_next.sql'],
    entries: parseNameStatus('A\tmigrations/003_feature.sql\nM\ttests/feature-migration.test.mjs'),
    changedTestFiles: ['tests/feature-migration.test.mjs'],
    specXml: '<AffectedAreas><M-DATABASE /></AffectedAreas>',
    planXml: '<VerificationAnchors><V-M-DATABASE /></VerificationAnchors>'
  });
  assert.deepEqual(valid.errors, []);

  const invalid = evaluateMigrationPolicy({
    baseMigrationFiles: ['migrations/001_initial.sql', 'migrations/002_next.sql'],
    entries: parseNameStatus('A\tmigrations/004_gap.sql'),
    changedTestFiles: [],
    specXml: '',
    planXml: ''
  });
  assert.ok(invalid.errors.some((message) => /expected 003/.test(message)));
  assert.ok(invalid.errors.some((message) => /migration.*test/i.test(message)));
  assert.ok(invalid.errors.some((message) => /M-DATABASE/.test(message)));
  assert.ok(invalid.errors.some((message) => /V-M-DATABASE/.test(message)));
});
