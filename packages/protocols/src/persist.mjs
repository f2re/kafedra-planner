import { newId } from '../../core/src/ids.mjs';
import { addSearchFragment } from '../../storage/src/search.mjs';

function review(database, workspaceId, sourceId, issueCode, title, explanation, proposedAction, context = {}, now = new Date().toISOString()) {
  const existing = database.get(`
    SELECT id FROM review_items
    WHERE workspace_id = ? AND source_kind = 'document_version'
      AND source_id = ? AND issue_code = ? AND status = 'open'
    ORDER BY created_at LIMIT 1
  `, workspaceId, sourceId, issueCode);
  if (existing) return existing.id;
  const id = newId('review');
  database.run(`
    INSERT INTO review_items(
      id, workspace_id, source_kind, source_id, issue_code, title,
      explanation, proposed_action, severity, status, context_json, created_at
    ) VALUES (?, ?, 'document_version', ?, ?, ?, ?, ?, 'warning', 'open', ?, ?)
  `, id, workspaceId, sourceId, issueCode, title, explanation, proposedAction, JSON.stringify(context), now);
  return id;
}

export function persistProtocol(database, {
  workspaceId,
  documentVersionId,
  documentTitle,
  result,
  now = new Date().toISOString()
}) {
  return database.transaction(() => {
    const existing = database.get(`
      SELECT id FROM meetings
      WHERE workspace_id = ? AND source_document_version_id = ?
      LIMIT 1
    `, workspaceId, documentVersionId);
    if (existing) return existing.id;

    const meetingId = newId('meeting');
    const agendaItems = Array.isArray(result?.agendaItems) ? result.agendaItems : [];
    database.run(`
      INSERT INTO meetings(
        id, workspace_id, source_document_version_id, protocol_number, meeting_date,
        title, chairperson_raw, secretary_raw, attendees_raw, confidence, status,
        evidence_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    meetingId, workspaceId, documentVersionId, result?.protocolNumber || null, result?.meetingDate || null,
    result?.title || documentTitle || 'Заседание кафедры', result?.chairperson || null,
    result?.secretary || null, result?.attendees || null, result?.confidence ?? 0,
    Number(result?.confidence || 0) >= 0.75 ? 'confirmed_auto' : 'proposed',
    JSON.stringify(result?.evidence || {}), now, now);

    if (result?.meetingDate) {
      database.run(`
        INSERT OR IGNORE INTO calendar_items(
          id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
          all_day, category, importance, status, description, item_kind,
          reminder_minutes, completed_at, created_at, updated_at
        ) VALUES (?, ?, 'meeting', ?, ?, ?, NULL, 1, 'organizational', 'normal', ?, ?,
          'event', NULL, NULL, ?, ?)
      `, newId('cal'), workspaceId, meetingId,
      result.protocolNumber ? `Заседание кафедры · протокол № ${result.protocolNumber}` : 'Заседание кафедры',
      result.meetingDate, Number(result.confidence || 0) >= 0.75 ? 'confirmed' : 'proposed',
      documentTitle, now, now);
    }

    addSearchFragment(database, {
      workspaceId,
      sourceKind: 'meeting',
      sourceId: meetingId,
      documentVersionId,
      title: result?.protocolNumber ? `Протокол № ${result.protocolNumber}` : documentTitle,
      content: [result?.chairperson, result?.secretary, result?.attendees].filter(Boolean).join('\n'),
      locator: result?.evidence || {}
    });

    for (const item of agendaItems) {
      const agendaId = newId('agenda');
      database.run(`
        INSERT INTO agenda_items(
          id, meeting_id, item_no, title, heard_text, discussed_text,
          decision_text, evidence_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, agendaId, meetingId, item.itemNo, item.title, item.heardText, item.discussedText,
      item.decisionText, JSON.stringify(item.evidence || {}), now);

      addSearchFragment(database, {
        workspaceId,
        sourceKind: 'agenda_item',
        sourceId: agendaId,
        documentVersionId,
        title: `${item.itemNo}. ${item.title}`,
        content: [item.heardText, item.discussedText, item.decisionText].filter(Boolean).join('\n'),
        locator: item.evidence || {}
      });

      if (item.decisionText) {
        const decisionId = newId('decision');
        database.run(`
          INSERT INTO decisions(
            id, agenda_item_id, text, responsible_raw, due_date,
            status, evidence_json, created_at
          ) VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?)
        `, decisionId, agendaId, item.decisionText, item.responsibleRaw, item.dueDate,
        JSON.stringify(item.evidence || {}), now);
        if (item.dueDate) {
          database.run(`
            INSERT OR IGNORE INTO calendar_items(
              id, workspace_id, source_kind, source_id, title, starts_at, ends_at,
              all_day, category, importance, status, description, item_kind,
              reminder_minutes, completed_at, created_at, updated_at
            ) VALUES (?, ?, 'decision', ?, ?, ?, NULL, 1, 'organizational', 'high', 'open', ?,
              'task', 1440, NULL, ?, ?)
          `, newId('cal'), workspaceId, decisionId, `Срок: ${item.title}`,
          item.dueDate, item.decisionText, now, now);
        }
        if (item.responsibleRaw) {
          review(database, workspaceId, documentVersionId, 'responsible_person_unresolved',
            'Нужно сопоставить ответственного',
            `В решении указан ответственный: «${item.responsibleRaw}».`,
            'Выберите человека из справочника или оставьте значение как текст.',
            { decisionId, responsibleRaw: item.responsibleRaw, evidence: item.evidence }, now);
        }
      }
    }

    if (!result?.protocolNumber) {
      review(database, workspaceId, documentVersionId, 'protocol_number_missing',
        'Не найден номер протокола',
        'Документ похож на протокол, но номер не удалось определить уверенно.',
        'Укажите номер на карточке заседания или оставьте поле пустым.', {}, now);
    }
    if (!result?.meetingDate) {
      review(database, workspaceId, documentVersionId, 'meeting_date_missing',
        'Не найдена дата заседания',
        'Автоматический разбор не нашёл однозначную дату заседания.',
        'Введите датэу в карточке заседания.', {}, now);
    }
    if (agendaItems.length === 0) {
      review(database, workspaceId, documentVersionId, 'agenda_missing',
        'Не найдены пункты повестки',
        'Текст сохранён, но структуру повестки определить не удалось.',
        'Добавьте вопросы в уже созданное заседание.', {}, now);
    }
    return meetingId;
  });
}
