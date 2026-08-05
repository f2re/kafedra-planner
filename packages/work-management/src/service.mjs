import { newId } from '../../core/src/ids.mjs';
import { addSearchFragment } from '../../storage/src/search.mjs';

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function normalizePersonName(value) {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^а-яa-z0-9\s-]/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function categoryFor(direction) {
  if (direction === 'science') return 'science';
  if (direction === 'education') return 'education';
  return 'organizational';
}

function addFacet(database, workspaceId, sourceKind, sourceId, name, value, now) {
  if (value === null || value === undefined || value === '') return;
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  database.run(`
    INSERT INTO entity_facets(
      id, workspace_id, source_kind, source_id, facet_name,
      text_value, normalized_value, date_value, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, newId('facet'), workspaceId, sourceKind, sourceId, name,
  isDate ? null : String(value), isDate ? null : normalizePersonName(value), isDate ? String(value) : null, now);
}

function findPerson(database, workspaceId, raw) {
  const normalized = normalizePersonName(raw);
  if (!normalized) return null;
  return database.get(`
    SELECT * FROM people
    WHERE workspace_id = ? AND normalized_name = ? AND status = 'active'
  `, workspaceId, normalized);
}

function review(database, workspaceId, sourceKind, sourceId, issueCode, title, explanation, action, context, now) {
  const exists = database.get(`
    SELECT 1 AS present FROM review_items
    WHERE workspace_id = ? AND source_kind = ? AND source_id = ?
      AND issue_code = ? AND status = 'open'
  `, workspaceId, sourceKind, sourceId, issueCode);
  if (exists) return;
  database.run(`
    INSERT INTO review_items(
      id, workspace_id, source_kind, source_id, issue_code, title,
      explanation, proposed_action, severity, status, context_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'warning', 'open', ?, ?)
  `, newId('review'), workspaceId, sourceKind, sourceId, issueCode, title,
  explanation, action, JSON.stringify(context || {}), now);
}

function assignmentExecutors(database, assignmentId) {
  return database.all(`
    SELECT ae.*, p.display_name, p.email, p.manager_id
    FROM assignment_executors ae
    LEFT JOIN people p ON p.id = ae.person_id
    WHERE ae.assignment_id = ?
    ORDER BY CASE ae.role WHEN 'executor' THEN 1 WHEN 'coexecutor' THEN 2 WHEN 'controller' THEN 3 ELSE 4 END,
      ae.executor_raw
  `, assignmentId);
}

function assignmentEvidence(database, assignmentId) {
  return database.all(`
    SELECT ae.*, d.id AS document_id, d.title AS document_title, dv.original_name
    FROM assignment_evidence ae
    LEFT JOIN document_versions dv ON dv.id = ae.document_version_id
    LEFT JOIN documents d ON d.id = dv.document_id
    WHERE ae.assignment_id = ?
    ORDER BY ae.created_at DESC
  `, assignmentId).map((row) => ({ ...row, locator: parseJson(row.locator_json, {}) }));
}

function assignmentRow(database, workspaceId, assignmentId) {
  const row = database.get(`
    SELECT a.*, d.document_number, d.issued_at, d.directive_kind,
      d.title AS directive_title, dv.document_id AS source_document_id
    FROM assignments a
    LEFT JOIN directives d ON d.id = a.directive_id
    LEFT JOIN document_versions dv ON dv.id = d.source_document_version_id
    WHERE a.workspace_id = ? AND a.id = ?
  `, workspaceId, assignmentId);
  if (!row) return null;
  return {
    ...row,
    evidence: parseJson(row.evidence_json, {}),
    executors: assignmentExecutors(database, row.id),
    reports: assignmentEvidence(database, row.id),
    updates: database.all(`
      SELECT au.*, p.display_name AS actor_name
      FROM assignment_updates au
      LEFT JOIN people p ON p.id = au.actor_person_id
      WHERE au.assignment_id = ? ORDER BY au.created_at DESC
    `, row.id)
  };
}

export function listPeople(database, workspaceId) {
  return database.all(`
    SELECT p.*, m.display_name AS manager_name
    FROM people p LEFT JOIN people m ON m.id = p.manager_id
    WHERE p.workspace_id = ? ORDER BY p.status = 'active' DESC, p.display_name
  `, workspaceId);
}

export function createPerson(database, workspaceId, body, now = new Date().toISOString()) {
  const displayName = String(body.displayName || '').trim();
  const normalizedName = normalizePersonName(displayName);
  if (!displayName || !normalizedName) throw new Error('person_name_required');
  const id = newId('person');
  database.run(`
    INSERT INTO people(
      id, workspace_id, display_name, normalized_name, email, position,
      manager_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    ON CONFLICT(workspace_id, normalized_name) DO UPDATE SET
      display_name = excluded.display_name,
      email = COALESCE(excluded.email, people.email),
      position = COALESCE(excluded.position, people.position),
      manager_id = COALESCE(excluded.manager_id, people.manager_id),
      updated_at = excluded.updated_at
  `, id, workspaceId, displayName, normalizedName, body.email || null,
  body.position || null, body.managerId || null, now, now);
  return database.get('SELECT * FROM people WHERE workspace_id = ? AND normalized_name = ?', workspaceId, normalizedName);
}

function persistExecutor(database, workspaceId, assignmentId, raw, role, now) {
  if (!raw) return;
  const person = findPerson(database, workspaceId, raw);
  database.run(`
    INSERT OR IGNORE INTO assignment_executors(
      assignment_id, person_id, executor_raw, role, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `, assignmentId, person?.id || null, String(raw).trim(), role, now);
  addFacet(database, workspaceId, 'assignment', assignmentId, role, raw, now);
  if (!person && role === 'executor') {
    review(database, workspaceId, 'assignment', assignmentId, 'executor_unresolved',
      'Не удалось однозначно определить исполнителя',
      `В документе указан исполнитель «${raw}», но точного сотрудника в справочнике нет.`,
      'Выберите сотрудника или добавьте его в справочник.', { raw }, now);
  }
}

export function persistDirective(database, {
  workspaceId,
  documentVersionId,
  documentTitle,
  result,
  now = new Date().toISOString()
}) {
  const existing = database.get(`
    SELECT * FROM directives WHERE workspace_id = ? AND source_document_version_id = ?
  `, workspaceId, documentVersionId);
  if (existing) return getDirective(database, workspaceId, existing.id);

  const directiveId = newId('directive');
    database.run(`
      INSERT INTO directives(
        id, workspace_id, source_document_version_id, directive_kind,
        document_number, issued_at, issuer_raw, title, summary, direction,
        status, confidence, evidence_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
    `, directiveId, workspaceId, documentVersionId, result.kind,
    result.documentNumber || null, result.issuedAt || null, result.issuerRaw || null,
    result.title || documentTitle, result.summary || null, result.direction || 'organizational',
    result.confidence || 0, JSON.stringify(result.evidence || {}), now, now);

    addFacet(database, workspaceId, 'directive', directiveId, 'document_number', result.documentNumber, now);
    addFacet(database, workspaceId, 'directive', directiveId, 'date', result.issuedAt, now);
    addFacet(database, workspaceId, 'directive', directiveId, 'direction', result.direction, now);
    addFacet(database, workspaceId, 'directive', directiveId, 'kind', result.kind, now);
    addFacet(database, workspaceId, 'directive', directiveId, 'issuer', result.issuerRaw, now);
    addSearchFragment(database, {
      workspaceId,
      sourceKind: 'directive',
      sourceId: directiveId,
      documentVersionId,
      title: `${result.kind || 'document'} ${result.documentNumber ? `№ ${result.documentNumber}` : ''} · ${result.title || documentTitle}`.trim(),
      content: [result.title, result.summary, result.issuerRaw, ...(result.assignments || []).map((item) => item.instructionText)].filter(Boolean).join('\n'),
      locator: { kind: 'directive', directiveId }
    });

    for (const item of result.assignments || []) {
      const assignmentId = newId('assignment');
      database.run(`
        INSERT INTO assignments(
          id, workspace_id, directive_id, source_item_no, title, instruction_text,
          starts_at, due_date, direction, priority, status, expected_result,
          report_required, confidence, evidence_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)
      `, assignmentId, workspaceId, directiveId, item.itemNo || null, item.title,
      item.instructionText, result.issuedAt || null, item.dueDate || null,
      item.direction || result.direction || 'organizational', item.priority || 'normal',
      item.expectedResult || null, item.reportRequired === false ? 0 : 1,
      item.confidence || 0, JSON.stringify(item.evidence || {}), now, now);

      persistExecutor(database, workspaceId, assignmentId, item.executorRaw, 'executor', now);
      persistExecutor(database, workspaceId, assignmentId, item.controllerRaw, 'controller', now);
      addFacet(database, workspaceId, 'assignment', assignmentId, 'date', item.dueDate, now);
      addFacet(database, workspaceId, 'assignment', assignmentId, 'direction', item.direction || result.direction, now);
      addFacet(database, workspaceId, 'assignment', assignmentId, 'status', 'open', now);
      addFacet(database, workspaceId, 'assignment', assignmentId, 'document_number', result.documentNumber, now);
      addSearchFragment(database, {
        workspaceId,
        sourceKind: 'assignment',
        sourceId: assignmentId,
        documentVersionId,
        title: item.title,
        content: [item.instructionText, item.executorRaw, item.controllerRaw, item.expectedResult].filter(Boolean).join('\n'),
        locator: item.evidence?.locator || {}
      });

      if (item.dueDate) {
        database.run(`
          INSERT OR IGNORE INTO calendar_items(
            id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
            all_day, category, importance, status, description, item_kind,
            reminder_minutes, completed_at, revision, created_at, updated_at
          ) VALUES (?, ?, 'assignment', ?, ?, ?, NULL, 1, ?, ?, 'open', ?, 'task', 10080, NULL, 1, ?, ?)
        `, newId('cal'), workspaceId, assignmentId, item.title, item.dueDate,
        categoryFor(item.direction || result.direction), item.priority || 'normal',
        item.instructionText, now, now);
      } else {
        review(database, workspaceId, 'assignment', assignmentId, 'due_date_missing',
          'У поручения не определён срок', item.instructionText,
          'Укажите контрольный срок; поручение уже сохранено и не потеряется.',
          { directiveId, sourceItemNo: item.itemNo }, now);
      }
    }

    if (!(result.assignments || []).length) {
      review(database, workspaceId, 'document_version', documentVersionId, 'directive_assignments_missing',
        'В распорядительном документе не найдены поручения',
        'Номер и дата документа сохранены, но распорядительные пункты не распознаны.',
        'Откройте документ и добавьте поручения вручную либо настройте шаблон.',
        { directiveId }, now);
    }
  return getDirective(database, workspaceId, directiveId);
}

function directiveWhere(filters, params) {
  const clauses = ['d.workspace_id = ?'];
  params.push(filters.workspaceId);
  if (filters.kind) { clauses.push('d.directive_kind = ?'); params.push(filters.kind); }
  if (filters.from) { clauses.push('d.issued_at >= ?'); params.push(filters.from); }
  if (filters.to) { clauses.push('d.issued_at <= ?'); params.push(filters.to); }
  if (filters.direction) { clauses.push('d.direction = ?'); params.push(filters.direction); }
  if (filters.status) { clauses.push('d.status = ?'); params.push(filters.status); }
  if (filters.q) {
    clauses.push('(d.title LIKE ? OR d.summary LIKE ? OR d.document_number LIKE ? OR d.issuer_raw LIKE ?)');
    const value = `%${filters.q}%`;
    params.push(value, value, value, value);
  }
  if (filters.executor) {
    clauses.push(`EXISTS (
      SELECT 1 FROM assignments a
      JOIN assignment_executors ae ON ae.assignment_id = a.id
      WHERE a.directive_id = d.id AND ae.executor_raw LIKE ?
    )`);
    params.push(`%${filters.executor}%`);
  }
  return clauses;
}

export function listDirectives(database, workspaceId, filters = {}) {
  const params = [];
  const clauses = directiveWhere({ ...filters, workspaceId }, params);
  params.push(Math.min(1000, Math.max(1, Number(filters.limit || 200))));
  return database.all(`
    SELECT d.*, dv.document_id AS source_document_id,
      (SELECT COUNT(*) FROM assignments a WHERE a.directive_id = d.id) AS assignment_count,
      (SELECT COUNT(*) FROM assignments a WHERE a.directive_id = d.id AND a.status NOT IN ('completed','cancelled')) AS open_assignment_count
    FROM directives d
    JOIN document_versions dv ON dv.id = d.source_document_version_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY COALESCE(d.issued_at, '0000-00-00') DESC, d.created_at DESC
    LIMIT ?
  `, ...params);
}

export function getDirective(database, workspaceId, directiveId) {
  const directive = database.get(`
    SELECT d.*, dv.document_id AS source_document_id, dv.original_name
    FROM directives d JOIN document_versions dv ON dv.id = d.source_document_version_id
    WHERE d.workspace_id = ? AND d.id = ?
  `, workspaceId, directiveId);
  if (!directive) return null;
  return {
    ...directive,
    evidence: parseJson(directive.evidence_json, {}),
    assignments: database.all(`
      SELECT id FROM assignments WHERE directive_id = ? ORDER BY CAST(source_item_no AS REAL), created_at
    `, directiveId).map((row) => assignmentRow(database, workspaceId, row.id))
  };
}

export function listAssignments(database, workspaceId, filters = {}) {
  const clauses = ['a.workspace_id = ?'];
  const params = [workspaceId];
  if (filters.from) { clauses.push('a.due_date >= ?'); params.push(filters.from); }
  if (filters.to) { clauses.push('a.due_date <= ?'); params.push(filters.to); }
  if (filters.direction) { clauses.push('a.direction = ?'); params.push(filters.direction); }
  if (filters.status) { clauses.push('a.status = ?'); params.push(filters.status); }
  if (filters.executor) {
    clauses.push('EXISTS (SELECT 1 FROM assignment_executors ae WHERE ae.assignment_id = a.id AND ae.executor_raw LIKE ?)');
    params.push(`%${filters.executor}%`);
  }
  if (filters.q) {
    clauses.push('(a.title LIKE ? OR a.instruction_text LIKE ? OR a.expected_result LIKE ?)');
    const value = `%${filters.q}%`;
    params.push(value, value, value);
  }
  params.push(Math.min(2000, Math.max(1, Number(filters.limit || 500))));
  return database.all(`
    SELECT a.id FROM assignments a
    WHERE ${clauses.join(' AND ')}
    ORDER BY CASE WHEN a.status IN ('completed','cancelled') THEN 1 ELSE 0 END,
      COALESCE(a.due_date, '9999-12-31'), a.created_at
    LIMIT ?
  `, ...params).map((row) => assignmentRow(database, workspaceId, row.id));
}

export function addAssignmentProgress(database, workspaceId, assignmentId, body, now = new Date().toISOString()) {
  const current = assignmentRow(database, workspaceId, assignmentId);
  if (!current) return null;
  const status = body.status || current.status;
  const progress = body.progressPercent === null || body.progressPercent === undefined
    ? null : Math.max(0, Math.min(100, Number(body.progressPercent)));
  return database.transaction(() => {
    database.run(`
      INSERT INTO assignment_updates(id, assignment_id, actor_person_id, status, progress_percent, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, newId('assignupd'), assignmentId, body.actorPersonId || null, status,
    Number.isFinite(progress) ? progress : null, body.note || null, now);
    database.run(`
      UPDATE assignments SET status = ?, completed_at = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ?
    `, status, status === 'completed' ? now : current.completed_at, now, assignmentId, workspaceId);
    database.run(`
      UPDATE calendar_items SET status = ?, completed_at = ?, revision = revision + 1, updated_at = ?
      WHERE source_kind = 'assignment' AND source_id = ? AND workspace_id = ?
    `, status, status === 'completed' ? now : null, now, assignmentId, workspaceId);
    return assignmentRow(database, workspaceId, assignmentId);
  });
}

export function attachAssignmentReport(database, workspaceId, assignmentId, body, now = new Date().toISOString()) {
  const assignment = assignmentRow(database, workspaceId, assignmentId);
  if (!assignment) return null;
  const version = database.get(`
    SELECT dv.id, d.id AS document_id, d.title
    FROM documents d JOIN document_versions dv ON dv.id = d.current_version_id
    WHERE d.workspace_id = ? AND d.id = ?
  `, workspaceId, body.documentId);
  if (!version) return null;
  database.transaction(() => {
    database.run(`
      INSERT INTO assignment_evidence(
        id, assignment_id, document_version_id, evidence_kind, note, locator_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, newId('evidence'), assignmentId, version.id, body.kind || 'report',
    body.note || null, JSON.stringify(body.locator || {}), now);
    database.run(`
      INSERT INTO assignment_updates(id, assignment_id, actor_person_id, status, progress_percent, note, created_at)
      VALUES (?, ?, ?, 'submitted', NULL, ?, ?)
    `, newId('assignupd'), assignmentId, body.actorPersonId || null,
    body.note || `Приложен отчёт «${version.title}»`, now);
    database.run("UPDATE assignments SET status = 'submitted', updated_at = ? WHERE id = ?", now, assignmentId);
    database.run(`
      UPDATE calendar_items SET status = 'submitted', revision = revision + 1, updated_at = ?
      WHERE source_kind = 'assignment' AND source_id = ?
    `, now, assignmentId);
  });
  return assignmentRow(database, workspaceId, assignmentId);
}

export function createPeriodicTask(database, workspaceId, body, now = new Date().toISOString()) {
  if (!body.title || !body.dueDate || !body.periodKind || !body.periodKey) throw new Error('periodic_task_fields_required');
  const id = newId('periodic');
  database.transaction(() => {
    database.run(`
      INSERT INTO periodic_tasks(
        id, workspace_id, owner_person_id, manager_person_id, period_kind, period_key,
        title, description, starts_at, due_date, direction, priority, status,
        expected_result, report_required, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
    `, id, workspaceId, body.ownerPersonId || null, body.managerPersonId || null,
    body.periodKind, body.periodKey, body.title, body.description || null,
    body.startsAt || null, body.dueDate, body.direction || 'organizational',
    body.priority || 'normal', body.expectedResult || null,
    body.reportRequired === false ? 0 : 1, now, now);
    database.run(`
      INSERT INTO calendar_items(
        id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
        all_day, category, importance, status, description, item_kind,
        reminder_minutes, completed_at, revision, created_at, updated_at
      ) VALUES (?, ?, 'periodic_task', ?, ?, ?, NULL, 1, ?, ?, 'open', ?, 'task', 10080, NULL, 1, ?, ?)
    `, newId('cal'), workspaceId, id, body.title, body.dueDate,
    categoryFor(body.direction), body.priority || 'normal', body.description || null, now, now);
    addFacet(database, workspaceId, 'periodic_task', id, 'date', body.dueDate, now);
    addFacet(database, workspaceId, 'periodic_task', id, 'direction', body.direction, now);
    addFacet(database, workspaceId, 'periodic_task', id, 'period', `${body.periodKind}:${body.periodKey}`, now);
  });
  return database.get('SELECT * FROM periodic_tasks WHERE id = ?', id);
}

export function listPeriodicTasks(database, workspaceId, filters = {}) {
  const clauses = ['pt.workspace_id = ?'];
  const params = [workspaceId];
  if (filters.ownerPersonId) { clauses.push('pt.owner_person_id = ?'); params.push(filters.ownerPersonId); }
  if (filters.managerPersonId) { clauses.push('pt.manager_person_id = ?'); params.push(filters.managerPersonId); }
  if (filters.periodKind) { clauses.push('pt.period_kind = ?'); params.push(filters.periodKind); }
  if (filters.periodKey) { clauses.push('pt.period_key = ?'); params.push(filters.periodKey); }
  if (filters.status) { clauses.push('pt.status = ?'); params.push(filters.status); }
  return database.all(`
    SELECT pt.*, owner.display_name AS owner_name, manager.display_name AS manager_name
    FROM periodic_tasks pt
    LEFT JOIN people owner ON owner.id = pt.owner_person_id
    LEFT JOIN people manager ON manager.id = pt.manager_person_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY pt.due_date, pt.title
  `, ...params);
}

export function searchWork(database, workspaceId, filters = {}) {
  const directives = listDirectives(database, workspaceId, { ...filters, limit: filters.limit || 200 }).map((item) => ({
    sourceKind: 'directive', id: item.id, title: item.title, subtype: item.directive_kind,
    documentNumber: item.document_number, eventDate: item.issued_at, direction: item.direction,
    status: item.status, executor: null, sourceDocumentId: item.source_document_id,
    openCount: item.open_assignment_count
  }));
  const assignments = listAssignments(database, workspaceId, { ...filters, limit: filters.limit || 500 }).map((item) => ({
    sourceKind: 'assignment', id: item.id, title: item.title, subtype: 'assignment',
    documentNumber: item.document_number, eventDate: item.due_date, direction: item.direction,
    status: item.status, executor: item.executors.map((executor) => executor.display_name || executor.executor_raw).join(', '),
    sourceDocumentId: item.source_document_id, directiveId: item.directive_id,
    reportCount: item.reports.length
  }));
  const items = [...directives, ...assignments].sort((a, b) =>
    String(b.eventDate || '').localeCompare(String(a.eventDate || '')) || a.title.localeCompare(b.title, 'ru')
  );
  return {
    items: items.slice(0, Math.min(1000, Math.max(1, Number(filters.limit || 500)))),
    facets: {
      directions: [...new Set(items.map((item) => item.direction).filter(Boolean))].sort(),
      statuses: [...new Set(items.map((item) => item.status).filter(Boolean))].sort(),
      kinds: [...new Set(items.map((item) => item.subtype).filter(Boolean))].sort()
    }
  };
}

export function recordLlmRun(database, workspaceId, documentVersionId, result, now = new Date().toISOString()) {
  const id = newId('llmrun');
  database.run(`
    INSERT INTO llm_extraction_runs(
      id, workspace_id, document_version_id, purpose, endpoint, model,
      prompt_version, input_sha256, status, response_json, error_message,
      duration_ms, created_at, completed_at
    ) VALUES (?, ?, ?, 'directive_enrichment', ?, ?, 'directive-v1', ?, ?, ?, ?, ?, ?, ?)
  `, id, workspaceId, documentVersionId, result.endpoint || null, result.model || null,
  result.inputSha256, result.status, result.output ? JSON.stringify(result.output) : null,
  result.error || null, result.durationMs || null, now,
  ['completed', 'failed', 'disabled'].includes(result.status) ? now : null);
  return id;
}
