import { AppError } from '../../core/src/errors.mjs';
import { selectionHash } from '../../ai/src/plan-selection-task.mjs';
import { assertPlanItemAccess } from './access.mjs';
import { getPlanEventDetails } from './event-details.mjs';
import { classifyPlanActivity } from './activity.mjs';
import { parseJson } from './shared.mjs';

export function loadSelectionSource(database, workspaceId, planItemId, context) {
  assertPlanItemAccess(database, workspaceId, context, planItemId, 'read');
  const row = database.get(`SELECT pi.*,p.workspace_id,p.title AS plan_title,p.plan_kind,p.period_key,
    p.year_start,p.year_end,p.owner_raw,p.status AS plan_status,p.source_document_version_id,
    dv.document_id AS source_document_id,person.display_name AS responsible_name
    FROM plan_items pi JOIN plans p ON p.id=pi.plan_id
    LEFT JOIN document_versions dv ON dv.id=p.source_document_version_id
    LEFT JOIN people person ON person.id=pi.responsible_person_id
    WHERE p.workspace_id=? AND pi.id=?`, workspaceId, planItemId);
  if (!row || row.plan_status !== 'active' || row.status === 'cancelled') {
    throw new AppError('plan_selection_source_unavailable', 'Мероприятие недоступно или больше не активно.', 404);
  }
  const details = getPlanEventDetails(database, workspaceId, planItemId, context);
  const { evidence_json, ...properties } = row;
  const source = { ...properties, evidence: parseJson(evidence_json, {}), activity_kind: classifyPlanActivity(row),
    location: details.location, customValues: details.customValues, detailsRevision: details.revision, canEditDetails: details.canEdit };
  const segments = [];
  const add = (id, text, locator) => {
    if (text !== null && text !== undefined && String(text).trim()) segments.push({ id, text: String(text), locator });
  };
  const itemLocator = { kind: 'plan_item', planId: row.plan_id, planItemId };
  for (const [key, label] of [['title', 'title'], ['description', 'description'], ['responsible_raw', 'responsible'], ['expected_result', 'result']]) {
    add(`item:${label}`, row[key], { ...itemLocator, field: key });
  }
  add('plan:title', row.plan_title, { kind: 'plan', planId: row.plan_id, field: 'title' });
  add('plan:owner', row.owner_raw, { kind: 'plan', planId: row.plan_id, field: 'owner_raw' });
  add('details:location', details.location, { ...itemLocator, field: 'location', revision: details.revision });
  for (const [key, value] of Object.entries(details.customValues)) add(`details:${key}`, value, { ...itemLocator, field: key, revision: details.revision });
  const original = database.all(`SELECT DISTINCT psr.id,psr.raw_text,psr.locator_json
    FROM plan_source_rows psr LEFT JOIN plan_source_row_items link ON link.source_row_id=psr.id
    WHERE psr.plan_id=? AND (link.plan_item_id=? OR psr.source_row_key=?) ORDER BY psr.id`,
  row.plan_id, planItemId, row.source_item_key);
  for (const part of original) add(`row:${part.id}`, part.raw_text, parseJson(part.locator_json, {}));
  const { canEditDetails, ...fingerprintSource } = source;
  const fingerprint = selectionHash(JSON.stringify({ source: fingerprintSource, segments }));
  return { planItemId, source, segments, fingerprint };
}

export function selectionSourceSnapshot(candidate) {
  return { planItemId: candidate.planItemId, fingerprint: candidate.fingerprint,
    documentVersionId: candidate.source.source_document_version_id || null,
    planId: candidate.source.plan_id, detailsRevision: candidate.source.detailsRevision,
    segments: candidate.segments.map(({ id, text, locator }) => ({ id, sha256: selectionHash(text), locator })) };
}
