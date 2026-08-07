import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createPerson } from '../packages/work-management/src/service.mjs';
import { extractPlan } from '../packages/plans/src/extractor.mjs';
import { listPlanCalendarSources, persistPlan } from '../packages/plans/src/service.mjs';
import { createZip, generateDocxFromPlanTemplate } from '../packages/plans/src/docx-generator.mjs';

const migrationsDir = resolve('migrations');
const exec = promisify(execFile);

function cell(table, row, column, text) {
  return {
    type: 'table_cell', text,
    locator: { kind: 'docx_table_cell', table, row, column },
    metadata: { table, row, column }
  };
}

test('разбирает табличный план, сохраняет источник и не дублирует календарь', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-plan-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    const person = createPerson(database, workspace.id, { displayName: 'Иванов Иван Иванович' });
    const now = new Date().toISOString();
    database.run("INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES ('planblob',1,'application/vnd.openxmlformats-officedocument.wordprocessingml.document','/tmp/plan.docx',?)", now);
    database.run("INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at) VALUES ('plandoc',?,'План кафедры','department_plan','processed',NULL,?,?)", workspace.id, now, now);
    database.run("INSERT INTO document_versions(id,document_id,version_no,blob_sha256,original_name,media_type,detected_format,processing_status,uploaded_at) VALUES ('planv','plandoc',1,'planblob','plan.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document','docx','processed',?)", now);
    database.run("UPDATE documents SET current_version_id = 'planv' WHERE id = 'plandoc'");

    const blocks = [
      cell(1, 1, 1, '№ п/п'), cell(1, 1, 2, 'Мероприятие'), cell(1, 1, 3, 'Дата проведения'), cell(1, 1, 4, 'Ответственный'), cell(1, 1, 5, 'Результат'),
      cell(1, 2, 1, '1'), cell(1, 2, 2, 'Заседание кафедры'), cell(1, 2, 3, '15 сентября'), cell(1, 2, 4, 'Иванов Иван Иванович'), cell(1, 2, 5, 'Протокол'),
      cell(1, 3, 1, '2'), cell(1, 3, 2, 'Подготовить годовой отчёт'), cell(1, 3, 3, '20.12.2026'), cell(1, 3, 4, 'Иванов Иван Иванович'), cell(1, 3, 5, 'Отчёт')
    ];
    const result = extractPlan({ text: 'ПЛАН работы кафедры на 2026 год', title: 'План кафедры', blocks });
    assert.equal(result.planScope, 'department');
    assert.equal(result.periodKey, '2026');
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].startsAt, '2026-09-15');
    assert.equal(result.items[0].responsibleRaw, 'Иванов Иван Иванович');

    const plan = persistPlan(database, {
      workspaceId: workspace.id, documentVersionId: 'planv', documentTitle: 'План кафедры', result, now
    });
    assert.equal(plan.items.length, 2);
    assert.equal(plan.items[0].responsible_person_id, person.id);
    assert.equal(database.get("SELECT COUNT(*) AS n FROM calendar_items WHERE source_kind = 'plan_item'").n, 2);
    const sources = listPlanCalendarSources(database, workspace.id);
    assert.equal(sources.length, 2);
    assert.equal(sources[0].source_document_id, 'plandoc');
    assert.equal(sources[0].scopeLabel, 'План кафедры');

    const retry = persistPlan(database, {
      workspaceId: workspace.id, documentVersionId: 'planv', documentTitle: 'План кафедры', result, now
    });
    assert.equal(retry.id, plan.id);
    assert.equal(database.get('SELECT COUNT(*) AS n FROM plans').n, 1);
    assert.equal(database.get("SELECT COUNT(*) AS n FROM calendar_items WHERE source_kind = 'plan_item'").n, 2);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('учебный год правильно переносит январь на следующий календарный год', () => {
  const blocks = [
    cell(1, 1, 1, 'Мероприятие'), cell(1, 1, 2, 'Сроки проведения'),
    cell(1, 2, 1, 'Осенняя конференция'), cell(1, 2, 2, '10 октября'),
    cell(1, 3, 1, 'Зимняя сессия'), cell(1, 3, 2, '20 января')
  ];
  const result = extractPlan({ text: 'План факультета на 2026/2027 учебный год', blocks });
  assert.equal(result.planScope, 'faculty');
  assert.equal(result.periodKey, '2026/27');
  assert.equal(result.items[0].startsAt, '2026-10-10');
  assert.equal(result.items[1].startsAt, '2027-01-20');
});

test('DOCX-генератор заменяет год и размножает строку-образец', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-plan-docx-'));
  const source = join(dir, 'template.docx');
  const target = join(dir, 'generated.docx');
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>План работы на 2025 год</w:t></w:r></w:p>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>№</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Мероприятие</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Дата</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Образец</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>01.01.2025</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl><w:p/></w:body></w:document>`;
  const contentTypes = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>';
  await writeFile(source, createZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes) },
    { name: 'word/document.xml', data: Buffer.from(xml) }
  ]));
  try {
    const result = await generateDocxFromPlanTemplate({
      sourcePath: source,
      targetPath: target,
      template: { table_index: 1, sample_row: 2, year_token: '2025', columnMap: { number: 1, title: 2, date: 3 } },
      periodKey: '2026',
      items: [
        { title: 'Первое мероприятие', startsAt: '2026-09-10' },
        { title: 'Второе мероприятие', startsAt: '2026-10-20' }
      ],
      maxBytes: 1024 * 1024
    });
    assert.equal(result.rowCount, 2);
    const { stdout } = await exec('unzip', ['-p', target, 'word/document.xml'], { encoding: 'utf8' });
    assert.match(stdout, /План работы на 2026 год/);
    assert.match(stdout, /Первое мероприятие/);
    assert.match(stdout, /Второе мероприятие/);
    assert.doesNotMatch(stdout, /Образец/);
    assert.match(stdout, /10\.09\.2026/);
    assert.ok((await readFile(target)).length > 100);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
