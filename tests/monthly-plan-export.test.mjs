import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { createManualPlan, createManualPlanItem, updateManualPlanItem } from '../packages/plans/src/manual.mjs';
import { createMonthlyPlan, getMonthlyPlan, updateMonthlyPlan, updateMonthlyPlanItem } from '../packages/plans/src/monthly.mjs';
import { analyzePlanDocumentXml } from '../packages/plan-docx/src/analyzer.mjs';
import { generatePlanDocumentXml } from '../packages/plan-docx/src/generator.mjs';
import { createPlanTemplate, generatePlanDocument } from '../packages/plan-docx/src/service.mjs';
import { registerDocument } from '../packages/storage/src/documents.mjs';
import { storeGeneratedFile } from '../packages/document-intake/src/blob-store.mjs';
import { writeZipArchive } from '../packages/plan-docx/src/archive.mjs';
import { generateMonthlyPlanDocument, renderMonthlyPlanXml, monthlyItemDate } from '../packages/plan-docx/src/monthly-export.mjs';
import { readDocumentXml, wordVisibleText, bodyChildren, tableRows } from '../packages/plan-docx/src/ooxml-shared.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'kafedra-month-export-'));
  const database = new Database(join(root, 'test.sqlite3'), { migrationsDir: resolve('migrations') });
  try {
    const workspaceId = ensureDefaultWorkspace(database).id;
    const context = { enabled: false, authenticated: true, role: 'admin', workspaceId };
    const config = { tempDir: join(root, 'tmp'), blobDir: join(root, 'blobs') };
    const annual = createManualPlan(database, workspaceId, {
      planKind: 'department', periodKind: 'calendar', year: 2026, title: 'План кафедры на 2026 год'
    });
    const first = createManualPlanItem(database, workspaceId, annual.id, {
      title: 'Методический семинар', startsAt: '2026-11-15', direction: 'education', responsibleRaw: 'Иванов И. И.'
    });
    const second = createManualPlanItem(database, workspaceId, annual.id, {
      title: 'Научная конференция', dueDate: '2026-11-20', direction: 'science', expectedResult: 'Доклад'
    });
    const draft = createMonthlyPlan(database, workspaceId, {
      month: '2026-11', title: 'План кафедры', planItemIds: [first.id, second.id], idempotencyKey: 'compose-month-export'
    }, context);
    await run({ database, workspaceId, context, config, annual, first, second, draft, root });
    assert.deepEqual(database.foreignKeyCheck(), []);
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
}

function snapshot(month = '2026-11') {
  return { month, title: 'План работы кафедры', items: [{ effective: {
    title: 'Образец мероприятия', dateText: '15 ноября 2026', responsibleRaw: 'Иванов',
    activityKind: 'methodological', expectedResult: 'Методическое пособие', note: ''
  } }] };
}

test('месячный DOCX-образец распознаёт месяц и сохраняет стили при следующем месяце', () => {
  const xml = renderMonthlyPlanXml(snapshot());
  const analysis = analyzePlanDocumentXml(xml, { planKind: 'department' });
  assert.equal(analysis.ready, true);
  assert.equal(analysis.detectedPeriod.kind, 'monthly');
  assert.equal(analysis.detectedPeriod.periodKey, '2026-11');
  const generated = generatePlanDocumentXml(xml, {
    config: analysis.suggestedConfig, targetPeriod: { periodKind: 'monthly', periodKey: '2027-02' },
    items: [{ title: 'Новое мероприятие & проверка', dateText: 'По отдельному графику', activityKind: 'teaching' }]
  });
  const visible = wordVisibleText(generated.xml);
  assert.match(visible, /на февраль 2027 года/u);
  assert.match(visible, /Новое мероприятие & проверка/u);
  assert.doesNotMatch(visible, /Образец мероприятия|15 ноября/u);
  assert.match(generated.xml, /w:orient="landscape"/u);
  assert.match(generated.xml, /w:tblHeader/u);
  assert.match(generated.xml, /Times New Roman/u);
  assert.throws(() => generatePlanDocumentXml(xml, {
    config: analysis.suggestedConfig, targetPeriod: { periodKind: 'monthly', periodKey: '2027-13' }, items: [{ title: 'X' }]
  }), /plan_generation_period_invalid/u);
});

test('разбор месячного заголовка не подменяет подпись, а конфликт двух месяцев требует выбора', () => {
  const source = renderMonthlyPlanXml(snapshot());
  const withSignature = source.replace('<w:sectPr>', '<w:p><w:r><w:t>Подписано 20 декабря 2026 года</w:t></w:r></w:p><w:sectPr>');
  const analysis = analyzePlanDocumentXml(withSignature, { planKind: 'department' });
  assert.equal(analysis.detectedPeriod.month, 11);
  assert.equal(analysis.suggestedConfig.periodAnchors.length, 1);
  const ambiguous = source.replace('на ноябрь 2026 года', 'на ноябрь и декабрь 2026 года');
  assert.equal(analyzePlanDocumentXml(ambiguous, { planKind: 'department' }).ready, false);
  const genitive = source.replace('на ноябрь 2026 года', 'План ноября 2026 года');
  const mapped = analyzePlanDocumentXml(genitive, { planKind: 'department' });
  assert.equal(mapped.ready, true);
  const generated = generatePlanDocumentXml(genitive, {
    config: mapped.suggestedConfig, targetPeriod: { periodKind: 'monthly', periodKey: '2026-12' }, items: [{ title: 'X' }]
  });
  assert.match(wordVisibleText(generated.xml), /План декабря 2026 года/u);
  const similarWord = source.replace('на ноябрь 2026 года', 'План работы майора Иванова на май 2026 года');
  const similarAnalysis = analyzePlanDocumentXml(similarWord, { planKind: 'department' });
  const changed = generatePlanDocumentXml(similarWord, {
    config: similarAnalysis.suggestedConfig, targetPeriod: { periodKind: 'monthly', periodKey: '2026-06' }, items: [{ title: 'X' }]
  });
  assert.match(wordVisibleText(changed.xml), /План работы майора Иванова на июнь 2026 года/u);
  const repeatedYear = source.replace('на ноябрь 2026 года', 'План группы набора 2026 года на ноябрь 2026 года');
  const repeatedAnalysis = analyzePlanDocumentXml(repeatedYear, { planKind: 'department' });
  assert.equal(repeatedAnalysis.suggestedConfig.periodAnchors.length, 1);
  const nextYear = generatePlanDocumentXml(repeatedYear, {
    config: repeatedAnalysis.suggestedConfig, targetPeriod: { periodKind: 'monthly', periodKey: '2027-02' }, items: [{ title: 'X' }]
  });
  assert.match(wordVisibleText(nextYear.xml), /План группы набора 2026 года на февраль 2027 года/u);
});

test('выгрузка — неизменяемый DOCX-снимок: повторы и overrides не дублируют календарь и задачи', async () => fixture(async (f) => {
  const { database: db, workspaceId: ws, draft, context, config } = f;
  const beforeItems = db.all('SELECT * FROM plan_items ORDER BY id');
  const beforeCalendar = db.all('SELECT * FROM calendar_items ORDER BY id');
  const edited = updateMonthlyPlanItem(db, ws, draft.id, draft.items[0].id, {
    expectedRevision: draft.revision, titleOverride: 'Участие кафедры в семинаре', dateTextOverride: '', note: 'Печатное примечание'
  }, context);
  const input = { expectedRevision: edited.revision, idempotencyKey: 'export-november-first' };
  const exported = await generateMonthlyPlanDocument(db, ws, draft.id, input, config, context);
  assert.equal(exported.status, 'completed');
  const again = await generateMonthlyPlanDocument(db, ws, draft.id, input, config, context);
  assert.equal(again.documentId, exported.documentId);
  assert.equal(again.duplicateRequest, true);
  const run = db.get('SELECT * FROM monthly_plan_exports WHERE id = ?', exported.id);
  const saved = JSON.parse(run.snapshot_json);
  assert.equal(saved.items[0].source.title, beforeItems.find((item) => item.id === draft.items[0].plan_item_id).title);
  assert.equal(saved.items[0].overrides.dateText, '');
  const version = db.get('SELECT * FROM document_versions WHERE id = ?', exported.versionId);
  const blob = db.get('SELECT * FROM file_blobs WHERE sha256 = ?', exported.sha256);
  const xml = await readDocumentXml(blob.storage_path);
  assert.match(wordVisibleText(xml), /Участие кафедры в семинаре/u);
  assert.match(wordVisibleText(xml), /Печатное примечание/u);
  assert.doesNotMatch(wordVisibleText(xml), /15 ноября/u);
  assert.equal(version.extracted_text, null);
  assert.equal(version.processing_status, 'processed');
  assert.equal(db.get('SELECT document_type FROM documents WHERE id = ?', exported.documentId).document_type, 'monthly_plan_export');
  assert.equal(db.get("SELECT COUNT(*) AS n FROM jobs WHERE json_extract(payload_json, '$.versionId') = ?", exported.versionId).n, 0);
  assert.deepEqual(db.all('SELECT * FROM plan_items ORDER BY id'), beforeItems);
  assert.deepEqual(db.all('SELECT * FROM calendar_items ORDER BY id'), beforeCalendar);
  assert.equal((await readFile(blob.storage_path)).subarray(0, 2).toString(), 'PK');
}));

test('изменившийся источник конфликтует со старым ключом и формирует новый проверяемый снимок', async () => fixture(async (f) => {
  const { database: db, workspaceId: ws, draft, first, config, context } = f;
  const request = { expectedRevision: draft.revision, idempotencyKey: 'source-change-export' };
  const before = await generateMonthlyPlanDocument(db, ws, draft.id, request, config, context);
  updateManualPlanItem(db, ws, first.id, { title: 'Семинар перенесён', startsAt: '2026-11-17' });
  await assert.rejects(generateMonthlyPlanDocument(db, ws, draft.id, request, config, context), { code: 'monthly_plan_export_idempotency_conflict' });
  const after = await generateMonthlyPlanDocument(db, ws, draft.id, { ...request, idempotencyKey: 'source-change-export-new' }, config, context);
  assert.notEqual(after.sha256, before.sha256);
  const oldSnapshot = JSON.parse(db.get('SELECT snapshot_json FROM monthly_plan_exports WHERE id = ?', before.id).snapshot_json);
  assert.equal(oldSnapshot.items[0].source.title, first.title);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM plan_items').n, 2);
}));

test('скачанный месячный DOCX можно сохранить как образец и повторно использовать в другом месяце', async () => fixture(async (f) => {
  const { database: db, workspaceId: ws, draft, config, context, second } = f;
  const first = await generateMonthlyPlanDocument(db, ws, draft.id, {
    expectedRevision: draft.revision, idempotencyKey: 'reusable-source'
  }, config, context);
  const template = await createPlanTemplate(db, ws, {
    documentId: first.documentId, name: 'Месячный образец кафедры', planKind: 'department'
  });
  assert.equal(template.period_kind, 'monthly');
  const jobsBeforeLegacy = db.all('SELECT * FROM jobs');
  await assert.rejects(generatePlanDocument(db, ws, template.id, {
    idempotencyKey: 'no-legacy-monthly', targetPeriod: { periodKind: 'monthly', periodKey: '2026-12' },
    items: [{ title: 'Не создавать повторное мероприятие', startsAt: '2026-12-01' }]
  }, config), { code: 'plan_generation_monthly_composition_required' });
  assert.deepEqual(db.all('SELECT * FROM jobs'), jobsBeforeLegacy);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM plan_generation_runs').n, 0);
  let next = createMonthlyPlan(db, ws, {
    month: '2026-12', title: 'Декабрьский план', templateId: template.id,
    idempotencyKey: 'december-compose', planItemIds: [second.id]
  }, context);
  const beforeSource = db.get('SELECT * FROM plan_items WHERE id = ?', second.id);
  next = updateMonthlyPlanItem(db, ws, next.id, next.items[0].id, {
    expectedRevision: next.revision, dateTextOverride: 'Срок уточнить', expectedResultOverride: 'Уточнённый результат'
  }, context);
  const exported = await generateMonthlyPlanDocument(db, ws, next.id, {
    expectedRevision: next.revision, idempotencyKey: 'reusable-december'
  }, config, context);
  const file = db.get('SELECT storage_path FROM file_blobs WHERE sha256 = ?', exported.sha256);
  const xml = await readDocumentXml(file.storage_path);
  const text = wordVisibleText(xml);
  assert.match(text, /на декабрь 2026 года/u);
  assert.match(text, /Срок уточнить/u);
  assert.match(text, /Уточнённый результат/u);
  assert.doesNotMatch(text, /20 ноября|Методический семинар/u);
  assert.deepEqual(db.get('SELECT * FROM plan_items WHERE id = ?', second.id), beforeSource);
  const saved = db.get('SELECT * FROM monthly_plan_exports WHERE id = ?', exported.id);
  assert.equal(saved.template_document_version_id, first.versionId);
  assert.equal(getMonthlyPlan(db, ws, next.id, context).template_id, template.id);
  next = updateMonthlyPlan(db, ws, next.id, { expectedRevision: next.revision, title: 'Правка имени' }, context);
  await assert.rejects(generateMonthlyPlanDocument(db, ws, next.id, {
    expectedRevision: next.revision - 1, idempotencyKey: 'stale-export'
  }, config, context), { code: 'monthly_plan_revision_conflict' });
}));

test('печатный срок сохраняет явную пустоту и полный интервал вместо выдуманной даты', () => {
  assert.equal(monthlyItemDate({ dateText: '', dueDate: '2026-11-10' }), '');
  assert.equal(monthlyItemDate({ startsAt: '2026-11-10', endsAt: '2026-11-12', dueDate: '2026-11-20' }),
    '10 ноября 2026 — 12 ноября 2026; до 20 ноября 2026');
});

test('образец с единственной колонкой срока сохраняет интервал и дедлайн, а две колонки разделяют их', async () => fixture(async (f) => {
  const { database: db, workspaceId: ws, draft, context, config, first, root } = f;
  updateManualPlanItem(db, ws, first.id, { endsAt: '2026-11-17', dueDate: '2026-11-20' });
  for (const kind of ['date', 'deadline', 'both']) {
    let xml = renderMonthlyPlanXml(snapshot());
    if (kind === 'deadline') xml = xml.replace('>Срок<', '>Срок выполнения<');
    if (kind === 'both') xml = xml.replace('>Результат / примечание<', '>Контрольный срок<');
    const path = join(root, `template-${kind}.docx`);
    await writeZipArchive(path, { 'word/document.xml': xml });
    const mediaType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const blob = await storeGeneratedFile(path, { blobDir: config.blobDir, mediaType });
    const document = registerDocument(db, { workspaceId: ws, title: kind, originalName: `${kind}.docx`,
      mediaType, detectedFormat: 'docx', requestedType: 'plan_template', blob });
    const template = await createPlanTemplate(db, ws, { documentId: document.documentId, name: kind, planKind: 'department' });
    const current = getMonthlyPlan(db, ws, draft.id, context);
    const edited = updateMonthlyPlan(db, ws, draft.id, { expectedRevision: current.revision, templateId: template.id }, context);
    const output = await generateMonthlyPlanDocument(db, ws, draft.id, {
      expectedRevision: edited.revision, idempotencyKey: `single-column-${kind}`
    }, config, context);
    const file = db.get('SELECT storage_path FROM file_blobs WHERE sha256 = ?', output.sha256);
    const table = bodyChildren(await readDocumentXml(file.storage_path)).find(child => child.tag === 'tbl');
    const cells = tableRows(table.xml)[1].cells.map(cell => cell.text);
    if (kind === 'both') {
      assert.equal(cells[3], '15–17 ноября 2026');
      assert.doesNotMatch(cells[3], /20 ноября/u);
      assert.equal(cells[5], '20 ноября 2026');
    } else {
      assert.match(cells[3], /15 ноября 2026 — 17 ноября 2026/u, kind);
      assert.match(cells[3], /до 20 ноября 2026/u, kind);
    }
  }
}));
