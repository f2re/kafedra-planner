export async function sendTelegramMessage({
  apiBase = 'https://api.telegram.org',
  botToken,
  chatId,
  subject,
  body,
  timeoutMs = 15000,
  fetchImpl = fetch
}) {
  if (!botToken || !chatId) throw new Error('telegram_not_configured');
  const base = String(apiBase || 'https://api.telegram.org').replace(/\/$/u, '');
  const response = await fetchImpl(`${base}/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: String(chatId),
      text: `${String(subject || '').trim()}\n\n${String(body || '').trim()}`.trim(),
      disable_web_page_preview: true
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) throw new Error(`telegram_http_${response.status}`);
  return {
    accepted: true,
    messageId: payload?.result?.message_id === undefined ? null : String(payload.result.message_id)
  };
}
