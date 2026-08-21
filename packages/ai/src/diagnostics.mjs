function cleanEndpoint(value) {
  const raw = String(value || '').trim().replace(/\/+$/u, '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/u, '');
  } catch {
    return '';
  }
}

function baseEndpoint(value) {
  const endpoint = cleanEndpoint(value);
  return endpoint.replace(/\/v1$/u, '');
}

async function fetchJson(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'GET', signal: controller.signal, headers: { accept: 'application/json' } });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch {}
    return { ok: response.ok, status: response.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

export async function diagnoseLlm(config, { fetchImpl = globalThis.fetch } = {}) {
  if (!config?.llmEnabled) return { status: 'disabled', enabled: false, managed: Boolean(config?.llmManaged) };
  const endpoint = cleanEndpoint(config.llmEndpoint)
    || (config.llmManaged ? `http://${config.llmHost || '127.0.0.1'}:${config.llmPort || 8081}` : '');
  if (!endpoint) return { status: 'misconfigured', enabled: true, managed: Boolean(config.llmManaged), reason: 'endpoint_missing' };
  const safeEndpoint = cleanEndpoint(endpoint);
  const timeoutMs = Math.max(1000, Math.min(Number(config.llmTimeoutMs || 45000), 10000));
  try {
    const root = baseEndpoint(safeEndpoint);
    const health = await fetchJson(fetchImpl, `${root}/health`, timeoutMs);
    if (!health.ok) return { status: 'unavailable', enabled: true, managed: Boolean(config.llmManaged), endpoint: safeEndpoint, healthStatus: health.status };
    const models = await fetchJson(fetchImpl, `${root}/v1/models`, timeoutMs);
    if (!models.ok || !Array.isArray(models.payload?.data)) {
      return { status: 'incompatible', enabled: true, managed: Boolean(config.llmManaged), endpoint: safeEndpoint, modelsStatus: models.status };
    }
    const ids = models.payload.data.map((item) => String(item?.id || '')).filter(Boolean);
    const selected = String(config.llmModel || '').trim();
    if (selected && !ids.includes(selected)) {
      return { status: 'model_missing', enabled: true, managed: Boolean(config.llmManaged), endpoint: safeEndpoint, selectedModel: selected, models: ids };
    }
    return { status: 'ready', enabled: true, managed: Boolean(config.llmManaged), endpoint: safeEndpoint, selectedModel: selected || ids[0] || null, models: ids };
  } catch (error) {
    return {
      status: error?.name === 'AbortError' ? 'timeout' : 'unavailable',
      enabled: true,
      managed: Boolean(config.llmManaged),
      endpoint: safeEndpoint,
      reason: error?.name === 'AbortError' ? 'timeout' : 'request_failed'
    };
  }
}
