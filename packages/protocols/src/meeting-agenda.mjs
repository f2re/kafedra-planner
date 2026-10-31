import { newId } from '../../core/src/ids.mjs';
import { clean, dateValue, fail, required, writeAudit } from './meeting-common.mjs';
import { getMeeting, syncMeetingSearch } from './meeting-core.mjs';
import { syncDecisionCalendar } from './decision-calendar.mjs';
import { resolveMeetingReviews } from './meeting-reviews.mjs';

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function optionalDate(value) {
  const text = clean(value);
  if (!text) return null;
  try { return dateValue(text); } catch { fail('agenda_due_date_invalid'); }
}

function appendManualCorrection(raw, correction) {
  const evidence = parseJson(raw, {});
  const history = Array.isArray(evidence.manualCorrections) ? [...evidence.manualCorrections] : [];
  history.push(correction);
  return { ...evidence, manualCorrections: history.slice(-100) };
}

function sourceQuestionTitle(source) {
  const title = required(source?.title, 'agenda_source_not_found');
  if (source.kind === 'plan_item' && /стать|публикац/iu.test(title)) {
    return `О рассмотрении научной статьи «${title}»`;
  }
  if (source.kind === 'plan_item') return `О рассмотрении пункта плана «${title}»`;
  if (source.kind === 'agenda_item' || source.kind === 'standard_template') return title;
  return `О рассмотрении задачи «${title}»`;
}

export const STANDARD_AGENDA_TOPICS = Object.freeze([
  {
    id: 'std_load_plans',
    title: 'Об утверждении индивидуальных планов работы преподавателей и распределении учебной нагрузки',
    category: 'Учебная работа',
    heardText: 'Заслушан доклад заведующего кафедрой о распределении учебной нагрузки и индивидуальных планах работы преподавателей на семестр.',
    discussedText: 'Вопросов и замечаний по распределению нагрузки не поступило.',
    decisionText: 'Утвердить индивидуальные планы работы профессорско-преподавательского состава кафедры.'
  },
  {
    id: 'std_vkr_topics',
    title: 'Об утверждении тем выпускных квалификационных работ (ВКР) и назначении научных руководителей',
    category: 'Учебная работа',
    heardText: 'Слушали сообщения преподавателей кафедры о согласовании тем ВКР бакалавров и магистров с профильными организациями.',
    discussedText: 'Темы ВКР соответствуют профилю подготовки и актуальным направлениям научно-практической деятельности.',
    decisionText: 'Утвердить предложенные темы ВКР и назначить научных руководителей согласно списку.'
  },
  {
    id: 'std_session_results',
    title: 'Об итогах промежуточной аттестации (экзаменационной сессии) студентов и ликвидации академических задолженностей',
    category: 'Учебная работа',
    heardText: 'Заслушан отчет заместителя заведующего кафедрой по учебной работе об успеваемости студентов и графике пересдач задолженностей.',
    discussedText: 'Обсуждены меры по повышению успеваемости и графики дополнительных консультаций преподавателей.',
    decisionText: 'Принять к сведению результаты сессии, преподавателям провести консультации и повторную аттестацию в установленные сроки.'
  },
  {
    id: 'std_nir_articles',
    title: 'О ходе выполнения научно-исследовательских работ (НИР) и публикации статей в изданиях ВАК и РИНЦ',
    category: 'Научная работа',
    heardText: 'Заслушаны сообщения ответственного за научную работу кафедры и исполнителей НИР о подготовке публикаций и грантовых заявок.',
    discussedText: 'Отмечена готовность статей к публикации в ведущих рецензируемых изданиях.',
    decisionText: 'Одобрить результаты выполнения этапов НИР, активизировать подготовку рукописей к публикации.'
  },
  {
    id: 'std_postgraduates',
    title: 'Об аттестации аспирантов и соискателей кафедры по итогам учебного года',
    category: 'Научная работа',
    heardText: 'Заслушаны индивидуальные отчеты аспирантов и заключения научных руководителей о выполнении индивидуального плана подготовки.',
    discussedText: 'Аспиранты представили материалы диссертационных исследований и список опубликованных статей.',
    decisionText: 'Аттестовать аспирантов кафедры за отчетный период.'
  },
  {
    id: 'std_methodical_book',
    title: 'О рассмотрении учебного (учебно-методического) пособия и рекомендации к изданию',
    category: 'Учебно-методическая работа',
    heardText: 'Слушали авторов о структуре и содержании подготовленного учебного пособия по профильной дисциплине кафедры.',
    discussedText: 'Рецензенты дали положительные отзывы на рукопись учебного пособия.',
    decisionText: 'Рекомендовать учебное пособие к изданию с грифом учебно-методического совета.'
  },
  {
    id: 'std_academic_titles',
    title: 'О рассмотрении кандидатур на присвоение ученых званий доцента / профессора',
    category: 'Кадры',
    heardText: 'Заслушана информация о соответствии кандидатов квалификационным требованиям, педагогическому стажу и научным трудам.',
    discussedText: 'Члены кафедры единогласно поддержали выдвижение кандидатуры.',
    decisionText: 'Ходатайствовать перед Ученым советом о представлении к присвоению ученого звания.'
  },
  {
    id: 'std_misc',
    title: 'Разное (текущие вопросы деятельности кафедры)',
    category: 'Организационная работа',
    heardText: 'Заведующий кафедрой довел распоряжения руководства, график предстоящих мероприятий и дежурств.',
    discussedText: 'Обсуждены текущие организационные вопросы.',
    decisionText: 'Принять информацию к сведению и руководству в повседневной работе.'
  }
]);

export function listAgendaSources(database, workspaceId, query = '', limit = 500) {
  const safeLimit = Math.min(1000, Math.max(1, Number(limit) || 500));
  const normalized = clean(query)?.toLocaleLowerCase('ru-RU') || '';
  const plans = database.all(`
    SELECT pi.id, pi.title, pi.description, pi.item_no, pi.responsible_raw, pi.direction,
      pi.due_date, pi.starts_at, p.title AS plan_title, p.plan_kind, p.period_key
    FROM plan_items pi
    JOIN plans p ON p.id = pi.plan_id
    WHERE p.workspace_id = ? AND pi.status <> 'cancelled'
    ORDER BY COALESCE(pi.due_date, pi.starts_at, '9999-12-31'), p.title, pi.item_no, pi.id
    LIMIT ?
  `, workspaceId, safeLimit).map((row) => ({
    kind: 'plan_item',
    id: row.id,
    title: row.title,
    questionTitle: sourceQuestionTitle({ kind: 'plan_item', title: row.title }),
    label: `${row.plan_title}${row.item_no ? ` · пункт ${row.item_no}` : ''}`,
    meta: [row.period_key, row.responsible_raw, row.due_date || row.starts_at].filter(Boolean).join(' · '),
    responsibleRaw: row.responsible_raw,
    direction: row.direction
  }));
  const tasks = database.all(`
    SELECT id, title, description, source_kind, source_id, starts_at, category, status
    FROM calendar_items
    WHERE workspace_id = ? AND item_kind = 'task'
      AND status NOT IN ('completed', 'cancelled')
      AND source_kind <> 'plan_item'
    ORDER BY starts_at, title, id
    LIMIT ?
  `, workspaceId, safeLimit).map((row) => ({
    kind: 'calendar_item',
    id: row.id,
    title: row.title,
    questionTitle: sourceQuestionTitle({ kind: 'calendar_item', title: row.title }),
    label: 'Задача',
    meta: [row.starts_at, row.category].filter(Boolean).join(' · '),
    responsibleRaw: null,
    direction: row.category
  }));
  const meetingQuestions = database.all(`
    SELECT ai.id, ai.title, ai.heard_text, ai.discussed_text, ai.decision_text, ai.item_no,
      m.id AS meeting_id, m.protocol_number, m.meeting_date, m.title AS meeting_title
    FROM agenda_items ai
    JOIN meetings m ON m.id = ai.meeting_id
    WHERE m.workspace_id = ?
    ORDER BY COALESCE(m.meeting_date, '9999-12-31') DESC, ai.item_no ASC
    LIMIT ?
  `, workspaceId, safeLimit).map((row) => ({
    kind: 'agenda_item',
    id: row.id,
    title: row.title,
    questionTitle: row.title,
    label: `Протокол №${row.protocol_number || '—'} от ${row.meeting_date || '—'} · вопрос ${row.item_no}`,
    meta: [row.meeting_date, row.meeting_title, row.heard_text ? `Слушали: ${row.heard_text.slice(0, 60)}` : '', row.decision_text ? `Решили: ${row.decision_text.slice(0, 60)}` : ''].filter(Boolean).join(' · '),
    responsibleRaw: null,
    direction: 'meeting',
    heardText: row.heard_text,
    discussedText: row.discussed_text,
    decisionText: row.decision_text
  }));
  const presets = STANDARD_AGENDA_TOPICS.map((preset) => ({
    kind: 'standard_template',
    id: preset.id,
    title: preset.title,
    questionTitle: preset.title,
    label: `Типовой вопрос · ${preset.category}`,
    meta: [preset.category, preset.decisionText ? `Решение: ${preset.decisionText.slice(0, 60)}` : ''].filter(Boolean).join(' · '),
    responsibleRaw: null,
    direction: 'preset',
    heardText: preset.heardText,
    discussedText: preset.discussedText,
    decisionText: preset.decisionText
  }));
  const combined = [...plans, ...tasks, ...meetingQuestions, ...presets];
  if (!normalized) return combined.slice(0, safeLimit);
  return combined.filter((item) =>
    [item.title, item.questionTitle, item.label, item.meta].join(' ').toLocaleLowerCase('ru-RU').includes(normalized)
  ).slice(0, safeLimit);
}

function agendaSource(database, workspaceId, sourceKind, sourceId) {
  if (sourceKind === 'plan_item') {
    const row = database.get(`
      SELECT pi.id, pi.title, pi.responsible_raw, p.title AS plan_title, pi.item_no
      FROM plan_items pi JOIN plans p ON p.id = pi.plan_id
      WHERE p.workspace_id = ? AND pi.id = ?
    `, workspaceId, sourceId);
    return row ? {
      kind: 'plan_item', id: row.id, title: row.title,
      questionTitle: sourceQuestionTitle({ kind: 'plan_item', title: row.title }),
      label: `${row.plan_title}${row.item_no ? ` · пункт ${row.item_no}` : ''}`,
      responsibleRaw: row.responsible_raw
    } : null;
  }
  if (sourceKind === 'calendar_item') {
    const row = database.get(`
      SELECT id, title FROM calendar_items
      WHERE workspace_id = ? AND id = ? AND item_kind = 'task'
    `, workspaceId, sourceId);
    return row ? {
      kind: 'calendar_item', id: row.id, title: row.title,
      questionTitle: sourceQuestionTitle({ kind: 'calendar_item', title: row.title }),
      label: 'Задача', responsibleRaw: null
    } : null;
  }
  if (sourceKind === 'agenda_item') {
    const row = database.get(`
      SELECT ai.id, ai.title, ai.heard_text, ai.discussed_text, ai.decision_text, ai.item_no,
        m.protocol_number, m.meeting_date, m.title AS meeting_title
      FROM agenda_items ai JOIN meetings m ON m.id = ai.meeting_id
      WHERE m.workspace_id = ? AND ai.id = ?
    `, workspaceId, sourceId);
    return row ? {
      kind: 'agenda_item', id: row.id, title: row.title,
      questionTitle: row.title,
      label: `Протокол №${row.protocol_number || '—'} от ${row.meeting_date || '—'} · вопрос ${row.item_no}`,
      responsibleRaw: null,
      heardText: row.heard_text,
      discussedText: row.discussed_text,
      decisionText: row.decision_text
    } : null;
  }
  if (sourceKind === 'standard_template') {
    const preset = STANDARD_AGENDA_TOPICS.find((p) => p.id === sourceId);
    return preset ? {
      kind: 'standard_template', id: preset.id, title: preset.title,
      questionTitle: preset.title,
      label: `Типовой вопрос · ${preset.category}`,
      responsibleRaw: null,
      heardText: preset.heardText,
      discussedText: preset.discussedText,
      decisionText: preset.decisionText
    } : null;
  }
  return null;
}

function nextAgendaNumber(database, meetingId) {
  return Number(database.get('SELECT COALESCE(MAX(item_no), 0) AS value FROM agenda_items WHERE meeting_id = ?', meetingId)?.value || 0) + 1;
}

function createManualDecision(database, workspaceId, agendaId, agendaTitle, input, actorPersonId, now) {
  const text = clean(input?.decisionText);
  if (!text) return null;
  const id = newId('decision');
  const responsibleRaw = clean(input?.responsibleRaw);
  const dueDate = optionalDate(input?.dueDate);
  database.run(`
    INSERT INTO decisions(
      id, agenda_item_id, text, responsible_raw, due_date, status, evidence_json, created_at
    ) VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?)
  `, id, agendaId, text, responsibleRaw, dueDate, JSON.stringify({
    kind: 'operator',
    source: 'meeting_editor',
    manualCorrections: [{ at: now, actorPersonId, fields: ['decisionText', 'responsibleRaw', 'dueDate'] }]
  }), now);
  const decision = database.get('SELECT * FROM decisions WHERE id = ?', id);
  syncDecisionCalendar(database, workspaceId, decision, agendaTitle, now);
  return decision;
}

export function addAgendaItem(database, workspaceId, meetingId, input, actorPersonId = null, now = new Date().toISOString()) {
  const meeting = database.get('SELECT * FROM meetings WHERE workspace_id = ? AND id = ?', workspaceId, meetingId);
  if (!meeting) fail('meeting_not_found');
  const sourceKind = clean(input?.sourceKind);
  const sourceId = clean(input?.sourceId);
  const source = sourceKind || sourceId ? agendaSource(database, workspaceId, sourceKind, sourceId) : null;
  if ((sourceKind || sourceId) && !source) fail('agenda_source_not_found');
  const title = clean(input?.title) || source?.questionTitle;
  if (!title) fail('agenda_title_required');
  if (source && database.get(
    'SELECT id FROM agenda_items WHERE meeting_id = ? AND source_kind = ? AND source_id = ?',
    meetingId, source.kind, source.id
  )) fail('agenda_source_duplicate');
  const itemNo = nextAgendaNumber(database, meetingId);
  const id = newId('agenda');
  const heardText = clean(input?.heardText) || source?.heardText || null;
  const discussedText = clean(input?.discussedText) || source?.discussedText || null;
  const decisionText = clean(input?.decisionText) || source?.decisionText || null;
  database.transaction(() => {
    database.run(`
      INSERT INTO agenda_items(
        id, meeting_id, item_no, title, heard_text, discussed_text, decision_text,
        evidence_json, created_at, source_kind, source_id, source_label, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, id, meetingId, itemNo, title, heardText, discussedText,
    decisionText, JSON.stringify({ kind: 'operator', source: source ? 'linked_item' : 'manual' }),
    now, source?.kind || null, source?.id || null, source?.label || null, now);
    const decisionInput = { ...input, decisionText };
    const decision = createManualDecision(database, workspaceId, id, title, decisionInput, actorPersonId, now);
    database.run('UPDATE meetings SET updated_at = ? WHERE id = ?', now, meetingId);
    syncMeetingSearch(database, workspaceId, meetingId);
    resolveMeetingReviews(database, workspaceId, meetingId, {
      scope: 'agenda', agendaItemId: id, decisionId: decision?.id || null,
      touchedFields: ['title', 'heardText', 'discussedText', 'decisionText', 'responsibleRaw', 'dueDate'],
      values: { title, heardText, discussedText, decisionText,
        responsibleRaw: clean(input?.responsibleRaw), dueDate: optionalDate(input?.dueDate) }
    }, actorPersonId, now);
    writeAudit(database, workspaceId, actorPersonId, 'meeting.agenda.added', 'meeting', meetingId, {
      agendaItemId: id, itemNo, sourceKind: source?.kind || null, sourceId: source?.id || null
    }, now);
  });
  return getMeeting(database, workspaceId, meetingId);
}

function agendaContext(database, workspaceId, meetingId, itemId) {
  return database.get(`
    SELECT ai.*, m.workspace_id
    FROM agenda_items ai JOIN meetings m ON m.id = ai.meeting_id
    WHERE m.workspace_id = ? AND m.id = ? AND ai.id = ?
  `, workspaceId, meetingId, itemId) || null;
}

function firstDecision(database, itemId) {
  return database.get(`
    SELECT * FROM decisions WHERE agenda_item_id = ? ORDER BY created_at, id LIMIT 1
  `, itemId) || null;
}

export function updateAgendaItem(database, workspaceId, meetingId, itemId, input, actorPersonId = null, now = new Date().toISOString()) {
  const current = agendaContext(database, workspaceId, meetingId, itemId);
  if (!current) fail('agenda_item_not_found');
  const touchedFields = ['title', 'heardText', 'discussedText', 'decisionText', 'responsibleRaw', 'dueDate']
    .filter((field) => Object.prototype.hasOwnProperty.call(input || {}, field));
  const value = (key, field) => Object.prototype.hasOwnProperty.call(input || {}, key)
    ? clean(input[key]) : current[field];
  const title = Object.prototype.hasOwnProperty.call(input || {}, 'title')
    ? required(input.title, 'agenda_title_required') : current.title;
  const heard = value('heardText', 'heard_text');
  const discussed = value('discussedText', 'discussed_text');
  const existingDecision = firstDecision(database, itemId);
  const requestedDecision = Object.prototype.hasOwnProperty.call(input || {}, 'decisionText')
    ? clean(input.decisionText) : current.decision_text;
  const decisionText = Object.prototype.hasOwnProperty.call(input || {}, 'decisionText')
    ? requestedDecision : requestedDecision || existingDecision?.text || null;
  const responsibleRaw = Object.prototype.hasOwnProperty.call(input || {}, 'responsibleRaw')
    ? clean(input.responsibleRaw) : existingDecision?.responsible_raw || null;
  const dueDate = Object.prototype.hasOwnProperty.call(input || {}, 'dueDate')
    ? optionalDate(input.dueDate) : existingDecision?.due_date || null;
  let decisionId = existingDecision?.id || null;

  database.transaction(() => {
    const agendaEvidence = touchedFields.length
      ? appendManualCorrection(current.evidence_json, {
        at: now,
        actorPersonId,
        fields: touchedFields,
        before: {
          title: current.title,
          heardText: current.heard_text,
          discussedText: current.discussed_text,
          decisionText: current.decision_text
        },
        after: { title, heardText: heard, discussedText: discussed, decisionText }
      })
      : parseJson(current.evidence_json, {});
    database.run(`
      UPDATE agenda_items
      SET title = ?, heard_text = ?, discussed_text = ?, decision_text = ?, evidence_json = ?, updated_at = ?
      WHERE id = ?
    `, title, heard, discussed, decisionText, JSON.stringify(agendaEvidence), now, itemId);

    if (decisionText || existingDecision) {
      if (existingDecision) {
        const decisionEvidence = appendManualCorrection(existingDecision.evidence_json, {
          at: now,
          actorPersonId,
          fields: touchedFields.filter((field) => ['decisionText', 'responsibleRaw', 'dueDate'].includes(field)),
          before: {
            text: existingDecision.text,
            responsibleRaw: existingDecision.responsible_raw,
            dueDate: existingDecision.due_date
          },
          after: { text: decisionText, responsibleRaw, dueDate }
        });
        database.run(`
          UPDATE decisions
          SET text = ?, responsible_raw = ?, due_date = ?, status = ?, evidence_json = ?
          WHERE id = ?
        `, decisionText || '', responsibleRaw, dueDate, decisionText ? 'confirmed' : 'proposed', JSON.stringify(decisionEvidence), existingDecision.id);
      } else {
        const created = createManualDecision(database, workspaceId, itemId, title, {
          decisionText, responsibleRaw, dueDate
        }, actorPersonId, now);
        decisionId = created?.id || null;
      }
      const decision = firstDecision(database, itemId);
      decisionId = decision?.id || decisionId;
      syncDecisionCalendar(database, workspaceId, decision, title, now);
    }

    database.run('UPDATE meetings SET updated_at = ? WHERE id = ?', now, meetingId);
    syncMeetingSearch(database, workspaceId, meetingId);
    resolveMeetingReviews(database, workspaceId, meetingId, {
      scope: 'agenda', agendaItemId: itemId, decisionId, touchedFields,
      values: { title, heardText: heard, discussedText: discussed, decisionText, responsibleRaw, dueDate }
    }, actorPersonId, now);
    writeAudit(database, workspaceId, actorPersonId, 'meeting.agenda.updated', 'agenda_item', itemId, {
      meetingId,
      itemNo: current.item_no,
      touchedFields,
      before: {
        title: current.title,
        heardText: current.heard_text,
        discussedText: current.discussed_text,
        decisionText: current.decision_text,
        responsibleRaw: existingDecision?.responsible_raw || null,
        dueDate: existingDecision?.due_date || null
      },
      after: { title, heardText: heard, discussedText: discussed, decisionText, responsibleRaw, dueDate }
    }, now);
  });
  return getMeeting(database, workspaceId, meetingId);
}

function renumberAgenda(database, meetingId, now) {
  const items = database.all(`
    SELECT id FROM agenda_items WHERE meeting_id = ? ORDER BY item_no, created_at, id
  `, meetingId);
  database.run('UPDATE agenda_items SET item_no = item_no + 100000, updated_at = ? WHERE meeting_id = ?', now, meetingId);
  items.forEach((item, index) => {
    database.run('UPDATE agenda_items SET item_no = ?, updated_at = ? WHERE id = ?', index + 1, now, item.id);
  });
}

export function deleteAgendaItem(database, workspaceId, meetingId, itemId, actorPersonId = null, now = new Date().toISOString()) {
  const current = agendaContext(database, workspaceId, meetingId, itemId);
  if (!current) fail('agenda_item_not_found');
  database.transaction(() => {
    const decisionIds = database.all('SELECT id FROM decisions WHERE agenda_item_id = ?', itemId).map((item) => item.id);
    for (const decisionId of decisionIds) {
      database.run(`
        DELETE FROM calendar_items
        WHERE workspace_id = ? AND source_kind = 'decision' AND source_id = ?
      `, workspaceId, decisionId);
    }
    database.run('DELETE FROM agenda_items WHERE id = ?', itemId);
    renumberAgenda(database, meetingId, now);
    database.run('UPDATE meetings SET updated_at = ? WHERE id = ?', now, meetingId);
    syncMeetingSearch(database, workspaceId, meetingId);
    writeAudit(database, workspaceId, actorPersonId, 'meeting.agenda.removed', 'meeting', meetingId, {
      agendaItemId: itemId, previousItemNo: current.item_no, title: current.title
    }, now);
  });
  return getMeeting(database, workspaceId, meetingId);
}

export function moveAgendaItem(database, workspaceId, meetingId, itemId, direction, actorPersonId = null, now = new Date().toISOString()) {
  const current = agendaContext(database, workspaceId, meetingId, itemId);
  if (!current) fail('agenda_item_not_found');
  if (!['up', 'down'].includes(direction)) fail('agenda_move_invalid');
  const targetNo = Number(current.item_no) + (direction === 'up' ? -1 : 1);
  const target = database.get('SELECT * FROM agenda_items WHERE meeting_id = ? AND item_no = ?', meetingId, targetNo);
  if (!target) return getMeeting(database, workspaceId, meetingId);
  database.transaction(() => {
    database.run('UPDATE agenda_items SET item_no = 0, updated_at = ? WHERE id = ?', now, current.id);
    database.run('UPDATE agenda_items SET item_no = ?, updated_at = ? WHERE id = ?', current.item_no, now, target.id);
    database.run('UPDATE agenda_items SET item_no = ?, updated_at = ? WHERE id = ?', targetNo, now, current.id);
    database.run('UPDATE meetings SET updated_at = ? WHERE id = ?', now, meetingId);
    syncMeetingSearch(database, workspaceId, meetingId);
    writeAudit(database, workspaceId, actorPersonId, 'meeting.agenda.moved', 'agenda_item', itemId, {
      meetingId, from: current.item_no, to: targetNo
    }, now);
  });
  return getMeeting(database, workspaceId, meetingId);
}
