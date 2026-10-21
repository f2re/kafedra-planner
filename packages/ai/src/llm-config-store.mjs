import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SETTINGS_FILENAME = 'llm-settings.json';

export function sanitizeEndpointUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('invalid_protocol');
    }
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/u, '');
  } catch {
    return '';
  }
}

export function baseEndpoint(endpoint) {
  const cleaned = sanitizeEndpointUrl(endpoint);
  return cleaned.replace(/\/v1$/u, '');
}

export function loadLlmSettings(dataDir, baseConfig = {}) {
  const filepath = join(dataDir || process.cwd(), SETTINGS_FILENAME);
  let stored = {};
  if (existsSync(filepath)) {
    try {
      const content = readFileSync(filepath, 'utf8');
      stored = JSON.parse(content);
    } catch {
      stored = {};
    }
  }

  const enabled = typeof stored.llmEnabled === 'boolean'
    ? stored.llmEnabled
    : Boolean(baseConfig.llmEnabled);

  const endpoint = sanitizeEndpointUrl(stored.llmEndpoint !== undefined ? stored.llmEndpoint : baseConfig.llmEndpoint);
  const model = String(stored.llmModel || baseConfig.llmModel || 'local-model').trim().slice(0, 100);
  const apiKey = String(stored.llmApiKey || baseConfig.llmApiKey || '').trim().slice(0, 256);
  const timeoutMs = Math.max(1000, Math.min(Number(stored.llmTimeoutMs || baseConfig.llmTimeoutMs || 45000), 120000));
  const maxTokens = Math.max(256, Math.min(Number(stored.llmMaxTokens || baseConfig.llmMaxTokens || 4096), 32768));

  return {
    llmEnabled: enabled,
    llmEndpoint: endpoint,
    llmModel: model,
    llmApiKey: apiKey,
    llmTimeoutMs: timeoutMs,
    llmMaxTokens: maxTokens
  };
}

export function saveLlmSettings(dataDir, newSettings, baseConfig = {}) {
  const current = loadLlmSettings(dataDir, baseConfig);
  const updated = {
    llmEnabled: typeof newSettings.llmEnabled === 'boolean' ? newSettings.llmEnabled : current.llmEnabled,
    llmEndpoint: newSettings.llmEndpoint !== undefined ? sanitizeEndpointUrl(newSettings.llmEndpoint) : current.llmEndpoint,
    llmModel: newSettings.llmModel !== undefined ? String(newSettings.llmModel).trim().slice(0, 100) : current.llmModel,
    llmApiKey: newSettings.llmApiKey !== undefined ? String(newSettings.llmApiKey).trim().slice(0, 256) : current.llmApiKey,
    llmTimeoutMs: newSettings.llmTimeoutMs ? Math.max(1000, Math.min(Number(newSettings.llmTimeoutMs), 120000)) : current.llmTimeoutMs,
    llmMaxTokens: newSettings.llmMaxTokens ? Math.max(256, Math.min(Number(newSettings.llmMaxTokens), 32768)) : current.llmMaxTokens
  };

  const targetDir = dataDir || process.cwd();
  const filepath = join(targetDir, SETTINGS_FILENAME);
  const tempPath = join(targetDir, `${SETTINGS_FILENAME}.${Date.now()}.tmp`);

  writeFileSync(tempPath, JSON.stringify(updated, null, 2), 'utf8');
  renameSync(tempPath, filepath);

  return updated;
}

export async function testLlmConnection({ endpoint, model, apiKey, timeoutMs = 8000, fetchImpl = fetch } = {}) {
  const safeEndpoint = sanitizeEndpointUrl(endpoint);
  if (!safeEndpoint) {
    return {
      ok: false,
      status: 'misconfigured',
      reason: 'endpoint_empty',
      latencyMs: null,
      models: []
    };
  }

  const root = baseEndpoint(safeEndpoint);
  const headers = { accept: 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let modelsList = [];
    let endpointResponding = false;

    // Try /v1/models
    try {
      const modelsRes = await fetchImpl(`${root}/v1/models`, {
        method: 'GET',
        headers,
        signal: controller.signal
      });
      if (modelsRes.ok) {
        endpointResponding = true;
        const data = await modelsRes.json();
        if (Array.isArray(data?.data)) {
          modelsList = data.data.map((m) => String(m?.id || '')).filter(Boolean);
        }
      }
    } catch {
      // Models endpoint might not be supported or failed, try health
    }

    if (!endpointResponding) {
      try {
        const healthRes = await fetchImpl(`${root}/health`, {
          method: 'GET',
          headers,
          signal: controller.signal
        });
        if (healthRes.ok) {
          endpointResponding = true;
        }
      } catch {
        // Health check failed
      }
    }

    const latencyMs = Math.round(performance.now() - started);

    if (!endpointResponding) {
      return {
        ok: false,
        status: 'unavailable',
        reason: 'endpoint_unreachable',
        latencyMs,
        models: []
      };
    }

    const selectedModel = String(model || '').trim();
    if (selectedModel && modelsList.length && !modelsList.includes(selectedModel)) {
      return {
        ok: true,
        status: 'model_not_in_list',
        latencyMs,
        models: modelsList,
        selectedModel
      };
    }

    return {
      ok: true,
      status: 'ready',
      latencyMs,
      models: modelsList,
      selectedModel: selectedModel || modelsList[0] || 'default'
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    const isTimeout = error?.name === 'AbortError' || String(error?.message).toLowerCase().includes('timeout');
    return {
      ok: false,
      status: isTimeout ? 'timeout' : 'unavailable',
      reason: isTimeout ? 'timeout' : 'request_failed',
      latencyMs,
      models: []
    };
  } finally {
    clearTimeout(timer);
  }
}
