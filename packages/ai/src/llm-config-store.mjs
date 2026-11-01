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
      } else if (modelsRes.status === 503 || modelsRes.status === 429) {
        endpointResponding = true;
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
        if (healthRes.ok || healthRes.status === 503) {
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

const PROMPTS_FILENAME = 'assistant-prompts.json';

export const DEFAULT_PROMPTS_PACK = Object.freeze([
  {
    id: 'std_agenda',
    title: '📋 Формирование повестки заседания',
    mode: 'suggest-agenda',
    tag: 'Заседания',
    isStandard: true,
    isFavorite: true,
    description: 'Анализирует задачи и формирует повестку с докладчиками и проектами решений.',
    systemPrompt: 'Ты — методист и секретарь кафедры. На основе месяца, задач кафедры и типовых тем сформируй проект повестки заседания кафедры с формулировками «Слушали», «Обсудили», «Постановили».',
    template: 'Сформировать проект повестки заседания кафедры на ближайший месяц на основе активных планов кафедры.'
  },
  {
    id: 'std_vkr',
    title: '🎓 Темы выпускных работ (ВКР)',
    mode: 'suggest-agenda',
    tag: 'ВКР',
    isStandard: true,
    isFavorite: true,
    description: 'Формулирует пункт повестки по утверждению тем ВКР бакалавров и магистров с назначением руководителей.',
    systemPrompt: 'Ты — секретарь кафедры. Составь формулировку вопроса повестки заседания об утверждении тем ВКР и назначении научных руководителей согласно ГОСТ.',
    template: 'Пункт повестки: Об утверждении тем выпускных квалификационных работ бакалавров по направлению подготовки и назначении научных руководителей.'
  },
  {
    id: 'std_extract',
    title: '📄 Выписка из протокола (ГОСТ)',
    mode: 'compliance-check',
    tag: 'Документы',
    isStandard: true,
    isFavorite: false,
    description: 'Проверка формулировок и обязательных реквизитов выписки из протокола заседания кафедры.',
    systemPrompt: 'Ты — нормоконтролер и юрист вуза. Проверь текст выписки из протокола кафедры на соответствие ГОСТ Р 7.0.97-2016.',
    template: 'ВЫПИСКА ИЗ ПРОТОКОЛА № 3 заседания кафедры от 15.10.2026.\nСЛУШАЛИ: об утверждении темы выпускной квалификационной работы студента Смирнова.\nПОСТАНОВИЛИ: тему утвердить, руководителем назначить доц. Петрова.'
  },
  {
    id: 'std_nir_report',
    title: '📊 Синтез раздела отчёта по НИР',
    mode: 'report-synthesis',
    tag: 'Отчёты',
    isStandard: true,
    isFavorite: true,
    description: 'Генерирует связный официальный раздел кафедрального отчёта по научной работе (ВАК, РИНЦ, гранты).',
    systemPrompt: 'Ты — заместитель заведующего кафедрой по научной работе. Составь официальный раздел годового отчёта кафедры по научно-исследовательской деятельности.',
    template: 'Составить раздел отчёта кафедры по научно-исследовательской работе: публикации в изданиях ВАК и РИНЦ, поданные грантовые заявки и участие в конференциях.'
  },
  {
    id: 'std_archive_search',
    title: '🔍 Поиск решений по аспирантам',
    mode: 'archive-query',
    tag: 'Поиск',
    isStandard: true,
    isFavorite: false,
    description: 'Находит все заседания и протоколы, где обсуждалась аттестация аспирантов.',
    systemPrompt: 'Ты — архивариус и аналитик кафедры. Найди в протоколах решения по аспирантам и укажи точные даты и номера протоколов.',
    template: 'На каком заседании кафедры утверждалась аттестация аспирантов и какие сроки были установлены?'
  },
  {
    id: 'std_calc_formula',
    title: '📐 Формула Calc: ВПР по преподавателю',
    mode: 'formula-calc',
    tag: 'Формулы',
    isStandard: true,
    isFavorite: false,
    description: 'Составляет формулу ВПР или ИНДЕКС/ПОИСКПОЗ для подтягивания должности преподавателя.',
    systemPrompt: 'Ты — эксперт по LibreOffice Calc и Excel. Составь формулу для таблицы кафедры.',
    template: 'Как написать формулу ВПР для подтягивания должности преподавателя по его ФИО из соседней таблицы на листе Справочник'
  },
  {
    id: 'std_template_fields',
    title: '✨ ИИ-анализ полей и шаблонов',
    mode: 'template-analyze',
    tag: 'Шаблоны',
    isStandard: true,
    isFavorite: true,
    description: 'Выявляет заменяемые переменные и повторяющиеся блоки в тексте протокола или распоряжения.',
    systemPrompt: 'Ты — разработчик шаблонов документов кафедры. Проанализируй текст и выдели все переменные поля, номера, даты, ФИО и списки.',
    template: 'Проанализируй текст протокола заседания и выдели все заменяемые поля и маркеры для создания шаблона.'
  }
]);

export function loadCustomPrompts(dataDir) {
  const filepath = join(dataDir || process.cwd(), PROMPTS_FILENAME);
  if (!existsSync(filepath)) {
    return DEFAULT_PROMPTS_PACK.map((p) => ({ ...p }));
  }
  try {
    const raw = readFileSync(filepath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_PROMPTS_PACK.map((p) => ({ ...p }));
    
    // Merge standard defaults with user modifications
    const storedMap = new Map(parsed.map((p) => [p.id, p]));
    const result = [];
    
    DEFAULT_PROMPTS_PACK.forEach((def) => {
      if (storedMap.has(def.id)) {
        result.push({ ...def, ...storedMap.get(def.id) });
        storedMap.delete(def.id);
      } else {
        result.push({ ...def });
      }
    });

    // Add remaining custom prompts
    for (const custom of storedMap.values()) {
      result.push(custom);
    }
    return result;
  } catch {
    return DEFAULT_PROMPTS_PACK.map((p) => ({ ...p }));
  }
}

export function saveCustomPrompts(dataDir, prompts) {
  const targetDir = dataDir || process.cwd();
  const filepath = join(targetDir, PROMPTS_FILENAME);
  const tempPath = join(targetDir, `${PROMPTS_FILENAME}.${Date.now()}.tmp`);

  const safeList = Array.isArray(prompts) ? prompts : [];
  writeFileSync(tempPath, JSON.stringify(safeList, null, 2), 'utf8');
  renameSync(tempPath, filepath);
  return safeList;
}

export function saveSingleCustomPrompt(dataDir, item) {
  const current = loadCustomPrompts(dataDir);
  const existingIdx = current.findIndex((p) => p.id === item.id);
  const now = new Date().toISOString();

  let updatedPrompt;
  if (existingIdx >= 0) {
    updatedPrompt = {
      ...current[existingIdx],
      ...item,
      updatedAt: now
    };
    current[existingIdx] = updatedPrompt;
  } else {
    updatedPrompt = {
      id: item.id || `prompt_${Date.now()}`,
      title: String(item.title || 'Новый шаблон').trim(),
      mode: item.mode || 'suggest-agenda',
      tag: item.tag || 'Пользовательский',
      isFavorite: Boolean(item.isFavorite),
      isStandard: false,
      description: String(item.description || '').trim(),
      systemPrompt: String(item.systemPrompt || '').trim(),
      template: String(item.template || '').trim(),
      createdAt: now,
      updatedAt: now
    };
    current.unshift(updatedPrompt);
  }

  saveCustomPrompts(dataDir, current);
  return updatedPrompt;
}

export function deleteCustomPrompt(dataDir, id) {
  const current = loadCustomPrompts(dataDir);
  const filtered = current.filter((p) => p.id !== id || p.isStandard);
  saveCustomPrompts(dataDir, filtered);
  return true;
}

export function toggleFavoritePrompt(dataDir, id) {
  const current = loadCustomPrompts(dataDir);
  const target = current.find((p) => p.id === id);
  if (target) {
    target.isFavorite = !target.isFavorite;
    target.updatedAt = new Date().toISOString();
    saveCustomPrompts(dataDir, current);
    return target;
  }
  return null;
}

export function installPromptPack(dataDir, pack) {
  const items = Array.isArray(pack?.prompts) ? pack.prompts : (Array.isArray(pack) ? pack : []);
  if (!items.length) return { installedCount: 0 };

  const current = loadCustomPrompts(dataDir);
  const map = new Map(current.map((p) => [p.id, p]));
  let installedCount = 0;

  for (const item of items) {
    if (!item.title) continue;
    const id = item.id || `prompt_pack_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    map.set(id, {
      id,
      title: String(item.title).trim(),
      mode: item.mode || 'suggest-agenda',
      tag: item.tag || pack.name || 'Импортированный',
      isFavorite: Boolean(item.isFavorite),
      isStandard: false,
      description: String(item.description || '').trim(),
      systemPrompt: String(item.systemPrompt || '').trim(),
      template: String(item.template || '').trim(),
      updatedAt: new Date().toISOString()
    });
    installedCount++;
  }

  saveCustomPrompts(dataDir, [...map.values()]);
  return { installedCount, totalCount: map.size };
}

