import { newId } from '../../core/src/ids.mjs';
import { addSearchFragment } from '../../storage/src/search.mjs';

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/[«»„“”"'`]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function sameText(left, right) {
  return normalizeText(left) === normalizeText(right);
}

function sourceEvidence(evidence, documentVersionId) {
  return { ...(evidence || {}), sourceDocumentVersionId: documentVersionId };
}

function review(database, workspaceId, sourceId, issueCode, title, explanation, proposedAction, context = {}) {
  const contextJson = JSON.stringify(context);
  const existing = database.get(`
    SELECT id FROM review_items
    WHERE workspace_id = ? AND source_kind = 'document_version' AND source_id = ?
      AND issue_code = ? AND status = 'open' AND context_json = ?
    ORDER BY created_at DESC LIMIT 1
  `, workspaceId, sourceId, issueCode, contextJson);
  if (existing) return existing.id;
  const id = newId('review');
  database.run(`
    INSERT INTO review_items(
      id, workspace_id, source_kind, source_id, issue_code, title,
      explanation, proposed_action, severity, status, context_json, created_at
    ) VALUES (?, ?, 'document_version', ?, ?, ?, ?, ?, 'warning', 'open', ?, ?)
  `, id, workspaceId, sourceId, issueCode, title, explanation, proposedAction, contextJson, new Date().toISOString());
  return id;
}

function mergedSources(evidence) {
  return Array.isArray(evidence?.mergedSources) ? evidence.mergedSources : [];
}

function addMergedSource(evidence, documentVersionId, locator) {
  const current = { ...(evidence || {}) };
  const sources = mergedSources(current).filter((entry) => entry?.documentVersionId !== documentVersionId);
  sources.push({ documentVersionId, locator: locator || null });
  current.mergedSources = sources;
  return current;
}

function alreadyMergedMeeting(database, workspaceId, documentVersionId) {
  const primary = database.get(`
    SELECT * FROM meetings
    WHERE workspace_id = ? AND source_document_version_id = ?
  `, workspaceId, documentVersionId);
  if (primary) return primary;
  return database.all('SELECT * FROM meetings WHERE workspace_id = ?', workspaceId)
    .find((meeting) => mergedSources(parseJson(meeting.evidence_json, {}))
      .some((entry) => entry?.documentVersionId === documentVersionId)) || null;
}

function meetingCandidates(database, workspaceId, result) {
  if (result.protocolNumber && result.meetingDate) {
    return database.all(`
      SELECT * FROM meetings
      WHERE workspace_id = ? AND protocol_number = ? AND meeting_date = ?
      ORDER BY created_at
    `, workspaceId, result.protocolNumber, result.meetingDate);
  }
  if (result.meetingDate) {
    return database.all(`
      SELECT * FROM meetings
      WHERE workspace_id = ? AND meeting_date = ? AND source_document_version_id IS NULL
      ORDER BY created_at
    `, workspaceId, result.meetingDate).filter((meeting) =>
      !result.protocolNumber || !meeting.protocol_number || meeting.protocol_number === result.protocolNumber);
  }
  return [];
}

function ensureMeetingCalendar(database, workspaceId, meetingId, result, documentTitle, now) {
  if (!result.meetingDate) return;
  const existing = database.get(`
    SELECT id FROM calendar_items WHERE workspace_id = ? AND source_kind = 'meeting' AND source_id = ?
    ORDER BY created_at LIMIT 1
  `, workspaceId, meetingId);
  if (existing) return;
  database.run(`
    INSERT INTO calendar_items(
      id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
      all_day, category, importance, status, description, item_kind,
      reminder_minutes, completed_at, created_at, updated_at
    ) VALUES (?, ?, 'meeting', ?, ?, ?, NULL, 1, 'organizational', 'normal', ?, ?,
      'event', NULL, NULL, ?, ?)
  `, newId('cal'), workspaceId, meetingId,
  result.protocolNumber ? `Заседание кафедры · протокол № ${result.protocolNumber}` : 'Заседание кафедры',
  result.meetingDate, result.confidence >= 0.75 ? 'confirmed' : 'proposed', documentTitle, now, now);
}

function ensureDecisionCalendar(database, workspaceId, decisionId, item, now) {
  if (!item.dueDate) return;
  const existing = database.get(`
    SELECT id FROM calendar_items WHERE workspace_id = ? AND source_kind = 'decision' AND source_id = ?
    ORDER BY created_at LIMIT 1
  `, workspaceId, decisionId);
  if (existing) return;
  database.run(`
    INSERT INTO calendar_items(
      id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
      all_day, category, importance, status, description, item_kind,
      reminder_minutes, completed_at, created_at, updated_at
    ) VALUES (?, ?, 'decision', ?, ?, ?, NULL, 1, 'organizational', 'high', 'open', ?,
      'task', 1440, NULL, ?, ?)
  `, newId('cal'), workspaceId, decisionId, `Срок: ${item.title}`,
  item.dueDate, item.decisionText, now, now);
}

function responsibleReview(database, workspaceId, documentVersionId, decisionId, item) {
  if (!item.responsibleRaw) return;
  review(database, workspaceId, documentVersionId, 'responsible_person_unresolved',
    'Нужно сопоставить ответственного',
    `В решении указан ответственный: «${item.responsibleRaw}».`,
    'Выберите человека из справочника или оставьте значение как текст.',
    { decisionId, responsibleRaw: item.responsibleRaw, evidence: sourceEvidence(item.evidence, documentVersionId) });
}

function createDecision(database, { workspaceId, documentVersionId, agendaId, item, now }) {
  if (!item.decisionText) return null;
  const decisionId = newId('decision');
  database.run(`
    INSERT INTO decisions(
      id, agenda_item_id, text, responsible_raw, due_date,
      status, evidence_json, created_at
    ) VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?)
  `, decisionId, agendaId, item.decisionText, item.responsibleRaw, item.dueDate,
  JSON.stringify(sourceEvidence(item.evidence, documentVersionId)), now);
  ensureDecisionCalendar(database, workspaceId, decisionId, item, now);
  responsibleReview(database, workspaceId, documentVersionId, decisionId, item);
  return decisionId;
}

function createAgendaItem(database, {
  workspaceId, documentVersionId, documentTitle, meetingId, item, now
}) {
  const agendaId = newId('agenda');
  database.run(`
    INSERT INTO agenda_items(
      id, meeting_id, item_no, title, heard_text, discussed_text,
      decision_text, evidence_json, created_at, source_kind, source_id, source_label, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'document_version', ?, ?, ?)
  `, agendaId, meetingId, item.itemNo, item.title, item.heardText, item.discussedText,
  item.decisionText, JSON.stringify(sourceEvidence(item.evidence, documentVersionId)), now,
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
  createDecision(database, { workspaceId, documentVersionId, agendaId, item, now });
  return agendaId;
}

function fieldConflict(database, workspaceId, documentVersionId, meetingId, field, existing, incoming, evidence) {
  review(database, workspaceId, documentVersionId, `meeting_field_conflict_${field}`,
    'Данные протокола отличаются от карточки заседания',
    `Поле «${field}» уже содержит «${existing}», а в новом документе найдено «${incoming}».`,
    'Сравните оба значения с исходными документами и исправьте карточку вручную только при необходимости.',
    { meetingId, field, existing, incoming, evidence: sourceEvidence(evidence, documentVersionId) });
}

function mergeMeetingFields(database, { workspaceId, documentVersionId, meeting, result, now }) {
  const columns = [
    ['protocol_number', result.protocolNumber],
    ['meeting_date', result.meetingDate],
    ['chairperson_raw', result.chairperson],
    ['secretary_raw', result.secretary],
    ['attendees_raw', result.attendees]
  ];
  const updates = {};
  for (const [column, incoming] of columns) {
    if (!incoming) continue;
    const existing = meeting[column];
    if (!existing) updates[column] = incoming;
    else if (!sameText(existing, incoming)) {
      fieldConflict(database, workspaceId, documentVersionId, meeting.id, column, existing, incoming, result.evidence);
    }
  }
  if (!meeting.source_document_version_id) updates.source_document_version_id = documentVersionId;
  updates.confidence = Math.max(Number(meeting.confidence || 0), Number(result.confidence || 0));
  updates.evidence_json = JSON.stringify(addMergedSource(
    parseJson(meeting.evidence_json, {}), documentVersionId, result.evidence
  ));
  updates.updated_at = now;
  const entries = Object.entries(updates);
  database.run(`UPDATE meetings SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`,
    ...entries.map(([, value]) => value), meeting.id);
  return database.get('SELECT * FROM meetings WHERE id = ?', meeting.id);
}

function agendaConflict(database, workspaceId, documentVersionId, meetingId, item, reason, existing = null) {
  review(database, workspaceId, documentVersionId, `agenda_conflict_${item.itemNo}`,
    'Вопрос повестки требует проверки',
    reason,
    'Сравните пункт загруженного протокола с существующей повесткой. Система не перезаписывает различающиеся данные автоматически.',
    {
      meetingId,
      itemNo: item.itemNo,
      incomingTitle: item.title,
      existingAgendaId: existing?.id || null,
      existingTitle: existing?.title || null,
      evidence: sourceEvidence(item.evidence, documentVersionId)
    });
}

function mergeAgendaField(database, { workspaceId, documentVersionId, meetingId, existing, item, field, incoming }) {
  if (!incoming) return false;
  const current = existing[field];
  if (!current) {
    database.run(`UPDATE agenda_items SET ${field} = ?, updated_at = ? WHERE id = ?`, incoming, new Date().toISOString(), existing.id);
    existing[field] = incoming;
    return true;
  }
  if (!sameText(current, incoming)) {
    agendaConflict(database, workspaceId, documentVersionId, meetingId, item,
      `В существующем пункте «${existing.title}» поле ${field} отличается от загруженного протокола.`, existing);
  }
  return false;
}

function mergeDecision(database, { workspaceId, documentVersionId, agenda, item, now }) {
  if (!item.decisionText) return;
  let decision = database.all('SELECT * FROM decisions WHERE agenda_item_id = ? ORDER BY created_at', agenda.id)
    .find((row) => sameText(row.text, item.decisionText));
  if (!decision) {
    const any = database.get('SELECT * FROM decisions WHERE agenda_item_id = ? ORDER BY created_at LIMIT 1', agenda.id);
    if (any && !sameText(any.text, item.decisionText)) {
      agendaConflict(database, workspaceId, documentVersionId, agenda.meeting_id, item,
        'Существующее решение по этому вопросу отличается от решения в загруженном протоколе.', agenda);
      return;
    }
    createDecision(database, { workspaceId, documentVersionId, agendaId: agenda.id, item, now });
    return;
  }
  const updates = {};
  if (item.responsibleRaw) {
    if (!decision.responsible_raw) updates.responsible_raw = item.responsibleRaw;
    else if (!sameText(decision.responsible_raw, item.responsibleRaw)) {
      review(database, workspaceId, documentVersionId, 'decision_responsible_conflict',
        'Ответственный в решении отличается',
        `В карточке решения указан «${decision.responsible_raw}», а в загруженном протоколе — «${item.responsibleRaw}».`,
        'Сверьте ответственного с исходным протоколом и организационной структурой.',
        { decisionId: decision.id, existing: decision.responsible_raw, incoming: item.responsibleRaw, evidence: sourceEvidence(item.evidence, documentVersionId) });
    }
  }
  if (item.dueDate) {
    if (!decision.due_date) updates.due_date = item.dueDate;
    else if (decision.due_date !== item.dueDate) {
      review(database, workspaceId, documentVersionId, 'decision_due_date_conflict',
        'Срок в решении отличается',
        `Сохранённый срок ${decision.due_date}, а в загруженном протоколе найден ${item.dueDate}.`,
        'Сверьте срок с исходным протоколом и исправьте вручную при необходимости.',
        { decisionId: decision.id, existing: decision.due_date, incoming: item.dueDate, evidence: sourceEvidence(item.evidence, documentVersionId) });
    }
  }
  if (Object.keys(updates).length) {
    database.run(`UPDATE decisions SET ${Object.keys(updates).map((key) => `${key} = ?`).join(', ')} WHERE id = ?`,
      ...Object.values(updates), decision.id);
    decision = { ...decision, ...updates };
  }
  if (decision.due_date) ensureDecisionCalendar(database, workspaceId, decision.id, { ...item, dueDate: decision.due_date }, now);
  responsibleReview(database, workspaceId, documentVersionId, decision.id, { ...item, responsibleRaw: decision.responsible_raw || item.responsibleRaw });
}

function mergeAgendaItems(database, {
  workspaceId, documentVersionId, documentTitle, meetingId, result, now
}) {
  for (const item of result.agendaItems) {
    const agendas = database.all('SELECT * FROM agenda_items WHERE meeting_id = ? ORDER BY item_no', meetingId);
    const byTitle = agendas.filter((row) => normalizeText(row.title) === normalizeText(item.title));
    const byNumber = agendas.find((row) => Number(row.item_no) === Number(item.itemNo));
    let existing = byTitle.length === 1 ? byTitle[0] : null;
    if (!existing && byNumber && sameText(byNumber.title, item.title)) existing = byNumber;
    if (!existing && byTitle.length > 1) {
      agendaConflict(database, workspaceId, documentVersionId, meetingId, item,
        'Несколько существующих пунктов имеют одинаковое нормализованное название, поэтому автоматическое сопоставление неоднозначно.');
      continue;
    }
    if (!existing && byNumber) {
      agendaConflict(database, workspaceId, documentVersionId, meetingId, item,
        `Номер ${item.itemNo} уже занят другим вопросом «${byNumber.title}».`, byNumber);
      continue;
    }
    if (!existing) {
      createAgendaItem(database, { workspaceId, documentVersionId, documentTitle, meetingId, item, now });
      continue;
    }

    mergeAgendaField(database, { workspaceId, documentVersionId, meetingId, existing, item, field: 'heard_text', incoming: item.heardText });
    mergeAgendaField(database, { workspaceId, documentVersionId, meetingId, existing, item, field: 'discussed_text', incoming: item.discussedText });
    const decisionChanged = mergeAgendaField(database, { workspaceId, documentVersionId, meetingId, existing, item, field: 'decision_text', incoming: item.decisionText });
    const evidence = addMergedSource(parseJson(existing.evidence_json, {}), documentVersionId, item.evidence);
    database.run('UPDATE agenda_items SET evidence_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(evidence), now, existing.id);

    addSearchFragment(database, {
      workspaceId,
      sourceKind: 'agenda_item',
      sourceId: existing.id,
      documentVersionId,
      title: `${existing.item_no}. ${existing.title}`,
      content: [item.heardText, item.discussedText, item.decisionText].filter(Boolean).join('\n'),
      locator: item.evidence
    });
    if (item.decisionText && (decisionChanged || sameText(existing.decision_text, item.decisionText))) {
      mergeDecision(database, { workspaceId, documentVersionId, agenda: existing, item, now });
    }
  }
}

function missingReviews(database, workspaceId, documentVersionId, result) {
  if (!result.protocolNumber) {
    review(database, workspaceId, documentVersionId, 'protocol_number_missing',
      'Не найден номер протокола',
      'Документ похож на протокол, но номер не удалось определить уверенно.',
      'Укажите номер на карточке документа или подтвердите отсутствие номера.');
  }
  if (!result.meetingDate) {
    review(database, workspaceId, documentVersionId, 'meeting_date_missing',
      'Не найдена дата заседания',
      'Автоматический разбор не нашёл однозначную дату заседания.',
      'Выберите дату из текста документа или введите её вручную.');
  }
  if (result.agendaItems.length === 0) {
    review(database, workspaceId, documentVersionId, 'agenda_missing',
      'Не найдены пункты повестки',
      'Текст сохранён, но структуру повестки определить не удалось.',
      'Разметьте начало и конец пунктов повестки в редакторе шаблона.');
  }
}

function createMeeting(database, { workspaceId, documentVersionId, documentTitle, result, now }) {
  const meetingId = newId('meeting');
  database.run(`
    INSERT INTO meetings(
      id, workspace_id, source_document_version_id, protocol_number, meeting_date,
      title, chairperson_raw, secretary_raw, attendees_raw, confidence, status,
      evidence_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  meetingId, workspaceId, documentVersionId, result.protocolNumber, result.meetingDate,
  result.title, result.chairperson, result.secretary, result.attendees, result.confidence,
  result.confidence >= 0.75 ? 'confirmed_auto' : 'proposed',
  JSON.stringify(addMergedSource(sourceEvidence(result.evidence, documentVersionId), documentVersionId, result.evidence)), now, now);

  ensureMeetingCalendar(database, workspaceId, meetingId, result, documentTitle, now);
  addSearchFragment(database, {
    workspaceId,
    sourceKind: 'meeting',
    sourceId: meetingId,
    documentVersionId,
    title: result.protocolNumber ? `Протокол № ${result.protocolNumber}` : documentTitle,
    content: [result.chairperson, result.secretary, result.attendees].filter(Boolean).join('\n'),
    locator: result.evidence
  });
  for (const item of result.agendaItems) {
    createAgendaItem(database, { workspaceId, documentVersionId, documentTitle, meetingId, item, now });
  }
  return meetingId;
}

export function persistProtocol(database, {
  workspaceId,
  documentVersionId,
  documentTitle,
  result
}) {
  const already = alreadyMergedMeeting(database, workspaceId, documentVersionId);
  if (already) {
    result.id = already.id;
    return already.id;
  }

  const now = new Date().toISOString();
  const candidates = meetingCandidates(database, workspaceId, result);
  let meetingId;
  if (candidates.length === 1) {
    const meeting = mergeMeetingFields(database, {
      workspaceId, documentVersionId, meeting: candidates[0], result, now
    });
    meetingId = meeting.id;
    ensureMeetingCalendar(database, workspaceId, meetingId, {
      ...result,
      protocolNumber: meeting.protocol_number || result.protocolNumber,
      meetingDate: meeting.meeting_date || result.meetingDate
    }, documentTitle, now);
    addSearchFragment(database, {
      workspaceId,
      sourceKind: 'meeting',
      sourceId: meetingId,
      documentVersionId,
      title: result.protocolNumber ? `Протокол № ${result.protocolNumber}` : documentTitle,
      content: [result.chairperson, result.secretary, result.attendees].filter(Boolean).join('\n'),
      locator: result.evidence
    });
    mergeAgendaItems(database, { workspaceId, documentVersionId, documentTitle, meetingId, result, now });
  } else {
    meetingId = createMeeting(database, { workspaceId, documentVersionId, documentTitle, result, now });
    if (candidates.length > 1) {
      review(database, workspaceId, documentVersionId, 'protocol_meeting_match_ambiguous',
        'Найдено несколько подходящих заседаний',
        'Номер и дата протокола совпадают более чем с одной карточкой. Новый источник сохранён отдельно, чтобы не смешивать историю автоматически.',
        'Выберите правильное заседание вручную после сравнения исходных документов.',
        { meetingId, candidateIds: candidates.map((candidate) => candidate.id), protocolNumber: result.protocolNumber, meetingDate: result.meetingDate });
    }
  }
  missingReviews(database, workspaceId, documentVersionId, result);
  result.id = meetingId;
  return meetingId;
}
