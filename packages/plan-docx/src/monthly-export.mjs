import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../../core/src/errors.mjs';
import { newId } from '../../core/src/ids.mjs';
import { assertObjectAccess, ensureObjectPolicy } from '../../access-control/src/service.mjs';
import { assertPlanItemAccess } from '../../plans/src/access.mjs';
import { getMonthlyPlan, assertMonthlyPlanRevision } from '../../plans/src/monthly.mjs';
import { PLAN_ACTIVITY_LABELS } from '../../plans/src/activity.mjs';
import { storeGeneratedFile } from '../../document-intake/src/blob-store.mjs';
import { generatePlanDocumentXml, formatRussianDate } from './generator.mjs';
import { DOCUMENT_XML, escapeXmlText, readDocumentXml } from './ooxml-shared.mjs';
import { monthlyPeriod, monthLabel } from './monthly-period.mjs';
import { rewriteZipArchive, writeZipArchive } from './archive.mjs';

const MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const GENERATOR_VERSION = 'monthly-docx-v1';
const STALE_MS = 5 * 60 * 1000;

function fail(code, message, status = 409) { throw new AppError(code, message, status); }

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function hashSnapshot(snapshot) {
  return createHash('sha256').update(JSON.stringify(stable(snapshot))).digest('hex');
}

function templateFor(database, workspaceId, draft, context) {
  if (!draft.template_id) return null;
  const row = database.get(`
    SELECT t.*, dv.document_id, dv.blob_sha256, fb.storage_path
    FROM plan_document_templates t
    JOIN document_versions dv ON dv.id = t.source_document_version_id
    JOIN file_blobs fb ON fb.sha256 = dv.blob_sha256
    WHERE t.workspace_id = ? AND t.id = ?
  `, workspaceId, draft.template_id);
  if (!row || row.status !== 'active') fail('monthly_plan_template_unavailable', 'Выбранный образец недоступен. Выберите другой формат.');
  assertObjectAccess(database, workspaceId, context, 'document', row.document_id, 'read');
  if (row.period_kind !== 'monthly') fail('monthly_plan_template_period_invalid', 'Для месячного плана нужен образец с месяцем в заголовке.');
  try { return { ...row, config: JSON.parse(row.config_json) }; }
  catch { fail('monthly_plan_template_invalid', 'Настройка образца повреждена. Загрузите или настройте образец заново.'); }
}

function prepareSnapshot(database, workspaceId, id, input, context) {
  const draft = getMonthlyPlan(database, workspaceId, id, context);
  assertMonthlyPlanRevision(draft, input.expectedRevision);
  if (draft.unavailableCount) fail('monthly_plan_source_unavailable', 'Часть мероприятий недоступна. Уберите их из состава или восстановите доступ.');
  if (!draft.items.length) fail('monthly_plan_empty', 'Добавьте мероприятия в месячный план.', 400);
  const template = templateFor(database, workspaceId, draft, context);
  const snapshot = {
    generatorVersion: GENERATOR_VERSION,
    monthlyPlanId: id, month: draft.month_key, title: draft.title, revision: draft.revision,
    template: template ? {
      id: template.id, documentId: template.document_id,
      documentVersionId: template.source_document_version_id, sha256: template.blob_sha256, config: template.config
    } : null,
    items: draft.items.map((item) => ({
      membershipId: item.id, position: item.position,
      source: item.source,
      overrides: {
        title: item.title_override, dateText: item.date_text_override,
        responsible: item.responsible_override, expectedResult: item.expected_result_override, note: item.note
      },
      effective: item.effective
    }))
  };
  return { draft, template, snapshot, hash: hashSnapshot(snapshot) };
}

function assertSnapshotAccess(database, workspaceId, context, snapshot) {
  if (!Array.isArray(snapshot?.items) || !snapshot.items.length) fail('monthly_plan_export_invalid', 'История выгрузки повреждена.');
  for (const item of snapshot.items) {
    assertPlanItemAccess(database, workspaceId, context, item.source?.id, 'read');
    // A historical export retains its exact source version even if membership is later edited.
    if (item.source?.source_document_id) {
      assertObjectAccess(database, workspaceId, context, 'document', item.source.source_document_id, 'read');
    }
  }
  if (snapshot.template?.documentId) assertObjectAccess(database, workspaceId, context, 'document', snapshot.template.documentId, 'read');
}

/** Run before generic document handlers, including content, preview and reprocess. */
export function assertMonthlyExportDocumentRequest(database, context, pathname, method = 'GET') {
  const match = /^\/api\/documents\/([^/]+)(?:\/.*)?$/u.exec(pathname);
  if (!match) return;
  const row = database.get('SELECT * FROM monthly_plan_exports WHERE generated_document_id = ?', decodeURIComponent(match[1]));
  if (!row) return;
  if (context?.enabled && context.workspaceId !== row.workspace_id) fail('document_not_found', 'Документ не найден.', 404);
  getMonthlyPlan(database, row.workspace_id, row.monthly_plan_id, context);
  let snapshot;
  try { snapshot = JSON.parse(row.snapshot_json); } catch { fail('monthly_plan_export_invalid', 'История выгрузки повреждена.'); }
  assertSnapshotAccess(database, row.workspace_id, context, snapshot);
  if (method === 'POST' && pathname.endsWith('/reprocess')) {
    fail('monthly_plan_export_is_snapshot', 'Это готовая выгрузка. Обновите состав и скачайте новую версию из месячного плана.');
  }
}

function reserve(database, workspaceId, prepared, key, context) {
  const { draft, template, snapshot, hash } = prepared;
  const now = new Date().toISOString();
  return database.transaction(() => {
    const previous = database.get('SELECT * FROM monthly_plan_exports WHERE workspace_id = ? AND idempotency_key = ?', workspaceId, key);
    if (previous) {
      if (previous.monthly_plan_id !== draft.id || previous.request_hash !== hash) {
        fail('monthly_plan_export_idempotency_conflict', 'Состав или исходные данные изменились. Скачайте новую выгрузку.');
      }
      if (previous.status === 'completed') return { ...previous, duplicateRequest: true };
      if (previous.status === 'running' && Date.now() - Date.parse(previous.updated_at) < STALE_MS) {
        fail('monthly_plan_export_in_progress', 'Выгрузка уже формируется. Повторите запрос через несколько секунд.');
      }
      database.run("UPDATE monthly_plan_exports SET status = 'running', error_message = NULL, updated_at = ? WHERE id = ?", now, previous.id);
      return { ...previous, status: 'running', duplicateRequest: false };
    }
    const id = newId('month_export');
    database.run(`
      INSERT INTO monthly_plan_exports(
        id, workspace_id, monthly_plan_id, revision, template_id, template_document_version_id,
        idempotency_key, request_hash, snapshot_json, status, created_by_person_id, started_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)
    `, id, workspaceId, draft.id, draft.revision, template?.id || null, template?.source_document_version_id || null,
    key, hash, JSON.stringify(snapshot), context?.personId || null, now, now);
    return { id, duplicateRequest: false };
  });
}

function result(database, workspaceId, id, duplicateRequest) {
  const row = database.get('SELECT * FROM monthly_plan_exports WHERE workspace_id = ? AND id = ?', workspaceId, id);
  return {
    id: row.id, status: row.status, documentId: row.generated_document_id, versionId: row.generated_document_version_id,
    sha256: row.output_sha256, requestHash: row.request_hash, duplicateRequest,
    downloadUrl: `/api/documents/${encodeURIComponent(row.generated_document_id)}/content?variant=original&download=1`
  };
}

export function monthlyItemDate(item) {
  if (item.dateText !== null && item.dateText !== undefined) return String(item.dateText);
  const dates = [];
  if (item.startsAt) dates.push(item.endsAt && item.endsAt !== item.startsAt
    ? `${formatRussianDate(item.startsAt)} — ${formatRussianDate(item.endsAt)}` : formatRussianDate(item.startsAt));
  if (item.dueDate) dates.push(`до ${formatRussianDate(item.dueDate)}`);
  return dates.join('; ');
}

function paragraph(text, { centered = false, bold = false, size = 22 } = {}) {
  const lines = String(text || '').split(/\r?\n/u);
  return `<w:p><w:pPr><w:spacing w:after="80"/>${centered ? '<w:jc w:val="center"/>' : ''}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/></w:rPr>${lines.map((line, index) => `${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${escapeXmlText(line)}</w:t>`).join('')}</w:r></w:p>`;
}

export function renderMonthlyPlanXml(snapshot) {
  const period = monthlyPeriod(snapshot.month);
  const widths = [500, 1800, 4400, 1800, 2500, 2500];
  const row = (values, heading = false) => `<w:tr><w:trPr><w:cantSplit/>${heading ? '<w:tblHeader/>' : ''}</w:trPr>${values.map((text, index) =>
    `<w:tc><w:tcPr><w:tcW w:w="${widths[index]}" w:type="dxa"/>${heading ? '<w:shd w:fill="F1F3F5"/>' : ''}<w:vAlign w:val="top"/></w:tcPr>${paragraph(text, { bold: heading })}</w:tc>`
  ).join('')}</w:tr>`;
  const rows = snapshot.items.map((item, index) => row([
    String(index + 1), PLAN_ACTIVITY_LABELS[item.effective.activityKind] || '', item.effective.title,
    monthlyItemDate(item.effective), item.effective.responsibleRaw,
    [item.effective.expectedResult, item.effective.note].filter(Boolean).join('\n')
  ])).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${paragraph(snapshot.title, { centered: true, bold: true, size: 28 })}
${paragraph(`на ${monthLabel(period.month)} ${period.yearStart} года`, { centered: true, size: 24 })}
<w:tbl><w:tblPr><w:tblW w:w="13500" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((side) => `<w:${side} w:val="single" w:sz="4" w:color="808080"/>`).join('')}</w:tblBorders></w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>
${row(['№', 'Вид деятельности', 'Мероприятие', 'Срок', 'Ответственный', 'Результат / примечание'], true)}${rows}</w:tbl>
<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
}

async function renderDocument(path, prepared) {
  const { template, snapshot } = prepared;
  if (template) {
    const xml = await readDocumentXml(template.storage_path);
    const items = snapshot.items.map((entry, index) => {
      const item = { ...entry.effective, itemNo: String(index + 1) };
      const { date, deadline } = template.config.columns;
      // A single printed term column must retain both the event interval and its deadline.
      if (date && !deadline) item.dateText = monthlyItemDate(entry.effective);
      if (deadline && !date) item.deadlineText = monthlyItemDate(entry.effective);
      if (entry.overrides.dateText !== null && entry.overrides.dateText !== undefined) {
        item.startsAt = null; item.endsAt = null; item.dueDate = null;
        item.deadlineText = date ? '' : entry.overrides.dateText;
      }
      if (template.config.columns.description) item.description = [item.description, item.note].filter(Boolean).join('\n');
      else item.expectedResult = [item.expectedResult, item.note].filter(Boolean).join('\n');
      return item;
    });
    const generated = generatePlanDocumentXml(xml, { config: template.config, targetPeriod: monthlyPeriod(snapshot.month), items });
    await rewriteZipArchive(template.storage_path, path, new Map([[DOCUMENT_XML, Buffer.from(generated.xml)]]));
    return;
  }
  await writeZipArchive(path, {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    [DOCUMENT_XML]: renderMonthlyPlanXml(snapshot)
  });
}

function registerSnapshot(database, workspaceId, draft, runId, blob, context) {
  const now = new Date().toISOString();
  const documentId = newId('doc');
  const versionId = newId('docv');
  const title = `${draft.title} · ${draft.month_key}`;
  const originalName = `${title.replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, ' ').slice(0, 140)}.docx`;
  database.run(`INSERT OR IGNORE INTO file_blobs(sha256, size_bytes, media_type, storage_path, created_at)
    VALUES (?, ?, ?, ?, ?)`, blob.sha256, blob.sizeBytes, MEDIA_TYPE, blob.storagePath, now);
  database.run(`INSERT INTO documents(id, workspace_id, title, document_type, status, current_version_id, created_at, updated_at)
    VALUES (?, ?, ?, 'monthly_plan_export', 'processed', ?, ?, ?)`, documentId, workspaceId, title, versionId, now, now);
  // Deliberately no process_document job and no searchable copy of restricted source text.
  database.run(`INSERT INTO document_versions(
    id, document_id, version_no, blob_sha256, original_name, media_type, detected_format,
    processing_status, upload_key, uploaded_at, structure_status, ocr_status, preview_status
  ) VALUES (?, ?, 1, ?, ?, ?, 'docx', 'processed', ?, ?, 'generated', 'not_needed', 'not_requested')`,
  versionId, documentId, blob.sha256, originalName, MEDIA_TYPE, `monthly-plan-export:${runId}`, now);
  ensureObjectPolicy(database, {
    workspaceId, objectKind: 'document', objectId: documentId,
    ownerPersonId: draft.created_by_person_id || context?.personId || null, accessScope: 'restricted', now
  });
  database.run(`UPDATE monthly_plan_exports SET status = 'completed', generated_document_id = ?,
    generated_document_version_id = ?, output_sha256 = ?, error_message = NULL, updated_at = ?, completed_at = ? WHERE id = ?`,
  documentId, versionId, blob.sha256, now, now, runId);
  database.run(`INSERT INTO audit_log(id, workspace_id, actor, action, subject_kind, subject_id, details_json, created_at)
    VALUES (?, ?, ?, 'monthly_plan.exported', 'monthly_plan', ?, ?, ?)`, newId('audit'), workspaceId,
  context?.personId || 'operator', draft.id, JSON.stringify({ runId, documentId, versionId, sha256: blob.sha256, revision: draft.revision }), now);
}

export async function generateMonthlyPlanDocument(database, workspaceId, id, input, config, context) {
  const key = String(input?.idempotencyKey || '');
  if (!/^[\x21-\x7e]{1,96}$/u.test(key)) fail('monthly_plan_export_key_required', 'Повторите скачивание из месячного плана.', 400);
  const prepared = prepareSnapshot(database, workspaceId, id, input, context);
  const run = reserve(database, workspaceId, prepared, key, context);
  if (run.duplicateRequest) {
    assertSnapshotAccess(database, workspaceId, context, prepared.snapshot);
    return result(database, workspaceId, run.id, true);
  }
  const temporary = join(config.tempDir, `monthly-plan-${run.id}.docx`);
  try {
    await mkdir(config.tempDir, { recursive: true });
    await rm(temporary, { force: true });
    await renderDocument(temporary, prepared);
    const blob = await storeGeneratedFile(temporary, { blobDir: config.blobDir, mediaType: MEDIA_TYPE });
    database.transaction(() => {
      const current = prepareSnapshot(database, workspaceId, id, input, context);
      if (current.hash !== prepared.hash) fail('monthly_plan_export_source_changed', 'Пока формировался документ, исходные мероприятия изменились. Повторите скачивание.');
      registerSnapshot(database, workspaceId, current.draft, run.id, blob, context);
    });
    return result(database, workspaceId, run.id, false);
  } catch (cause) {
    database.run("UPDATE monthly_plan_exports SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ? AND status <> 'completed'",
      String(cause?.code || cause?.message || cause), new Date().toISOString(), run.id);
    throw cause;
  } finally { await rm(temporary, { force: true }); }
}
