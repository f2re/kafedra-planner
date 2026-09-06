import { newId } from '../../../packages/core/src/ids.mjs';
import { persistProtocol } from '../../../packages/protocols/src/persist.mjs';
import { extendProtocolWithProfileApplications } from '../../../packages/protocols/src/profile-extension.mjs';
import { syncMeetingSearch } from '../../../packages/protocols/src/meeting-core.mjs';
import { applyTemplate, matchesTemplate } from '../../../packages/templates/src/extractor.mjs';

const FINAL_STATUSES = new Set(['processed', 'needs_review']);
const MATERIALIZED_FIELDS = {
  protocolNumber: 'protocol_number',
  meetingDate: 'meeting_date',
  chairperson: 'chairperson_raw',
  secretary: 'secretary_raw',
  attendees: 'attendees_raw'
};

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function empty(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function same(left, right) {
  return String(left ?? '').toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е').replace(/\s+/gu, ' ').trim()
    === String(right ?? '').toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е').replace(/\s+/gu, ' ').trim();
}

function payloadOf(job) {
  return parseJson(job?.payload_json, {});
}

function blocksForVersion(database, versionId) {
  return database.all(`
    SELECT id, sequence_no, block_type, text, locator_json, geometry_json, metadata_json
    FROM document_blocks
    WHERE document_version_id = ?
    ORDER BY sequence_no
  `, versionId).map((row) => ({
    id: row.id,
    sequence: row.sequence_no,
    type: row.block_type,
    text: row.text,
    locator: parseJson(row.locator_json, {}),
    geometry: parseJson(row.geometry_json, null),
    metadata: parseJson(row.metadata_json, {})
  }));
}

function insertReview(database, workspaceId, versionId, code, title, explanation, action, context = {}) {
  const existing = database.get(`
    SELECT id FROM review_items
    WHERE workspace_id = ? AND source_kind = 'document_version' AND source_id = ?
      AND issue_code = ? AND status = 'open'
    LIMIT 1
  `, workspaceId, versionId, code);
  if (existing) return existing.id;
  const id = newId('review');
  database.run(`
    INSERT INTO review_items(
      id, workspace_id, source_kind, source_id, issue_code, title, explanation,
      proposed_action, severity, status, context_json, created_at
    ) VALUES (?, ?, 'document_version', ?, ?, ?, ?, ?, 'warning', 'open', ?, ?)
  `, id, workspaceId, versionId, code, title, explanation, action,
  JSON.stringify(context), new Date().toISOString());
  return id;
}

function resolveReview(database, workspaceId, versionId, code, runId, now) {
  database.run(`
    UPDATE review_items
    SET status = 'resolved', resolved_at = ?, resolution_json = ?
    WHERE workspace_id = ? AND source_kind = 'document_version' AND source_id = ?
      AND issue_code = ? AND status = 'open'
  `, now, JSON.stringify({ kind: 'protocol_profile', extractionRunId: runId }),
  workspaceId, versionId, code);
}

function resolvePreviousProfileReviews(database, workspaceId, versionId, runId, now) {
  database.run(`
    UPDATE review_items
    SET status = 'resolved', resolved_at = ?, resolution_json = ?
    WHERE workspace_id = ? AND source_kind = 'document_version' AND source_id = ?
      AND status = 'open' AND issue_code LIKE 'protocol_profile_%'
  `, now, JSON.stringify({ kind: 'protocol_profile_reprocess', extractionRunId: runId }),
  workspaceId, versionId);
}

function profileTemplates(database, workspaceId) {
  return database.all(`
    SELECT * FROM document_templates
    WHERE workspace_id = ? AND status = 'active' AND document_type = 'department_protocol'
    ORDER BY version DESC, updated_at DESC, id
  `, workspaceId);
}

function appendMeetingProfileEvidence(meeting, fields, versionId, runId) {
  const evidence = parseJson(meeting.evidence_json, {});
  const profileFields = evidence.profileFields && typeof evidence.profileFields === 'object'
    ? { ...evidence.profileFields } : {};
  for (const field of fields) {
    const key = field.canonicalField;
    if (!key) continue;
    const rows = Array.isArray(profileFields[key]) ? [...profileFields[key]] : [];
    if (!rows.some((row) => row.extractionRunId === runId && row.templateId === field.templateId)) {
      rows.push({
        documentVersionId: versionId,
        extractionRunId: runId,
        templateId: field.templateId,
        templateCode: field.templateCode,
        value: field.value,
        locator: field.evidence?.locator || null,
        evidence: field.evidence || null
      });
    }
    profileFields[key] = rows.slice(-100);
  }
  return { ...evidence, profileFields };
}

function syncMeetingCalendar(database, meeting, now) {
  const existing = database.get(`
    SELECT id FROM calendar_items
    WHERE workspace_id = ? AND source_kind = 'meeting' AND source_id = ?
    ORDER BY created_at LIMIT 1
  `, meeting.workspace_id, meeting.id);
  if (!meeting.meeting_date) return;
  const title = meeting.protocol_number
    ? `Заседание кафедры · протокол №${meeting.protocol_number}`
    : 'Заседание кафедры';
  const description = [
    meeting.title,
    meeting.chairperson_raw ? `Председатель: ${meeting.chairperson_raw}` : null,
    meeting.secretary_raw ? `Секретарь: ${meeting.secretary_raw}` : null
  ].filter(Boolean).join('\n');
  if (existing) {
    database.run(`
      UPDATE calendar_items SET title = ?, starts_at = ?, description = ?, updated_at = ?
      WHERE id = ?
    `, title, meeting.meeting_date, description, now, existing.id);
    return;
  }
  database.run(`
    INSERT INTO calendar_items(
      id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
      all_day, category, importance, status, description, created_at, updated_at,
      item_kind, reminder_minutes
    ) VALUES (?, ?, 'meeting', ?, ?, ?, NULL, 1, 'organizational', 'normal', 'confirmed', ?, ?, ?, 'event', 1440)
  `, newId('cal'), meeting.workspace_id, meeting.id, title, meeting.meeting_date, description, now, now);
}

function materializeProfileFields(database, {
  workspaceId,
  versionId,
  runId,
  baseProtocol,
  enriched,
  now
}) {
  if (!enriched?.id) return;
  let meeting = database.get('SELECT * FROM meetings WHERE workspace_id = ? AND id = ?', workspaceId, enriched.id);
  if (!meeting) return;
  const appliedEvidence = [];
  const updates = {};

  for (const [field, column] of Object.entries(MATERIALIZED_FIELDS)) {
    if (!empty(baseProtocol?.[field])) continue;
    const incoming = enriched[field];
    if (empty(incoming)) continue;
    const sourceField = enriched.profileFields.find((item) => item.canonicalField === field && same(item.value, incoming));
    if (!sourceField) continue;
    if (empty(meeting[column])) {
      updates[column] = incoming;
      appliedEvidence.push(sourceField);
    } else if (same(meeting[column], incoming)) {
      appliedEvidence.push(sourceField);
    } else {
      insertReview(database, workspaceId, versionId,
        `protocol_profile_working_conflict_${field}_${sourceField.templateId || 'profile'}`,
        'Профиль нашёл другое значение реквизита',
        `В рабочей карточке сохранено «${meeting[column]}», а профиль исходного документа извлёк «${incoming}».`,
        'Сравните значение с исходником. Рабочая правка сохранена и автоматически не перезаписана.',
        { meetingId: meeting.id, field, existing: meeting[column], incoming, evidence: sourceField.evidence });
    }
  }

  if (Object.keys(updates).length) {
    database.run(`
      UPDATE meetings SET
        protocol_number = COALESCE(?, protocol_number),
        meeting_date = COALESCE(?, meeting_date),
        chairperson_raw = COALESCE(?, chairperson_raw),
        secretary_raw = COALESCE(?, secretary_raw),
        attendees_raw = COALESCE(?, attendees_raw),
        updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `, updates.protocol_number || null, updates.meeting_date || null,
    updates.chairperson_raw || null, updates.secretary_raw || null,
    updates.attendees_raw || null, now, workspaceId, meeting.id);
  }

  if (appliedEvidence.length) {
    meeting = database.get('SELECT * FROM meetings WHERE workspace_id = ? AND id = ?', workspaceId, meeting.id);
    const evidence = appendMeetingProfileEvidence(meeting, appliedEvidence, versionId, runId);
    database.run('UPDATE meetings SET evidence_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(evidence), now, meeting.id);
  }

  meeting = database.get('SELECT * FROM meetings WHERE workspace_id = ? AND id = ?', workspaceId, meeting.id);
  syncMeetingCalendar(database, meeting, now);
  syncMeetingSearch(database, workspaceId, meeting.id);

  if (meeting.protocol_number) resolveReview(database, workspaceId, versionId, 'protocol_number_missing', runId, now);
  if (meeting.meeting_date) resolveReview(database, workspaceId, versionId, 'meeting_date_missing', runId, now);
}

function markReviewStatus(database, version, runId, resultJson, now) {
  const count = Number(database.get(`
    SELECT COUNT(*) AS count FROM review_items
    WHERE workspace_id = ? AND source_kind = 'document_version' AND source_id = ? AND status = 'open'
  `, version.workspace_id, version.id)?.count || 0);
  const status = count ? 'needs_review' : 'processed';
  database.run('UPDATE document_versions SET processing_status = ? WHERE id = ?', status, version.id);
  database.run('UPDATE documents SET status = ?, updated_at = ? WHERE id = ?', status, now, version.document_id);
  database.run(`
    UPDATE extraction_runs SET status = ?, result_json = ?, completed_at = ? WHERE id = ?
  `, count ? 'needs_review' : 'completed', JSON.stringify(resultJson), now, runId);
  return count;
}

export function shouldApplyProtocolProfileForJob(database, job) {
  if (job?.kind !== 'process_document') return false;
  const payload = payloadOf(job);
  if (!payload.versionId || !payload.documentId) return false;
  const row = database.get(`
    SELECT processing_status FROM document_versions
    WHERE id = ? AND document_id = ?
  `, payload.versionId, payload.documentId);
  return Boolean(row && !FINAL_STATUSES.has(row.processing_status));
}

export async function applyProtocolProfileForJob(database, job, logger) {
  const payload = payloadOf(job);
  if (!payload.versionId || !payload.documentId) return { applied: 0, errors: 0 };
  try {
    const version = database.get(`
      SELECT dv.*, d.workspace_id, d.title
      FROM document_versions dv JOIN documents d ON d.id = dv.document_id
      WHERE dv.id = ? AND d.id = ?
    `, payload.versionId, payload.documentId);
    if (!version || version.processing_status === 'failed') return { applied: 0, errors: 0 };
    const run = database.get(`
      SELECT * FROM extraction_runs WHERE document_version_id = ?
      ORDER BY started_at DESC, id DESC LIMIT 1
    `, version.id);
    const runResult = parseJson(run?.result_json, {});
    const baseProtocol = runResult.protocol;
    if (!run || !baseProtocol?.id) return { applied: 0, errors: 0 };

    const templates = profileTemplates(database, version.workspace_id);
    if (!templates.length) return { applied: 0, errors: 0 };
    const blocks = blocksForVersion(database, version.id);
    const applications = [];
    const profileErrors = [];
    const now = new Date().toISOString();

    database.transaction(() => {
      resolvePreviousProfileReviews(database, version.workspace_id, version.id, run.id, now);
      for (const template of templates) {
        try {
          if (!matchesTemplate(template, { text: version.extracted_text || '', originalName: version.original_name })) continue;
          const result = applyTemplate(template, {
            text: version.extracted_text || '', originalName: version.original_name, blocks
          });
          applications.push({ template, result });
          if (result.missing.length) {
            insertReview(database, version.workspace_id, version.id,
              `protocol_profile_missing_${template.id}`,
              'Профиль протокола не нашёл обязательные поля',
              `Не найдено: ${result.missing.map((item) => item.label).join(', ')}. Остальные значения сохранены.`,
              'Уточните профиль по реальному образцу; исходный документ и найденные значения уже сохранены.',
              { templateId: template.id, missing: result.missing, values: result.values, evidence: result.evidence });
          }
        } catch (error) {
          const item = { templateId: template.id, code: template.code, error: String(error?.message || error) };
          profileErrors.push(item);
          insertReview(database, version.workspace_id, version.id,
            `protocol_profile_failed_${template.id}`,
            'Профиль протокола обработан с ошибкой',
            'Базовый протокол сохранён. Ошибка дополнительного профиля не блокирует документ.',
            'Исправьте профиль и повторите обработку этого же сохранённого источника.', item);
        }
      }

      if (!applications.length && !profileErrors.length) return;
      const enriched = extendProtocolWithProfileApplications(baseProtocol, applications);
      enriched.profileErrors = profileErrors;
      for (const conflict of enriched.profileConflicts) {
        insertReview(database, version.workspace_id, version.id,
          `protocol_profile_base_conflict_${conflict.field}_${conflict.templateId || 'profile'}`,
          'Профиль протокола расходится с базовым разбором',
          `Базовый parser извлёк «${conflict.existing}», профиль — «${conflict.incoming}».`,
          'Сверьте оба значения с исходником; автоматика не выбирает одно из них без основания.',
          { meetingId: enriched.id, ...conflict });
      }
      materializeProfileFields(database, {
        workspaceId: version.workspace_id,
        versionId: version.id,
        runId: run.id,
        baseProtocol,
        enriched,
        now
      });
      const nextResult = { ...runResult, protocol: enriched };
      enriched.reviewCount = markReviewStatus(database, version, run.id, nextResult, now);
      database.run('UPDATE extraction_runs SET result_json = ? WHERE id = ?', JSON.stringify({ ...runResult, protocol: enriched }), run.id);
    });

    logger?.info?.('protocol profile applied', {
      documentId: version.document_id,
      versionId: version.id,
      applications: applications.length,
      errors: profileErrors.length
    });
    return { applied: applications.length, errors: profileErrors.length };
  } catch (error) {
    logger?.error?.('protocol profile failed after base processing', {
      versionId: payload.versionId,
      error: String(error?.stack || error)
    });
    try {
      const version = database.get(`
        SELECT dv.id, d.workspace_id FROM document_versions dv JOIN documents d ON d.id = dv.document_id
        WHERE dv.id = ? AND d.id = ?
      `, payload.versionId, payload.documentId);
      if (version) insertReview(database, version.workspace_id, version.id, 'protocol_profile_failed',
        'Дополнительный профиль протокола не применён',
        'Базовый разбор и сохранённый исходник остаются доступными.',
        'Исправьте профиль и повторите обработку сохранённого источника.',
        { error: String(error?.message || error) });
    } catch {}
    return { applied: 0, errors: 1 };
  }
}
