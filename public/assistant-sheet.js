// Assistant Sheet UI Controller · Kafedra Planner

const DRAFT_KEY = 'kafedra.assistant.draft';
const HISTORY_KEY = 'kafedra.assistant.history';
const FAVORITES_KEY = 'kafedra.assistant.favorites';
const MAX_HISTORY = 30;

const PRESETS = {
  'table-extract': [
    { label: '📋 Поручения и сроки', text: 'Поручить доценту Сидорову подготовить методические указания к 25 ноября. Профессору Иванову проверить готовность рабочих программ до 1 декабря.' },
    { label: '📚 Статьи и публикации', text: '1. Иванов И.И. Анализ данных в климатологии // Вестник науки. 2026. № 2. С. 45-52.\n2. Петров В.В., Сидоров А.А. Методы оценки влажности // Экологический мониторинг. 2026. Т. 14. С. 10-18.' },
    { label: '👥 Упоминания и роли', text: 'В заседании участвовали: зав. кафедрой Иванов И.И. (председатель), доц. Смирнова Е.А. (секретарь), проф. Кузнецов Д.В., аспирант Васильев А.С.' },
    { label: '📊 Учебная нагрузка', text: 'Преподаватель Петров В.В.: Лекции по базам данных — 36 часов, лабораторные работы — 64 часа, приём курсовых проектов — 18 часов. Семестр 1.' },
    { label: '🎓 Темы ВКР и рецензенты', text: '1. Студент Смирнов Д.А. «Разработка микросервиса аналитики», руководитель проф. Кузнецов Д.В., рецензент доц. Васильев.\n2. Студентка Белова Е.К. «Методы распознавания документов», руководитель доц. Петров.' }
  ],
  'protocol-analysis': [
    { label: '🏛️ Разбор протокола кафедры', text: 'ПРОТОКОЛ № 3 заседания кафедры от 15.10.2026.\nПредседатель: д.т.н., проф. Иванов И.И.\nСекретарь: к.т.н., доц. Смирнова Е.А.\nПрисутствовало: 11 из 14 (кворум имеется).\nСЛУШАЛИ:\n1. О готовности к зимней экзаменационной сессии. Докладчик: зам. зав. кафедрой доц. Петров В.В.\nПОСТАНОВИЛИ:\n1. Преподавателям кафедры провести контрольные срезы знаний студентов до 15.11.2026.\n2. Доц. Сидорову подготовить график консультаций и пересдач до 20.11.2026. Контроль возложить на зав. кафедрой.' },
    { label: '📋 Поручения по НИР и публикациям', text: 'ПРОТОКОЛ заседания кафедры от 22.09.2026.\nСЛУШАЛИ: отчёт о выполнении плана НИР и публикаций в изданиях ВАК и РИНЦ. Докладчик: проф. Кузнецов Д.В.\nПОСТАНОВИЛИ:\n1. Доц. Васильеву представить рукопись статьи по датчикам влажности до 01.12.2026.\n2. Секретарю сформировать сводную заявку на гранты РНФ до 15.12.2026.' },
    { label: '🎓 Утверждение тем ВКР', text: 'Заседание кафедры № 2 от 25.09.2026.\nПредседатель: проф. Иванов И.И. Секретарь: доц. Смирнова Е.А.\nПовестка: утверждение тем выпускных квалификационных работ специалистов и бакалавров.\nПОСТАНОВИЛИ:\nУтвердить темы ВКР согласно приложению. Научным руководителям выдать индивидуальные задания обучающимся до 10.10.2026.' },
    { label: '🔬 Аттестация аспирантов', text: 'СЛУШАЛИ: об итогах промежуточной аттестации аспирантов очной формы обучения за 2025/2026 уч. год.\nПОСТАНОВИЛИ:\nАттестовать аспиранта Смирнова А.В. Срок сдачи кандидатского минимума по специальности — 15 мая 2027 г.' }
  ],
  'report-synthesis': [
    { label: '📊 Отчёт по НИР за семестр', text: 'Подготовить раздел отчёта кафедры по научно-исследовательской работе за осенний семестр 2026 года: рассмотренные статьи и публикации ВАК/РИНЦ, поданные заявки на гранты и утверждённые темы исследований.' },
    { label: '📚 Учебно-методическая работа', text: 'Сформировать официальный раздел отчёта по учебно-методической работе кафедры: переработка РПД, подготовка методических указаний к лабораторным работам и проведение открытых лекций.' },
    { label: '👥 Кадры и квалификация', text: 'Составить раздел отчёта кафедры по повышению квалификации профессорско-преподавательского состава (ППС), стажировкам и защитам диссертаций в 2026 году.' },
    { label: '🎯 Итоги экзаменационной сессии', text: 'Подготовить аналитический раздел отчёта по результатам зимней экзаменационной сессии, успеваемости курсантов и ликвидации академических задолженностей.' }
  ],
  'compliance-check': [
    { label: '💡 Уточнение сроков и поручений', text: 'По вопросу 2 повестки дня постановили: активизировать научную деятельность преподавателей, завершить методические пособия как можно скорее, обратить внимание на посещаемость занятий.' },
    { label: 'ℹ️ Проверка кворума и явки', text: 'Протокол заседания кафедры.\nПрисутствовало: 6 человек из 15 штатных преподавателей.\nПредседатель: доц. Петров (врио).\nПОСТАНОВИЛИ: пересмотреть учебную нагрузку на следующий семестр, работу продолжать в плановом порядке.' },
    { label: '📝 Советы к проекту протокола', text: 'Протокол № 5 заседания кафедры от 20 октября 2026 г.\nПредседатель: Иванов И.И., секретарь: Смирнова Е.А.\nШтат: 12, присутствовало: 10.\nСлушали: О распределении нагрузки.\nПостановили: утвердить распределение часов на 2 семестр, ответственный: зав. кафедрой, срок: до 01.12.2026.' }
  ],
  'gap-repair': [
    { label: '🏛️ Заседание: пропуски дат и повестки', text: 'Заседание кафедры вычислительной техники.\nПрисутствовали: Иванов, Петров, Сидоров.\nПовестка дня:\n1. О подготовке к зимней сессии. Докладчик зав. кафедрой.\n2. Разное. Обсуждение закупки оборудования.' },
    { label: '📝 Протокол: проверка докладчиков и сроков', text: 'По вопросу 1 постановили: завершить приём задолженностей до конца месяца. Ответственным назначить зам. заведующего.' },
    { label: '⚠️ Анализ ошибки или неполного фрагмента', text: 'Ошибка при сохранении документа: отсутствуют обязательные реквизиты распоряжения: номер и дата издания документа.' },
    { label: '📅 Расчёт дат заседаний кафедры', text: 'Заседание кафедры состоялось в третий четверг октября 2026 года. Необходимо определить точную дату заседания и крайний срок сдачи выписок из протокола.' },
    { label: '👥 Проверка кворума и явки', text: 'Штатный состав кафедры: 14 человек. На заседании присутствовали: 9 преподавателей. Отсутствовали по уважительной причине: 3. Определить наличие кворума.' }
  ],
  'formula-calc': [
    { label: '🔍 ВПР по ФИО', text: 'Как написать формулу ВПР для подтягивания должности преподавателя по его ФИО из соседней таблицы на листе Справочник' },
    { label: '📊 Подсчёт часов (СУММЕСЛИМН)', text: 'Напиши формулу СУММЕСЛИМН для подсчёта суммы учебных часов преподавателя Иванова за весенний семестр' },
    { label: '🚦 Условное форматирование', text: 'Как в LibreOffice Calc выделить красным цветом ячейки со статусом "Не сдано" или сроком ранее сегодняшнего дня' },
    { label: '📈 Средний балл успеваемости', text: 'Формула для расчёта среднего балла студентов группы по дисциплине с округлением до двух знаков (СРЗНАЧ, ОКРУГЛ)' },
    { label: '⏱️ Рабочие дни до срока', text: 'Как рассчитать количество рабочих дней между сегодняшней датой и датой заседания кафедры с помощью ЧИСТРАБДНИ' }
  ],
  'archive-query': [
    { label: '💧 Статья о влажности', text: 'На каком заседании кафедры обсуждалась статья о влажности и какие решения были приняты?' },
    { label: '📋 Утверждение тем ВКР', text: 'Найти заседания, где утверждались темы выпускных квалификационных работ' },
    { label: '🎓 Отчёт по аспирантам', text: 'В каких протоколах рассматривалась аттестация аспирантов кафедры?' },
    { label: '🔬 Научные отчеты и гранты', text: 'В каком заседании кафедры рассматривались заявки на гранты РНФ и результаты НИР?' },
    { label: '🏛️ Закупка оборудования', text: 'На каком заседании кафедры обсуждалось оснащение лаборатории и закупка вычислительной техники?' }
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
    list.unshift({ ...item, id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, timestamp: Date.now() });
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

function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
  } catch {
    return [];
  }
}

function isFavorite(query) {
  const favs = getFavorites();
  return favs.some((f) => f.query === query);
}

function toggleFavorite(item) {
  try {
    const favs = getFavorites();
    const idx = favs.findIndex((f) => f.query === item.query);
    if (idx >= 0) {
      favs.splice(idx, 1);
    } else {
      favs.unshift({ ...item, id: `fav_${Date.now()}`, starredAt: Date.now() });
    }
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
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
  let contextBannerEl;
  let abortController = null;
  let currentMode = 'table-extract';
  let timerInterval = null;
  let activeHistoryFilter = 'all';

  function ensureElements() {
    if (sheetEl) return;

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
          <input type="text" id="assistant-setting-endpoint" placeholder="http://llm.52kaf.vka:8081 или http://127.0.0.1:8081">
        </div>
        <div class="assistant-settings-field">
          <div class="assistant-settings-label-row">
            <label for="assistant-setting-model">Модель:</label>
            <button id="assistant-refresh-models-btn" class="quiet-button small-button" type="button" title="Запросить список моделей с сервера">🔄 Обновить модели</button>
          </div>
          <div class="assistant-model-input-group">
            <input type="text" id="assistant-setting-model" list="assistant-models-datalist" placeholder="department-assistant или qwen">
            <datalist id="assistant-models-datalist"></datalist>
            <select id="assistant-models-select" class="assistant-models-select hidden" aria-label="Выбор модели из списка"></select>
          </div>
          <small class="assistant-field-help">Модели подтягиваются автоматически при проверке связи или нажатии «Обновить модели».</small>
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
        <div id="assistant-context-banner" class="assistant-context-banner hidden"></div>

        <nav class="assistant-modes" role="tablist" aria-label="Режимы ассистента">
          <button class="assistant-mode-tab active" type="button" data-mode="table-extract">Таблицы</button>
          <button class="assistant-mode-tab" type="button" data-mode="protocol-analysis">Разбор протокола</button>
          <button class="assistant-mode-tab" type="button" data-mode="report-synthesis">Составление отчёта</button>
          <button class="assistant-mode-tab" type="button" data-mode="archive-query">Поиск в архиве</button>
          <button class="assistant-mode-tab" type="button" data-mode="gap-repair">Пропуски и ошибки</button>
          <button class="assistant-mode-tab" type="button" data-mode="compliance-check">Подсказки к тексту</button>
          <button class="assistant-mode-tab" type="button" data-mode="formula-calc">Формулы Calc</button>
          <button class="assistant-mode-tab" type="button" data-mode="custom-prompts">Шаблоны промптов</button>
          <button class="assistant-mode-tab" type="button" data-mode="search-help">Справка по поиску</button>
          <button class="assistant-mode-tab" type="button" data-mode="history">История</button>
        </nav>

        <div id="assistant-presets-wrap" class="assistant-presets">
          <span class="assistant-preset-label">Примеры:</span>
          <div id="assistant-presets" class="assistant-presets-grid"></div>
        </div>

        <div class="assistant-input-card">
          <textarea id="assistant-input" class="assistant-textarea" placeholder="Вставьте сюда текст или напишите запрос..."></textarea>
          <div class="assistant-input-footer">
            <span id="assistant-char-count">0 символов</span>
            <span>Ctrl + Enter для запуска</span>
          </div>
        </div>

        <details id="assistant-prompt-accordion" class="assistant-prompt-accordion">
          <summary class="assistant-prompt-summary">⚙️ Настроить системный промпт (для экспертов)</summary>
          <div class="assistant-prompt-editor-body">
            <label for="assistant-custom-system-prompt">Системный промпт модели:</label>
            <textarea id="assistant-custom-system-prompt" class="assistant-system-textarea" rows="3" placeholder="Оставьте пустым для стандартного промпта режима..."></textarea>
            <div class="assistant-prompt-editor-actions">
              <button type="button" id="assistant-reset-system-prompt-btn" class="quiet-button small-button">Сбросить к стандартному</button>
            </div>
          </div>
        </details>

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
    contextBannerEl = sheetEl.querySelector('#assistant-context-banner');

    backdropEl.addEventListener('click', close);
    sheetEl.querySelector('#assistant-close-btn').addEventListener('click', close);

    statusBadgeEl.addEventListener('click', toggleSettings);
    settingsToggleBtn.addEventListener('click', toggleSettings);

    const testBtn = sheetEl.querySelector('#assistant-settings-test-btn');
    const saveBtn = sheetEl.querySelector('#assistant-settings-save-btn');
    const refreshModelsBtn = sheetEl.querySelector('#assistant-refresh-models-btn');
    const modelsSelect = sheetEl.querySelector('#assistant-models-select');

    testBtn.addEventListener('click', handleTestConnection);
    saveBtn.addEventListener('click', handleSaveSettings);
    refreshModelsBtn.addEventListener('click', handleRefreshModels);

    modelsSelect.addEventListener('change', () => {
      if (modelsSelect.value) {
        sheetEl.querySelector('#assistant-setting-model').value = modelsSelect.value;
      }
    });

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

  function updateModelsList(models, selectedModel) {
    const datalist = sheetEl.querySelector('#assistant-models-datalist');
    const select = sheetEl.querySelector('#assistant-models-select');
    const input = sheetEl.querySelector('#assistant-setting-model');
    if (!datalist || !select || !input) return;

    datalist.innerHTML = '';
    select.innerHTML = '<option value="">-- Выберите модель из списка --</option>';

    if (Array.isArray(models) && models.length > 0) {
      models.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        datalist.append(opt.cloneNode(true));
        select.append(opt);
      });
      select.classList.remove('hidden');

      const chosen = selectedModel || models[0];
      if (!input.value || input.value === 'local-model' || !models.includes(input.value)) {
        input.value = chosen;
        select.value = chosen;
      } else {
        select.value = input.value;
      }
    } else {
      select.classList.add('hidden');
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
        updateModelsList(data.models || [], data.suggestedModel || data.model);
      }
    } catch {}
  }

  async function handleRefreshModels() {
    ensureElements();
    const endpoint = sheetEl.querySelector('#assistant-setting-endpoint').value.trim();
    const apiKey = sheetEl.querySelector('#assistant-setting-apikey').value.trim();
    const feedback = sheetEl.querySelector('#assistant-settings-feedback');

    feedback.className = 'assistant-settings-feedback';
    feedback.textContent = 'Запрос списка моделей...';
    feedback.classList.remove('hidden');

    try {
      const resp = await fetch('/api/assistant/test-connection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, apiKey })
      });
      const data = await resp.json();
      if (data.ok && Array.isArray(data.models) && data.models.length > 0) {
        updateModelsList(data.models, data.selectedModel || data.models[0]);
        feedback.className = 'assistant-settings-feedback success';
        feedback.textContent = `✓ Найдено моделей: ${data.models.length} (${data.models.join(', ')}). Модель выбрана.`;
      } else {
        feedback.className = 'assistant-settings-feedback error';
        feedback.textContent = `✗ Не удалось получить список моделей: ${data.reason || data.status}`;
      }
    } catch (e) {
      feedback.className = 'assistant-settings-feedback error';
      feedback.textContent = `✗ Ошибка: ${e.message}`;
    }
  }

  async function handleTestConnection() {
    ensureElements();
    const feedback = sheetEl.querySelector('#assistant-settings-feedback');
    const endpoint = sheetEl.querySelector('#assistant-setting-endpoint').value.trim();
    const model = sheetEl.querySelector('#assistant-setting-model').value.trim();
    const apiKey = sheetEl.querySelector('#assistant-setting-apikey').value.trim();

    feedback.className = 'assistant-settings-feedback';
    feedback.textContent = 'Проверка соединения с сервером...';
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
        const models = data.models || [];
        updateModelsList(models, data.selectedModel);
        const modelInfo = models.length > 0 ? `Доступно моделей: ${models.length} (${models.join(', ')}). Модель подтянута автоматом.` : 'Сервер ответил (список моделей пуст).';
        feedback.textContent = `✓ Соединение успешно (${data.latencyMs} мс). ${modelInfo}`;
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
    feedback.textContent = 'Сохранение настроек...';
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
        feedback.textContent = '✓ Настройки успешно сохранены';
        checkStatus();
        setTimeout(() => {
          feedback.classList.add('hidden');
          settingsPanelEl.classList.add('hidden');
        }, 1200);
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
    const isCustomPrompts = mode === 'custom-prompts';
    const isSearchHelp = mode === 'search-help';
    const isSpecialView = isHistory || isCustomPrompts || isSearchHelp;
    sheetEl.querySelector('#assistant-presets-wrap').classList.toggle('hidden', isSpecialView);
    sheetEl.querySelector('.assistant-input-card').classList.toggle('hidden', isSpecialView);
    sheetEl.querySelector('#assistant-prompt-accordion')?.classList.toggle('hidden', isSpecialView);
    sheetEl.querySelector('.assistant-actions').classList.toggle('hidden', isSpecialView);

    if (isHistory) {
      renderHistoryView();
    } else if (isCustomPrompts) {
      renderCustomPromptsView();
    } else if (isSearchHelp) {
      renderSearchHelpView();
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
      textareaEl.placeholder = 'Вставьте неформатированный текст (поручения, список статей, учебную нагрузку)...';
    } else if (currentMode === 'protocol-analysis') {
      textareaEl.placeholder = 'Вставьте текст или черновик протокола заседания (СЛУШАЛИ / ПОСТАНОВИЛИ)...';
    } else if (currentMode === 'report-synthesis') {
      textareaEl.placeholder = 'Опишите тему отчёта (НИР, УМР, кадры, сессия) или перечислите факты для синтеза раздела...';
    } else if (currentMode === 'archive-query') {
      textareaEl.placeholder = 'Напишите вопрос по протоколам и заседаниям кафедры (например: на каком заседании обсуждалась статья о влажности)...';
    } else if (currentMode === 'gap-repair') {
      textareaEl.placeholder = 'Вставьте фрагмент заседания, протокол или ошибку для выявления пропусков и исправления...';
    } else if (currentMode === 'compliance-check') {
      textareaEl.placeholder = 'Вставьте текст протокола или решения для получения доброжелательных подсказок и вариантов улучшений...';
    } else if (currentMode === 'formula-calc') {
      textareaEl.placeholder = 'Опишите задачу для Calc / Excel (например: формула ВПР по ФИО, подсчёт учебных часов по семестрам)...';
    }
  }

  function renderPresets() {
    const list = PRESETS[currentMode] || [];
    presetsContainerEl.innerHTML = '';
    list.forEach((p) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'assistant-preset-chip';
      chip.textContent = p.label;
      chip.title = p.text.slice(0, 160);
      chip.addEventListener('click', () => {
        textareaEl.value = p.text;
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
      localStorage.setItem(`${DRAFT_KEY}.${currentMode}`, textareaEl.value);
    } catch {}
  }

  function restoreDraft() {
    try {
      const saved = localStorage.getItem(`${DRAFT_KEY}.${currentMode}`);
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
        if (data.enabled && (data.status === 'ready' || data.status === 'model_not_in_list')) {
          const lat = data.latencyMs ? ` (${data.latencyMs} мс)` : '';
          statusBadgeEl.textContent = `● В сети${lat}`;
          statusBadgeEl.className = 'assistant-status-badge ready';
          statusBadgeEl.title = `Сервер: ${data.endpoint || 'локальный'}\nМодель: ${data.model}${data.suggestedModel && data.suggestedModel !== data.model ? `\nДоступна: ${data.suggestedModel}` : ''}`;
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

    resultsContainerEl.innerHTML = `
      <div class="assistant-progress-card">
        <div class="assistant-progress-header">
          <div class="assistant-progress-spinner"></div>
          <div class="assistant-progress-title" id="assistant-progress-stage">
            ${currentMode === 'archive-query' ? '1. Поиск документов в архиве кафедры...' : '1. Анализ текста и подготовка контекста...'}
          </div>
          <div class="assistant-progress-timer" id="assistant-progress-timer">0 с</div>
        </div>
        <div class="assistant-progress-bar-wrap">
          <div class="assistant-progress-bar" id="assistant-progress-bar"></div>
        </div>
        <div class="assistant-progress-steps">
          <div class="assistant-step active" id="ast-step-1">1. ${currentMode === 'archive-query' ? 'Поиск протоколов и решений в архиве' : 'Анализ входного текста'}</div>
          <div class="assistant-step" id="ast-step-2">2. Извлечение цитат и подготовка контекста</div>
          <div class="assistant-step" id="ast-step-3">3. Генерация ответа локальной нейросетью</div>
          <div class="assistant-step" id="ast-step-4">4. Проверка реквизитов и формул</div>
        </div>
        <p class="assistant-progress-note">
          💡 Локальная модель работает полностью автономно на сервере кафедры (CPU). При сложных запросах генерация занимает 15–45 секунд.
        </p>
      </div>
    `;

    const stageEl = resultsContainerEl.querySelector('#assistant-progress-stage');
    const timerEl = resultsContainerEl.querySelector('#assistant-progress-timer');
    const barEl = resultsContainerEl.querySelector('#assistant-progress-bar');
    const step1 = resultsContainerEl.querySelector('#ast-step-1');
    const step2 = resultsContainerEl.querySelector('#ast-step-2');
    const step3 = resultsContainerEl.querySelector('#ast-step-3');
    const step4 = resultsContainerEl.querySelector('#ast-step-4');

    timerInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      processBtn.textContent = `Обработка... (${elapsed} с)`;
      if (timerEl) timerEl.textContent = `${elapsed} с`;

      if (elapsed < 3) {
        if (stageEl) stageEl.textContent = currentMode === 'archive-query' ? '1. Поиск документов в архиве кафедры...' : '1. Анализ входного текста...';
        if (barEl) barEl.className = 'assistant-progress-bar progress-p25';
      } else if (elapsed < 8) {
        if (step1) { step1.classList.remove('active'); step1.classList.add('completed'); }
        if (step2) step2.classList.add('active');
        if (stageEl) stageEl.textContent = '2. Извлечение фрагментов и подготовка промпта...';
        if (barEl) barEl.className = 'assistant-progress-bar progress-p50';
      } else {
        if (step2) { step2.classList.remove('active'); step2.classList.add('completed'); }
        if (step3) step3.classList.add('active');
        if (stageEl) stageEl.textContent = `3. Генерация ответа нейросетью (${elapsed} с)...`;
        if (barEl) barEl.className = 'assistant-progress-bar progress-p90';
      }
    }, 1000);

    try {
      const customSystemPrompt = sheetEl.querySelector('#assistant-custom-system-prompt')?.value?.trim() || undefined;
      const resp = await fetch('/api/assistant/process', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          task: currentMode,
          text: (currentMode === 'table-extract' || currentMode === 'gap-repair') ? text : undefined,
          query: (currentMode !== 'table-extract' && currentMode !== 'gap-repair') ? text : undefined,
          customSystemPrompt
        }),
        signal: abortController.signal
      });

      clearInterval(timerInterval);
      processBtn.textContent = 'Обработать';
      processBtn.disabled = false;
      cancelBtn.classList.add('hidden');

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        resultsContainerEl.innerHTML = `<p class="error-text">Ошибка HTTP ${resp.status}: ${errorData.message || 'Сбой обработки запроса'}</p>`;
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

      if (step3) { step3.classList.remove('active'); step3.classList.add('completed'); }
      if (step4) step4.classList.add('completed');
      if (barEl) barEl.className = 'assistant-progress-bar progress-p100';

      renderResult(data.result, {
        prompt: data.prompt,
        rawResponse: data.rawResponse,
        durationMs: data.durationMs
      });
      saveHistoryItem({ mode: currentMode, query: text, result: data.result, success: true });
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

  function escapeHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderResult(result, meta = {}) {
    resultsContainerEl.innerHTML = '';
    if (result.type === 'table') {
      renderTableResult(result);
    } else if (result.type === 'gap-repair') {
      renderGapRepairResult(result);
    } else if (result.type === 'formula') {
      renderFormulaResult(result);
    } else if (result.type === 'archive-matches') {
      renderArchiveMatches(result);
    } else if (result.type === 'protocol-analysis') {
      renderProtocolAnalysisResult(result);
    } else if (result.type === 'report-synthesis') {
      renderReportSynthesisResult(result);
    } else if (result.type === 'compliance-check') {
      renderComplianceCheckResult(result);
    } else if (result.type === 'search-refine') {
      renderSearchRefineResult(result);
    }
    if (meta && (meta.prompt || meta.rawResponse)) {
      renderInspectorCard(meta);
    }
  }

  function renderInspectorCard(meta) {
    const card = document.createElement('details');
    card.className = 'assistant-prompt-inspector';
    card.innerHTML = `
      <summary class="assistant-inspector-summary">
        <span>🔍 Параметры запроса и ответ модели</span>
        <small>${meta.durationMs ? `${meta.durationMs} мс` : ''}</small>
      </summary>
      <div class="assistant-inspector-content">
        ${meta.prompt?.system ? `
          <div class="assistant-inspector-block">
            <strong>Системный промпт:</strong>
            <pre>${escapeHtml(meta.prompt.system)}</pre>
          </div>
        ` : ''}
        ${meta.prompt?.user ? `
          <div class="assistant-inspector-block">
            <strong>Переданный контекст (User prompt):</strong>
            <pre>${escapeHtml(meta.prompt.user)}</pre>
          </div>
        ` : ''}
        ${meta.rawResponse ? `
          <div class="assistant-inspector-block">
            <div class="assistant-inspector-head">
              <strong>Сырой ответ модели (verbatim):</strong>
              <button type="button" class="quiet-button small-button" id="ast-copy-raw-btn">Копировать</button>
            </div>
            <pre>${escapeHtml(meta.rawResponse)}</pre>
          </div>
        ` : ''}
      </div>
    `;
    const copyBtn = card.querySelector('#ast-copy-raw-btn');
    if (copyBtn && meta.rawResponse) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(meta.rawResponse).then(() => showToast('Сырой ответ скопирован'));
      });
    }
    resultsContainerEl.append(card);
  }

  const CUSTOM_PROMPTS_KEY = 'kafedra.assistant.custom_prompts';
  const DEFAULT_CUSTOM_PROMPTS = [
    {
      id: 'cp_agenda',
      title: '📋 Формирование повестки заседания',
      mode: 'protocol-analysis',
      tag: 'Заседания',
      description: 'Анализирует текст и формирует повестку с докладчиками и проектами решений.',
      template: 'ПРОТОКОЛ заседания кафедры.\nПовестка дня:\n1. О распределении учебной нагрузки на весенний семестр.\n2. Об утверждении тем выпускных квалификационных работ бакалавров.\n3. Разное.'
    },
    {
      id: 'cp_extract',
      title: '🎓 Выписка из протокола (ГОСТ)',
      mode: 'compliance-check',
      tag: 'Документы',
      description: 'Проверка формулировок и реквизитов выписки из протокола кафедры.',
      template: 'ВЫПИСКА ИЗ ПРОТОКОЛА № 3 заседания кафедры от 15.10.2026.\nСЛУШАЛИ: об утверждении темы выпускной квалификационной работы студента Смирнова.\nПОСТАНОВИЛИ: тему утвердить, руководителем назначить доц. Петрова.'
    },
    {
      id: 'cp_archive',
      title: '🔍 Поиск решений по аспирантам',
      mode: 'archive-query',
      tag: 'Поиск',
      description: 'Находит все заседания и протоколы, где обсуждалась аттестация аспирантов.',
      template: 'На каком заседании кафедры утверждалась аттестация аспирантов и какие сроки были установлены?'
    },
    {
      id: 'cp_report_nir',
      title: '📊 Синтез раздела отчёта по НИР',
      mode: 'report-synthesis',
      tag: 'Отчёты',
      description: 'Генерирует связный официальный раздел кафедрального отчёта по научной работе.',
      template: 'Составить раздел отчёта кафедры по научно-исследовательской работе: публикации в изданиях ВАК и РИНЦ, поданные грантовые заявки и участие в конференциях.'
    },
    {
      id: 'cp_formula_vpr',
      title: '📐 Формула Calc: ВПР по преподавателю',
      mode: 'formula-calc',
      tag: 'Формулы',
      description: 'Составляет формулу ВПР или ИНДЕКС/ПОИСКПОЗ для подтягивания должности преподавателя.',
      template: 'Как написать формулу ВПР для подтягивания должности преподавателя по его ФИО из соседней таблицы на листе Справочник'
    }
  ];

  function getCustomPrompts() {
    try {
      const saved = JSON.parse(localStorage.getItem(CUSTOM_PROMPTS_KEY) || '[]');
      return [...DEFAULT_CUSTOM_PROMPTS, ...saved];
    } catch {
      return DEFAULT_CUSTOM_PROMPTS;
    }
  }

  function saveCustomPrompt(item) {
    try {
      const saved = JSON.parse(localStorage.getItem(CUSTOM_PROMPTS_KEY) || '[]');
      saved.unshift({ ...item, id: `user_${Date.now()}` });
      localStorage.setItem(CUSTOM_PROMPTS_KEY, JSON.stringify(saved));
    } catch {}
  }

  function renderCustomPromptsView() {
    resultsContainerEl.classList.remove('hidden');
    resultsContainerEl.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'assistant-custom-prompts-container';

    const header = document.createElement('div');
    header.className = 'assistant-history-header';
    header.innerHTML = `
      <div><strong>Шаблоны промптов</strong><span>Библиотека готовых кафедральных запросов и свои шаблоны</span></div>
      <button type="button" class="secondary-button" id="ast-add-prompt-btn">＋ Свой шаблон</button>
    `;
    container.append(header);

    const prompts = getCustomPrompts();
    const list = document.createElement('div');
    list.className = 'assistant-custom-prompts-list';

    prompts.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'assistant-custom-prompt-card';
      card.innerHTML = `
        <div class="assistant-custom-prompt-head">
          <strong>${escapeHtml(p.title)}</strong>
          <span class="assistant-custom-prompt-tag">${escapeHtml(p.tag || 'Общий')}</span>
        </div>
        <div class="assistant-custom-prompt-desc">${escapeHtml(p.description || '')}</div>
        <div class="assistant-custom-prompt-actions">
          <button type="button" class="primary-button" data-run-prompt="${escapeHtml(p.id)}">Использовать шаблон</button>
        </div>
      `;
      card.querySelector('[data-run-prompt]')?.addEventListener('click', () => {
        setMode(p.mode || 'table-extract');
        textareaEl.value = p.template || '';
        updateCharCount();
        saveDraft();
        textareaEl.focus();
      });
      list.append(card);
    });
    container.append(list);

    header.querySelector('#ast-add-prompt-btn')?.addEventListener('click', () => {
      const title = prompt('Название вашего шаблона промпта:');
      if (!title || !title.trim()) return;
      const desc = prompt('Краткое описание:') || '';
      saveCustomPrompt({
        title: title.trim(),
        description: desc.trim(),
        mode: currentMode,
        tag: 'Пользовательский',
        template: textareaEl.value || ''
      });
      renderCustomPromptsView();
      showToast('Шаблон сохранён');
    });

    resultsContainerEl.append(container);
  }

  function renderSearchHelpView() {
    resultsContainerEl.classList.remove('hidden');
    resultsContainerEl.innerHTML = `
      <div class="assistant-help-card">
        <h3>📚 Руководство: как искать по документам и протоколам</h3>
        <div class="assistant-help-section">
          <h4>1. Полнотекстовый поиск в архиве кафедры</h4>
          <p>В строке поиска или в режиме «Поиск в архиве» введите ключевые слова: например, <code>влажность статья</code> или <code>аттестация аспирантов</code>. Индекс FTS5 находит совпадения по всем протоколам, решениям и планам кафедры с учётом словоформ русского языка.</p>
        </div>
        <div class="assistant-help-section">
          <h4>2. Поиск точной цитаты или словосочетания</h4>
          <p>Заключите фразу в двойные кавычки: <code>"учебная нагрузка"</code> или <code>"экзаменационная сессия"</code>. Система найдёт точное вхождение слов именно в этом порядке.</p>
        </div>
        <div class="assistant-help-section">
          <h4>3. Логическое ИЛИ (OR) для синонимов</h4>
          <p>Соединяйте синонимы через <code>OR</code>: <code>статья OR публикация OR вестник</code>. Это позволяет охватить различные формулировки одной темы.</p>
        </div>
        <div class="assistant-help-section">
          <h4>4. Переход к исходному оригиналу документа</h4>
          <p>Каждое совпадение и каждая цитата в ответе ассистента снабжены ссылкой на оригинал. Нажмите её, чтобы просмотреть оригинальный неизменяемый DOCX, ODT или PDF-скан.</p>
        </div>
        <div class="assistant-help-section">
          <h4>5. Автоматическая помощь нейросети</h4>
          <p>Локальная нейросеть анализирует найденные фрагменты, отсекает нерелевантные упоминания и формулирует ответ по существу вопроса с точным указанием номера протокола и даты заседания.</p>
        </div>
      </div>
    `;
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
          itemTitleEl.style.fontWeight = '600';
          itemTitleEl.style.marginTop = '4px';
          itemTitleEl.textContent = m.itemTitle;
          card.append(itemTitleEl);
        }

        if (m.quote) {
          const quoteEl = document.createElement('blockquote');
          quoteEl.className = 'assistant-match-quote';
          quoteEl.textContent = `«${m.quote}»`;
          card.append(quoteEl);
        }

        const actionsRow = document.createElement('div');
        actionsRow.className = 'assistant-match-actions';

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'quiet-button small-button';
        copyBtn.textContent = '📋 Скопировать реквизиты';
        copyBtn.addEventListener('click', async () => {
          const textToCopy = `Протокол заседания кафедры № ${m.protocolNumber || 'б/н'} от ${m.meetingDate || 'б/д'}${m.itemNumber ? `, вопрос ${m.itemNumber}` : ''}: ${m.quote || m.itemTitle || ''}`;
          try {
            await navigator.clipboard.writeText(textToCopy);
            showToast('Реквизиты заседания скопированы в буфер');
          } catch {
            showToast('Не удалось скопировать');
          }
        });

        actionsRow.append(copyBtn);

        if (m.meetingId) {
          const openMeetingBtn = document.createElement('button');
          openMeetingBtn.type = 'button';
          openMeetingBtn.className = 'secondary-button small-button';
          openMeetingBtn.textContent = '👁️ Открыть заседание';
          openMeetingBtn.addEventListener('click', () => {
            close();
            window.dispatchEvent(new CustomEvent('kafedra:open-meeting', { detail: { meetingId: m.meetingId } }));
            window.dispatchEvent(new CustomEvent('kafedra:view-changed', { detail: { view: 'meetings' } }));
            if (window.location.hash !== '#meetings') {
              window.location.hash = '#meetings';
            }
          });
          actionsRow.append(openMeetingBtn);
        }

        card.append(actionsRow);
        wrap.append(card);
      });
    }

    resultsContainerEl.append(wrap);
  }

  function renderProtocolAnalysisResult(data) {
    const wrap = document.createElement('div');
    wrap.className = 'assistant-protocol-wrap';

    const headerCard = document.createElement('div');
    headerCard.className = 'assistant-protocol-header-card';

    const numPart = data.meetingNumber ? `Протокол № ${data.meetingNumber}` : 'Протокол заседания кафедры';
    const datePart = data.meetingDate ? ` от ${data.meetingDate}` : '';
    const titleEl = document.createElement('h3');
    titleEl.className = 'assistant-protocol-title';
    titleEl.textContent = `${numPart}${datePart}`;
    headerCard.append(titleEl);

    const metaRow = document.createElement('div');
    metaRow.className = 'assistant-protocol-meta';
    if (data.chairman) {
      const chEl = document.createElement('span');
      chEl.className = 'assistant-meta-badge';
      chEl.textContent = `Председатель: ${data.chairman}`;
      metaRow.append(chEl);
    }
    if (data.secretary) {
      const secEl = document.createElement('span');
      secEl.className = 'assistant-meta-badge';
      secEl.textContent = `Секретарь: ${data.secretary}`;
      metaRow.append(secEl);
    }
    if (data.quorum) {
      const qEl = document.createElement('span');
      qEl.className = 'assistant-meta-badge';
      qEl.textContent = `Кворум: ${data.quorum}`;
      metaRow.append(qEl);
    }
    headerCard.append(metaRow);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'secondary-button small-button';
    copyBtn.textContent = '📋 Скопировать решения и поручения';
    copyBtn.addEventListener('click', async () => {
      const lines = [];
      lines.push(`${numPart}${datePart}`);
      (data.agenda || []).forEach((ag) => {
        lines.push(`\nВопрос ${ag.itemNumber}. ${ag.topic}`);
        if (ag.speaker) lines.push(`Докладчик: ${ag.speaker}`);
        (ag.decisions || []).forEach((dec, idx) => {
          const dl = dec.deadline ? ` (Срок: ${dec.deadline})` : '';
          const as = dec.assignee ? ` [Ответственный: ${dec.assignee}]` : '';
          lines.push(`  ${idx + 1}. ${dec.action}${as}${dl}`);
        });
      });
      try {
        await navigator.clipboard.writeText(lines.join('\n'));
        showToast('Поручения скопированы в буфер');
      } catch {
        showToast('Не удалось скопировать');
      }
    });
    headerCard.append(copyBtn);
    wrap.append(headerCard);

    const agendaList = data.agenda || [];
    if (agendaList.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'helper';
      empty.textContent = 'Повестка дня и принятые решения в тексте не распознаны.';
      wrap.append(empty);
    } else {
      agendaList.forEach((ag) => {
        const itemCard = document.createElement('div');
        itemCard.className = 'assistant-agenda-card';

        const agHead = document.createElement('div');
        agHead.className = 'assistant-agenda-head';
        agHead.innerHTML = `<strong>Вопрос ${ag.itemNumber}:</strong> ${ag.topic || 'Без названия'}`;
        itemCard.append(agHead);

        if (ag.speaker) {
          const spk = document.createElement('div');
          spk.className = 'assistant-agenda-speaker';
          spk.textContent = `Докладчик: ${ag.speaker}`;
          itemCard.append(spk);
        }

        const decList = ag.decisions || [];
        if (decList.length > 0) {
          const decTitle = document.createElement('div');
          decTitle.className = 'assistant-decision-title';
          decTitle.textContent = 'Постановления и поручения:';
          itemCard.append(decTitle);

          const ol = document.createElement('ol');
          ol.className = 'assistant-decision-list';
          decList.forEach((d) => {
            const li = document.createElement('li');
            li.className = 'assistant-decision-item';

            const actionSpan = document.createElement('div');
            actionSpan.className = 'assistant-decision-action';
            actionSpan.textContent = d.action;
            li.append(actionSpan);

            const decMeta = document.createElement('div');
            decMeta.className = 'assistant-decision-meta';
            if (d.assignee) {
              const assBadge = document.createElement('span');
              assBadge.className = 'assistant-assignee-badge';
              assBadge.textContent = `👤 ${d.assignee}`;
              decMeta.append(assBadge);
            }
            if (d.deadline) {
              const dlBadge = document.createElement('span');
              dlBadge.className = 'assistant-deadline-badge';
              dlBadge.textContent = `📅 Срок: ${d.deadline}`;
              decMeta.append(dlBadge);
            }
            if (d.control) {
              const ctrlBadge = document.createElement('span');
              ctrlBadge.className = 'assistant-control-badge';
              ctrlBadge.textContent = `Контроль: ${d.control}`;
              decMeta.append(ctrlBadge);
            }
            li.append(decMeta);
            ol.append(li);
          });
          itemCard.append(ol);
        }

        wrap.append(itemCard);
      });
    }

    resultsContainerEl.append(wrap);
  }

  function renderReportSynthesisResult(data) {
    const wrap = document.createElement('div');
    wrap.className = 'assistant-report-wrap';

    const header = document.createElement('div');
    header.className = 'assistant-report-header';

    const titleEl = document.createElement('h3');
    titleEl.className = 'assistant-report-title';
    titleEl.textContent = data.sectionTitle || 'Раздел отчёта кафедры';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'secondary-button small-button';
    copyBtn.textContent = '📋 Скопировать раздел отчёта';
    copyBtn.addEventListener('click', async () => {
      const parts = [data.sectionTitle || ''];
      if (data.executiveSummary) parts.push(`Сводка:\n${data.executiveSummary}`);
      if (Array.isArray(data.paragraphs)) parts.push(data.paragraphs.join('\n\n'));
      if (Array.isArray(data.facts) && data.facts.length) {
        parts.push('\nКлючевые показатели:');
        data.facts.forEach((f) => parts.push(`- ${f.label}: ${f.value} (${f.source || ''})`));
      }
      if (Array.isArray(data.conclusions) && data.conclusions.length) {
        parts.push('\nВыводы:');
        data.conclusions.forEach((c) => parts.push(`- ${c}`));
      }
      try {
        await navigator.clipboard.writeText(parts.join('\n\n'));
        showToast('Текст отчёта скопирован');
      } catch {
        showToast('Не удалось скопировать');
      }
    });

    header.append(titleEl, copyBtn);
    wrap.append(header);

    if (data.executiveSummary) {
      const sumCard = document.createElement('div');
      sumCard.className = 'assistant-summary-card';
      sumCard.innerHTML = `<strong>Сводка:</strong> ${data.executiveSummary}`;
      wrap.append(sumCard);
    }

    if (Array.isArray(data.paragraphs) && data.paragraphs.length > 0) {
      const pWrap = document.createElement('div');
      pWrap.className = 'assistant-report-paragraphs';
      data.paragraphs.forEach((pText) => {
        const p = document.createElement('p');
        p.className = 'assistant-report-p';
        p.textContent = pText;
        pWrap.append(p);
      });
      wrap.append(pWrap);
    }

    if (Array.isArray(data.facts) && data.facts.length > 0) {
      const factsCard = document.createElement('div');
      factsCard.className = 'assistant-report-facts';
      const fHead = document.createElement('strong');
      fHead.textContent = 'Ключевые факты и источники:';
      factsCard.append(fHead);

      const fGrid = document.createElement('div');
      fGrid.className = 'assistant-facts-grid';
      data.facts.forEach((f) => {
        const chip = document.createElement('div');
        chip.className = 'assistant-fact-chip';
        chip.innerHTML = `
          <div class="assistant-fact-label">${f.label}</div>
          <div class="assistant-fact-value">${f.value}</div>
          <div class="assistant-fact-source">${f.source || ''}</div>
        `;
        fGrid.append(chip);
      });
      factsCard.append(fGrid);
      wrap.append(factsCard);
    }

    if (Array.isArray(data.conclusions) && data.conclusions.length > 0) {
      const concCard = document.createElement('div');
      concCard.className = 'assistant-conclusions-card';
      concCard.innerHTML = '<strong>Выводы:</strong>';
      const ul = document.createElement('ul');
      data.conclusions.forEach((c) => {
        const li = document.createElement('li');
        li.textContent = c;
        ul.append(li);
      });
      concCard.append(ul);
      wrap.append(concCard);
    }

    resultsContainerEl.append(wrap);
  }

  function renderComplianceCheckResult(data) {
    const wrap = document.createElement('div');
    wrap.className = 'assistant-compliance-wrap';

    const banner = document.createElement('div');
    banner.className = 'assistant-compliance-banner friendly';
    banner.innerHTML = `
      <div class="assistant-compliance-icon">💡</div>
      <div class="assistant-compliance-info">
        <div class="assistant-compliance-headline">${data.summary || 'Советы и подсказки к оформлению'}</div>
        <div class="assistant-compliance-subline">Все подсказки носят рекомендательный характер. Вы можете применить предложенную формулировку кликом на «Принять» или оставить свой вариант без изменений.</div>
      </div>
    `;
    wrap.append(banner);

    const items = data.suggestions || data.checks || [];
    const fixableItems = items.filter((it) => it.suggestedFix);

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<p>✓ Все основные реквизиты и формулировки в порядке. Дополнительных рекомендаций нет.</p>';
      wrap.append(empty);
    } else {
      if (fixableItems.length > 0) {
        const toolbar = document.createElement('div');
        toolbar.className = 'assistant-compliance-toolbar';

        const applyAllBtn = document.createElement('button');
        applyAllBtn.type = 'button';
        applyAllBtn.className = 'primary-button small-button assistant-apply-all-btn';
        applyAllBtn.textContent = '✓ Принять все предложения';
        applyAllBtn.title = 'Заменить все неточные формулировки в тексте на предложенные';

        const copyAllBtn = document.createElement('button');
        copyAllBtn.type = 'button';
        copyAllBtn.className = 'secondary-button small-button';
        copyAllBtn.textContent = '📋 Скопировать список советов';

        toolbar.append(applyAllBtn, copyAllBtn);
        wrap.append(toolbar);

        const cardRefList = [];

        applyAllBtn.addEventListener('click', () => {
          let text = textareaEl.value;
          fixableItems.forEach((f) => {
            if (f.sourceQuote && text.includes(f.sourceQuote)) {
              text = text.replace(f.sourceQuote, f.suggestedFix);
            } else if (!text.includes(f.suggestedFix)) {
              text = `${text}\n${f.suggestedFix}`;
            }
          });
          textareaEl.value = text;
          updateCharCount();
          saveDraft();

          cardRefList.forEach(({ card, applyBtn, badge }) => {
            card.classList.add('applied');
            if (badge) {
              badge.className = 'assistant-check-badge ok applied';
              badge.textContent = '✓ Принято';
            }
            if (applyBtn) {
              applyBtn.textContent = '✓ Применено';
              applyBtn.disabled = true;
            }
          });

          applyAllBtn.textContent = '✓ Все предложения приняты';
          applyAllBtn.disabled = true;
          showToast('Все предложенные формулировки внесены в текст');
        });

        copyAllBtn.addEventListener('click', async () => {
          const lines = [data.summary || 'Советы к оформлению документа:'];
          items.forEach((it, idx) => {
            lines.push(`\n${idx + 1}. ${it.rule}: ${it.details}`);
            if (it.suggestedFix) lines.push(`   Предлагаемый вариант: ${it.suggestedFix}`);
          });
          try {
            await navigator.clipboard.writeText(lines.join('\n'));
            showToast('Список советов скопирован');
          } catch {
            showToast('Не удалось скопировать');
          }
        });

        const chWrap = document.createElement('div');
        chWrap.className = 'assistant-checks-list';

        items.forEach((c) => {
          const card = document.createElement('div');
          card.className = `assistant-check-card status-${c.status || 'suggestion'}`;

          const head = document.createElement('div');
          head.className = 'assistant-check-head';

          const title = document.createElement('span');
          title.className = 'assistant-check-rule';
          title.textContent = c.rule;

          const badge = document.createElement('span');
          badge.className = `assistant-check-badge ${c.status || 'suggestion'}`;
          badge.textContent = c.status === 'ok' ? '✓ Оформлено' : c.status === 'notice' ? 'ℹ️ Примечание' : '💡 Рекомендация';

          head.append(title, badge);
          card.append(head);

          if (c.details) {
            const dt = document.createElement('div');
            dt.className = 'assistant-check-details';
            dt.textContent = c.details;
            card.append(dt);
          }

          if (c.sourceQuote) {
            const q = document.createElement('blockquote');
            q.className = 'assistant-check-quote';
            q.textContent = `В исходном тексте: «${c.sourceQuote}»`;
            card.append(q);
          }

          let cardApplyBtn = null;
          if (c.suggestedFix) {
            const fixBox = document.createElement('div');
            fixBox.className = 'assistant-suggested-fix-box';

            const fixHeader = document.createElement('div');
            fixHeader.className = 'assistant-fix-label';
            fixHeader.textContent = 'Предлагаемый вариант формулировки:';

            const fixCode = document.createElement('div');
            fixCode.className = 'assistant-fix-code';
            fixCode.textContent = c.suggestedFix;

            const fixActions = document.createElement('div');
            fixActions.className = 'assistant-fix-actions';

            cardApplyBtn = document.createElement('button');
            cardApplyBtn.type = 'button';
            cardApplyBtn.className = 'quiet-button small-button assistant-accept-fix-btn';
            cardApplyBtn.textContent = '✓ Принять формулировку';
            cardApplyBtn.title = 'Заменить исходную фразу на этот вариант';

            const copyFixBtn = document.createElement('button');
            copyFixBtn.type = 'button';
            copyFixBtn.className = 'quiet-button small-button';
            copyFixBtn.textContent = '📋';
            copyFixBtn.title = 'Скопировать формулировку';

            cardApplyBtn.addEventListener('click', () => {
              if (c.sourceQuote && textareaEl.value.includes(c.sourceQuote)) {
                textareaEl.value = textareaEl.value.replace(c.sourceQuote, c.suggestedFix);
              } else if (!textareaEl.value.includes(c.suggestedFix)) {
                textareaEl.value = `${textareaEl.value}\n${c.suggestedFix}`;
              }
              updateCharCount();
              saveDraft();
              card.classList.add('applied');
              badge.className = 'assistant-check-badge ok applied';
              badge.textContent = '✓ Принято';
              cardApplyBtn.textContent = '✓ Применено';
              cardApplyBtn.disabled = true;
              showToast(`Принято: ${c.rule}`);
            });

            copyFixBtn.addEventListener('click', async () => {
              try {
                await navigator.clipboard.writeText(c.suggestedFix);
                showToast('Формулировка скопирована');
              } catch {
                showToast('Не удалось скопировать');
              }
            });

            fixActions.append(cardApplyBtn, copyFixBtn);
            fixBox.append(fixHeader, fixCode, fixActions);
            card.append(fixBox);
          }

          cardRefList.push({ card, applyBtn: cardApplyBtn, badge });
          chWrap.append(card);
        });

        wrap.append(chWrap);
      } else {
        const chWrap = document.createElement('div');
        chWrap.className = 'assistant-checks-list';

        items.forEach((c) => {
          const card = document.createElement('div');
          card.className = `assistant-check-card status-${c.status || 'suggestion'}`;

          const head = document.createElement('div');
          head.className = 'assistant-check-head';

          const title = document.createElement('span');
          title.className = 'assistant-check-rule';
          title.textContent = c.rule;

          const badge = document.createElement('span');
          badge.className = `assistant-check-badge ${c.status || 'suggestion'}`;
          badge.textContent = c.status === 'ok' ? '✓ Оформлено' : c.status === 'notice' ? 'ℹ️ Примечание' : '💡 Рекомендация';

          head.append(title, badge);
          card.append(head);

          if (c.details) {
            const dt = document.createElement('div');
            dt.className = 'assistant-check-details';
            dt.textContent = c.details;
            card.append(dt);
          }

          if (c.sourceQuote) {
            const q = document.createElement('blockquote');
            q.className = 'assistant-check-quote';
            q.textContent = `«${c.sourceQuote}»`;
            card.append(q);
          }

          chWrap.append(card);
        });
        wrap.append(chWrap);
      }
    }

    const notesList = data.helpfulNotes || data.recommendations || [];
    if (Array.isArray(notesList) && notesList.length > 0) {
      const recCard = document.createElement('div');
      recCard.className = 'assistant-advice-card';
      recCard.innerHTML = '<strong>💡 Полезные примечания:</strong>';
      const ol = document.createElement('ol');
      notesList.forEach((r) => {
        const li = document.createElement('li');
        li.textContent = r;
        ol.append(li);
      });
      recCard.append(ol);
      wrap.append(recCard);
    }

    resultsContainerEl.append(wrap);
  }

  function renderSearchRefineResult(data) {
    const wrap = document.createElement('div');
    wrap.className = 'assistant-refine-wrap';

    if (data.explanation) {
      const exp = document.createElement('div');
      exp.className = 'assistant-summary-card';
      exp.textContent = data.explanation;
      wrap.append(exp);
    }

    const row = document.createElement('div');
    row.className = 'assistant-refine-tags';

    (data.keywords || []).forEach((k) => {
      const chip = document.createElement('span');
      chip.className = 'assistant-keyword-chip';
      chip.textContent = `#${k}`;
      row.append(chip);
    });

    (data.synonyms || []).forEach((s) => {
      const chip = document.createElement('span');
      chip.className = 'assistant-synonym-chip';
      chip.textContent = `~${s}`;
      row.append(chip);
    });
    wrap.append(row);

    if (data.ftsQuery) {
      const qBox = document.createElement('div');
      qBox.className = 'assistant-refine-box';

      const code = document.createElement('code');
      code.className = 'assistant-refine-query';
      code.textContent = data.ftsQuery;

      const runBtn = document.createElement('button');
      runBtn.type = 'button';
      runBtn.className = 'primary-button small-button';
      runBtn.textContent = '🔍 Искать в архиве';
      runBtn.addEventListener('click', () => {
        setMode('archive-query');
        textareaEl.value = data.ftsQuery;
        updateCharCount();
        handleProcess();
      });

      qBox.append(code, runBtn);
      wrap.append(qBox);
    }

    resultsContainerEl.append(wrap);
  }

  function renderHistoryView() {
    resultsContainerEl.classList.remove('hidden');
    resultsContainerEl.innerHTML = '';

    const list = getHistory();
    const favs = getFavorites();

    const header = document.createElement('div');
    header.className = 'assistant-result-header';

    const filterGroup = document.createElement('div');
    filterGroup.className = 'assistant-history-filters';

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = `assistant-history-filter-btn ${activeHistoryFilter === 'all' ? 'active' : ''}`;
    allBtn.textContent = `Все (${list.length})`;
    allBtn.addEventListener('click', () => { activeHistoryFilter = 'all'; renderHistoryView(); });

    const favBtn = document.createElement('button');
    favBtn.type = 'button';
    favBtn.className = `assistant-history-filter-btn ${activeHistoryFilter === 'favorites' ? 'active' : ''}`;
    favBtn.textContent = `★ Избранные (${favs.length})`;
    favBtn.addEventListener('click', () => { activeHistoryFilter = 'favorites'; renderHistoryView(); });

    const successBtn = document.createElement('button');
    successBtn.type = 'button';
    const successCount = list.filter((it) => it.success).length;
    successBtn.className = `assistant-history-filter-btn ${activeHistoryFilter === 'success' ? 'active' : ''}`;
    successBtn.textContent = `✓ Успешные (${successCount})`;
    successBtn.addEventListener('click', () => { activeHistoryFilter = 'success'; renderHistoryView(); });

    filterGroup.append(allBtn, favBtn, successBtn);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'quiet-button small-button';
    clearBtn.textContent = 'Очистить историю';
    clearBtn.addEventListener('click', () => {
      clearHistory();
      renderHistoryView();
    });

    header.append(filterGroup, clearBtn);
    resultsContainerEl.append(header);

    let displayList = list;
    if (activeHistoryFilter === 'favorites') {
      displayList = favs;
    } else if (activeHistoryFilter === 'success') {
      displayList = list.filter((it) => it.success);
    }

    if (!displayList.length) {
      const empty = document.createElement('p');
      empty.className = 'helper';
      empty.textContent = activeHistoryFilter === 'favorites' ? 'В избранном пока нет запросов. Нажмите ★ на карточке запроса.' : 'История запросов пуста.';
      resultsContainerEl.append(empty);
      return;
    }

    const histList = document.createElement('div');
    histList.className = 'assistant-history-list';

    displayList.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'assistant-history-item';

      const favStarred = isFavorite(item.query);
      const starBtn = document.createElement('button');
      starBtn.type = 'button';
      starBtn.className = `assistant-history-star-btn ${favStarred ? 'starred' : ''}`;
      starBtn.textContent = favStarred ? '★' : '☆';
      starBtn.title = favStarred ? 'Удалить из избранного' : 'Добавить в избранное';
      starBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(item);
        renderHistoryView();
      });

      const contentBox = document.createElement('div');
      contentBox.className = 'assistant-history-item-content';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'assistant-history-query';
      titleSpan.textContent = item.query ? item.query.slice(0, 100) : '(пустой запрос)';

      const metaRow = document.createElement('div');
      metaRow.className = 'assistant-history-meta';

      const modeBadge = document.createElement('span');
      modeBadge.className = 'assistant-history-mode-tag';
      modeBadge.textContent = item.mode || 'запрос';

      const dateSpan = document.createElement('span');
      dateSpan.className = 'helper';
      dateSpan.textContent = new Date(item.timestamp || item.starredAt || Date.now()).toLocaleDateString();

      metaRow.append(modeBadge, dateSpan);
      contentBox.append(titleSpan, metaRow);

      const rerunBtn = document.createElement('button');
      rerunBtn.type = 'button';
      rerunBtn.className = 'quiet-button small-button assistant-history-rerun-btn';
      rerunBtn.textContent = 'Открыть ↵';
      rerunBtn.title = 'Загрузить этот запрос в поле ввода';

      row.append(starBtn, contentBox, rerunBtn);
      row.addEventListener('click', () => {
        setMode(item.mode);
        textareaEl.value = item.query;
        updateCharCount();
        if (item.result) {
          renderResult(item.result);
        }
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

    if (options.contextTitle) {
      contextBannerEl.classList.remove('hidden');
      contextBannerEl.innerHTML = `<strong>Контекст:</strong> ${options.contextTitle}`;
    } else {
      contextBannerEl.classList.add('hidden');
      contextBannerEl.innerHTML = '';
    }

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
