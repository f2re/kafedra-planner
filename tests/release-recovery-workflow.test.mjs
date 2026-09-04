import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manuallyRunnableWorkflows = [
  '.github/workflows/ci.yml',
  '.github/workflows/release-gate.yml',
  '.github/workflows/organization.yml',
  '.github/workflows/science-reports.yml',
  '.github/workflows/science-lifecycle.yml',
  '.github/workflows/science-import.yml'
];

test('диагностические project workflows сохраняют явный manual dispatch', async () => {
  for (const path of manuallyRunnableWorkflows) {
    const source = await readFile(path, 'utf8');
    assert.match(source, /^\s{2}workflow_dispatch:\s*$/mu, `${path} должен поддерживать workflow_dispatch`);
  }
});

test('publisher использует только успешный universal Release gate и не оркестрирует остальные workflows', async () => {
  const source = await readFile('.github/workflows/release.yml', 'utf8');
  assert.match(source, /workflows: \["Release gate"\]/u);
  assert.match(source, /SOURCE_EVENT: \$\{\{ github\.event\.workflow_run\.event \|\| github\.event_name \}\}/u);
  assert.match(source, /SOURCE_BRANCH: \$\{\{ github\.event\.workflow_run\.head_branch \|\| github\.ref_name \}\}/u);
  assert.match(source, /SOURCE_CONCLUSION: \$\{\{ github\.event\.workflow_run\.conclusion \|\| 'success' \}\}/u);
  assert.match(source, /SOURCE_EVENT" == push && "\$SOURCE_BRANCH" == main && "\$SOURCE_CONCLUSION" == success/u);
  assert.match(source, /Завершить штатный no-op/u);
  assert.match(source, /main изменился: ожидался \$SOURCE_SHA/u);
  assert.doesNotMatch(source, /actions: write/u);
  assert.doesNotMatch(source, /required=\(/u);
  assert.doesNotMatch(source, /workflow_files/u);
  assert.doesNotMatch(source, /gh workflow run/u);
  assert.doesNotMatch(source, /declare -A recovered_from/u);
  assert.doesNotMatch(source, /failed_jobs/u);
});

test('publisher не повторяет gate tests и проверяет ровно тот artifact, который затем публикует', async () => {
  const source = await readFile('.github/workflows/release.yml', 'utf8');
  assert.doesNotMatch(source, /npm test/u);
  assert.doesNotMatch(source, /playwright test/u);
  assert.match(source, /Собрать полный автономный bundle один раз/u);
  assert.match(source, /ARCHIVE="\$\(find "\$OUT"/u);
  assert.match(source, /systemd-deploy-selftest\.sh "\$OUT"/u);
  assert.match(source, /project-control-package\.py/u);
  assert.match(source, /--archive "\$ARCHIVE"/u);
  assert.match(source, /SHA256SUMS/u);
  assert.match(source, /gh release create "\$TAG"/u);
  assert.match(source, /--target "\$SOURCE_SHA"/u);
});
