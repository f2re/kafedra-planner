import { newId } from '../../core/src/ids.mjs';
import { addSearchFragment } from '../../storage/src/search.mjs';

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalized(value) {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/\s+/gu, ' ')
    .trim();
}

function same(left, right) {
  return normalized(left) === normalized(right);
}

function evidencePayload(raw) {
  const parsed = typeof raw === 'string' ? parseJson(raw, {}) : (raw || {});
  if (Array.isArray(parsed.sources)) return { ...parsed, sources: [...parsed.sources] };
  return { locator: parsed, sources: [] };
}

function sourceEvidence(raw, {
  documentVersionId,
  documentTitle,
  locator,
  relation
}) {
  const payload = evidencePayload(raw);
  if (!payload.sources.some((item) => item.documentVersionId === documentVersionId)) {
    payload.sources.push({
      documentVersionId,
      documentTitle,
      relation,
      locator: locator || null
    });
  }
  return payload;
}

function review(database, workspaceId, sourceId, issueCode, title, explanation, proposedAction, context = {}) {
  const existing = database.get(`
    SELECT id FROM review_items
    WHERE workspace_id = ? AND source_kind = 'document_version'
      AND source_id = ? AND issue_code = ? AND status = 'open'
    ORDER BY created_at DESC LIMIT 1
  `, workspaceId, sourceId, issueCode);
  if (existing) return existing.id;
  const id = newId('review');
  database.run(`
    INSERT INTO review_items(
      id, workspace_id, source_kind, source_id, issue_code, title,
      explanation, proposed_action, severity, status, context_json, created_at
    ) VALUES (?, ?, 'document_version', ?, ?, ?, ?, ?, 'warning', 'open', ?, ?)
  `, id, workspaceId, sourceId, issueCode, title, explanation, proposedAction,
  JSON.stringify(context), new Date().toISOString());
  return id;
}

function exposeRoute(result, meetingId, materialization, matchedBy) {
  result.id = meetingId;
  result.materialization = materialization;
  result.matchedBy = matchedBy;
}

function addMeetingSearch(database, {
  workspaceId,
  meetingId,
  documentVersionId,
  documentTitle,
  result
}) {
  addSearchFragment(database, {
    workspaceId,
    sourceKind: 'meeting',
    sourceId: meetingId,
    documentVersionId,
    title: result.protocolNumber ? `Протокол № ${result.protocolNumber}` : documentTitle,
    content: [result.title, result.chairperson, result.secretary, result.attendees]
      .filter(Boolean).join('\n'),
    locator: result.evidence
  });
}

function ensureMeetingCalendar(database, workspaceId, meeting, documentTitle, now) {
  if (!meeting.meeting_date) return;
  const title = meeting.protocol_number
    ? `Заседание кафедры · протокол № ${meeting.protocol_number}`
    : 'Заседание кафедры';
  const existing = database.get(`
    SELECT id FROM calendar_items
    WHERE workspace_id = ? AND source_kind = 'meeting' AND source_id = ?
    ORDER BY created_at LIMIT 1
  `, workspaceId, meeting.id);
  if (existing) {
    database.run(`
      UPDATE calendar_items
      SET title = ?, starts_at = ?, description = COALESCE(description, ?), updated_at = ?
      WHERE id = ?
    `, title, meeting.meeting_date, documentTitle, now, existing.id);
    return;
  }
  database.run(`
    INSERT INTO calendar_items(
      id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
      all_day, category, importance, status, description, item_kind,
      reminder_minutes, completed_at, created_at, updated_at
    ) VALUES (?, ?, 'meeting', ?, ?, ?, NULL, 1, 'organizational', 'normal', ?, ?,
      'event', NULL, NULL, ?, ?)
  `, newId('cal'), workspaceId, meeting.id, title, meeting.meeting_date,
  meeting.confidence >= 0.75 ? 'confirmed' : 'proposed', documentTitle, now, now);
}

function ensureDecisionCalendar(database, workspaceId, decision, agendaTitle, now) {
  if (!decision?.due_date) return;
  const title = `Срок: ${agendaTitle}`;
  const existing = database.get(`
    SELECT id FROM calendar_items
    WHERE workspace_id = ? AND source_kind = 'decision' AND source_id = ?
    ORDER BY created_at LIMIT 1
  `, workspaceId, decision.id);
  if (existing) {
    database.run(`
      UPDATE calendar_items
      SET title = ?, starts_at = ?, description = ?, updated_at = ?
      WHERE id = ?
    `, title, decision.due_date, decision.text, now, existing.id);
    return;
  }
  database.run(`
    INSERT INTO calendar_items(
      id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
      all_day, category, importance, status, description, item_kind,
      reminder_minutes, completed_at, created_at, updated_at
    ) VALUES (?, ?, 'decision', ?, ?, ?, NULL, 1, 'organizational', 'high', 'open', ?,
      'task', 1440, NULL, ?, ?)
  `, newId('cal'), workspaceId, decision.id, title, decision.due_date,
  decision.text, now, now);
}

function insertDecision(database, {
  workspaceId,
  sourceId,
  agendaId,
  agendaTitle,
  item,
  evidence,
  now
}) {
  if (!item.decisionText) return null;
  const decisionId = newId('decision');
  database.run(`
    INSERT INTO decisions(
      id, agenda_item_id, text, responsible_raw, due_date,
      status, evidence_json, created_at
    ) VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?)
  `, decisionId, agendaId, item.decisionText, item.responsibleRaw, item.dueDate,
  JSON.stringify(evidence), now);
  const decision = database.get('SELECT * FROM decisions WHERE id = ?', decisionId);
  ensureDecisionCalendar(database, workspaceId, decision, agendaTitle, now);
  if (item.responsibleRaw) {
    review(database, workspaceId, sourceId, `responsible_person_unresolved_${decisionId}`,
      'Нужно сопоставить ответственного',
      `В решении указан ответственный: «${item.responsibleRaw}».`,
      'Выберите человека из справочника или оставьте значение как текст.',
      { decisionId, responsibleRaw: item.responsibleRaw, evidence: item.evidence });
  }
  return decisionId;
}

function insertAgenda(database, {
  workspaceId,
  meetingId,
  documentVersionId,
  documentTitle,
  item,
  now
}) {
  const agendaId = newId('agenda');
  const evidence = sourceEvidence(item.evidence, {
    documentVersionId,
    documentTitle,
    locator: item.evidence,
    relation: 'agenda_source'
  });
  database.run(`
    INSERT INTO agenda_items(
      id, meeting_id, item_no, title, heard_text, discussed_text,
      decision_text, evidence_json, created_at, source_kind, source_id,
      source_label, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'document_agenda', ?, ?, ?)
  `, agendaId, meetingId, item.itemNo, item.title, item.heardText, item.discussedText,
  item.decisionText, JSON.stringify(evidence), now,
  `${documentVersionId}:${item.itemNo}`, documentTitle, now);

  addSearchFragment(database, {
    workspaceId,
    sourceKind: 'agenda_item',
    sourceId: agendaId,
    documentVersionId,
    title: `${item.itemNo}. ${item.title}`,
    content: [item.heardText, item.discussedText, item.decisionText].filter(Boolean).join('\n'),
    locator: item.evidence
  });
  const decisionId = insertDecision(database, {
    workspaceId,
    sourceId: documentVersionId,
    agendaId,
    agendaTitle: item.title,
    item,
    evidence,
    now
  });
  return { agendaId, decisionId };
}

function mergeDecision(database, {
  workspaceId,
  sourceId,
  agendaId,
  agendaTitle,
  item,
  documentVersionId,
  documentTitle,
  now
}) {
  if (!item.decisionText) return;
  const decisions = database.all(`
    SELECT * FROM decisions WHERE agenda_item_id = ? ORDER BY created_at
  `, agendaId);
  const exact = decisions.find((decision) => same(decision.text, item.decisionText));
  if (!exact) {
    if (decisions.length) {
      review(database, workspaceId, sourceId, `protocol_decision_conflict_${agendaId}`,
        'Решение по вопросу отличается',
        'В загруженном протоколе найден другой текст решения для уже существующего вопроса.',
        'Сравните оба текста и выберите итоговую формулировку в карточке заседания.',
        { agendaId, existing: decisions.map((row) => row.text), incoming: item.decisionText, evidence: item.evidence });
      return;
    }
    const evidence = sourceEvidence(item.evidence, {
      documentVersionId,
      documentTitle,
      locator: item.evidence,
      relation: 'decision_source'
    });
    insertDecision(database, {
      workspaceId,
      sourceId,
      agendaId,
      agendaTitle,
      item,
      evidence,
      now
    });
    return;
  }

  const changes = {};
  for (const [column, incoming] of [['responsible_raw', item.responsibleRaw], ['due_date', item.dueDate]]) {
    if (!incoming) continue;
    if (!exact[column]) changes[column] = incoming;
    else if (!same(exact[column], incoming)) {
      review(database, workspaceId, sourceId, `protocol_decision_${column}_conflict_${exact.id}`,
        column === 'due_date' ? 'Срок решения отличается' : 'Ответственный по решению отличается',
        `Сохранено: «${exact[column]}». В новом документе: «${incoming}».`,
        'Проверьте исходники и исправьте значение вручную; автоматика ничего не перезаписала.',
        { decisionId: exact.id, existing: exact[column], incoming, evidence: item.evidence });
    }
  }
  const evidence = sourceEvidence(exact.evidence_json, {
    documentVersionId,
    documentTitle,
    locator: item.evidence,
    relation: 'decision_source'
  });
  database.run(`
    UPDATE decisions
    SET responsible_raw = COALESCE(?, responsible_raw),
      due_date = COALESCE(?, due_date), evidence_json = ?
    WHERE id = ?
  `, changes.responsible_raw || null, changes.due_date || null,
  JSON.stringify(evidence), exact.id);
  const updated = database.get('SELECT * FROM decisions WHERE id = ?', exact.id);
  ensureDecisionCalendar(database, workspaceId, updated, agendaTitle, now);
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
    const rows = database.all(`
      SELECT * FROM agenda_items WHERE meeting_id = ? ORDER BY item_no, created_at
    `, meetingId);
    const titleMatches = rows.filter((row) => same(row.title, item.title));
    if (titleMatches.length > 1) {
      review(database, workspaceId, sourceId, `protocol_agenda_ambiguous_${item.itemNo}`,
        'Неоднозначное совпадение вопроса повестки',
        `В заседании найдено несколько вопросов с названием «${item.title}».`,
        'Выберите вопрос, к которому относится фрагмент нового протокола.',
        { meetingId, item, candidates: titleMatches.map((row) => row.id) });
      continue;
    }
    if (titleMatches.length === 0) {
      const numberConflict = rows.find((row) => Number(row.item_no) === Number(item.itemNo));
      if (numberConflict) {
        review(database, workspaceId, sourceId, `protocol_agenda_number_conflict_${item.itemNo}`,
          'Номер вопроса уже занят',
          `Пункт ${item.itemNo} уже называется «${numberConflict.title}», а в новом документе — «${item.title}».`,
          'Сопоставьте вопросы вручную или добавьте новый вопрос с корректным номером.',
          { meetingId, existingAgendaId: numberConflict.id, incoming: item, evidence: item.evidence });
        continue;
      }
      insertAgenda(database, {
        workspaceId, meetingId, documentVersionId, documentTitle, item, now
      });
      continue;
    }

    const existing = titleMatches[0];
    const updates = {};
    let decisionConflict = false;
    for (const [column, incoming] of [
      ['heard_text', item.heardText],
      ['discussed_text', item.discussedText],
      ['decision_text', item.decisionText]
    ]) {
      if (!incoming) continue;
      if (!existing[column]) updates[column] = incoming;
      else if (!same(existing[column], incoming)) {
        if (column === 'decision_text') decisionConflict = true;
        review(database, workspaceId, sourceId, `protocol_agenda_${column}_conflict_${existing.id}`,
          'Фрагмент вопроса повестки отличается',
          `Поле «${column}» уже заполнено и отличается от нового протокола.`,
          'Сравните исходные документы; сохранённое значение не изменено.',
          { meetingId, agendaId: existing.id, field: column, existing: existing[column], incoming, evidence: item.evidence });
      }
    }
    const evidence = sourceEvidence(existing.evidence_json, {
      documentVersionId,
      documentTitle,
      locator: item.evidence,
      relation: 'agenda_source'
    });
    database.run(`
      UPDATE agenda_items
      SET heard_text = COALESCE(?, heard_text),
        discussed_text = COALESCE(?, discussed_text),
        decision_text = COALESCE(?, decision_text),
        evidence_json = ?, updated_at = ?
      WHERE id = ?
    `, updates.heard_text || null, updates.discussed_text || null,
    updates.decision_text || null, JSON.stringify(evidence), now, existing.id);

    addSearchFragment(database, {
      workspaceId,
      sourceKind: 'agenda_item',
      sourceId: existing.id,
      documentVersionId,
      title: `${existing.item_no}. ${existing.title}`,
      content: [item.heardText, item.discussedText, item.decisionText].filter(Boolean).join('\n'),
      locator: item.evidence
    });
    if (!decisionConflict) {
      mergeDecision(database, {
        workspaceId,
        sourceId,
        agendaId: existing.id,
        agendaTitle: existing.title,
        item,
        documentVersionId,
        documentTitle,
        now
      });
    }
  }
}

function matchingMeeting(database, workspaceId, documentVersionId, result) {
  const bySource = database.get(`
    SELECT * FROM meetings
    WHERE workspace_id = ? AND source_document_version_id = ?
  `, workspaceId, documentVersionId);
  if (bySource) return { meeting: bySource, matchedBy: 'source_document_version' };

  const byEvidence = database.all(`
    SELECT * FROM meetings WHERE workspace_id = ? ORDER BY created_at
  `, workspaceId).find((meeting) => {
    const evidence = evidencePayload(meeting.evidence_json);
    return evidence.sources.some((item) => item.documentVersionId === documentVersionId);
  });
  if (byEvidence) return { meeting: byEvidence, matchedBy: 'evidence_source' };

  if (!result.protocolNumber || !result.meetingDate) return { meeting: null, matchedBy: null, candidates: [] };
  const candidates = database.all(`
    SELECT * FROM meetings
    WHERE workspace_id = ? AND protocol_number = ? AND meeting_date = ?
    ORDER BY created_at
  `, workspaceId, result.protocolNumber, result.meetingDate);
  if (candidates.length === 1) return { meeting: candidates[0], matchedBy: 'protocol_number_and_date', candidates };
  return { meeting: null, matchedBy: candidates.length > 1 ? 'ambiguous' : null, candidates };
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
