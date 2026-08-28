import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeMigrationDiff,
  extractObservedWriteScope,
  isSignificantPath,
  migrationEvidenceErrors,
  scopeMatches,
  validateScopeGlob
} from '../scripts/lib/grace-governance.mjs';
import { evaluateRequiredChecks, latestChecksByName } from '../scripts/grace-merge-gate.mjs';

const scope = extractObservedWriteScope(`
<GraceChangePlan graceVersion="4.0" status="approved">
  <C-TEST>
    <ObservedWriteScope>
      <File>AGENTS.md</File>
      <Glob>scripts/**</Glob>
      <Glob>tests/*.test.mjs</Glob>
    </ObservedWriteScope>
  </C-TEST>
</GraceChangePlan>`);

test('ObservedWriteScope поддерживает exact path, * и whole-segment **', () => {
  assert.deepEqual(scope.errors, []);
  assert.equal(scopeMatches(scope, 'AGENTS.md'), true);
  assert.equal(scopeMatches(scope, 'scripts/grace-policy.mjs'), true);
  assert.equal(scopeMatches(scope, 'scripts/lib/grace-governance.mjs'), true);
  assert.equal(scopeMatches(scope, 'tests/grace-governance.test.mjs'), true);
  assert.equal(scopeMatches(scope, 'tests/browser/grace-governance.test.mjs'), false);
  assert.equal(scopeMatches(scope, 'apps/api/src/main.mjs'), false);
});

test('небезопасный glob отклоняется', () => {
  assert.throws(() => validateScopeGlob('../scripts/**'), /пределы репозитория/);
  assert.throws(() => validateScopeGlob('scripts/**.mjs'), /Globstar/);
  assert.throws(() => validateScopeGlob('scripts/{a,b}.mjs'), /Неподдерживаемый/);
});

test('значимый diff включает runtime, schema, CI и инженерные контракты', () => {
  assert.equal(isSignificantPath('apps/api/src/main.mjs'), true);
  assert.equal(isSignificantPath('migrations/031_example.sql'), true);
  assert.equal(isSignificantPath('.github/workflows/ci.yml'), true);
  assert.equal(isSignificantPath('AGENTS.md'), true);
  assert.equal(isSignificantPath('docs/typo.md'), false);
});

test('миграции append-only: изменение существующей миграции запрещено', () => {
  const result = analyzeMigrationDiff({
    entries: [{ status: 'M', statusToken: 'M', paths: ['migrations/030_old.sql'], oldPath: null, newPath: 'migrations/030_old.sql' }],
    baseFiles: ['migrations/029_base.sql', 'migrations/030_old.sql'],
    headFiles: ['migrations/029_base.sql', 'migrations/030_old.sql']
  });
  assert.match(result.errors.join('\n'), /append-only/);
});

test('новые миграции должны продолжать нумерацию без разрыва', () => {
  const result = analyzeMigrationDiff({
    entries: [{ status: 'A', statusToken: 'A', paths: ['migrations/032_gap.sql'], oldPath: null, newPath: 'migrations/032_gap.sql' }],
    baseFiles: ['migrations/030_base.sql'],
    headFiles: ['migrations/030_base.sql', 'migrations/032_gap.sql']
  });
  assert.match(result.errors.join('\n'), /031/);
});

test('последовательные новые миграции принимаются', () => {
  const result = analyzeMigrationDiff({
    entries: [
      { status: 'A', statusToken: 'A', paths: ['migrations/031_first.sql'], oldPath: null, newPath: 'migrations/031_first.sql' },
      { status: 'A', statusToken: 'A', paths: ['migrations/032_second.sql'], oldPath: null, newPath: 'migrations/032_second.sql' }
    ],
    baseFiles: ['migrations/030_base.sql'],
    headFiles: ['migrations/030_base.sql', 'migrations/031_first.sql', 'migrations/032_second.sql']
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.newMigrations.map((item) => item.version), [31, 32]);
});

test('schema-change требует integrity, backup/restore и rollback evidence', () => {
  assert.equal(migrationEvidenceErrors(['grace:migrations backup:selftest quick_check foreign_key_check rollback']).length, 0);
  assert.equal(migrationEvidenceErrors(['grace:migrations']).length, 4);
});

test('merge gate использует новейший check run каждого имени', () => {
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

test('skipped/cancelled/failure не считаются успешным merge evidence', () => {
  const state = evaluateRequiredChecks([
    { id: 1, name: 'test', status: 'completed', conclusion: 'success' },
    { id: 2, name: 'browser', status: 'completed', conclusion: 'skipped' }
  ], ['test', 'browser']);
  assert.equal(state.complete, false);
  assert.deepEqual(state.failed.map((item) => item.conclusion), ['skipped']);
});
