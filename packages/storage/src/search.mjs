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

function tableExists(database, tableName) {
  try {
    const row = database.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", tableName);
    return Boolean(row);
  } catch {
    return false;
  }
}

export function ensureSearchIndexUpToDate(database, workspaceId) {
  let meetingsCount = 0;
  let decisionsCount = 0;
  let documentsCount = 0;
  let plansCount = 0;
  let planItemsCount = 0;
  let directivesCount = 0;
  let assignmentsCount = 0;
  let scienceCount = 0;

  // 1. Index meetings without search_fragments
  if (tableExists(database, 'meetings')) {
    const unindexedMeetings = database.all(`
      SELECT m.id, m.protocol_number, m.meeting_date, m.chairperson_raw, m.secretary_raw, m.source_document_version_id
      FROM meetings m
      LEFT JOIN search_fragments sf ON sf.source_id = m.id AND sf.source_kind = 'meeting'
      WHERE sf.id IS NULL AND m.workspace_id = ?
    `, workspaceId);

    for (const m of unindexedMeetings) {
      let agendaContent = '';
      if (tableExists(database, 'agenda_items')) {
        const agendaRows = database.all(`
          SELECT ai.item_no, ai.title, ai.heard_text, ai.discussed_text, ai.decision_text
          FROM agenda_items ai
          WHERE ai.meeting_id = ?
          ORDER BY ai.item_no
        `, m.id);

        agendaContent = agendaRows.map((a) =>
          [
            a.item_no ? `Вопрос ${a.item_no}:` : '',
            a.title,
            a.heard_text ? `Слушали: ${a.heard_text}` : '',
            a.discussed_text ? `Выступили: ${a.discussed_text}` : '',
            a.decision_text ? `Постановили: ${a.decision_text}` : ''
          ].filter(Boolean).join(' ')
        ).join('\n');
      }

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
      meetingsCount += 1;
    }
  }

  // 2. Index decisions without search_fragments
  if (tableExists(database, 'decisions') && tableExists(database, 'agenda_items') && tableExists(database, 'meetings')) {
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
      decisionsCount += 1;
    }
  }

  // 3. Index documents without search_fragments
  if (tableExists(database, 'documents') && tableExists(database, 'document_versions')) {
    const unindexedDocs = database.all(`
      SELECT d.id AS document_id, d.title, d.document_type,
             dv.id AS document_version_id, dv.original_name, dv.detected_format, dv.extracted_text
      FROM documents d
      JOIN document_versions dv ON dv.id = d.current_version_id
      LEFT JOIN search_fragments sf ON sf.source_id = d.id AND sf.source_kind = 'document'
      WHERE sf.id IS NULL AND d.workspace_id = ?
    `, workspaceId);

    for (const doc of unindexedDocs) {
      let docText = doc.extracted_text || '';
      if (!docText && tableExists(database, 'document_blocks')) {
        const blockRow = database.get(`
          SELECT group_concat(text, ' ') AS block_text
          FROM document_blocks
          WHERE document_version_id = ?
        `, doc.document_version_id);
        docText = blockRow?.block_text || '';
      }

      const content = docText || [doc.title, doc.original_name, doc.document_type].filter(Boolean).join(' ');
      addSearchFragment(database, {
        workspaceId,
        sourceKind: 'document',
        sourceId: doc.document_id,
        documentVersionId: doc.document_version_id,
        title: doc.title || doc.original_name || 'Документ',
        content,
        locator: { kind: doc.detected_format || 'document', scope: 'full_document' }
      });
      documentsCount += 1;
    }
  }

  // 4. Index plans without search_fragments
  if (tableExists(database, 'plans')) {
    const unindexedPlans = database.all(`
      SELECT p.id, p.title, p.plan_kind, p.period_key, p.year_start, p.year_end, p.owner_raw, p.source_document_version_id
      FROM plans p
      LEFT JOIN search_fragments sf ON sf.source_id = p.id AND sf.source_kind = 'plan'
      WHERE sf.id IS NULL AND p.workspace_id = ?
    `, workspaceId);

    for (const p of unindexedPlans) {
      const academicYear = p.year_start && p.year_end ? `${p.year_start}/${p.year_end}` : (p.year_start ? String(p.year_start) : '');
      const content = [
        p.title,
        p.plan_kind ? `Вид плана: ${p.plan_kind}` : '',
        p.period_key ? `Период: ${p.period_key}` : '',
        academicYear ? `Учебный год: ${academicYear}` : '',
        p.owner_raw ? `Ответственный: ${p.owner_raw}` : ''
      ].filter(Boolean).join('\n');

      addSearchFragment(database, {
        workspaceId,
        sourceKind: 'plan',
        sourceId: p.id,
        documentVersionId: p.source_document_version_id || null,
        title: p.title || `План (${p.period_key || ''})`,
        content
      });
      plansCount += 1;
    }
  }

  // 5. Index plan items without search_fragments
  if (tableExists(database, 'plan_items') && tableExists(database, 'plans')) {
    const unindexedItems = database.all(`
      SELECT pi.id, pi.plan_id, pi.title, pi.direction, pi.responsible_raw, pi.due_date, pi.starts_at, p.source_document_version_id
      FROM plan_items pi
      JOIN plans p ON p.id = pi.plan_id
      LEFT JOIN search_fragments sf ON sf.source_id = pi.id AND sf.source_kind = 'plan_item'
      WHERE sf.id IS NULL AND p.workspace_id = ?
    `, workspaceId);

    for (const pi of unindexedItems) {
      const content = [
        pi.title,
        pi.direction ? `Направление: ${pi.direction}` : '',
        pi.responsible_raw ? `Ответственный: ${pi.responsible_raw}` : '',
        pi.due_date ? `Срок исполнения: ${pi.due_date}` : ''
      ].filter(Boolean).join('\n');

      addSearchFragment(database, {
        workspaceId,
        sourceKind: 'plan_item',
        sourceId: pi.id,
        documentVersionId: pi.source_document_version_id || null,
        title: pi.title || 'Пункт плана',
        content
      });
      planItemsCount += 1;
    }
  }

  // 6. Index directives without search_fragments
  if (tableExists(database, 'directives')) {
    const unindexedDirectives = database.all(`
      SELECT d.id, d.title, d.document_number, d.directive_kind, d.issued_at, d.issuer_raw, d.summary, d.source_document_version_id
      FROM directives d
      LEFT JOIN search_fragments sf ON sf.source_id = d.id AND sf.source_kind = 'directive'
      WHERE sf.id IS NULL AND d.workspace_id = ?
    `, workspaceId);

    for (const d of unindexedDirectives) {
      const content = [
        d.title,
        d.document_number ? `Распорядительный документ № ${d.document_number}` : '',
        d.directive_kind ? `Вид: ${d.directive_kind}` : '',
        d.issued_at ? `Дата издания: ${d.issued_at}` : '',
        d.issuer_raw ? `Кем издан: ${d.issuer_raw}` : '',
        d.summary || ''
      ].filter(Boolean).join('\n');

      addSearchFragment(database, {
        workspaceId,
        sourceKind: 'directive',
        sourceId: d.id,
        documentVersionId: d.source_document_version_id || null,
        title: d.title || `Распоряжение № ${d.document_number || 'б/н'}`,
        content
      });
      directivesCount += 1;
    }
  }

  // 7. Index assignments without search_fragments
  if (tableExists(database, 'assignments')) {
    const unindexedAssignments = database.all(`
      SELECT a.id, a.title, a.instruction_text, a.due_date, d.document_number, d.source_document_version_id
      FROM assignments a
      LEFT JOIN directives d ON d.id = a.directive_id
      LEFT JOIN search_fragments sf ON sf.source_id = a.id AND sf.source_kind = 'assignment'
      WHERE sf.id IS NULL AND a.workspace_id = ?
    `, workspaceId);

    for (const a of unindexedAssignments) {
      const content = [
        a.title,
        a.document_number ? `К распоряжению № ${a.document_number}` : '',
        a.instruction_text,
        a.due_date ? `Срок: ${a.due_date}` : ''
      ].filter(Boolean).join('\n');

      addSearchFragment(database, {
        workspaceId,
        sourceKind: 'assignment',
        sourceId: a.id,
        documentVersionId: a.source_document_version_id || null,
        title: a.title || 'Поручение',
        content
      });
      assignmentsCount += 1;
    }
  }

  // 8. Index scientific items without search_fragments
  if (tableExists(database, 'scientific_items')) {
    const unindexedScience = database.all(`
      SELECT s.id, s.title, s.item_kind, s.abstract_text, s.venue, s.publication_year, s.doi, s.source_document_version_id
      FROM scientific_items s
      LEFT JOIN search_fragments sf ON sf.source_id = s.id AND sf.source_kind = 'scientific_item'
      WHERE sf.id IS NULL AND s.workspace_id = ?
    `, workspaceId);

    for (const s of unindexedScience) {
      const content = [
        s.title,
        s.item_kind ? `Вид: ${s.item_kind}` : '',
        s.venue ? `Издание: ${s.venue}` : '',
        s.publication_year ? `Год: ${s.publication_year}` : '',
        s.abstract_text || '',
        s.doi ? `DOI: ${s.doi}` : ''
      ].filter(Boolean).join('\n');

      addSearchFragment(database, {
        workspaceId,
        sourceKind: 'scientific_item',
        sourceId: s.id,
        documentVersionId: s.source_document_version_id || null,
        title: s.title || 'Научный материал',
        content
      });
      scienceCount += 1;
    }
  }

  const indexedCount = meetingsCount + decisionsCount + documentsCount + plansCount + planItemsCount + directivesCount + assignmentsCount + scienceCount;

  return {
    indexedCount,
    meetingsCount,
    decisionsCount,
    documentsCount,
    plansCount,
    planItemsCount,
    directivesCount,
    assignmentsCount,
    scienceCount
  };
}

export function rebuildSearchIndex(database, workspaceId) {
  database.transaction(() => {
    database.run(`
      DELETE FROM search_fts
      WHERE fragment_id IN (
        SELECT id FROM search_fragments WHERE workspace_id = ?
      )
    `, workspaceId);
    database.run('DELETE FROM search_fragments WHERE workspace_id = ?', workspaceId);
  });

  return ensureSearchIndexUpToDate(database, workspaceId);
}
