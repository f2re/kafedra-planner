export function meetingDateLabel(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) return text || 'дата не указана';
  const [year, month, day] = text.split('-');
  return `${day}.${month}.${year}`;
}

export function planMeetingLinkLabel(link) {
  const number = String(link?.protocol_number || '—').trim() || '—';
  const question = Number(link?.item_no) || '—';
  return `протокол №${number} от ${meetingDateLabel(link?.meeting_date)} · вопрос ${question}`;
}
