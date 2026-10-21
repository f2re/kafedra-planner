// Assistant Sheet UI Controller · Kafedra Planner

const DRAFT_KEY = 'kafedra.assistant.draft';
const HISTORY_KEY = 'kafedra.assistant.history';
const MAX_HISTORY = 15;

const PRESETS = {
  'table-extract': [
    { label: '📋 Поручения и сроки', text: 'Поручить доценту Сидорову подготовить методические указания к 25 ноября. Профессору Иванову проверить готовность рабочих программ до 1 декабря.' },
    { label: '📚 Статьи и публикации', text: '1. Иванов И.И. Анализ данных в климатологии // Вестник науки. 2026. № 2. С. 45-52.\n2. Петров В.В., Сидоров А.А. Методы оценки влажности // Экологический мониторинг. 2026. Т. 14. С. 10-18.' },
    { label: '👥 Упоминания и роли', text: 'В заседании участвовали: зав. кафедрой Иванов И.И. (председатель), доц. Смирнова Е.А. (секретарь), проф. Кузнецов Д.В., аспирант Васильев А.С.' }
  ],
  'gap-repair': [
    { label: '🏛️ Заседание: пропуски дат и повестки', text: 'Заседание кафедры вычислительной техники.\nПрисутствовали: Иванов, Петров, Сидоров.\nПовестка дня:\n1. О подготовке к зимней сессии. Докладчик зав. кафедрой.\n2. Разное. Обсуждение закупки оборудования.' },
    { label: '📝 Протокол: проверка докладчиков и сроков', text: 'По вопросу 1 постановили: завершить приём задолженностей до конца месяца. Ответственным назначить зам. заведующего.' },
    { label: '⚠️ Анализ ошибки или неполного фрагмента', text: 'Ошибка при сохранении документа: отсутствуют обязательные реквизиты распоряжения: номер и дата издания документа.' }
  ],
  'formula-calc': [
    { label: '🔍 ВПР по ФИО', text: 'Как написать формулу ВПР для подтягивания должности преподавателя по его ФИО из соседней таблицы на листе Справочник' },
    { label: '📊 Подсчёт часов (СУММЕСЛИМН)', text: 'Напиши формулу СУММЕСЛИМН для подсчёта суммы учебных часов преподавателя Иванова за весенний семестр' },
    { label: '🚦 Условное форматирование', text: 'Как в LibreOffice Calc выделить красным цветом ячейки со статусом "Не сдано" или сроком ранее сегодняшнего дня' }
  ],
  'archive-query': [
    { label: '💧 Статья о влажности', text: 'На каком заседании кафедры обсуждалась статья о влажности и какие решения были приняты?' },
    { label: '📋 Утверждение тем ВКР', text: 'Найти заседания, где утверждались темы выпускных квалификационных работ' },
    { label: '🎓 Отчёт по аспирантам', text: 'В каких протоколах рассматривалась аттестация аспирантов кафедры?' }
  ]
};

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveHistoryItem(item) {
  try {
    const list = getHistory();
    list.unshift({ ...item, timestamp: Date.now() });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
  } catch {
    // quota exceeded or private mode
  }
}

function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {}
}

export function computeRepairedText(originalText, items, suggestedRepairedText) {
  if (suggestedRepairedText && typeof suggestedRepairedText === 'string' && suggestedRepairedText.trim().length > 0) {
    return suggestedRepairedText.trim();
  }
  let text = originalText || '';
  if (!Array.isArray(items) || items.length === 0) return text;

  const missingAdditions = [];
  for (const item of items) {
    if (!item.suggestedValue) continue;
    if (item.currentValue && text.includes(item.currentValue)) {
      text = text.replace(item.currentValue, item.suggestedValue);
    } else if (item.status === 'missing' && !text.includes(item.suggestedValue)) {
      missingAdditions.push(`${item.field}: ${item.suggestedValue}`);
    }
  }
  if (missingAdditions.length > 0) {
    text = (text ? `${text}\n\n` : '') + `[Заполненные реквизиты]:\n${missingAdditions.join('\n')}`;
  }
  return text;
}

export function applySingleItem(originalText, item) {
  let text = originalText || '';
  if (!item?.suggestedValue) return text;
  if (item.currentValue && text.includes(item.currentValue)) {
    return text.replace(item.currentValue, item.suggestedValue);
  }
  if (!text.includes(item.suggestedValue)) {
    const addition = `${item.field}: ${item.suggestedValue}`;
    return text ? `${text}\n${addition}` : addition;
  }
  return text;
}

export function createAssistantSheet() {
  let backdropEl;
  let sheetEl;
  let statusBadgeEl;
  let settingsPanelEl;
  let settingsToggleBtn;
  let modeButtons;
  let presetsContainerEl;
  let textareaEl;
  let charCountEl;
  let processBtn;
  let cancelBtn;
  let clearBtn;
  let resultsContainerEl;
  let abortController = null;
  let currentMode = 'table-extract';
  let timerInterval = null;

  function ensureElements() {
    if (sheetEl) return;

    // Inject stylesheet
    if (!document.querySelector('link[href*="assistant-sheet.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/assistant-sheet.css';
      document.head.append(link);
    }

    backdropEl = document.createElement('div');
    backdropEl.id = 'assistant-backdrop';
    backdropEl.className = 'assistant-backdrop hidden';
    document.body.append(backdropEl);

    sheetEl = document.createElement('section');
    sheetEl.id = 'assistant-sheet';
    sheetEl.className = 'assistant-sheet hidden';
    sheetEl.setAttribute('role', 'dialog');
    sheetEl.setAttribute('aria-modal', 'true');
    sheetEl.setAttribute('aria-label', 'Ассистент кафедры');

    sheetEl.innerHTML = `
      <header class="assistant-header">
        <div class="assistant-title-group">
          <h2 class="assistant-title">✨ Ассистент кафедры</h2>
          <button id="assistant-status-badge" class="assistant-status-badge" type="button" title="Проверить статус / Настройки LLM">Проверка...</button>
        </div>
        <div class="assistant-header-actions">
          <button id="assistant-settings-toggle" class="icon-button" type="button" aria-label="Настройки LLM" title="Настройки LLM-сервера">⚙</button>
          <button id="assistant-close-btn" class="icon-button" type="button" aria-label="Закрыть">×</button>
        </div>
      </header>

      <div id="assistant-settings-panel" class="assistant-settings-panel hidden" role="region" aria-label="Настройки LLM сервера">
        <div class="assistant-settings-header">
          <span>Настройки подключения к LLM</span>
          <span id="assistant-settings-status" class="assistant-settings-status"></span>
        </div>
        <div class="assistant-settings-field">
          <label class="assistant-settings-checkbox-label">
            <input type="checkbox" id="assistant-setting-enabled"> Включить ИИ-ассистент
          </label>
        </div>
        <div class="assistant-settings-field">
          <label for="assistant-setting-endpoint">Адрес сервера (URL):</label>
          <input type="text" id="assistant-setting-endpoint" placeholder="http://remote-server:8000/v1">
        </div>
        <div class="assistant-settings-field">
          <label for="assistant-setting-model">Модель:</label>
          <input type="text" id="assistant-setting-model" placeholder="local-model">
        </div>
        <div class="assistant-settings-field">
          <label for="assistant-setting-apikey">API-ключ (необязательно):</label>
          <input type="password" id="assistant-setting-apikey" placeholder="Токен доступа">
        </div>
        <div class="assistant-settings-actions">
          <button id="assistant-settings-test-btn" class="secondary-button" type="button">Проверить связь</button>
          <button id="assistant-settings-save-btn" class="primary-button" type="button">Сохранить</button>
        </div>
        <div id="assistant-settings-feedback" class="assistant-settings-feedback hidden"></div>
      </div>

      <div class="assistant-body">
        <nav class="assistant-modes" role="tablist" aria-label="Режимы ассистента">
          <button class="assistant-mode-tab active" type="button" data-mode="table-extract">Анализ текста</button>
          <button class="assistant-mode-tab" type="button" data-mode="gap-repair">Пропуски и ошибки</button>
          <button class="assistant-mode-tab" type="button" data-mode="archive-query">Поиск в архиве</button>
          <button class="assistant-mode-tab" type="button" data-mode="formula-calc">Формулы Calc / Excel</button>
          <button class="assistant-mode-tab" type="button" data-mode="history">История</button>
        </nav>

        <div id="assistant-presets-wrap" class="assistant-presets">
          <span class="assistant-preset-label">Примеры:</span>
          <div id="assistant-presets" style="display:contents"></div>
        </div>

        <div class="assistant-input-card">
          <textarea id="assistant-input" class="assistant-textarea" placeholder="Вставьте сюда текст или напишите запрос..."></textarea>
          <div class="assistant-input-footer">
            <span id="assistant-char-count">0 символов</span>
            <span>Ctrl + Enter для запуска</span>
          </div>
        </div>

        <div class="assistant-actions">
          <button id="assistant-clear-btn" class="quiet-button" type="button">Очистить</button>
          <button id="assistant-cancel-btn" class="secondary-button hidden" type="button">Отмена</button>
          <button id="assistant-process-btn" class="primary-button" type="button">Обработать</button>
        </div>

        <div id="assistant-results" class="assistant-result-section hidden"></div>
      </div>
    `;

    document.body.append(sheetEl);

    statusBadgeEl = sheetEl.querySelector('#assistant-status-badge');
    settingsPanelEl = sheetEl.querySelector('#assistant-settings-panel');
    settingsToggleBtn = sheetEl.querySelector('#assistant-settings-toggle');
    modeButtons = sheetEl.querySelectorAll('.assistant-mode-tab');
    presetsContainerEl = sheetEl.querySelector('#assistant-presets');
    textareaEl = sheetEl.querySelector('#assistant-input');
    charCountEl = sheetEl.querySelector('#assistant-char-count');
    processBtn = sheetEl.querySelector('#assistant-process-btn');
    cancelBtn = sheetEl.querySelector('#assistant-cancel-btn');
    clearBtn = sheetEl.querySelector('#assistant-clear-btn');
    resultsContainerEl = sheetEl.querySelector('#assistant-results');

    // Event listeners
    backdropEl.addEventListener('click', close);
    sheetEl.querySelector('#assistant-close-btn').addEventListener('click', close);

    statusBadgeEl.addEventListener('click', toggleSettings);
    settingsToggleBtn.addEventListener('click', toggleSettings);

    const testBtn = sheetEl.querySelector('#assistant-settings-test-btn');
    const saveBtn = sheetEl.querySelector('#assistant-settings-save-btn');
    testBtn.addEventListener('click', handleTestConnection);
    saveBtn.addEventListener('click', handleSaveSettings);

    modeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        setMode(btn.dataset.mode);
      });
    });

    textareaEl.addEventListener('input', () => {
      updateCharCount();
      saveDraft();
    });

    textareaEl.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleProcess();
      }
    });

    clearBtn.addEventListener('click', handleClear);
    cancelBtn.addEventListener('click', handleCancel);
    processBtn.addEventListener('click', handleProcess);

    // Global keyboard listener for Alt+A
    window.addEventListener('keydown', (e) => {
      if (e.altKey && (e.code === 'KeyA' || e.key === 'a' || e.key === 'ф' || e.key === 'Ф')) {
        e.preventDefault();
        toggle();
      }
      if (e.key === 'Escape' && isOpen()) {
        e.preventDefault();
        close();
      }
    });
  }

  function toggleSettings() {
    ensureElements();
    const isHidden = settingsPanelEl.classList.contains('hidden');
    settingsPanelEl.classList.toggle('hidden', !isHidden);
    if (isHidden) {
      loadSettingsToForm();
    }
  }

  async function loadSettingsToForm() {
    try {
      const resp = await fetch('/api/assistant/status');
      if (resp.ok) {
        const data = await resp.json();
        sheetEl.querySelector('#assistant-setting-enabled').checked = Boolean(data.enabled);
        sheetEl.querySelector('#assistant-setting-endpoint').value = data.endpoint || '';
        sheetEl.querySelector('#assistant-setting-model').value = data.model || '';
      }
    } catch {}
  }

  async function handleTestConnection() {
    ensureElements();
    const feedback = sheetEl.querySelector('#assistant-settings-feedback');
    const endpoint = sheetEl.querySelector('#assistant-setting-endpoint').value.trim();
    const model = sheetEl.querySelector('#assistant-setting-model').value.trim();
    const apiKey = sheetEl.querySelector('#assistant-setting-apikey').value.trim();

    feedback.className = 'assistant-settings-feedback';
    feedback.textContent = 'Проверка соединения...';
    feedback.classList.remove('hidden');

    try {
      const resp = await fetch('/api/assistant/test-connection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, model, apiKey })
      });
      const data = await resp.json();
      if (data.ok) {
        feedback.className = 'assistant-settings-feedback success';
        const modelsCount = (data.models || []).length;
        feedback.textContent = `✓ Соединение успешно (${data.latencyMs} мс). Доступно моделей: ${modelsCount}.`;
      } else {
        feedback.className = 'assistant-settings-feedback error';
        feedback.textContent = `✗ Сервер недоступен: ${data.reason || data.status}`;
      }
    } catch (e) {
      feedback.className = 'assistant-settings-feedback error';
      feedback.textContent = `✗ Ошибка запроса: ${e.message}`;
    }
  }

  async function handleSaveSettings() {
    ensureElements();
    const feedback = sheetEl.querySelector('#assistant-settings-feedback');
    const enabled = sheetEl.querySelector('#assistant-setting-enabled').checked;
    const endpoint = sheetEl.querySelector('#assistant-setting-endpoint').value.trim();
    const model = sheetEl.querySelector('#assistant-setting-model').value.trim();
    const apiKey = sheetEl.querySelector('#assistant-setting-apikey').value.trim();

    feedback.className = 'assistant-settings-feedback';
    feedback.textContent = 'Сохранение...';
    feedback.classList.remove('hidden');

    try {
      const resp = await fetch('/api/assistant/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled, endpoint, model, apiKey: apiKey || undefined })
      });
      const data = await resp.json();
      if (data.ok) {
        feedback.className = 'assistant-settings-feedback success';
        feedback.textContent = '✓ Настройки сохранены';
        checkStatus();
        setTimeout(() => {
          feedback.classList.add('hidden');
          settingsPanelEl.classList.add('hidden');
        }, 1500);
      } else {
        feedback.className = 'assistant-settings-feedback error';
        feedback.textContent = `✗ Ошибка сохранения: ${data.error || 'неизвестная ошибка'}`;
      }
    } catch (e) {
      feedback.className = 'assistant-settings-feedback error';
      feedback.textContent = `✗ Ошибка сети: ${e.message}`;
    }
  }

  function setMode(mode) {
    currentMode = mode;
    modeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    const isHistory = mode === 'history';
    sheetEl.querySelector('#assistant-presets-wrap').classList.toggle('hidden', isHistory);
    sheetEl.querySelector('.assistant-input-card').classList.toggle('hidden', isHistory);
    sheetEl.querySelector('.assistant-actions').classList.toggle('hidden', isHistory);

    if (isHistory) {
      renderHistoryView();
    } else {
      updatePlaceholder();
      renderPresets();
      restoreDraft();
      resultsContainerEl.classList.add('hidden');
      resultsContainerEl.innerHTML = '';
      textareaEl.focus();
    }
  }

  function updatePlaceholder() {
    if (currentMode === 'table-extract') {
      textareaEl.placeholder = 'Вставьте неформатированный текст (протокол, список статей, поручения)...';
    } else if (currentMode === 'gap-repair') {
      textareaEl.placeholder = 'Вставьте фрагмент заседания, протокол или текст с ошибкой для анализа пропусков дат и реквизитов...';
    } else if (currentMode === 'archive-query') {
      textareaEl.placeholder = 'Например: В каких заседаниях обсуждался вопрос о влажности почв?';
    } else if (currentMode === 'formula-calc') {
      textareaEl.placeholder = 'Опишите задачу: например, как посчитать часы Иванова по семестрам в Calc...';
    }
  }

  function renderPresets() {
    presetsContainerEl.innerHTML = '';
    const list = PRESETS[currentMode] || [];
    list.forEach((preset) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'assistant-preset-chip';
      chip.textContent = preset.label;
      chip.addEventListener('click', () => {
        textareaEl.value = preset.text;
        updateCharCount();
        saveDraft();
        textareaEl.focus();
      });
      presetsContainerEl.append(chip);
    });
  }

  function updateCharCount() {
    const len = textareaEl.value.length;
    charCountEl.textContent = `${len} символов`;
  }

  function saveDraft() {
    try {
      sessionStorage.setItem(`${DRAFT_KEY}.${currentMode}`, textareaEl.value);
    } catch {}
  }

  function restoreDraft() {
    try {
      const saved = sessionStorage.getItem(`${DRAFT_KEY}.${currentMode}`);
      if (saved) {
        textareaEl.value = saved;
        updateCharCount();
      }
    } catch {}
  }

  async function checkStatus() {
    try {
      const resp = await fetch('/api/assistant/status');
      if (resp.ok) {
        const data = await resp.json();
        if (data.enabled && data.status === 'ready') {
          const lat = data.latencyMs ? ` (${data.latencyMs} мс)` : '';
          statusBadgeEl.textContent = `● В сети${lat}`;
          statusBadgeEl.className = 'assistant-status-badge ready';
          statusBadgeEl.title = `Сервер: ${data.endpoint || 'локальный'}\nМодель: ${data.model}`;
        } else if (data.enabled && data.status === 'unavailable') {
          statusBadgeEl.textContent = '● Недоступен';
          statusBadgeEl.className = 'assistant-status-badge unavailable';
          statusBadgeEl.title = 'Сервер модели не отвечает. Нажмите для настройки адреса.';
        } else if (data.enabled && data.status === 'timeout') {
          statusBadgeEl.textContent = '● Таймаут';
          statusBadgeEl.className = 'assistant-status-badge timeout';
        } else {
          statusBadgeEl.textContent = '○ Выключен';
          statusBadgeEl.className = 'assistant-status-badge offline';
          statusBadgeEl.title = 'ИИ-ассистент отключен. Нажмите для настройки.';
        }
      }
    } catch {
      statusBadgeEl.textContent = '○ Офлайн';
      statusBadgeEl.className = 'assistant-status-badge offline';
    }
  }

  function showToast(message) {
    let toast = document.querySelector('#toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast hidden';
      document.body.append(toast);
    }
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.add('hidden'), 2500);
  }

  async function handleProcess() {
    const text = textareaEl.value.trim();
    if (!text) {
      textareaEl.focus();
      return;
    }

    abortController = new AbortController();
    processBtn.disabled = true;
    cancelBtn.classList.remove('hidden');
    resultsContainerEl.classList.remove('hidden');

    const startTime = Date.now();
    processBtn.textContent = 'Обработка... (0 с)';
    timerInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      processBtn.textContent = `Обработка... (${elapsed} с)`;
    }, 1000);

    resultsContainerEl.innerHTML = '<p class="helper">Модель обрабатывает запрос и формирует результат...</p>';

    try {
      const resp = await fetch('/api/assistant/process', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          task: currentMode,
          text: (currentMode === 'table-extract' || currentMode === 'gap-repair') ? text : undefined,
          query: (currentMode !== 'table-extract' && currentMode !== 'gap-repair') ? text : undefined
        }),
        signal: abortController.signal
      });

      clearInterval(timerInterval);
      processBtn.textContent = 'Обработать';
      processBtn.disabled = false;
      cancelBtn.classList.add('hidden');

      if (!resp.ok) {
        resultsContainerEl.innerHTML = `<p class="error-text">Ошибка HTTP ${resp.status}</p>`;
        return;
      }

      const data = await resp.json();
      if (data.status === 'disabled') {
        resultsContainerEl.innerHTML = `
          <div class="empty-state">
            <strong>LLM выключен</strong>
            <p>Включите ассистент в настройках (⚙ в шапке панели) или задайте <code>KAFEDRA_LLM_ENABLED=true</code>.</p>
          </div>
        `;
        return;
      }

      if (data.status === 'timeout') {
        resultsContainerEl.innerHTML = `<p class="error-text">Тайм-аут: сервер модели не ответил вовремя. Попробуйте уменьшить объём текста.</p>`;
        return;
      }

      if (data.status !== 'completed' || !data.result) {
        resultsContainerEl.innerHTML = `<p class="error-text">Не удалось обработать запрос: ${data.error || 'неизвестная ошибка'}</p>`;
        return;
      }

      renderResult(data.result);
      saveHistoryItem({ mode: currentMode, query: text, result: data.result });
    } catch (err) {
      clearInterval(timerInterval);
      processBtn.textContent = 'Обработать';
      processBtn.disabled = false;
      cancelBtn.classList.add('hidden');

      if (err.name === 'AbortError') {
        resultsContainerEl.innerHTML = '<p class="helper">Запрос отменён пользователем.</p>';
      } else {
        resultsContainerEl.innerHTML = `<p class="error-text">Ошибка соединения: ${err.message}</p>`;
      }
    }
  }

  function handleCancel() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  }

  function handleClear() {
    textareaEl.value = '';
    updateCharCount();
    saveDraft();
    resultsContainerEl.innerHTML = '';
    resultsContainerEl.classList.add('hidden');
    textareaEl.focus();
  }

  function renderResult(result) {
    resultsContainerEl.innerHTML = '';
    if (result.type === 'table') {
      renderTableResult(result);
    } else if (result.type === 'gap-repair') {
      renderGapRepairResult(result);
    } else if (result.type === 'formula') {
      renderFormulaResult(result);
    } else if (result.type === 'archive-matches') {
      renderArchiveMatches(result);
    }
  }

  function renderGapRepairResult(result) {
    const wrap = document.createElement('div');
    wrap.className = 'assistant-gap-list';

    if (result.summary) {
      const summaryCard = document.createElement('div');
      summaryCard.className = 'assistant-summary-card';
      summaryCard.textContent = result.summary;
      wrap.append(summaryCard);
    }

    const items = result.items || [];
    if (items.length === 0) {
      const emptyCard = document.createElement('div');
      emptyCard.className = 'empty-state';
      emptyCard.innerHTML = '<p>Пропусков и ошибок не обнаружено. Все реквизиты заполнены.</p>';
      wrap.append(emptyCard);
    } else {
      // Top actions toolbar: single-click accept all, copy repaired text, toggle details
      const toolbar = document.createElement('div');
      toolbar.className = 'assistant-gap-toolbar';

      const toolbarLeft = document.createElement('div');
      toolbarLeft.className = 'assistant-gap-toolbar-left';

      const applyAllBtn = document.createElement('button');
      applyAllBtn.id = 'assistant-apply-all-btn';
      applyAllBtn.type = 'button';
      applyAllBtn.className = 'primary-button assistant-apply-all-btn';
      applyAllBtn.textContent = '✓ Принять всё сразу';
      applyAllBtn.title = 'Применить все исправления в текст без подтверждения каждого';

      const copyAllBtn = document.createElement('button');
      copyAllBtn.id = 'assistant-copy-all-btn';
      copyAllBtn.type = 'button';
      copyAllBtn.className = 'secondary-button';
      copyAllBtn.textContent = '📋 Скопировать готовый текст';
      copyAllBtn.title = 'Скопировать исправленный связный текст в буфер обмена';

      toolbarLeft.append(applyAllBtn, copyAllBtn);

      const toolbarRight = document.createElement('div');
      toolbarRight.className = 'assistant-gap-toolbar-right';

      const toggleDetailsBtn = document.createElement('button');
      toggleDetailsBtn.id = 'assistant-toggle-details-btn';
      toggleDetailsBtn.type = 'button';
      toggleDetailsBtn.className = 'quiet-button assistant-toggle-details-btn';
      toggleDetailsBtn.textContent = '🔍 Проверить цитаты и обоснования';
      toggleDetailsBtn.title = 'Развернуть или скрыть обоснования и цитаты по всем карточкам';

      toolbarRight.append(toggleDetailsBtn);
      toolbar.append(toolbarLeft, toolbarRight);
      wrap.append(toolbar);

      const cards = [];
      const detailsElements = [];

      applyAllBtn.addEventListener('click', () => {
        const repaired = computeRepairedText(textareaEl.value, items, result.repairedText);
        textareaEl.value = repaired;
        updateCharCount();
        saveDraft();

        cards.forEach(({ card, applyBtn, statusBadge }) => {
          card.classList.add('applied');
          statusBadge.className = 'assistant-gap-status applied';
          statusBadge.textContent = '✓ Принято';
          applyBtn.textContent = '✓ Применено';
          applyBtn.disabled = true;
        });

        applyAllBtn.textContent = '✓ Все исправления приняты';
        applyAllBtn.disabled = true;
        applyAllBtn.classList.add('applied');

        showToast('Все исправления успешно применены к тексту');
      });

      copyAllBtn.addEventListener('click', async () => {
        const repaired = computeRepairedText(textareaEl.value, items, result.repairedText);
        try {
          await navigator.clipboard.writeText(repaired);
          showToast('Исправленный текст скопирован в буфер обмена');
        } catch {
          showToast('Не удалось скопировать в буфер обмена');
        }
      });

      let allExpanded = false;
      toggleDetailsBtn.addEventListener('click', () => {
        allExpanded = !allExpanded;
        detailsElements.forEach((det) => {
          det.open = allExpanded;
        });
        toggleDetailsBtn.textContent = allExpanded
          ? 'Скрыть цитаты и обоснования'
          : '🔍 Проверить цитаты и обоснования';
      });

      items.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'assistant-gap-card';

        const head = document.createElement('div');
        head.className = 'assistant-gap-head';

        const titleGroup = document.createElement('div');
        titleGroup.className = 'assistant-gap-title-group';

        const title = document.createElement('span');
        title.className = 'assistant-gap-field';
        title.textContent = item.field;

        const statusBadge = document.createElement('span');
        statusBadge.className = `assistant-gap-status ${item.status}`;
        statusBadge.textContent = item.status === 'missing' ? 'Пропущен' : item.status === 'invalid' ? 'Ошибка' : 'Исправлен';

        titleGroup.append(title, statusBadge);

        const cardActions = document.createElement('div');
        cardActions.className = 'assistant-gap-card-actions';

        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'quiet-button assistant-apply-item-btn';
        applyBtn.textContent = '✓ Принять';
        applyBtn.title = 'Принять только это исправление';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'quiet-button assistant-copy-item-btn';
        copyBtn.textContent = '📋';
        copyBtn.title = 'Скопировать предлагаемое значение';

        cardActions.append(applyBtn, copyBtn);
        head.append(titleGroup, cardActions);
        card.append(head);

        const valWrap = document.createElement('div');
        valWrap.className = 'assistant-gap-values';

        if (item.currentValue) {
          const cur = document.createElement('span');
          cur.className = 'assistant-gap-current';
          cur.textContent = `Было: ${item.currentValue}`;
          const arrow = document.createElement('span');
          arrow.className = 'assistant-gap-arrow';
          arrow.textContent = '→';
          valWrap.append(cur, arrow);
        }

        const sug = document.createElement('span');
        sug.className = 'assistant-gap-suggested';
        sug.textContent = item.currentValue ? item.suggestedValue : `Предлагается: ${item.suggestedValue}`;
        valWrap.append(sug);
        card.append(valWrap);

        // Collapsible details block (quiet by default, expandable on demand)
        const details = document.createElement('details');
        details.className = 'assistant-gap-details';

        const detailsSummary = document.createElement('summary');
        detailsSummary.className = 'assistant-gap-details-toggle';
        detailsSummary.textContent = item.quoteVerified
          ? '🔍 Обоснование и проверенная цитата'
          : '🔍 Обоснование и цитата';
        details.append(detailsSummary);

        const detailsBody = document.createElement('div');
        detailsBody.className = 'assistant-gap-details-body';

        if (item.reason) {
          const reason = document.createElement('div');
          reason.className = 'assistant-gap-reason';
          reason.textContent = item.reason;
          detailsBody.append(reason);
        }

        if (item.sourceQuote) {
          const quote = document.createElement('blockquote');
          quote.className = `assistant-gap-quote ${item.quoteVerified ? 'verified' : ''}`;
          quote.textContent = item.sourceQuote;
          if (item.quoteVerified) {
            quote.title = 'Цитата подтверждена в исходном тексте документа';
          }
          detailsBody.append(quote);
        }

        details.append(detailsBody);
        card.append(details);
        detailsElements.push(details);

        applyBtn.addEventListener('click', () => {
          const updated = applySingleItem(textareaEl.value, item);
          textareaEl.value = updated;
          updateCharCount();
          saveDraft();

          card.classList.add('applied');
          statusBadge.className = 'assistant-gap-status applied';
          statusBadge.textContent = '✓ Принято';
          applyBtn.textContent = '✓ Применено';
          applyBtn.disabled = true;

          const allDone = cards.every((c) => c.card.classList.contains('applied'));
          if (allDone) {
            applyAllBtn.textContent = '✓ Все исправления приняты';
            applyAllBtn.disabled = true;
            applyAllBtn.classList.add('applied');
          }

          showToast(`Принято: ${item.field} → ${item.suggestedValue}`);
        });

        copyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(item.suggestedValue);
            showToast(`Скопировано: ${item.suggestedValue}`);
          } catch {
            showToast('Не удалось скопировать');
          }
        });

        cards.push({ card, applyBtn, statusBadge });
        wrap.append(card);
      });
    }

    if (result.actionableAdvice) {
      const adviceCard = document.createElement('div');
      adviceCard.className = 'assistant-advice-card';
      adviceCard.innerHTML = `<strong>Рекомендация:</strong> ${result.actionableAdvice}`;
      wrap.append(adviceCard);
    }

    resultsContainerEl.append(wrap);
  }

  function renderTableResult(tableData) {
    const headerRow = document.createElement('div');
    headerRow.className = 'assistant-result-header';

    const titleEl = document.createElement('strong');
    titleEl.textContent = tableData.title || 'Извлечённая таблица';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'secondary-button';
    copyBtn.textContent = '📋 Скопировать в Excel / Calc';
    copyBtn.addEventListener('click', () => copyTableToClipboard(tableEl));

    const addRowBtn = document.createElement('button');
    addRowBtn.type = 'button';
    addRowBtn.className = 'quiet-button';
    addRowBtn.textContent = '+ Строка';
    addRowBtn.addEventListener('click', () => {
      const tr = createTableRow(tableData.columns, {});
      tableEl.querySelector('tbody').append(tr);
    });

    headerRow.append(titleEl, addRowBtn, copyBtn);
    resultsContainerEl.append(headerRow);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'assistant-table-wrap';

    const tableEl = document.createElement('table');
    tableEl.className = 'assistant-table';

    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    (tableData.columns || []).forEach((col) => {
      const th = document.createElement('th');
      th.textContent = col.label;
      th.dataset.colId = col.id;
      trHead.append(th);
    });
    const thAct = document.createElement('th');
    thAct.style.width = '32px';
    trHead.append(thAct);
    thead.append(trHead);
    tableEl.append(thead);

    const tbody = document.createElement('tbody');
    (tableData.rows || []).forEach((row) => {
      tbody.append(createTableRow(tableData.columns, row));
    });
    tableEl.append(tbody);
    tableWrap.append(tableEl);
    resultsContainerEl.append(tableWrap);
  }

  async function copyTableToClipboard(tableEl) {
    const rows = Array.from(tableEl.querySelectorAll('tr'));
    const tsvLines = [];
    const htmlRows = [];

    rows.forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll('th, td'));
      const textCells = cells.slice(0, -1).map((c) => c.innerText.trim().replace(/\t/g, ' '));
      if (textCells.length) {
        tsvLines.push(textCells.join('\t'));
        htmlRows.push(`<tr>${textCells.map((c) => `<td>${c}</td>`).join('')}</tr>`);
      }
    });

    const tsv = tsvLines.join('\n');
    const html = `<table>${htmlRows.join('')}</table>`;

    try {
      if (navigator.clipboard?.write && window.ClipboardItem) {
        const itemData = {
          'text/plain': new Blob([tsv], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' })
        };
        try {
          itemData['text/tab-separated-values'] = new Blob([tsv], { type: 'text/tab-separated-values' });
        } catch {}

        await navigator.clipboard.write([new ClipboardItem(itemData)]);
      } else {
        await navigator.clipboard.writeText(tsv);
      }
      showToast('Таблица скопирована для вставки в Calc / Excel');
    } catch {
      showToast('Не удалось скопировать таблицу');
    }
  }

  function createTableRow(columns, rowData) {
    const tr = document.createElement('tr');
    columns.forEach((col) => {
      const td = document.createElement('td');
      td.contentEditable = 'true';
      td.textContent = rowData[col.id] || '';
      tr.append(td);
    });

    const tdAct = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'icon-button';
    delBtn.textContent = '✕';
    delBtn.title = 'Удалить строку';
    delBtn.style.padding = '2px 6px';
    delBtn.addEventListener('click', () => tr.remove());
    tdAct.append(delBtn);
    tr.append(tdAct);

    return tr;
  }

  function renderFormulaResult(formulaData) {
    const wrap = document.createElement('div');
    wrap.className = 'assistant-formula-card';

    if (formulaData.description) {
      const desc = document.createElement('p');
      desc.textContent = formulaData.description;
      wrap.append(desc);
    }

    const box = document.createElement('div');
    box.className = 'assistant-formula-box';

    const code = document.createElement('code');
    code.className = 'assistant-formula-code';
    code.textContent = formulaData.formula;

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'secondary-button';
    copyBtn.textContent = '📋 Копировать';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(formulaData.formula);
        showToast('Формула скопирована в буфер');
      } catch {
        showToast('Не удалось скопировать формулу');
      }
    });

    box.append(code, copyBtn);
    wrap.append(box);

    if (formulaData.steps && formulaData.steps.length) {
      const stepsHeader = document.createElement('strong');
      stepsHeader.textContent = 'Как использовать:';
      const ol = document.createElement('ol');
      ol.className = 'assistant-formula-steps';
      formulaData.steps.forEach((step) => {
        const li = document.createElement('li');
        li.textContent = step;
        ol.append(li);
      });
      wrap.append(stepsHeader, ol);
    }

    if (formulaData.example) {
      const ex = document.createElement('p');
      ex.className = 'helper';
      ex.textContent = `Пример: ${formulaData.example}`;
      wrap.append(ex);
    }

    resultsContainerEl.append(wrap);
  }

  function renderArchiveMatches(archiveData) {
    const wrap = document.createElement('div');
    wrap.className = 'assistant-matches-list';

    if (archiveData.summary) {
      const summaryEl = document.createElement('div');
      summaryEl.className = 'assistant-summary-card';
      summaryEl.textContent = archiveData.summary;
      wrap.append(summaryEl);
    }

    const matches = archiveData.matches || [];
    if (matches.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'helper';
      empty.textContent = 'В найденных документах заседаний точных совпадений с вопросом не обнаружено.';
      wrap.append(empty);
    } else {
      matches.forEach((m) => {
        const card = document.createElement('div');
        card.className = 'assistant-match-card';

        const head = document.createElement('div');
        head.className = 'assistant-match-head';

        const title = document.createElement('span');
        const numPart = m.protocolNumber ? `Протокол № ${m.protocolNumber}` : 'Заседание';
        const datePart = m.meetingDate ? ` от ${m.meetingDate}` : '';
        const itemPart = m.itemNumber ? ` · Вопрос ${m.itemNumber}` : '';
        title.textContent = `${numPart}${datePart}${itemPart}`;

        head.append(title);
        card.append(head);

        if (m.itemTitle) {
          const itemTitleEl = document.createElement('div');
          itemTitleEl.style.fontSize = '13px';
          itemTitleEl.textContent = m.itemTitle;
          card.append(itemTitleEl);
        }

        if (m.quote) {
          const quoteEl = document.createElement('blockquote');
          quoteEl.className = 'assistant-match-quote';
          quoteEl.textContent = `«${m.quote}»`;
          card.append(quoteEl);
        }

        wrap.append(card);
      });
    }

    resultsContainerEl.append(wrap);
  }

  function renderHistoryView() {
    resultsContainerEl.classList.remove('hidden');
    resultsContainerEl.innerHTML = '';

    const list = getHistory();
    if (!list.length) {
      resultsContainerEl.innerHTML = '<p class="helper">История запросов пуста.</p>';
      return;
    }

    const header = document.createElement('div');
    header.className = 'assistant-result-header';
    header.innerHTML = '<strong>Недавние запросы</strong>';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'quiet-button';
    clearBtn.textContent = 'Очистить историю';
    clearBtn.addEventListener('click', () => {
      clearHistory();
      renderHistoryView();
    });
    header.append(clearBtn);
    resultsContainerEl.append(header);

    const histList = document.createElement('div');
    histList.className = 'assistant-history-list';

    list.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'assistant-history-item';

      const textSpan = document.createElement('span');
      textSpan.textContent = item.query ? item.query.slice(0, 80) : '(пустой запрос)';

      const dateSpan = document.createElement('span');
      dateSpan.className = 'helper';
      dateSpan.textContent = new Date(item.timestamp).toLocaleDateString();

      row.append(textSpan, dateSpan);
      row.addEventListener('click', () => {
        setMode(item.mode);
        textareaEl.value = item.query;
        updateCharCount();
        renderResult(item.result);
      });

      histList.append(row);
    });

    resultsContainerEl.append(histList);
  }

  function open(options = {}) {
    ensureElements();
    backdropEl.classList.remove('hidden');
    sheetEl.classList.remove('hidden');
    checkStatus();

    if (options.mode) {
      setMode(options.mode);
    }
    if (typeof options.text === 'string') {
      textareaEl.value = options.text;
      updateCharCount();
      saveDraft();
    }
    textareaEl.focus();
  }

  function close() {
    if (!sheetEl) return;
    backdropEl.classList.add('hidden');
    sheetEl.classList.add('hidden');
    handleCancel();
  }

  function toggle() {
    if (isOpen()) close();
    else open();
  }

  function isOpen() {
    return Boolean(sheetEl && !sheetEl.classList.contains('hidden'));
  }

  return {
    open,
    close,
    toggle,
    isOpen
  };
}
