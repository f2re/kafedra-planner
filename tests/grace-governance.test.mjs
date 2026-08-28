import test from 'node:test';
import assert from 'node:assert/strict';

import {
  changedActiveChangeIds,
  evaluateGovernance,
  evaluateMigrationPolicy,
  extractObservedWriteScope,
  globToRegExp,
  isGovernedPath,
  parseNameStatus,
  validateObservedWriteScope
} from '../scripts/grace-governance.mjs';
import { evaluateDurableModelDiff } from '../scripts/github/grace-durable-gate.mjs';
import { evaluateRequiredChecks, latestChecksByName } from '../scripts/github/grace-merge-gate.mjs';
import { GRACE_MERGE_CHECK, REQUIRED_MAIN_CHECKS, mainProtectionPayload } from '../scripts/github/grace-required-checks.mjs';

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

test('governance covers product, tests, docs, agent skills and delivery surfaces', () => {
  for (const path of [
    'apps/api/src/main.mjs',
    'packages/storage/src/database.mjs',
    'tests/example.test.mjs',
    'docs/ARCHITECTURE.md',
    'codex/skills/kafedra-data/SKILL.md',
    '.github/workflows/ci.yml',
    'README.md',
    'VERSION'
  ]) {
    assert.equal(isGovernedPath(path), true, `${path} must be governed`);
  }
  assert.equal(isGovernedPath('.grace/changes/archive/C-OLD/spec.xml'), false);
});

test('archive-only lifecycle move does not select a deleted active change', () => {
  const entries = parseNameStatus([
    'D\t.grace/changes/active/C-DONE/spec.xml',
    'D\t.grace/changes/active/C-DONE/plan.xml',
    'A\t.grace/changes/archive/C-DONE/spec.xml',
    'A\t.grace/changes/archive/C-DONE/plan.xml'
  ].join('\n'));
  assert.deepEqual(changedActiveChangeIds(entries, () => false), []);
  assert.deepEqual(changedActiveChangeIds(entries, (id) => id === 'C-DONE'), ['C-DONE']);
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

test('durable GRACE context/graph/verification cannot change without one active C-*', () => {
  const entries = parseNameStatus('M\t.grace/context/principles.xml');
  const result = evaluateDurableModelDiff({ entries, activeIds: [] });
  assert.ok(result.errors.some((message) => /exactly one approved active C-\*/.test(message)));
  assert.deepEqual(evaluateDurableModelDiff({ entries, activeIds: ['C-CONTEXT'] }).errors, []);
});

test('terminal archive transition must be a complete active-to-archive move with applied artifacts', () => {
  const entries = parseNameStatus([
    'R098\t.grace/changes/active/C-DONE/spec.xml\t.grace/changes/archive/C-DONE/spec.xml',
    'R098\t.grace/changes/active/C-DONE/plan.xml\t.grace/changes/archive/C-DONE/plan.xml'
  ].join('\n'));
  const archiveArtifacts = new Map([['C-DONE', {
    specXml: '<GraceChangeSpec graceVersion="4.0" status="applied"><C-DONE /></GraceChangeSpec>',
    planXml: '<GraceChangePlan graceVersion="4.0" status="applied"><C-DONE /></GraceChangePlan>'
  }]]);
  assert.deepEqual(evaluateDurableModelDiff({ entries, activeIds: [], archiveArtifacts }).errors, []);

  const forged = parseNameStatus('A\t.grace/changes/archive/C-FORGED/spec.xml');
  assert.ok(evaluateDurableModelDiff({ entries: forged, activeIds: [], archiveArtifacts: new Map() }).errors.length > 0);
});

test('required main checks have one shared unique desired-state list', () => {
  assert.equal(new Set(REQUIRED_MAIN_CHECKS).size, REQUIRED_MAIN_CHECKS.length);
  assert.ok(REQUIRED_MAIN_CHECKS.includes(GRACE_MERGE_CHECK));
  assert.ok(REQUIRED_MAIN_CHECKS.includes('Full offline Debian 12 + Project Control'));
  assert.deepEqual(mainProtectionPayload().required_status_checks.contexts, [...REQUIRED_MAIN_CHECKS]);
  assert.equal(mainProtectionPayload().required_status_checks.strict, true);
});

test('exact-SHA merge gate uses the newest run of every required name', () => {
  const latest = latestChecksByName([
    { id: 1, name: 'test', status: 'completed', conclusion: 'failure' },
    { id: 3, name: 'test', status: 'completed', conclusion: 'success' },
    { id: 2, name: 'browser', status: 'in_progress', conclusion: null }
  ]);
  assert.equal(latest.get('test').id, 3);
  const state = evaluateRequiredChecks([...latest.values()], ['test', 'browser', 'offline']);
  assert.deepEqual(state.successful, ['test']);
  assert.deepEqual(state.pending, [{ name: 'browser', status: 'in_progress' }]);
  assert.deepEqual(state.missing, ['offline']);
  assert.deepEqual(state.failed, []);
});

test('skipped, cancelled and failed checks are never merge evidence', () => {
  const state = evaluateRequiredChecks([
    { id: 1, name: 'test', status: 'completed', conclusion: 'success' },
    { id: 2, name: 'browser', status: 'completed', conclusion: 'skipped' },
    { id: 3, name: 'offline', status: 'completed', conclusion: 'cancelled' }
  ], ['test', 'browser', 'offline']);
  assert.equal(state.complete, false);
  assert.deepEqual(state.failed.map((item) => item.conclusion), ['skipped', 'cancelled']);
});
