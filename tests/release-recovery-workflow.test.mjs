import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const requiredWorkflows = [
  '.github/workflows/ci.yml',
  '.github/workflows/release-gate.yml',
  '.github/workflows/organization.yml',
  '.github/workflows/science-reports.yml',
  '.github/workflows/science-lifecycle.yml',
  '.github/workflows/science-import.yml'
];

test('каждый обязательный post-merge workflow допускает явный безопасный повтор', async () => {
  for (const path of requiredWorkflows) {
    const source = await readFile(path, 'utf8');
    assert.match(source, /^\s{2}workflow_dispatch:\s*$/mu, `${path} должен поддерживать workflow_dispatch`);
  }
});

test('publisher 0.3.3 восстанавливает только инфраструктурные runs и не скрывает реальные failures', async () => {
  const source = await readFile('.github/workflows/release.yml', 'utf8');
  assert.match(source, /workflows: \["Release gate 0\.3\.3"\]/u);
  assert.match(source, /permissions:\n\s+actions: write\n\s+contents: write/u);
  assert.match(source, /github\.event\.workflow_run\.head_branch == 'main'/u);
  assert.doesNotMatch(source, /workflow_run\.conclusion == 'success'/u);
  assert.match(source, /startup_failure\|failure\|cancelled\|success/u);
  assert.match(source, /job_count > 0/u);
  assert.match(source, /running_jobs/u);
  assert.match(source, /failed_jobs/u);
  assert.match(source, /success_jobs == job_count/u);
  assert.match(source, /Метаданные run '\$name' расходятся с jobs/u);
  assert.match(source, /gh workflow run "\$\{workflow_files\[\$name\]\}" --repo "\$GITHUB_REPOSITORY" --ref main/u);
  assert.match(source, /реально выполнял jobs и завершился ошибкой; повторять его автоматически нельзя/u);
  assert.match(source, /main уже изменился: ожидался \$SOURCE_SHA/u);
  assert.match(source, /declare -A recovered_from/u);
  assert.match(source, /Повторный запуск '\$name' также завершился без выполняемых jobs/u);
  assert.match(source, /tests\/browser\/docomator-integration\.spec\.mjs/u);
});
