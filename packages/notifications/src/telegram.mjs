function requestError(error) {
  const name = String(error?.name || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();
  if (name.includes('timeout') || code.includes('timeout') || code === 'abort_err') {
    return new Error('telegram_timeout');
  }
  return new Error('telegram_request_failed');
}

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
  let response;
  try {
    response = await fetchImpl(`${base}/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId),
        text: `${String(subject || '').trim()}\n\n${String(body || '').trim()}`.trim(),
        disable_web_page_preview: true
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw requestError(error);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) throw new Error(`telegram_http_${response.status}`);
  return {
    accepted: true,
    messageId: payload?.result?.message_id === undefined ? null : String(payload.result.message_id)
  };
}