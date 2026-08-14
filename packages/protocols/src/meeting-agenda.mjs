import { newId } from '../../core/src/ids.mjs';
import { clean, fail, required, writeAudit } from './meeting-common.mjs';
import { getMeeting, syncMeetingSearch } from './meeting-core.mjs';

function sourceQuestionTitle(source) {
  const title = required(source?.title, 'agenda_source_not_found');
  if (source.kind === 'plan_item' && /стать|публикац/iu.test(title)) {
    return `О рассмотрении научной статьи «${title}»`;
  }
  if (source.kind === 'plan_item') return `О рассмотрении пункта плана «${title}»`;
  return `О рассмотрении задачи «${title}»`;
}

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
  const combined = [...plans, ...tasks];
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
  return null;
}

function nextAgendaNumber(database, meetingId) {
  return Number(database.get('SELECT COALESCE(MAX(item_no), 0) AS value FROM agenda_items WHERE meeting_id = ?', meetingId)?.value || 0) + 1;
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
  database.transaction(() => {
    database.run(`
      INSERT INTO agenda_items(
        id, meeting_id, item_no, title, heard_text, discussed_text, decision_text,
        evidence_json, created_at, source_kind, source_id, source_label, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, id, meetingId, itemNo, title, clean(input?.heardText), clean(input?.discussedText),
    clean(input?.decisionText), JSON.stringify({ kind: 'operator', source: source ? 'linked_item' : 'manual' }),
    now, source?.kind || null, source?.id || null, source?.label || null, now);
    database.run('UPDATE meetings SET updated_at = ? WHERE id = ?', now, meetingId);
    syncMeetingSearch(database, workspaceId, meetingId);
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

export function updateAgendaItem(database, workspaceId, meetingId, itemId, input, actorPersonId = null, now = new Date().toISOString()) {
  const current = agendaContext(database, workspaceId, meetingId, itemId);
  if (!current) fail('agenda_item_not_found');
  const value = (key, field) => Object.prototype.hasOwnProperty.call(input || {}, key)
    ? clean(input[key]) : current[field];
  const title = Object.prototype.hasOwnProperty.call(input || {}, 'title')
    ? required(input.title, 'agenda_title_required') : current.title;
  const heard = value('heardText', 'heard_text');
  const discussed = value('discussedText', 'discussed_text');
  const decision = value('decisionText', 'decision_text');
  database.transaction(() => {
    database.run(`
      UPDATE agenda_items
      SET title = ?, heard_text = ?, discussed_text = ?, decision_text = ?, updated_at = ?
      WHERE id = ?
    `, title, heard, discussed, decision, now, itemId);
    database.run('UPDATE meetings SET updated_at = ? WHERE id = ?', now, meetingId);
    syncMeetingSearch(database, workspaceId, meetingId);
    writeAudit(database, workspaceId, actorPersonId, 'meeting.agenda.updated', 'agenda_item', itemId, {
      meetingId, itemNo: current.item_no
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
