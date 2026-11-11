import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createManualPlan, createManualPlanItem } from '../packages/plans/src/manual.mjs';
import { createMonthlyPlan, getMonthlyPlan, updateMonthlyPlan } from '../packages/plans/src/monthly.mjs';
import { createEventTemplate, createEventTemplateVersion, defaultEventTemplateDefinition } from '../packages/plans/src/event-templates.mjs';
import { updatePlanEventDetails } from '../packages/plans/src/event-details.mjs';
import { generateMonthlyPlanDocument, renderMonthlyPlanXml } from '../packages/plan-docx/src/monthly-export.mjs';
import { renderEventTemplateXml, requiredEventFields, assertEventTemplateComplete, applyEventTemplateToSample } from '../packages/plan-docx/src/event-template-export.mjs';
import { wordVisibleText, readDocumentXml, bodyChildren, tableRows, rowCells } from '../packages/plan-docx/src/ooxml-shared.mjs';
import { analyzePlanDocumentXml } from '../packages/plan-docx/src/analyzer.mjs';
import { createPlanTemplate } from '../packages/plan-docx/src/service.mjs';
import { writeZipArchive, readZipEntry } from '../packages/plan-docx/src/archive.mjs';
import { registerDocument } from '../packages/storage/src/documents.mjs';
import { storeGeneratedFile } from '../packages/document-intake/src/blob-store.mjs';

function definition() {
  const value = defaultEventTemplateDefinition();
  value.fields.push({ key: 'custom_equipment', label: 'Оборудование', source: 'custom', type: 'text', visible: true, required: true, width: 30 });
  value.fields.push({ key: 'custom_count', label: 'Участников', source: 'custom', type: 'number', visible: true, required: false, width: 10 });
  value.fields.push({ key: 'custom_internal', label: 'Служебное поле', source: 'custom', type: 'text', visible: false, required: false, width: 10 });
  return value;
}

function snapshot() {
  return { title: 'План кафедры', month: '2026-11', eventTemplate: { id: 'test-version', definition: definition() }, items: [
    { membershipId: 'row', source: { id: 'event' }, effective: { title: 'Семинар & практика', startsAt: '2026-11-15', responsibleRaw: '', location: 'Аудитория 12', customValues: { custom_equipment: 'Радиозонд', custom_count: '0', custom_internal: 'Внутренняя пометка' } } }
  ] };
}

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-event-export-'));
  const database = new Database(join(root, 'db.sqlite'), { migrationsDir: resolve('migrations') });
  try {
    const workspaceId = ensureDefaultWorkspace(database).id;
    const context = { enabled: false, authenticated: true, role: 'admin', workspaceId };
    const config = { tempDir: join(root, 'temp'), blobDir: join(root, 'blobs') };
    const plan = createManualPlan(database, workspaceId, { planKind: 'department', periodKind: 'calendar', year: 2026, title: 'План кафедры метеорологии' });
    const item = createManualPlanItem(database, workspaceId, plan.id, { title: 'Практикум кафедры', startsAt: '2026-11-15', direction: 'education' });
    const template = createEventTemplate(database, workspaceId, { title: 'План с оснащением', definition: definition(), idempotencyKey: 'template-create' }, context);
    updatePlanEventDetails(database, workspaceId, item.id, { expectedRevision: 0, templateVersionId: template.currentVersionId, location: 'Аудитория 12', customValues: { custom_equipment: 'Радиозонд', custom_count: '0', custom_internal: 'Внутренняя пометка' } }, context);
    const draft = createMonthlyPlan(database, workspaceId, { month: '2026-11', eventTemplateVersionId: template.currentVersionId, departmentText: 'Кафедра метеорологии', planItemIds: [item.id], idempotencyKey: 'month-create' }, context);
    await run({ database, workspaceId, context, config, plan, item, template, draft, root });
    assert.deepEqual(database.foreignKeyCheck(), []);
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
}

test('визуальный шаблон определяет колонки, ширины, порядок, ориентацию и необязательного исполнителя', () => {
  const data = snapshot();
  data.eventTemplate.definition.layout = { orientation: 'portrait', showRowNumbers: false };
  const xml = renderEventTemplateXml(data);
  const table = bodyChildren(xml).find(child => child.tag === 'tbl');
  const rows = tableRows(table.xml);
  const heading = rowCells(rows[0].xml).map(cell => wordVisibleText(cell.xml));
  assert.deepEqual(heading, ['Мероприятие', 'Срок', 'Исполнитель', 'Место', 'Оборудование', 'Участников']);
  assert.equal(rowCells(rows[1].xml).length, 6);
  assert.equal(rowCells(rows[1].xml).map(cell => wordVisibleText(cell.xml))[2], '');
  assert.equal(rowCells(rows[1].xml).map(cell => wordVisibleText(cell.xml))[5], '0');
  assert.match(wordVisibleText(xml), /Семинар & практика/u);
  assert.match(wordVisibleText(xml), /15 ноября 2026/u);
  assert.doesNotMatch(wordVisibleText(xml), /Служебное поле|Внутренняя пометка/u);
  assert.match(xml, /w:pgSz w:w="11906" w:h="16838"/u);
  assert.equal([...table.xml.matchAll(/<w:gridCol w:w="(\d+)"/gu)].reduce((sum, match) => sum + Number(match[1]), 0), 9638);
  assert.doesNotThrow(() => assertEventTemplateComplete(data));
});

test('обязательные пустые поля названы по строкам; неизвестный срок не подставляется', () => {
  const data = snapshot();
  data.items[0].effective.startsAt = null;
  data.items[0].effective.customValues.custom_equipment = '';
  assert.deepEqual(requiredEventFields(data).map(item => item.fieldKey), ['date', 'custom_equipment']);
  assert.throws(() => assertEventTemplateComplete(data), error => error.code === 'event_template_required_fields' && error.status === 422 && error.details.missing.length === 2);
  assert.doesNotMatch(wordVisibleText(renderEventTemplateXml(data)), /Без точного срока/u);
});

test('стандартная таблица без визуального шаблона выводит сохранённое место мероприятия', () => {
  const data = { ...snapshot(), eventTemplate: null };
  const xml = renderMonthlyPlanXml(data);
  const rows = tableRows(bodyChildren(xml).find(child => child.tag === 'tbl').xml);
  const header = rowCells(rows[0].xml).map(cell => wordVisibleText(cell.xml));
  const values = rowCells(rows[1].xml).map(cell => wordVisibleText(cell.xml));
  assert.equal(values[header.indexOf('Место')], 'Аудитория 12');
  assert.equal(values.length, header.length);
});

test('таблица визуального шаблона сохраняет внешние абзацы образца и меняет только свою секцию', () => {
  const data = snapshot();
  data.eventTemplate.definition.layout.orientation = 'portrait';
  const legacy = renderMonthlyPlanXml({ ...data, eventTemplate: null });
  const signed = legacy.replace('<w:tbl>', '<w:p><w:r><w:t>УТВЕРЖДАЮ</w:t></w:r></w:p><w:tbl>')
    .replace('<w:sectPr>', '<w:p><w:r><w:t>Заведующий кафедрой: __________</w:t></w:r></w:p><w:sectPr>');
  const result = applyEventTemplateToSample(signed, 1, data);
  assert.match(wordVisibleText(result), /УТВЕРЖДАЮ/u);
  assert.match(wordVisibleText(result), /Заведующий кафедрой: __________/u);
  assert.match(wordVisibleText(result), /Оборудование/u);
  assert.match(result, /w:pgSz w:w="11906" w:h="16838"/u);
  assert.doesNotMatch(wordVisibleText(result), /Результат \/ примечание/u);
  for (const section of ['', '<w:sectPr/>']) {
    const minimalSample = signed.replace(/<w:sectPr>[\s\S]*?<\/w:sectPr>/u, section);
    const minimalResult = applyEventTemplateToSample(minimalSample, 1, data);
    assert.match(minimalResult, /w:pgSz w:w="11906" w:h="16838"/u);
    assert.match(wordVisibleText(minimalResult), /Заведующий кафедрой: __________/u);
  }
});

test('DOCX фиксирует старую версию полей, источник и значения; повтор не создаёт календарных дублей', async () => fixture(async f => {
  const { database: db, workspaceId: ws, context, draft, config, template } = f;
  const before = db.all('SELECT id FROM calendar_items ORDER BY id');
  const request = { expectedRevision: draft.revision, idempotencyKey: 'visual-export' };
  const first = await generateMonthlyPlanDocument(db, ws, draft.id, request, config, context);
  const stored = JSON.parse(db.get('SELECT snapshot_json FROM monthly_plan_exports WHERE id=?', first.id).snapshot_json);
  assert.equal(stored.eventTemplate.id, template.currentVersionId);
  assert.equal(stored.items[0].effective.location, 'Аудитория 12');
  assert.equal(stored.items[0].effective.customValues.custom_equipment, 'Радиозонд');
  assert.equal(stored.department, 'Кафедра метеорологии');
  const revised = definition();
  revised.fields.find(field => field.key === 'custom_equipment').label = 'Оснащение занятия';
  createEventTemplateVersion(db, ws, template.id, { title: 'Новая редакция', definition: revised, expectedVersion: 1, idempotencyKey: 'template-v2' }, context);
  const repeated = await generateMonthlyPlanDocument(db, ws, draft.id, request, config, context);
  assert.equal(repeated.documentId, first.documentId);
  assert.equal(repeated.duplicateRequest, true);
  const path = db.get('SELECT storage_path FROM file_blobs WHERE sha256=?', first.sha256).storage_path;
  const text = wordVisibleText(await readDocumentXml(path));
  assert.match(text, /Оборудование/u);
  assert.doesNotMatch(text, /Оснащение занятия|Внутренняя пометка/u);
  assert.equal(getMonthlyPlan(db, ws, draft.id, context).eventTemplate.version, 1);
  assert.deepEqual(db.all('SELECT id FROM calendar_items ORDER BY id'), before);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM plan_items').n, 1);
}));

test('выгрузка с DOCX-образцом и визуальными полями сохраняет пакет и выводит custom колонки', async () => fixture(async f => {
  const { database: db, workspaceId: ws, context, config, root } = f;
  let draft = f.draft;
  const sampleData = snapshot(); sampleData.items[0].effective.location = '';
  const xml = renderMonthlyPlanXml({ ...sampleData, eventTemplate: null })
    .replace('<w:sectPr>', '<w:p><w:r><w:t>Подпись руководителя</w:t></w:r></w:p><w:sectPr>');
  const source = join(root, 'sample.docx');
  await writeZipArchive(source, { '[Content_Types].xml': '<Types/>', 'word/document.xml': xml, 'word/header1.xml': '<header>Original stationery</header>' });
  const blob = await storeGeneratedFile(source, { blobDir: config.blobDir, mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const document = registerDocument(db, { workspaceId: ws, title: 'Образец', requestedType: 'plan_template', originalName: 'sample.docx', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', detectedFormat: 'docx', blob, idempotencyKey: 'visual-sample' });
  const analysis = analyzePlanDocumentXml(xml, { planKind: 'department' });
  const sample = await createPlanTemplate(db, ws, { documentId: document.documentId, name: 'Образец с подписью', planKind: 'department', config: analysis.suggestedConfig });
  draft = updateMonthlyPlan(db, ws, draft.id, { expectedRevision: draft.revision, templateId: sample.id }, context);
  const result = await generateMonthlyPlanDocument(db, ws, draft.id, { expectedRevision: draft.revision, idempotencyKey: 'sample-combined' }, config, context);
  const path = db.get('SELECT storage_path FROM file_blobs WHERE sha256=?', result.sha256).storage_path;
  const text = wordVisibleText(await readDocumentXml(path));
  assert.match(text, /Подпись руководителя/u);
  assert.match(text, /Оборудование/u);
  assert.match(text, /Радиозонд/u);
  assert.equal((await readZipEntry(path, 'word/header1.xml')).toString(), '<header>Original stationery</header>');
  assert.ok((await readFile(path)).length > 1000);
}));

test('изменение места во время выгрузки отменяет публикацию устаревшего снимка', async () => fixture(async f => {
  const { database: db, workspaceId: ws, context, config, item, draft } = f;
  const pending = generateMonthlyPlanDocument(db, ws, draft.id, { expectedRevision: draft.revision, idempotencyKey: 'changed-location' }, config, context);
  updatePlanEventDetails(db, ws, item.id, { expectedRevision: 1, location: 'Аудитория 14' }, context);
  await assert.rejects(pending, { code: 'monthly_plan_export_source_changed' });
  assert.equal(db.get("SELECT COUNT(*) AS n FROM documents WHERE document_type='monthly_plan_export'").n, 0);
  assert.equal(db.get("SELECT status FROM monthly_plan_exports WHERE idempotency_key='changed-location'").status, 'failed');
}));

test('старый DOCX-образец без колонки места сохраняет место в доступной печатной колонке', async () => fixture(async f => {
  const { database: db, workspaceId: ws, context, config, root } = f;
  const data = snapshot(); data.items[0].effective.location = '';
  const xml = renderMonthlyPlanXml({ ...data, eventTemplate: null });
  const source = join(root, 'legacy.docx');
  await writeZipArchive(source, { '[Content_Types].xml': '<Types/>', 'word/document.xml': xml });
  const mediaType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const blob = await storeGeneratedFile(source, { blobDir: config.blobDir, mediaType });
  const document = registerDocument(db, { workspaceId: ws, title: 'Старый образец', requestedType: 'plan_template', originalName: 'legacy.docx', mediaType, detectedFormat: 'docx', blob, idempotencyKey: 'legacy-sample' });
  const analysis = analyzePlanDocumentXml(xml, { planKind: 'department' });
  const sample = await createPlanTemplate(db, ws, { documentId: document.documentId, name: 'Образец только с названием и сроком', planKind: 'department', config: { ...analysis.suggestedConfig, columns: { title: 3, date: 4 } } });
  const draft = updateMonthlyPlan(db, ws, f.draft.id, { expectedRevision: f.draft.revision, eventTemplateVersionId: null, templateId: sample.id }, context);
  const result = await generateMonthlyPlanDocument(db, ws, draft.id, { expectedRevision: draft.revision, idempotencyKey: 'legacy-location' }, config, context);
  const output = db.get('SELECT storage_path FROM file_blobs WHERE sha256=?', result.sha256).storage_path;
  const exported = wordVisibleText(await readDocumentXml(output));
  assert.match(exported, /Практикум кафедры/u);
  assert.match(exported, /Место: Аудитория 12/u);
  assert.equal(getMonthlyPlan(db, ws, draft.id, context).items[0].effective.title, 'Практикум кафедры');
}));
