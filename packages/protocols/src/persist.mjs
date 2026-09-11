import { hasRelocatedAgendaSource } from './meeting-transfer-origin.mjs';
import { newId } from '../../core/src/ids.mjs';
import { addSearchFragment } from '../../storage/src/search.mjs';
import { resolvePerson } from './person-resolver.mjs';
import { syncDecisionCalendar } from './decision-calendar.mjs';

function parseJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalize(value) {
  return String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е').replace(/\s+/gu, ' ').trim();
}

function same(left, right) {
  return normalize(left) === normalize(right);
}

function sourceEvidence(raw, source) {
  const evidence = parseJson(raw, {});
  const sources = Array.isArray(evidence.sources) ? [...evidence.sources] : [];
  const exists = sources.some((item) => item.documentVersionId === source.documentVersionId
    && JSON.stringify(item.locator || null) === JSON.stringify(source.locator || null));
  if (!exists) sources.push(source);
  return { ...evidence, sources };
}

function review(database, workspaceId, sourceId, issueCode, title, message, suggestedAction, context = {}) {
  const existing = database.get(`
    SELECT id FROM review_items
    WHERE workspace_id = ? AND source_kind = 'document_version'
      AND source_id = ? AND issue_code = ? AND status = 'open'
  `, workspaceId, sourceId, issueCode);
  if (existing) return existing.id;
  const id = newId('review');
  database.run(`
    INSERT INTO review_items(
      id, workspace_id, source_kind, source_id, issue_code,
      title, message, suggested_action, context_json, created_at
    ) VALUES (?, ?, 'document_version', ?, ?, ?, ?, ?, ?, ?)
  `, id, workspaceId, sourceId, issueCode, title, message, suggestedAction,
  JSON.stringify(context), new Date().toISOString());
  return id;
}

function matchingMeeting(database, workspaceId, documentVersionId, result) {
  const direct = database.get(`
    SELECT * FROM meetings WHERE workspace_id = ? AND source_document_version_id = ?
  `, workspaceId, documentVersionId);
  if (direct) return { meeting: direct, matchedBy: 'source_document_version' };
  const sourceMatches = database.all(`
    SELECT * FROM meetings WHERE workspace_id = ? AND evidence_json LIKE ?
  `, workspaceId, `%${documentVersionId}%`).filter((meeting) => {
    const evidence = parseJson(meeting.evidence_json, {});
    return Array.isArray(evidence.sources)
      && evidence.sources.some((source) => source.documentVersionId === documentVersionId);
  });
  if (sourceMatches.length === 1) return { meeting: sourceMatches[0], matchedBy: 'evidence_source' };
  if (sourceMatches.length > 1) return { meeting: null, matchedBy: 'ambiguous', candidates: sourceMatches };
  if (!result.protocolNumber || !result.meetingDate) return { meeting: null, matchedBy: 'none' };
  const candidates = database.all(`
    SELECT * FROM meetings
    WHERE workspace_id = ? AND protocol_number = ? AND meeting_date = ?
    ORDER BY created_at, id
  `, workspaceId, result.protocolNumber, result.meetingDate);
  if (candidates.length === 1) return { meeting: candidates[0], matchedBy: 'protocol_number_and_date' };
  if (candidates.length > 1) return { meeting: null, matchedBy: 'ambiguous', candidates };
  return { meeting: null, matchedBy: 'none' };
}

function ensureMeetingCalendar(database, workspaceId, meeting, documentTitle, now) {
  const existing = database.get(`
    SELECT id FROM calendar_items
    WHERE workspace_id = ? AND source_kind = 'meeting' AND source_id = ?
    ORDER BY created_at, id LIMIT 1
  `, workspaceId, meeting.id);
  if (existing) return existing.id;
  const calendarId = newId('cal');
  database.run(`
    INSERT INTO calendar_items(
      id, workspace_id, source_kind, source_id, title, starts_at,
      category, importance, status, description, created_at, updated_at
    ) VALUES (?, ?, 'meeting', ?, ?, ?, 'organizational', 'normal', ?, ?, ?, ?)
  `, calendarId, workspaceId, meeting.id,
  meeting.protocol_number ? `Заседание кафедры · протокол №${meeting.protocol_number}` : 'Заседание кафедры',
  meeting.meeting_date, meeting.meeting_date ? 'confirmed' : 'needs_review', documentTitle, now, now);
  return calendarId;
}

function addMeetingSearch(database, { workspaceId, meetingId, documentVersionId, documentTitle, result }) {
  const existing = database.get(`
    SELECT id FROM search_fragments
    WHERE workspace_id = ? AND source_kind = 'meeting' AND source_id = ?
      AND document_version_id = ?
    LIMIT 1
  `, workspaceId, meetingId, documentVersionId);
  if (existing) return;
  addSearchFragment(database, {
    workspaceId,
    sourceKind: 'meeting',
    sourceId: meetingId,
    documentVersionId,
    title: result.title || documentTitle,
    content: [result.title, result.chairperson, result.secretary, ...result.agendaItems.map((item) => item.title)].filter(Boolean).join('\n'),
    locator: result.evidence
  });
}

function addAgendaSearch(database, { workspaceId, agendaId, documentVersionId, item }) {
  const existing = database.get(`
    SELECT id FROM search_fragments
    WHERE workspace_id = ? AND source_kind = 'agenda_item' AND source_id = ?
      AND document_version_id = ?
    LIMIT 1
  `, workspaceId, agendaId, documentVersionId);
  if (existing) return;
  addSearchFragment(database, {
    workspaceId,
    sourceKind: 'agenda_item',
    sourceId: agendaId,
    documentVersionId,
    title: item.title,
    content: [item.heardText, item.discussedText, item.decisionText].filter(Boolean).join('\n'),
    locator: item.evidence
  });
}

function attachResponsible(database, { workspaceId, documentVersionId, decisionId, raw, now }) {
  if (!raw) return;
  const existing = database.get(`
    SELECT id FROM action_assignments
    WHERE owner_kind = 'decision' AND owner_id = ? AND original_text = ?
    LIMIT 1
  `, decisionId, raw);
  if (existing) return;
  const resolution = resolvePerson(database, workspaceId, raw);
  database.run(`
    INSERT INTO action_assignments(
      id, owner_kind, owner_id, person_id, original_text, resolution_status,
      confidence, candidates_json, created_at
    ) VALUES (?, 'decision', ?, ?, ?, ?, ?, ?, ?)
  `, newId('assign'), decisionId, resolution.personId, raw,
  resolution.status, resolution.confidence, JSON.stringify(resolution.candidates), now);
  if (resolution.status !== 'resolved') {
    review(database, workspaceId, documentVersionId, `responsible_person_unresolved_${decisionId}`,
      'Ответственный требует уточнения',
      `Не удалось однозначно определить сотрудника: «${raw}».`,
      'Выберите сотрудника из списка. Исходная формулировка сохранится.',
      { decisionId, originalText: raw, candidates: resolution.candidates });
  }
}

function insertDecision(database, { workspaceId, documentVersionId, agendaId, agendaTitle, item, now }) {
  if (!item.decisionText) return null;
  const decisionId = newId('decision');
  const evidence = sourceEvidence(item.evidence, {
    documentVersionId,
    locator: item.evidence,
    relation: 'decision_source'
  });
  database.run(`
    INSERT INTO decisions(
      id, agenda_item_id, text, responsible_raw, due_date, status, evidence_json, created_at
    ) VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?)
  `, decisionId, agendaId, item.decisionText, item.responsibleRaw || null,
  item.dueDate || null, JSON.stringify(evidence), now);
  attachResponsible(database, {
    workspaceId, documentVersionId, decisionId, raw: item.responsibleRaw, now
  });
  const decision = database.get('SELECT * FROM decisions WHERE id = ?', decisionId);
  syncDecisionCalendar(database, workspaceId, decision, agendaTitle, now);
  return decisionId;
}

function mergeDecision(database, { workspaceId, documentVersionId, agenda, item, now }) {
  if (!item.decisionText) return;
  const decisions = database.all(`
    SELECT * FROM decisions WHERE agenda_item_id = ? ORDER BY created_at, id
  `, agenda.id);
  const exact = decisions.find((decision) => same(decision.text, item.decisionText));
  if (!exact && decisions.length) {
    review(database, workspaceId, documentVersionId, `protocol_decision_conflict_${agenda.id}`,
      'Решение отличается от сохранённого',
      'В загруженном протоколе для этого вопроса указано другое решение. Сохранённое решение и его срок не изменены.',
      'Сравните формулировки и выберите нужное решение вручную.',
      { agendaId: agenda.id, existing: decisions.map((decision) => ({ id: decision.id, text: decision.text })), incoming: item });
    return;
  }
  if (!exact) {
    insertDecision(database, {
      workspaceId, documentVersionId, agendaId: agenda.id, agendaTitle: agenda.title, item, now
    });
    return;
  }
  const updates = {};
  for (const [column, incoming] of [['responsible_raw', item.responsibleRaw], ['due_date', item.dueDate]]) {
    if (!incoming) continue;
    if (!exact[column]) updates[column] = incoming;
    else if (!same(exact[column], incoming)) {
      review(database, workspaceId, documentVersionId, `protocol_decision_${column}_conflict_${exact.id}`,
        column === 'due_date' ? 'Срок решения отличается' : 'Ответственный отличается',
        `Сохранено: «${exact[column]}». В новом документе: «${incoming}».`,
        'Проверьте исходные документы; автоматическое изменение не выполнено.',
        { decisionId: exact.id, field: column, existing: exact[column], incoming, evidence: item.evidence });
    }
  }
  const evidence = sourceEvidence(exact.evidence_json, {
    documentVersionId,
    locator: item.evidence,
    relation: 'matching_decision'
  });
  database.run(`
    UPDATE decisions SET responsible_raw = COALESCE(?, responsible_raw),
      due_date = COALESCE(?, due_date), evidence_json = ? WHERE id = ?
  `, updates.responsible_raw || null, updates.due_date || null, JSON.stringify(evidence), exact.id);
  const decision = database.get('SELECT * FROM decisions WHERE id = ?', exact.id);
  attachResponsible(database, {
    workspaceId, documentVersionId, decisionId: exact.id, raw: decision.responsible_raw, now
  });
  syncDecisionCalendar(database, workspaceId, decision, agenda.title, now);
}

function insertAgenda(database, { workspaceId, meetingId, documentVersionId, documentTitle, item, now }) {
  const agendaId = newId('agenda');
  const evidence = sourceEvidence(item.evidence, {
    documentVersionId,
    documentTitle,
    locator: item.evidence,
    relation: 'agenda_source'
  });
  database.run(`
    INSERT INTO agenda_items(
      id, meeting_id, item_no, title, heard_text, discussed_text, decision_text,
      evidence_json, created_at, source_kind, source_id, source_label, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'document_agenda', ?, ?, ?)
  `, agendaId, meetingId, item.itemNo, item.title, item.heardText, item.discussedText,
  item.decisionText, JSON.stringify(evidence), now,
  `${documentVersionId}:${item.itemNo}`, documentTitle, now);
  addAgendaSearch(database, { workspaceId, agendaId, documentVersionId, item });
  insertDecision(database, {
    workspaceId, documentVersionId, agendaId, agendaTitle: item.title, item, now
  });
  return agendaId;
}

function mergeAgenda(database, {
  workspaceId,
  sourceId,
  meetingId,
  documentVersionId,
  documentTitle,
  items,
  now
}) {
  for (const item of items) {
    if (hasRelocatedAgendaSource(database, workspaceId, meetingId, documentVersionId, item)) continue;
    const rows = database.all(`
      SELECT * FROM agenda_items WHERE meeting_id = ? ORDER BY item_no, created_at, id
    `, meetingId);
    const sameTitle = rows.filter((row) => same(row.title, item.title));
    const numbered = rows.find((row) => Number(row.item_no) === Number(item.itemNo));
    let agenda = null;
    if (sameTitle.length === 1) agenda = sameTitle[0];
    else if (sameTitle.length > 1) {
      review(database, workspaceId, sourceId, `protocol_agenda_ambiguous_${item.itemNo}`,
        'Неоднозначное совпадение вопроса повестки',
        `В заседании несколько вопросов с названием «${item.title}».`,
        'Выберите соответствующий вопрос вручную.',
        { meetingId, item, candidates: sameTitle.map((row) => row.id) });
      continue;
    } else if (numbered) {
      review(database, workspaceId, sourceId, `protocol_agenda_number_conflict_${numbered.id}`,
        'Номер вопроса занят другим пунктом',
        `Вопрос №${item.itemNo} уже содержит «${numbered.title}», а в документе указано «${item.title}».`,
        'Проверьте, является ли это исправлением существующего вопроса или новым пунктом повестки.',
        { meetingId, existingAgendaId: numbered.id, incoming: item });
      continue;
    }

    if (!agenda) {
      insertAgenda(database, {
        workspaceId, meetingId, documentVersionId, documentTitle, item, now
      });
      continue;
    }

    const updates = {};
    for (const [column, incoming] of [
      ['heard_text', item.heardText],
      ['discussed_text', item.discussedText],
      ['decision_text', item.decisionText]
    ]) {
      if (!incoming) continue;
      if (!agenda[column]) updates[column] = incoming;
      else if (!same(agenda[column], incoming)) {
        review(database, workspaceId, sourceId, `protocol_agenda_${column}_conflict_${agenda.id}`,
          'Содержание вопроса отличается',
          `В новом протоколе отличается поле ${column}. Ранее введённый текст сохранён.`,
          'Сравните источники и внесите нужное исправление вручную.',
          { meetingId, agendaId: agenda.id, field: column, existing: agenda[column], incoming, evidence: item.evidence });
      }
    }
    const evidence = sourceEvidence(agenda.evidence_json, {
      documentVersionId,
      documentTitle,
      locator: item.evidence,
      relation: 'matching_agenda'
    });
    database.run(`
      UPDATE agenda_items
      SET heard_text = COALESCE(?, heard_text), discussed_text = COALESCE(?, discussed_text),
        decision_text = COALESCE(?, decision_text), evidence_json = ?, updated_at = ?
      WHERE id = ?
    `, updates.heard_text || null, updates.discussed_text || null, updates.decision_text || null,
    JSON.stringify(evidence), now, agenda.id);
    addAgendaSearch(database, { workspaceId, agendaId: agenda.id, documentVersionId, item });
    mergeDecision(database, { workspaceId, documentVersionId, agenda, item, now });
  }
}

function exposeRoute(result, meetingId, action, matchedBy) {
  result.meetingId = meetingId;
  result.persistence = { meetingId, action, matchedBy };
}

function createMeeting(database, {
  workspaceId,
  documentVersionId,
  documentTitle,
  result,
  now
}) {
  const meetingId = newId('meeting');
  const evidence = sourceEvidence(result.evidence, {
    documentVersionId,
    documentTitle,
    locator: result.evidence,
    relation: 'primary_source'
  });
  database.run(`
    INSERT INTO meetings(
      id, workspace_id, source_document_version_id, protocol_number, meeting_date,
      title, chairperson_raw, secretary_raw, attendees_raw, confidence, status,
      evidence_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, meetingId, workspaceId, documentVersionId, result.protocolNumber, result.meetingDate,
  result.title, result.chairperson, result.secretary, result.attendees, result.confidence,
  result.confidence >= 0.75 ? 'confirmed_auto' : 'proposed', JSON.stringify(evidence), now, now);

  const meeting = database.get('SELECT * FROM meetings WHERE id = ?', meetingId);
  ensureMeetingCalendar(database, workspaceId, meeting, documentTitle, now);
  addMeetingSearch(database, { workspaceId, meetingId, documentVersionId, documentTitle, result });
  for (const item of result.agendaItems) {
    insertAgenda(database, { workspaceId, meetingId, documentVersionId, documentTitle, item, now });
  }
  exposeRoute(result, meetingId, 'created', 'new_meeting');
  return meetingId;
}

function mergeMeeting(database, {
  workspaceId,
  documentVersionId,
  documentTitle,
  result,
  meeting,
  matchedBy,
  now
}) {
  const scalarUpdates = {};
  for (const [column, incoming] of [
    ['protocol_number', result.protocolNumber],
    ['meeting_date', result.meetingDate],
    ['chairperson_raw', result.chairperson],
    ['secretary_raw', result.secretary],
    ['attendees_raw', result.attendees]
  ]) {
    if (!incoming) continue;
    if (!meeting[column]) scalarUpdates[column] = incoming;
    else if (!same(meeting[column], incoming)) {
      review(database, workspaceId, documentVersionId, `protocol_meeting_${column}_conflict_${meeting.id}`,
        'Реквизит заседания отличается',
        `Сохранено: «${meeting[column]}». В новом документе: «${incoming}».`,
        'Проверьте оба источника и исправьте значение вручную; автоматика ничего не перезаписала.',
        { meetingId: meeting.id, field: column, existing: meeting[column], incoming, evidence: result.evidence });
    }
  }
  const evidence = sourceEvidence(meeting.evidence_json, {
    documentVersionId,
    documentTitle,
    locator: result.evidence,
    relation: 'matching_protocol'
  });
  database.run(`
    UPDATE meetings
    SET protocol_number = COALESCE(?, protocol_number),
      meeting_date = COALESCE(?, meeting_date),
      chairperson_raw = COALESCE(?, chairperson_raw),
      secretary_raw = COALESCE(?, secretary_raw),
      attendees_raw = COALESCE(?, attendees_raw),
      confidence = MAX(confidence, ?), evidence_json = ?, updated_at = ?
    WHERE id = ?
  `, scalarUpdates.protocol_number || null, scalarUpdates.meeting_date || null,
  scalarUpdates.chairperson_raw || null, scalarUpdates.secretary_raw || null,
  scalarUpdates.attendees_raw || null, result.confidence,
  JSON.stringify(evidence), now, meeting.id);

  mergeAgenda(database, {
    workspaceId,
    sourceId: documentVersionId,
    meetingId: meeting.id,
    documentVersionId,
    documentTitle,
    items: result.agendaItems,
    now
  });
  const updated = database.get('SELECT * FROM meetings WHERE id = ?', meeting.id);
  ensureMeetingCalendar(database, workspaceId, updated, documentTitle, now);
  addMeetingSearch(database, {
    workspaceId,
    meetingId: meeting.id,
    documentVersionId,
    documentTitle,
    result
  });
  exposeRoute(result, meeting.id, 'merged', matchedBy);
  return meeting.id;
}

export function persistProtocol(database, {
  workspaceId,
  documentVersionId,
  documentTitle,
  result
}) {
  const now = new Date().toISOString();
  const match = matchingMeeting(database, workspaceId, documentVersionId, result);
  let meetingId;

  if (match.meeting && ['source_document_version', 'evidence_source'].includes(match.matchedBy)) {
    meetingId = match.meeting.id;
    exposeRoute(result, meetingId, 'existing', match.matchedBy);
  } else if (match.meeting) {
    meetingId = mergeMeeting(database, {
      workspaceId,
      documentVersionId,
      documentTitle,
      result,
      meeting: match.meeting,
      matchedBy: match.matchedBy,
      now
    });
  } else {
    if (match.matchedBy === 'ambiguous') {
      review(database, workspaceId, documentVersionId, 'protocol_meeting_match_ambiguous',
        'Найдено несколько похожих заседаний',
        'Номер и дата совпадают у нескольких заседаний, поэтому автоматическое объединение небезопасно.',
        'Выберите существующее заседание вручную либо оставьте созданный рабочий объект отдельным.',
        { candidates: match.candidates.map((item) => item.id), protocolNumber: result.protocolNumber, meetingDate: result.meetingDate });
    }
    meetingId = createMeeting(database, {
      workspaceId, documentVersionId, documentTitle, result, now
    });
  }

  if (!result.protocolNumber) {
    review(database, workspaceId, documentVersionId, 'protocol_number_missing',
      'Не найден номер протокола',
      'Документ похож на протокол, но номер не удалось определить уверенно.',
      'Укажите номер на карточке заседания или оставьте поле пустым.',
      { meetingId });
  }
  if (!result.meetingDate) {
    review(database, workspaceId, documentVersionId, 'meeting_date_missing',
      'Не найдена дата заседания',
      'Автоматический разбор не нашёл однозначную дату заседания.',
      'Выберите дату из текста документа или введите её вручную.',
      { meetingId });
  }
  if (result.agendaItems.length === 0) {
    review(database, workspaceId, documentVersionId, 'agenda_missing',
      'Не найдены пункты повестки',
      'Текст сохранён, но структуру повестки определить не удалось.',
      'Разметьте пункты повестки в редакторе либо добавьте их вручную.',
      { meetingId });
  }
  return meetingId;
}
