/**
 * @file document-graph.mjs
 * Построение смыслового графа документарной базы кафедры.
 * Автономно, полностью оффлайн, на чистом SQLite и связях сущностей.
 */

const THEMATIC_CLUSTERS = [
  {
    id: 'topic_study_load',
    label: 'Учебная работа и нагрузка',
    keywords: ['нагрузк', 'учебн', 'семестр', 'дисциплин', 'лекци', 'практик', 'календар']
  },
  {
    id: 'topic_vkr_gia',
    label: 'ВКР, бакалавры и ГИА',
    keywords: ['вкр', 'выпускн', 'квалификацион', 'бакалавр', 'магистр', 'руководител', 'рецензент', 'гиа']
  },
  {
    id: 'topic_nir_science',
    label: 'НИР, публикации и ВАК',
    keywords: ['нир', 'стать', 'публикац', 'вак', 'ринц', 'конференц', 'грант', 'научн', 'монограф']
  },
  {
    id: 'topic_postgraduates',
    label: 'Аспирантура и диссертации',
    keywords: ['аспирант', 'диссертац', 'аттестац', 'соискател', 'кандидат']
  },
  {
    id: 'topic_exams_session',
    label: 'Экзаменационная сессия',
    keywords: ['сесси', 'экзамен', 'зачет', 'задолженност', 'успеваемост', 'ведомост']
  },
  {
    id: 'topic_staff_organization',
    label: 'Кадры, звания и заседания',
    keywords: ['звание', 'доцент', 'профессор', 'конкурс', 'повестк', 'состав', 'кадр']
  }
];

function matchTopic(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const cluster of THEMATIC_CLUSTERS) {
    for (const kw of cluster.keywords) {
      if (lower.includes(kw)) {
        return cluster;
      }
    }
  }
  return null;
}

export function buildDocumentSemanticGraph(database, workspaceId, options = {}) {
  const query = String(options.query || '').trim().toLowerCase();
  const typeFilter = options.type ? String(options.type) : null;
  const focusId = options.focusId ? String(options.focusId) : null;
  const limit = Math.max(10, Math.min(Number(options.limit || 120), 400));

  const nodes = [];
  const edges = [];
  const nodeMap = new Map();

  function addNode(node) {
    if (nodeMap.has(node.id)) return nodeMap.get(node.id);
    node.degree = 0;
    nodeMap.set(node.id, node);
    nodes.push(node);
    return node;
  }

  function addEdge(sourceId, targetId, relation, label = '', weight = 1) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    if (!nodeMap.has(sourceId) || !nodeMap.has(targetId)) return;
    const edgeKey = `${sourceId}__${targetId}__${relation}`;
    edges.push({
      id: edgeKey,
      source: sourceId,
      target: targetId,
      relation,
      label,
      weight
    });
    nodeMap.get(sourceId).degree += 1;
    nodeMap.get(targetId).degree += 1;
  }

  // 1. Pre-register Thematic Topic Nodes
  THEMATIC_CLUSTERS.forEach((cluster) => {
    addNode({
      id: cluster.id,
      type: 'topic',
      label: cluster.label,
      sublabel: 'Тематический кластер',
      cluster: 'Темы',
      color: '#0284c7',
      metadata: { keywords: cluster.keywords }
    });
  });

  // 2. Load Documents
  const docs = database.all(`
    SELECT d.id, d.title, d.document_type, d.status, d.created_at, dv.original_name
    FROM documents d
    LEFT JOIN document_versions dv ON dv.id = d.current_version_id
    WHERE d.workspace_id = ?
    ORDER BY d.created_at DESC
    LIMIT ?
  `, workspaceId, limit);

  docs.forEach((doc) => {
    const docId = `doc_${doc.id}`;
    const node = addNode({
      id: docId,
      type: 'document',
      label: doc.title || doc.original_name || 'Документ без названия',
      sublabel: doc.document_type || 'Документ',
      cluster: 'Документы',
      color: '#2563eb',
      metadata: {
        rawId: doc.id,
        documentType: doc.document_type,
        createdAt: doc.created_at,
        originalName: doc.original_name
      }
    });

    const topic = matchTopic(`${doc.title} ${doc.original_name || ''}`);
    if (topic) {
      addEdge(docId, topic.id, 'thematic', 'тема');
    }
  });

  // 3. Load Meetings & Agenda Items
  const meetings = database.all(`
    SELECT m.id, m.meeting_date, m.protocol_number, m.title, m.status,
      m.chairperson_raw, m.secretary_raw, m.source_document_version_id
    FROM meetings m
    WHERE m.workspace_id = ?
    ORDER BY m.meeting_date DESC
    LIMIT ?
  `, workspaceId, limit);

  meetings.forEach((m) => {
    const meetingId = `meet_${m.id}`;
    const dateStr = m.meeting_date ? new Date(m.meeting_date).toLocaleDateString('ru-RU') : 'Без даты';
    const numStr = m.protocol_number ? `№ ${m.protocol_number}` : '';
    const node = addNode({
      id: meetingId,
      type: 'meeting',
      label: m.title ? `${m.title} ${numStr}` : `Заседание кафедры ${numStr}`,
      sublabel: dateStr,
      cluster: 'Заседания',
      color: '#7c3aed',
      metadata: {
        rawId: m.id,
        meetingDate: m.meeting_date,
        protocolNumber: m.protocol_number,
        chairperson: m.chairperson_raw,
        secretary: m.secretary_raw
      }
    });

    // Link meeting to source document if present
    if (m.source_document_version_id) {
      const srcDoc = database.get('SELECT document_id FROM document_versions WHERE id = ?', m.source_document_version_id);
      if (srcDoc) {
        addEdge(meetingId, `doc_${srcDoc.document_id}`, 'sourced_from', 'источник');
      }
    }

    // Link meeting to Chairperson / Secretary person nodes
    if (m.chairperson_raw && m.chairperson_raw.trim()) {
      const pId = `person_${encodeURIComponent(m.chairperson_raw.trim().toLowerCase())}`;
      addNode({
        id: pId,
        type: 'person',
        label: m.chairperson_raw.trim(),
        sublabel: 'Председатель / Преподаватель',
        cluster: 'Преподаватели',
        color: '#d97706',
        metadata: { role: 'chairperson' }
      });
      addEdge(meetingId, pId, 'chaired_by', 'председатель');
    }

    if (m.secretary_raw && m.secretary_raw.trim()) {
      const pId = `person_${encodeURIComponent(m.secretary_raw.trim().toLowerCase())}`;
      addNode({
        id: pId,
        type: 'person',
        label: m.secretary_raw.trim(),
        sublabel: 'Секретарь / Преподаватель',
        cluster: 'Преподаватели',
        color: '#d97706',
        metadata: { role: 'secretary' }
      });
      addEdge(meetingId, pId, 'recorded_by', 'секретарь');
    }

    // Query agenda items for this meeting
    const agendaItems = database.all(`
      SELECT ai.id, ai.item_no, ai.title, ai.source_kind, ai.source_id,
        ai.heard_text, ai.discussed_text, ai.decision_text
      FROM agenda_items ai
      WHERE ai.meeting_id = ?
    `, m.id);

    agendaItems.forEach((ai) => {
      const topic = matchTopic(`${ai.title} ${ai.heard_text || ''} ${ai.decision_text || ''}`);
      if (topic) {
        addEdge(meetingId, topic.id, 'thematic', ai.title.slice(0, 30));
      }

      // If item links to a plan item, create edge to plan item
      if (ai.source_kind === 'plan_item' && ai.source_id) {
        const planItem = database.get('SELECT plan_id FROM plan_items WHERE id = ?', ai.source_id);
        if (planItem) {
          addEdge(meetingId, `plan_${planItem.plan_id}`, 'references', 'по плану');
        }
      }
    });

    // Query decisions to find assigned people
    const decisions = database.all(`
      SELECT d.id, d.responsible_raw, d.due_date
      FROM decisions d
      JOIN agenda_items ai ON ai.id = d.agenda_item_id
      WHERE ai.meeting_id = ?
    `, m.id);

    decisions.forEach((d) => {
      if (d.responsible_raw && d.responsible_raw.trim()) {
        const pId = `person_${encodeURIComponent(d.responsible_raw.trim().toLowerCase())}`;
        addNode({
          id: pId,
          type: 'person',
          label: d.responsible_raw.trim(),
          sublabel: 'Ответственный по решению',
          cluster: 'Преподаватели',
          color: '#d97706',
          metadata: { role: 'responsible' }
        });
        addEdge(meetingId, pId, 'assigned_to', 'поручение');
      }
    });
  });

  // 4. Load Plans
  const plans = database.all(`
    SELECT p.id, p.title, p.plan_kind, p.period_kind, p.period_key, p.year_start, p.year_end, p.status
    FROM plans p
    WHERE p.workspace_id = ?
    ORDER BY p.created_at DESC
    LIMIT ?
  `, workspaceId, 50);

  plans.forEach((p) => {
    const planId = `plan_${p.id}`;
    const yearStr = p.year_start ? `${p.year_start}${p.year_end ? `/${p.year_end}` : ''}` : (p.period_key || '');
    addNode({
      id: planId,
      type: 'plan',
      label: p.title || `План работы (${yearStr || '—'})`,
      sublabel: yearStr ? `Учебный год ${yearStr}` : 'План кафедры',
      cluster: 'Планы',
      color: '#059669',
      metadata: {
        rawId: p.id,
        yearStart: p.year_start,
        yearEnd: p.year_end,
        periodKey: p.period_key,
        planKind: p.plan_kind
      }
    });

    const topic = matchTopic(p.title);
    if (topic) {
      addEdge(planId, topic.id, 'thematic', 'направление');
    }

    // Load plan items to connect responsible persons
    const pItems = database.all(`
      SELECT pi.title, pi.responsible_raw
      FROM plan_items pi
      WHERE pi.plan_id = ?
      LIMIT 30
    `, p.id);

    pItems.forEach((pi) => {
      if (pi.responsible_raw && pi.responsible_raw.trim()) {
        const pId = `person_${encodeURIComponent(pi.responsible_raw.trim().toLowerCase())}`;
        addNode({
          id: pId,
          type: 'person',
          label: pi.responsible_raw.trim(),
          sublabel: 'Ответственный по плану',
          cluster: 'Преподаватели',
          color: '#d97706',
          metadata: { role: 'plan_responsible' }
        });
        addEdge(planId, pId, 'responsible', 'пункт плана');
      }
      const itemTopic = matchTopic(pi.title);
      if (itemTopic) {
        addEdge(planId, itemTopic.id, 'thematic', 'пункт');
      }
    });
  });

  // 5. Query Filtering & Focus Subgraph
  let filteredNodes = nodes;
  let filteredEdges = edges;

  if (query) {
    const matchingNodeIds = new Set();
    nodes.forEach((n) => {
      if (n.label.toLowerCase().includes(query) ||
          n.sublabel.toLowerCase().includes(query) ||
          n.cluster.toLowerCase().includes(query)) {
        matchingNodeIds.add(n.id);
      }
    });

    // Also include 1-hop connected nodes to show relations
    const connectedIds = new Set(matchingNodeIds);
    edges.forEach((e) => {
      if (matchingNodeIds.has(e.source)) connectedIds.add(e.target);
      if (matchingNodeIds.has(e.target)) connectedIds.add(e.source);
    });

    filteredNodes = nodes.filter((n) => connectedIds.has(n.id));
    filteredEdges = edges.filter((e) => connectedIds.has(e.source) && connectedIds.has(e.target));
  } else if (focusId) {
    const focusSet = new Set([focusId]);
    edges.forEach((e) => {
      if (e.source === focusId) focusSet.add(e.target);
      if (e.target === focusId) focusSet.add(e.source);
    });
    filteredNodes = nodes.filter((n) => focusSet.has(n.id));
    filteredEdges = edges.filter((e) => focusSet.has(e.source) && focusSet.has(e.target));
  } else if (typeFilter) {
    const typeSet = new Set(nodes.filter((n) => n.type === typeFilter).map((n) => n.id));
    // include topic connections for visual context
    edges.forEach((e) => {
      if (typeSet.has(e.source) && e.target.startsWith('topic_')) typeSet.add(e.target);
      if (typeSet.has(e.target) && e.source.startsWith('topic_')) typeSet.add(e.source);
    });
    filteredNodes = nodes.filter((n) => typeSet.has(n.id));
    filteredEdges = edges.filter((e) => typeSet.has(e.source) && typeSet.has(e.target));
  }

  // Remove duplicate edges
  const uniqueEdgesMap = new Map();
  filteredEdges.forEach((e) => {
    const key = [e.source, e.target].sort().join(':::');
    if (!uniqueEdgesMap.has(key)) {
      uniqueEdgesMap.set(key, e);
    }
  });

  const finalEdges = [...uniqueEdgesMap.values()];

  // Stats calculation
  const stats = {
    totalNodes: filteredNodes.length,
    totalEdges: finalEdges.length,
    documentsCount: filteredNodes.filter((n) => n.type === 'document').length,
    meetingsCount: filteredNodes.filter((n) => n.type === 'meeting').length,
    plansCount: filteredNodes.filter((n) => n.type === 'plan').length,
    peopleCount: filteredNodes.filter((n) => n.type === 'person').length,
    topicsCount: filteredNodes.filter((n) => n.type === 'topic').length
  };

  return {
    ok: true,
    nodes: filteredNodes,
    edges: finalEdges,
    stats,
    clusters: THEMATIC_CLUSTERS.map((c) => ({ id: c.id, label: c.label }))
  };
}

export function searchAllDocumentEntities(database, workspaceId, query, limit = 30) {
  const cleanQ = String(query || '').trim().toLowerCase();
  if (!cleanQ) return [];

  const results = [];

  // Search meetings
  const meetings = database.all(`
    SELECT m.id, m.title, m.meeting_date, m.protocol_number
    FROM meetings m
    WHERE m.workspace_id = ? AND (
      lower(m.title) LIKE ? OR
      lower(m.chairperson_raw) LIKE ? OR
      m.protocol_number LIKE ?
    )
    LIMIT ?
  `, workspaceId, `%${cleanQ}%`, `%${cleanQ}%`, `%${cleanQ}%`, limit);

  meetings.forEach((m) => {
    results.push({
      id: m.id,
      kind: 'meeting',
      title: m.title ? `${m.title} (№ ${m.protocol_number || '—'})` : `Заседание кафедры № ${m.protocol_number || '—'}`,
      detail: `Дата: ${m.meeting_date || '—'}`,
      date: m.meeting_date
    });
  });

  // Search documents
  const docs = database.all(`
    SELECT d.id, d.title, d.document_type, d.created_at
    FROM documents d
    WHERE d.workspace_id = ? AND lower(d.title) LIKE ?
    LIMIT ?
  `, workspaceId, `%${cleanQ}%`, limit);

  docs.forEach((d) => {
    results.push({
      id: d.id,
      kind: 'document',
      title: d.title || 'Документ без названия',
      detail: `Тип: ${d.document_type || 'документ'}`,
      date: d.created_at
    });
  });

  // Search plan items
  const planItems = database.all(`
    SELECT pi.id, pi.title, pi.responsible_raw, p.title AS plan_title
    FROM plan_items pi
    JOIN plans p ON p.id = pi.plan_id
    WHERE p.workspace_id = ? AND lower(pi.title) LIKE ?
    LIMIT ?
  `, workspaceId, `%${cleanQ}%`, limit);

  planItems.forEach((pi) => {
    results.push({
      id: pi.id,
      kind: 'plan_item',
      title: pi.title,
      detail: `План: ${pi.plan_title}. Ответственный: ${pi.responsible_raw || '—'}`,
      date: null
    });
  });

  return results.slice(0, limit);
}
