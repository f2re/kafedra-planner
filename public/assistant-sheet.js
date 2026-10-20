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

export function createAssistantSheet() {
  let backdropEl;
  let sheetEl;
  let statusBadgeEl;
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
          <span id="assistant-status-badge" class="assistant-status-badge">Проверка...</span>
        </div>
        <button id="assistant-close-btn" class="icon-button" type="button" aria-label="Закрыть">×</button>
      </header>

      <div class="assistant-body">
        <nav class="assistant-modes" role="tablist" aria-label="Режимы ассистента">
          <button class="assistant-mode-tab active" type="button" data-mode="table-extract">Анализ текста</button>
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

    processBtn.addEventListener('click', handleProcess);
    cancelBtn.addEventListener('click', handleCancel);
    clearBtn.addEventListener('click', handleClear);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !sheetEl.classList.contains('hidden')) {
        close();
      } else if (e.altKey && (e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф')) {
        e.preventDefault();
        toggle();
      }
    });

    renderPresets();
    restoreDraft();
    checkStatus();
  }

  function setMode(mode) {
    currentMode = mode;
    modeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    const isHistory = mode === 'history';
    sheetEl.querySelector('#assistant-presets-wrap').classList.toggle('hidden', isHistory);
    textareaEl.closest('.assistant-input-card').classList.toggle('hidden', isHistory);
    processBtn.classList.toggle('hidden', isHistory);
    clearBtn.classList.toggle('hidden', isHistory);

    if (isHistory) {
      renderHistoryView();
    } else {
      renderPresets();
      updatePlaceholder();
    }
  }

  function updatePlaceholder() {
    if (currentMode === 'table-extract') {
      textareaEl.placeholder = 'Вставьте неформатированный текст (протокол, список статей, поручения)...';
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
        if (data.enabled) {
          statusBadgeEl.textContent = 'Готов (LLM)';
          statusBadgeEl.className = 'assistant-status-badge ready';
        } else {
          statusBadgeEl.textContent = 'Офлайн (LLM выключен)';
          statusBadgeEl.className = 'assistant-status-badge offline';
          statusBadgeEl.title = 'Включите KAFEDRA_LLM_ENABLED=true в конфигурации для активации';
        }
      }
    } catch {
      statusBadgeEl.textContent = 'Офлайн';
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
          text: currentMode === 'table-extract' ? text : undefined,
          query: currentMode !== 'table-extract' ? text : undefined
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
            <p>Для работы ассистента включите <code>KAFEDRA_LLM_ENABLED=true</code> в конфигурации сервера.</p>
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
    resultsContainerEl.classList.remove('hidden');

    if (result.type === 'table') {
      renderTableResult(result);
    } else if (result.type === 'formula') {
      renderFormulaResult(result);
    } else if (result.type === 'archive-matches') {
      renderArchiveResult(result);
    }
  }

  function renderTableResult(tableData) {
    const header = document.createElement('div');
    header.className = 'assistant-result-header';

    const title = document.createElement('h3');
    title.className = 'assistant-result-title';
    title.textContent = `${tableData.title || 'Таблица'} (${tableData.rows?.length || 0} строк)`;

    const tools = document.createElement('div');
    tools.className = 'assistant-export-tools';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'secondary-button';
    copyBtn.type = 'button';
    copyBtn.textContent = '📋 Скопировать в Excel / Calc';
    copyBtn.title = 'Копирует таблицу в буфер для вставки в Calc или Excel по ячейкам';

    const addRowBtn = document.createElement('button');
    addRowBtn.className = 'quiet-button';
    addRowBtn.type = 'button';
    addRowBtn.textContent = '+ Строка';

    tools.append(copyBtn, addRowBtn);
    header.append(title, tools);

    const wrap = document.createElement('div');
    wrap.className = 'assistant-table-wrap';

    const table = document.createElement('table');
    table.className = 'assistant-table';

    const thead = document.createElement('thead');
    const trHead = document.createElement('tr');
    (tableData.columns || []).forEach((col) => {
      const th = document.createElement('th');
      th.textContent = col.label;
      th.dataset.colId = col.id;
      trHead.append(th);
    });
    const thAction = document.createElement('th');
    thAction.className = 'assistant-cell-delete';
    trHead.append(thAction);
    thead.append(trHead);
    table.append(thead);

    const tbody = document.createElement('tbody');
    (tableData.rows || []).forEach((row) => {
      const tr = createTableRow(tableData.columns, row);
      tbody.append(tr);
    });
    table.append(tbody);
    wrap.append(table);

    addRowBtn.addEventListener('click', () => {
      const emptyRow = {};
      tableData.columns.forEach((c) => { emptyRow[c.id] = ''; });
      tbody.append(createTableRow(tableData.columns, emptyRow));
    });

    copyBtn.addEventListener('click', () => {
      copyTableToClipboard(table);
    });

    resultsContainerEl.append(header, wrap);
  }

  function createTableRow(columns, rowData) {
    const tr = document.createElement('tr');
    columns.forEach((col) => {
      const td = document.createElement('td');
      td.contentEditable = 'true';
      td.textContent = rowData[col.id] || '';
      tr.append(td);
    });
    const tdDel = document.createElement('td');
    tdDel.className = 'assistant-cell-delete';
    const delBtn = document.createElement('button');
    delBtn.className = 'assistant-row-delete-btn';
    delBtn.textContent = '✕';
    delBtn.title = 'Удалить строку';
    delBtn.addEventListener('click', () => tr.remove());
    tdDel.append(delBtn);
    tr.append(tdDel);
    return tr;
  }

  async function copyTableToClipboard(table) {
    const rows = [...table.querySelectorAll('tr')];
    if (!rows.length) return;

    const tsvLines = [];
    const htmlRows = [];

    rows.forEach((tr) => {
      const cells = [...tr.querySelectorAll('th:not(.assistant-cell-delete), td:not(.assistant-cell-delete)')];
      const textValues = cells.map((c) => c.innerText.replace(/[\t\r\n]/gu, ' ').trim());
      tsvLines.push(textValues.join('\t'));

      const htmlCells = cells.map((c) => `<${c.tagName.toLowerCase()}>${c.innerText.trim()}</${c.tagName.toLowerCase()}>`).join('');
      htmlRows.push(`<tr>${htmlCells}</tr>`);
    });

    const tsv = tsvLines.join('\n');
    const html = `<table border="1">${htmlRows.join('')}</table>`;

    try {
      if (navigator.clipboard?.write && window.ClipboardItem) {
        const itemData = {
          'text/plain': new Blob([tsv], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' })
        };
        try {
          itemData['text/tab-separated-values'] = new Blob([tsv], { type: 'text/tab-separated-values' });
        } catch {}
        await navigator.clipboard.write([
          new ClipboardItem(itemData)
        ]);
      } else {
        await navigator.clipboard.writeText(tsv);
      }
      showToast('✓ Таблица скопирована для Excel/Calc');
    } catch {
      showToast('Не удалось скопировать таблицу');
    }
  }

  function renderFormulaResult(formulaData) {
    const card = document.createElement('div');
    card.className = 'assistant-formula-card';

    const title = document.createElement('h3');
    title.className = 'assistant-result-title';
    title.textContent = 'Формула для LibreOffice Calc / Excel:';

    const box = document.createElement('div');
    box.className = 'assistant-formula-box';
    const code = document.createElement('span');
    code.textContent = formulaData.formula;
    const copyBtn = document.createElement('button');
    copyBtn.className = 'secondary-button';
    copyBtn.style.padding = '4px 8px';
    copyBtn.style.fontSize = '12px';
    copyBtn.textContent = '📋 Копировать';
    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(formulaData.formula);
      showToast('✓ Формула скопирована');
    });
    box.append(code, copyBtn);

    const desc = document.createElement('p');
    desc.style.fontSize = '13px';
    desc.style.margin = '4px 0';
    desc.textContent = formulaData.description;

    const stepsList = document.createElement('ol');
    stepsList.className = 'assistant-formula-steps';
    (formulaData.steps || []).forEach((st) => {
      const li = document.createElement('li');
      li.textContent = st;
      stepsList.append(li);
    });

    card.append(title, box, desc, stepsList);
    resultsContainerEl.append(card);
  }

  function renderArchiveResult(archiveData) {
    const title = document.createElement('h3');
    title.className = 'assistant-result-title';
    title.textContent = archiveData.summary || 'Результаты поиска по заседаниям:';

    const list = document.createElement('div');
    list.className = 'assistant-matches-list';

    const matches = archiveData.matches || [];
    if (!matches.length) {
      list.innerHTML = '<p class="helper">Совпадений в доступных протоколах не найдено.</p>';
    } else {
      matches.forEach((m) => {
        const item = document.createElement('div');
        item.className = 'assistant-match-item';

        const head = document.createElement('div');
        head.className = 'assistant-match-head';
        head.innerHTML = `
          <span>Заседание ${m.meetingDate ? `от ${m.meetingDate}` : ''} ${m.protocolNumber ? `(Протокол № ${m.protocolNumber})` : ''}</span>
          ${m.itemNumber ? `<span class="count-pill">Вопрос № ${m.itemNumber}</span>` : ''}
        `;

        const titleP = document.createElement('div');
        titleP.style.fontSize = '13px';
        titleP.textContent = m.itemTitle || '';

        const quote = document.createElement('blockquote');
        quote.className = 'assistant-match-quote';
        quote.textContent = `«${m.quote}»`;

        item.append(head, titleP, quote);
        list.append(item);
      });
    }

    resultsContainerEl.append(title, list);
  }

  function renderHistoryView() {
    resultsContainerEl.innerHTML = '';
    resultsContainerEl.classList.remove('hidden');

    const history = getHistory();
    if (!history.length) {
      resultsContainerEl.innerHTML = '<p class="empty-state">История запросов пуста.</p>';
      return;
    }

    const header = document.createElement('div');
    header.className = 'assistant-result-header';
    header.innerHTML = `
      <h3 class="assistant-result-title">Недавние запросы (${history.length}):</h3>
      <button id="assistant-clear-history-btn" class="quiet-button" type="button">Очистить историю</button>
    `;

    header.querySelector('#assistant-clear-history-btn').addEventListener('click', () => {
      clearHistory();
      renderHistoryView();
    });

    const list = document.createElement('div');
    list.className = 'assistant-history-list';

    history.forEach((h) => {
      const item = document.createElement('div');
      item.className = 'assistant-history-item';
      const timeStr = new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      item.innerHTML = `
        <div>
          <strong>${h.mode === 'table-extract' ? 'Таблица' : h.mode === 'formula-calc' ? 'Формула' : 'Архив'}:</strong>
          <span>${h.query.slice(0, 70)}${h.query.length > 70 ? '…' : ''}</span>
        </div>
        <span class="count-pill">${timeStr}</span>
      `;
      item.addEventListener('click', () => {
        setMode(h.mode);
        textareaEl.value = h.query;
        updateCharCount();
        renderResult(h.result);
      });
      list.append(item);
    });

    resultsContainerEl.append(header, list);
  }

  function open() {
    ensureElements();
    backdropEl.classList.remove('hidden');
    sheetEl.classList.remove('hidden');
    textareaEl.focus();
    checkStatus();
  }

  function close() {
    if (!sheetEl) return;
    backdropEl.classList.add('hidden');
    sheetEl.classList.add('hidden');
    handleCancel();
  }

  function toggle() {
    ensureElements();
    if (sheetEl.classList.contains('hidden')) open();
    else close();
  }

  return { open, close, toggle, ensureElements };
}
