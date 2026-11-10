import { newId } from '../../core/src/ids.mjs';
import { canReadSearchResult, documentIdForVersion, resolveObjectAccess } from '../../access-control/src/service.mjs';

const MAX_INPUT = 16000;
const MAX_RESULT = 250000;
const MAX_REFERENCES = 12;

export function assistantOwnerKey(context) {
  if (!context?.authenticated) throw new Error('assistant_auth_required');
  return context.enabled ? 'account:' + String(context.accountId || context.personId || 'unknown') : 'local-workspace';
}

function isReadable(database, workspaceId, context, ref) {
  if (!ref || !ref.kind || !ref.id) return false;
  if (!canReadSearchResult(database, workspaceId, context, { source_kind: ref.kind, source_id: ref.id, document_version_id: ref.versionId })) return false;
  return !ref.documentId || resolveObjectAccess(database, workspaceId, context, 'document', ref.documentId).allowed;
}

export function assistantCandidateSources(database, workspaceId, context, candidates = []) {
  const found = [];
  const unique = new Set();
  for (const candidate of candidates.slice(0, MAX_REFERENCES)) {
    const kind = String(candidate.kind || '');
    const id = String(candidate.id || '');
    if (!id || !kind || unique.has(kind + ':' + id)) continue;
    let versionId = String(candidate.documentVersionId || candidate.versionId || '') || null;
    if (!versionId && kind === 'meeting') {
      versionId = database.get(
        'SELECT source_document_version_id AS id FROM meetings WHERE workspace_id = ? AND id = ?',
        workspaceId, id
      )?.id || null;
    }
    if (!versionId && kind === 'decision') {
      versionId = database.get(
        'SELECT m.source_document_version_id AS id FROM decisions d JOIN agenda_items a ON a.id = d.agenda_item_id JOIN meetings m ON m.id = a.meeting_id WHERE m.workspace_id = ? AND d.id = ?',
        workspaceId, id
      )?.id || null;
    }
    if (!versionId && kind === 'document') {
      versionId = database.get('SELECT current_version_id AS id FROM documents WHERE workspace_id = ? AND id = ?', workspaceId, id)?.id || null;
    }
    if (!versionId && kind === 'document_version') versionId = id;
    const documentId = versionId
      ? documentIdForVersion(database, workspaceId, versionId)
      : kind === 'document' ? id : null;
    const preview = versionId
      ? database.get('SELECT preview_status FROM document_versions WHERE id = ?', versionId)
      : null;
    const source = {
      kind, id, documentId: documentId || null,
      versionId: versionId || (kind === 'document_version' ? id : null),
      title: String(candidate.title || 'Материал').slice(0, 200),
      snippet: String(candidate.snippet || '').replace(/<[^>]*>/gu, '').slice(0, 500),
      locator: String(candidate.locator || '').slice(0, 200),
      previewAvailable: preview?.preview_status === 'ready'
    };
    if (!isReadable(database, workspaceId, context, source)) continue;
    unique.add(kind + ':' + id);
    found.push(source);
  }
  return found;
}

function parseRefs(value) {
  try {
    const refs = JSON.parse(value || '[]');
    return Array.isArray(refs) ? refs.slice(0, MAX_REFERENCES) : [];
  } catch {
    return [];
  }
}

function present(database, workspaceId, context, row) {
  const refs = parseRefs(row.source_refs_json);
  const redacted = refs.some((ref) => !isReadable(database, workspaceId, context, ref));
  return {
    id: row.id,
    task: row.task,
    promptText: redacted ? '' : row.prompt_text,
    status: row.status,
    result: !redacted && row.result_json ? JSON.parse(row.result_json) : null,
    rawResponse: redacted ? null : row.raw_response,
    sources: redacted ? [] : refs,
    error: redacted ? null : row.error_message,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    redacted
  };
}

export function saveAssistantRun(database, { workspaceId, context, id = newId('airun'), task, promptText, status, result, rawResponse, sources = [], error, durationMs }) {
  const owner = assistantOwnerKey(context);
  const resultJson = result == null ? null : JSON.stringify(result);
  if (resultJson && resultJson.length > MAX_RESULT) throw new Error('assistant_result_too_large');
  const refs = assistantCandidateSources(database, workspaceId, context, sources);
  const now = new Date().toISOString();
  database.run(
    'INSERT INTO assistant_runs(id, workspace_id, owner_key, task, prompt_text, status, result_json, raw_response, source_refs_json, error_message, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
    id, workspaceId, owner, String(task).slice(0, 80), String(promptText || '').slice(0, MAX_INPUT),
    ['completed', 'failed', 'aborted', 'disabled'].includes(status) ? status : 'failed',
    resultJson, rawResponse ? String(rawResponse).slice(0, MAX_RESULT) : null,
    JSON.stringify(refs), error ? String(error).slice(0, 1000) : null,
    Number.isFinite(Number(durationMs)) ? Math.max(0, Math.round(Number(durationMs))) : null, now
  );
  return id;
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Array.isArray(value) && value.length === 2
      && typeof value[0] === 'string' && typeof value[1] === 'string'
      && value[0].length < 80 && value[1].length < 128 ? value : null;
  } catch {
    return null;
  }
}

export function listAssistantRuns(database, { workspaceId, context, limit = 30, cursor = '' }) {
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 30));
  const after = decodeCursor(cursor);
  const rows = after
    ? database.all('SELECT * FROM assistant_runs WHERE workspace_id = ? AND owner_key = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?',
      workspaceId, assistantOwnerKey(context), after[0], after[0], after[1], safeLimit + 1)
    : database.all('SELECT * FROM assistant_runs WHERE workspace_id = ? AND owner_key = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      workspaceId, assistantOwnerKey(context), safeLimit + 1);
  const page = rows.slice(0, safeLimit);
  const tail = page.at(-1);
  return {
    items: page.map((row) => present(database, workspaceId, context, row)),
    nextCursor: rows.length > safeLimit && tail ? Buffer.from(JSON.stringify([tail.created_at, tail.id])).toString('base64url') : null
  };
}

export function getAssistantRun(database, { workspaceId, context, id }) {
  const row = database.get('SELECT * FROM assistant_runs WHERE workspace_id = ? AND owner_key = ? AND id = ?',
    workspaceId, assistantOwnerKey(context), id);
  return row ? present(database, workspaceId, context, row) : null;
}

export function deleteAssistantRuns(database, { workspaceId, context, id }) {
  if (id) {
    return database.run('DELETE FROM assistant_runs WHERE workspace_id = ? AND owner_key = ? AND id = ?',
      workspaceId, assistantOwnerKey(context), id).changes;
  }
  return database.run('DELETE FROM assistant_runs WHERE workspace_id = ? AND owner_key = ?',
    workspaceId, assistantOwnerKey(context)).changes;
}
