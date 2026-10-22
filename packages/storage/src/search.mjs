import { newId } from '../../core/src/ids.mjs';

const STOP_WORDS = new Set([
  'и', 'в', 'во', 'не', 'что', 'он', 'на', 'с', 'со', 'как', 'а', 'то', 'все', 'так',
  'его', 'но', 'да', 'к', 'у', 'же', 'за', 'бы', 'по', 'ее', 'было', 'были', 'был',
  'была', 'от', 'еще', 'нет', 'о', 'об', 'обо', 'из', 'когда', 'ли', 'если', 'или',
  'ни', 'до', 'для', 'их', 'чем', 'при', 'какой', 'каком', 'какие', 'какая', 'какое',
  'каких', 'это', 'этот', 'эта', 'эти', 'этом', 'где', 'куда', 'вы'
]);

export function sanitizeSearchQuery(query) {
  const raw = String(query || '').trim();
  if (!raw) return { terms: [], allTokens: [] };

  const allTokens = raw
    .replace(/[^\p{L}\p{N}_]/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  if (allTokens.length === 0) return { terms: [], allTokens: [] };

  const contentTerms = allTokens.filter((token) => !STOP_WORDS.has(token) && token.length > 1);
  const terms = contentTerms.length > 0 ? contentTerms : allTokens;

  return { terms, allTokens };
}

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
  const { terms } = sanitizeSearchQuery(query);
  if (!terms || terms.length === 0) return [];

  const andQuery = terms.map((token) => `${token}*`).join(' AND ');
  try {
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
    `, andQuery, workspaceId, limit);
  } catch {
    return [];
  }
}

export function ensureSearchIndexUpToDate(database, workspaceId) {
  let indexedCount = 0;

  // Index meetings without search_fragments
  const unindexedMeetings = database.all(`
    SELECT m.id, m.protocol_number, m.meeting_date, m.chairperson_raw, m.secretary_raw, m.source_document_version_id
    FROM meetings m
    LEFT JOIN search_fragments sf ON sf.source_id = m.id AND sf.source_kind = 'meeting'
    WHERE sf.id IS NULL AND m.workspace_id = ?
  `, workspaceId);

  for (const m of unindexedMeetings) {
    const agendaRows = database.all(`
      SELECT ai.item_no, ai.title, ai.speaker_raw, d.decision_text
      FROM agenda_items ai
      LEFT JOIN decisions d ON d.agenda_item_id = ai.id
      WHERE ai.meeting_id = ?
      ORDER BY ai.item_no
    `, m.id);

    const agendaContent = agendaRows.map((a) =>
      `Вопрос ${a.item_no || ''}: ${a.title || ''}. Докладчик: ${a.speaker_raw || ''}. Решение: ${a.decision_text || ''}`
    ).join('\n');

    const content = [
      `Заседание кафедры №${m.protocol_number || 'б/н'} от ${m.meeting_date || ''}`,
      m.chairperson_raw ? `Председатель: ${m.chairperson_raw}` : '',
      m.secretary_raw ? `Секретарь: ${m.secretary_raw}` : '',
      agendaContent
    ].filter(Boolean).join('\n');

    addSearchFragment(database, {
      workspaceId,
      sourceKind: 'meeting',
      sourceId: m.id,
      documentVersionId: m.source_document_version_id || null,
      title: `Заседание кафедры №${m.protocol_number || 'б/н'} (${m.meeting_date || 'б/д'})`,
      content
    });
    indexedCount += 1;
  }

  // Index decisions without search_fragments
  const unindexedDecisions = database.all(`
    SELECT d.id, d.text AS decision_text, d.due_date, ai.item_no, ai.title AS agenda_title, m.id AS meeting_id, m.protocol_number, m.source_document_version_id
    FROM decisions d
    JOIN agenda_items ai ON ai.id = d.agenda_item_id
    JOIN meetings m ON m.id = ai.meeting_id
    LEFT JOIN search_fragments sf ON sf.source_id = d.id AND sf.source_kind = 'decision'
    WHERE sf.id IS NULL AND m.workspace_id = ?
  `, workspaceId);

  for (const d of unindexedDecisions) {
    const content = [
      `Протокол №${d.protocol_number || ''}, вопрос ${d.item_no || ''}: ${d.agenda_title || ''}`,
      `Решение: ${d.decision_text || ''}`,
      d.due_date ? `Срок: ${d.due_date}` : ''
    ].filter(Boolean).join('\n');

    addSearchFragment(database, {
      workspaceId,
      sourceKind: 'decision',
      sourceId: d.id,
      documentVersionId: d.source_document_version_id || null,
      title: `Решение по вопросу ${d.item_no || ''} (протокол №${d.protocol_number || ''})`,
      content
    });
    indexedCount += 1;
  }

  return { indexedCount };
}
