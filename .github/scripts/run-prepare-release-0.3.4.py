from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


prepare_path = Path(".github/scripts/prepare-release-0.3.4.py")
source = prepare_path.read_text(encoding="utf-8")
source = source.replace(
    "CI проверяет миграции до schema 029, foreign keys, quick check, logical digest и полный backup/restore.",
    "CI проверяет миграции до schema 029, backup/restore, Node 24.15 и host Node 25, desktop/mobile Chromium, интеграцию Оформлятора, full-offline Debian 12, additive APT policy и systemd-сценарии с LLM и без него.",
)
source = source.replace(
    "CI проверяет миграции до schema 030, foreign keys, quick check, logical digest и полный backup/restore.",
    "CI проверяет миграции до schema 030, backup/restore, Node 24.15 и host Node 25, desktop/mobile Chromium, интеграцию Оформлятора, full-offline Debian 12, additive APT policy и systemd-сценарии с LLM и без него.",
)
source = source.replace(
    "test('обновление 28 → 29 добавляет mapping полей без изменения существующей интеграции'",
    "test('обновление 28 → 29 добавляет выбор полей и сохраняет существующие связи Оформлятора'",
)
source = source.replace(
    "test('обновление 29 → 30 добавляет mapping полей без изменения существующей интеграции'",
    "test('обновление 29 → 30 добавляет выбор полей и сохраняет существующие связи Оформлятора'",
)
exec(compile(source, str(prepare_path), "exec"), {"__name__": "__main__"})

migration = Path("tests/docomator-fields-migration.test.mjs")
text = migration.read_text(encoding="utf-8")
old_schema = "assert.equal(database.getSchemaVersion(), 30);"
target_schema = "assert.equal(database.getSchemaVersion(), 29);"
if old_schema not in text or target_schema not in text:
    raise SystemExit("migration test: не найдены assertions для перестановки")
text = text.replace(old_schema, "__OLD_SCHEMA_ASSERT__", 1)
text = text.replace(target_schema, old_schema, 1)
text = text.replace("__OLD_SCHEMA_ASSERT__", target_schema, 1)
migration.write_text(text, encoding="utf-8")

target = Path("docs/TARGET_ACCEPTANCE.md")
target_text = target.read_text(encoding="utf-8")
if "0.3.3" not in target_text:
    raise SystemExit("TARGET_ACCEPTANCE: не найден release marker 0.3.3")
target.write_text(target_text.replace("0.3.3", "0.3.4"), encoding="utf-8")

release_assets = """import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('publisher 0.3.4 публикует полный проверяемый набор release assets', async () => {
  const source = await readFile('.github/workflows/release.yml', 'utf8');
  assert.match(source, /--target \"\$SOURCE_SHA\"/u);
  assert.match(source, /\"\$ARCHIVE\"/u);
  assert.match(source, /\"\$ARCHIVE\.sha256\"/u);
  assert.match(source, /install-kafedra-planner\.sh/u);
  assert.match(source, /README-INSTALL\.txt/u);
  assert.match(source, /kafedra-planner-\$\{VERSION\}-project-control\.f2re\.zip/u);
  assert.match(source, /kafedra-planner-\$\{VERSION\}-project-control\.f2re\.zip\.sha256/u);
  assert.match(source, /SHA256SUMS/u);
  assert.match(source, /sha256sum -c --strict SHA256SUMS/u);
  assert.match(source, /\.assets \| length' <<<\"\$RELEASE\"\)\" -ge 7/u);
  assert.match(source, /\[\[ \"\$OBJECT_SHA\" == \"\$SOURCE_SHA\" \]\]/u);
  assert.match(source, /--latest/u);
  assert.doesNotMatch(source, /--prerelease/u);
});

test('контракт выпуска содержит VERSION 0.3.4 и schema 30', async () => {
  assert.equal((await readFile('VERSION', 'utf8')).trim(), '0.3.4');
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.version, '0.3.4');
  await readFile('migrations/030_docomator_field_mapping.sql', 'utf8');
  const notes = await readFile('docs/releases/0.3.4.md', 'utf8');
  assert.match(notes, /^# Kafedra Planner 0\.3\.4$/mu);
  assert.match(notes, /схема SQLite.*30/iu);
});
"""
write("tests/release-assets-contract.test.mjs", release_assets)

release_recovery = """import test from 'node:test';
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

test('publisher 0.3.4 восстанавливает только инфраструктурные runs и не скрывает реальные failures', async () => {
  const source = await readFile('.github/workflows/release.yml', 'utf8');
  assert.match(source, /workflows: \[\"Release gate 0\.3\.4\"\]/u);
  assert.match(source, /permissions:\n\s+actions: write\n\s+contents: write/u);
  assert.match(source, /github\.event\.workflow_run\.head_branch == 'main'/u);
  assert.doesNotMatch(source, /workflow_run\.conclusion == 'success'/u);
  assert.match(source, /startup_failure\|failure\|cancelled\|success/u);
  assert.match(source, /job_count > 0/u);
  assert.match(source, /running_jobs/u);
  assert.match(source, /failed_jobs/u);
  assert.match(source, /success_jobs == job_count/u);
  assert.match(source, /gh workflow run/u);
  assert.match(source, /реально выполнял jobs и завершился ошибкой; повторять его автоматически нельзя/u);
  assert.match(source, /main уже изменился: ожидался \$SOURCE_SHA/u);
  assert.match(source, /declare -A recovered_from/u);
  assert.match(source, /tests\/browser\/docomator-fields\.spec\.mjs/u);
  assert.match(source, /tests\/browser\/meeting-template-editor\.spec\.mjs/u);
});
"""
write("tests/release-recovery-workflow.test.mjs", release_recovery)
