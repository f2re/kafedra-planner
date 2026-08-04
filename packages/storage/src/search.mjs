import { newId } from '../../core/src/ids.mjs';

export function addSearchFragment(database, {
  workspaceId,
  sourceKind,
  sourceId,
  documentVersionId = null,
  title,
  content,
  locator = {}
}) {
  const id = newId('fragment');
  const createdAt = new Date().toISOString();
  database.run(`
    INSERT INTO search_fragments(
      id, workspace_id, source_kind, source_id, document_version_id,
      title, content, locator_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, id, workspaceId, sourceKind, sourceId, documentVersionId, title, content, JSON.stringify(locator), createdAt);
  database.run('INSERT INTO search_fts(fragment_id, title, content) VALUES (?, ?, ?)', id, title, content);
  return id;
}

export function search(database, workspaceId, query, limit = 50) {
  const normalized = String(query || '').trim();
  if (!normalized) return [];
  const ftsQuery = normalized
    .split(/\s+/)
    .map((token) => token.replace(/["'():*]/g, ''))
    .filter(Boolean)
    .map((token) => `${token}*`)
    .join(' AND ');
  if (!ftsQuery) return [];
  return database.all(`
    SELECT
      sf.id, sf.source_kind, sf.source_id, sf.document_version_id,
      sf.title, snippet(search_fts, 2, '<mark>', '</mark>', '…', 24) AS snippet,
      sf.locator_json, bm25(search_fts) AS rank
    FROM search_fts
    JOIN search_fragments sf ON sf.id = search_fts.fragment_id
    WHERE search_fts MATCH ? AND sf.workspace_id = ?
    ORDER BY rank
    LIMIT ?
  `, ftsQuery, workspaceId, limit);
}
