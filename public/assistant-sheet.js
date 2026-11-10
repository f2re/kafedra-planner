// Assistant Sheet UI Controller · Kafedra Planner
import { appendAssistantPlainAnswer, appendAssistantSources } from './assistant-answer.js';

const DRAFT_KEY = 'kafedra.assistant.draft';
const HISTORY_KEY = 'kafedra.assistant.history';
const FAVORITES_KEY = 'kafedra.assistant.favorites';

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
  'template-analyze': [
    { label: '🏛️ Протокол заседания кафедры', text: 'ПРОТОКОЛ № 4 заседания кафедры от 15.10.2026.\nПредседатель: проф. Иванов И.И.\nСекретарь: доц. Петрова А.С.\nКворум: 18 из 20 членов кафедры.\nПовестка дня:\n1. О распределении учебной нагрузки на весенний семестр.\nСЛУШАЛИ: зав. кафедрой о плане часов.\nВЫСТУПИЛИ: доц. Сидоров.\nПОСТАНОВИЛИ: нагрузку утвердить.\n2. Об утверждении тем ВКР бакалавров.\nСЛУШАЛИ: доц. Петрову о темах студентов.\nПОСТАНОВИЛИ: темы утвердить, назначить руководителей.' },
    { label: '📄 Выписка по ВКР студента', text: 'ВЫПИСКА ИЗ ПРОТОКОЛА № 3 заседания кафедры от 20.09.2026.\nСЛУШАЛИ: Об утверждении темы выпускной квалификационной работы студента группы 521 Иванова И.И. «Разработка веб-системы планирования».\nПОСТАНОВИЛИ: Тему утвердить, научным руководителем назначить доцента Смирнова А.А.' },
    { label: '📜 Распоряжение по кафедре', text: 'РАСПОРЯЖЕНИЕ № 12 по кафедре информационных систем от 05.10.2026.\nО подготовке к зимней экзаменационной сессии.\n1. Преподавателям подготовить экзаменационные билеты до 01.12.2026.\n2. Контроль возложить на зам. зав. кафедрой доц. Сидорова В.В.' }
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
  let historySearch = '';
  let historyRecords = [];
  let historyNextCursor = null;
  let historyLoading = false;
  let historyError = '';

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
          <button id="assistant-settings-reindex-btn" class="secondary-button" type="button" title="Переиндексировать документы, протоколы и решения для ИИ">🔄 Индексация базы</button>
          <button id="assistant-settings-save-btn" class="primary-button" type="button">Сохранить</button>
        </div>
        <div id="assistant-settings-feedback" class="assistant-settings-feedback hidden"></div>
      </div>

      <div class="assistant-body">
        <div id="assistant-context-banner" class="assistant-context-banner hidden"></div>

        <nav class="assistant-modes" role="tablist" aria-label="Режимы ассистента">
          <button class="assistant-mode-tab active" type="button" data-mode="table-extract">Таблицы</button>
          <button class="assistant-mode-tab" type="button" data-mode="protocol-analysis">Разбор протокола</button>
          <button class="assistant-mode-tab" type="button" data-mode="template-analyze">Анализ шаблонов</button>
          <button class="assistant-mode-tab" type="button" data-mode="report-synthesis">Составление отчёта</button>
          <button class="assistant-mode-tab" type="button" data-mode="archive-query">Поиск в архиве</button>
          <button class="assistant-mode-tab" type="button" data-mode="document-graph">Смысловой граф</button>
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

    const reindexBtn = sheetEl.querySelector('#assistant-settings-reindex-btn');
    if (reindexBtn) {
      reindexBtn.addEventListener('click', async () => {
        reindexBtn.disabled = true;
        const originalText = reindexBtn.textContent;
        reindexBtn.textContent = 'Индексация...';
        const feedback = sheetEl.querySelector('#assistant-settings-feedback');
        if (feedback) {
          feedback.textContent = 'Выполняется переиндексация документов и заседаний...';
          feedback.className = 'assistant-settings-feedback';
          feedback.classList.remove('hidden');
        }
        try {
          const resp = await fetch('/api/search/reindex', { method: 'POST' });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data?.error?.message || 'Ошибка');
          if (feedback) {
            feedback.textContent = `База актуализирована: ${data.indexedCount || 0} фрагментов (протоколы: ${data.meetingsCount || 0}, документы: ${data.documentsCount || 0}, планы: ${data.plansCount || 0}).`;
            feedback.className = 'assistant-settings-feedback success';
          }
        } catch (err) {
          if (feedback) {
            feedback.textContent = `Ошибка индексации: ${err.message}`;
            feedback.className = 'assistant-settings-feedback error';
          }
        } finally {
          reindexBtn.disabled = false;
          reindexBtn.textContent = originalText;
        }
      });
    }

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
    const isDocumentGraph = mode === 'document-graph';
    const isSpecialView = isHistory || isCustomPrompts || isSearchHelp || isDocumentGraph;
    sheetEl.querySelector('#assistant-presets-wrap').classList.toggle('hidden', isSpecialView);
    sheetEl.querySelector('.assistant-input-card').classList.toggle('hidden', isSpecialView);
    sheetEl.querySelector('#assistant-prompt-accordion')?.classList.toggle('hidden', isSpecialView);
    sheetEl.querySelector('.assistant-actions').classList.toggle('hidden', isSpecialView);

    if (isHistory) {
      renderHistoryView();
      void loadAssistantHistory();
    } else if (isCustomPrompts) {
      renderCustomPromptsView();
    } else if (isSearchHelp) {
      renderSearchHelpView();
    } else if (isDocumentGraph) {
      renderDocumentGraphView();
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
    } else if (currentMode === 'template-analyze') {
      textareaEl.placeholder = 'Вставьте текст протокола, выписки или распоряжения для ИИ-поиска заменяемых полей и переменных...';
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
    processBtn.textContent = 'Генерация...';

    // Render the live telemetry and streaming terminal
    resultsContainerEl.innerHTML = `
      <div class="assistant-live-terminal" id="assistant-live-terminal">
        <div class="assistant-telemetry-bar">
          <div class="assistant-telemetry-left">
            <div class="telemetry-pill status-pill" id="ast-stream-stage-pill">
              <span class="telemetry-dot pulse" id="ast-stream-dot"></span>
              <span id="ast-stream-stage-label">Инициализация...</span>
            </div>
            <div class="telemetry-pill telemetry-speed" id="ast-telemetry-speed" title="Скорость генерации токенов">
              <span>⚡</span> <span id="ast-stream-speed">0.0</span> <small>ток/с</small>
            </div>
            <div class="telemetry-pill telemetry-count" id="ast-telemetry-count" title="Сгенерировано токенов">
              <span>🔢</span> <span id="ast-stream-tokens">0</span> <small>ток</small>
            </div>
            <div class="telemetry-pill telemetry-timer" id="ast-telemetry-timer" title="Время генерации и задержка первого токена">
              <span>⏱️</span> <span id="ast-stream-time">0.0 с</span>
              <small id="ast-stream-ttft" style="margin-left: 4px; opacity: 0.85;"></small>
            </div>
          </div>
          <div class="assistant-telemetry-right">
            <button type="button" class="assistant-stop-stream-btn" id="ast-stop-stream-btn" title="Остановить генерацию">
              ⏹ Стоп
            </button>
          </div>
        </div>

        <div class="assistant-live-progress-wrap">
          <div class="assistant-live-progress-bar" id="ast-stream-progress-bar"></div>
        </div>

        <details class="assistant-reasoning-panel hidden" id="ast-reasoning-panel" open>
          <summary class="assistant-reasoning-summary">
            <div class="reasoning-summary-left">
              <span>🧠</span>
              <strong>Ход мыслей и рассуждения модели</strong>
              <span class="reasoning-live-badge" id="ast-reasoning-badge">Думает...</span>
            </div>
            <div class="reasoning-summary-meta" id="ast-reasoning-meta"></div>
          </summary>
          <div class="assistant-reasoning-body">
            <pre class="assistant-reasoning-text" id="ast-reasoning-text"></pre>
          </div>
        </details>

        <div class="assistant-live-stream-box" id="ast-live-stream-box">
          <div class="assistant-live-stream-head">
            <span>Поток ответа модели:</span>
            <small id="ast-stream-meta-status">приём токенов...</small>
          </div>
          <pre class="assistant-live-stream-content" id="ast-stream-content"><span class="assistant-streaming-cursor" id="ast-stream-cursor">▋</span></pre>
        </div>
      </div>
      <div id="assistant-final-result-wrap" class="hidden"></div>
    `;

    const terminalEl = resultsContainerEl.querySelector('#assistant-live-terminal');
    const stageLabelEl = resultsContainerEl.querySelector('#ast-stream-stage-label');
    const stageDotEl = resultsContainerEl.querySelector('#ast-stream-dot');
    const speedValEl = resultsContainerEl.querySelector('#ast-stream-speed');
    const tokensValEl = resultsContainerEl.querySelector('#ast-stream-tokens');
    const timeValEl = resultsContainerEl.querySelector('#ast-stream-time');
    const ttftValEl = resultsContainerEl.querySelector('#ast-stream-ttft');
    const stopBtn = resultsContainerEl.querySelector('#ast-stop-stream-btn');
    const progressBar = resultsContainerEl.querySelector('#ast-stream-progress-bar');
    const reasoningPanel = resultsContainerEl.querySelector('#ast-reasoning-panel');
    const reasoningBadge = resultsContainerEl.querySelector('#ast-reasoning-badge');
    const reasoningTextEl = resultsContainerEl.querySelector('#ast-reasoning-text');
    const streamContentEl = resultsContainerEl.querySelector('#ast-stream-content');
    const streamCursorEl = resultsContainerEl.querySelector('#ast-stream-cursor');
    const streamMetaStatus = resultsContainerEl.querySelector('#ast-stream-meta-status');
    const finalResultWrap = resultsContainerEl.querySelector('#assistant-final-result-wrap');

    stopBtn?.addEventListener('click', () => {
      handleCancel();
      if (stageLabelEl) stageLabelEl.textContent = '⏹ Остановлено оператором';
      if (stageDotEl) stageDotEl.className = 'telemetry-dot';
      if (streamCursorEl) streamCursorEl.remove();
      if (streamMetaStatus) streamMetaStatus.textContent = 'генерация прервана';
    });

    timerInterval = setInterval(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      processBtn.textContent = `Генерация... (${elapsed} с)`;
      if (timeValEl) timeValEl.textContent = `${elapsed} с`;
    }, 100);

    try {
      const customSystemPrompt = sheetEl.querySelector('#assistant-custom-system-prompt')?.value?.trim() || undefined;
      const isTextTask = ['table-extract', 'gap-repair', 'template-analyze'].includes(currentMode);

      const resp = await fetch('/api/assistant/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          task: currentMode,
          text: isTextTask ? text : undefined,
          query: !isTextTask ? text : undefined,
          customSystemPrompt
        }),
        signal: abortController.signal
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let finalData = null;
      let streamedRawText = '';
      let streamedThinkingText = '';
      let streamError = null;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const evText of events) {
          if (!evText.trim()) continue;
          const lines = evText.split('\n');
          let eventName = 'message';
          let dataStr = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
          }

          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);

            if (eventName === 'stage') {
              if (stageLabelEl) stageLabelEl.textContent = data.message || data.stage;
            } else if (eventName === 'thinking') {
              if (reasoningPanel) reasoningPanel.classList.remove('hidden');
              streamedThinkingText = data.fullText || (streamedThinkingText + (data.delta || ''));
              if (reasoningTextEl) {
                reasoningTextEl.textContent = streamedThinkingText;
                reasoningTextEl.scrollTop = reasoningTextEl.scrollHeight;
              }
            } else if (eventName === 'token') {
              streamedRawText = data.fullText || (streamedRawText + (data.delta || ''));
              if (streamContentEl) {
                streamContentEl.textContent = streamedRawText;
                const cur = document.createElement('span');
                cur.className = 'assistant-streaming-cursor';
                cur.textContent = '▋';
                streamContentEl.append(cur);
                streamContentEl.scrollTop = streamContentEl.scrollHeight;
              }
              if (data.meta) {
                if (speedValEl && data.meta.tokensPerSec) speedValEl.textContent = data.meta.tokensPerSec;
                if (tokensValEl && data.meta.tokenIndex) tokensValEl.textContent = data.meta.tokenIndex;
                if (ttftValEl && data.meta.ttftMs) ttftValEl.textContent = `(TTFT: ${data.meta.ttftMs} мс)`;
              }
            } else if (eventName === 'telemetry') {
              if (speedValEl && data.tokensPerSec) speedValEl.textContent = data.tokensPerSec;
              if (tokensValEl && data.completionTokens) tokensValEl.textContent = data.completionTokens;
              if (ttftValEl && data.ttftMs) ttftValEl.textContent = `(TTFT: ${data.ttftMs} мс)`;
            } else if (eventName === 'done') {
              finalData = data;
            } else if (eventName === 'error') {
              streamError = new Error(data.message || data.error || (
                data.status === 'disabled' ? 'ИИ-ассистент отключён в настройках.' : 'Ошибка генерации'
              ));
            }
          } catch {
            // ignore partial json
          }
        }
      }

      clearInterval(timerInterval);
      processBtn.textContent = 'Обработать';
      processBtn.disabled = false;
      cancelBtn.classList.add('hidden');
      if (stopBtn) stopBtn.remove();
      if (stageDotEl) stageDotEl.className = 'telemetry-dot';
      if (progressBar) progressBar.style.animation = 'none';
      if (streamCursorEl) streamCursorEl.remove();

      if (!finalData && streamError) throw streamError;
      if (!finalData) throw new Error('Поток завершился без ответа. Повторите запрос.');

      if (finalData && finalData.status === 'disabled') {
        resultsContainerEl.innerHTML = `
          <div class="empty-state">
            <strong>LLM выключен</strong>
            <p>Включите ассистент в настройках (⚙ в шапке панели) или задайте <code>KAFEDRA_LLM_ENABLED=true</code>.</p>
          </div>
        `;
        return;
      }

      if (finalData && finalData.result) {
        if (stageLabelEl) stageLabelEl.textContent = `✓ Завершено (${tokensValEl?.textContent || 0} токенов)`;
        if (reasoningBadge) reasoningBadge.textContent = '✓ Завершено';
        if (streamMetaStatus) streamMetaStatus.textContent = 'ответ принят';

        // Add view toggles between Structured Result, Reasoning, and Token Stream
        const togglesWrap = document.createElement('div');
        togglesWrap.className = 'assistant-view-toggles';
        togglesWrap.innerHTML = `
          <button type="button" class="assistant-view-toggle-btn active" data-view="structured">✨ Структурированный результат</button>
          <button type="button" class="assistant-view-toggle-btn" data-view="reasoning">🧠 Ход мыслей модели</button>
          <button type="button" class="assistant-view-toggle-btn" data-view="stream">⚡ Лог токенов и телеметрия</button>
        `;

        const structBtn = togglesWrap.querySelector('[data-view="structured"]');
        const reasonBtn = togglesWrap.querySelector('[data-view="reasoning"]');
        const streamBtn = togglesWrap.querySelector('[data-view="stream"]');

        const liveStreamBox = resultsContainerEl.querySelector('#ast-live-stream-box');

        structBtn?.addEventListener('click', () => {
          structBtn.classList.add('active');
          reasonBtn.classList.remove('active');
          streamBtn.classList.remove('active');
          if (finalResultWrap) finalResultWrap.classList.remove('hidden');
          if (liveStreamBox) liveStreamBox.classList.add('hidden');
          if (reasoningPanel) reasoningPanel.classList.add('hidden');
        });

        reasonBtn?.addEventListener('click', () => {
          reasonBtn.classList.add('active');
          structBtn.classList.remove('active');
          streamBtn.classList.remove('active');
          if (finalResultWrap) finalResultWrap.classList.add('hidden');
          if (liveStreamBox) liveStreamBox.classList.add('hidden');
          if (reasoningPanel) {
            reasoningPanel.classList.remove('hidden');
            reasoningPanel.open = true;
          }
        });

        streamBtn?.addEventListener('click', () => {
          streamBtn.classList.add('active');
          structBtn.classList.remove('active');
          reasonBtn.classList.remove('active');
          if (finalResultWrap) finalResultWrap.classList.add('hidden');
          if (liveStreamBox) liveStreamBox.classList.remove('hidden');
          if (reasoningPanel) reasoningPanel.classList.remove('hidden');
        });

        terminalEl.before(togglesWrap);

        // Hide live stream box by default once structured result is ready
        if (liveStreamBox) liveStreamBox.classList.add('hidden');
        if (reasoningPanel) reasoningPanel.open = false;

        if (finalResultWrap) {
          finalResultWrap.classList.remove('hidden');
          const origResultsEl = resultsContainerEl;
          resultsContainerEl = finalResultWrap;
          try {
            renderResult(finalData.result, {
              prompt: finalData.prompt,
              rawResponse: finalData.rawResponse,
              durationMs: finalData.durationMs,
              sources: finalData.sources || []
            });
          } finally {
            resultsContainerEl = origResultsEl;
          }
        }

        if (!finalData.historySaved) {
          const warning = document.createElement('p');
          warning.className = 'assistant-history-unsaved';
          warning.textContent = 'Ответ получен, но не сохранён в истории. Скопируйте его перед закрытием.';
          resultsContainerEl.append(warning);
        }
      }
    } catch (err) {
      clearInterval(timerInterval);
      processBtn.textContent = 'Обработать';
      processBtn.disabled = false;
      cancelBtn.classList.add('hidden');

      if (err.name === 'AbortError') {
        if (stageLabelEl) stageLabelEl.textContent = '⏹ Остановлено оператором';
        if (streamCursorEl) streamCursorEl.remove();
        showToast('Генерация остановлена');
      } else {
        resultsContainerEl.innerHTML = `<p class="error-text">Ошибка генерации: ${escapeHtml(err.message)}</p>`;
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
    } else if (result.type === 'template-analyze') {
      renderTemplateAnalyzeResult(result);
    } else {
      appendAssistantPlainAnswer(resultsContainerEl, result.type === 'raw'
        ? result.text : JSON.stringify(result, null, 2));
    }
    appendAssistantSources(resultsContainerEl, meta?.sources || [], {
      navigate: async (kind, id) => {
        close();
        if (typeof window.kafedraOpenExactRoute === 'function') {
          await window.kafedraOpenExactRoute({ kind, id });
        } else {
          window.location.hash = kind === 'meeting' ? '#meetings' : '#documents';
        }
      },
      error: showToast
    });
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

  let customPromptsCache = null;
  let promptActiveFilter = 'all';
  let promptSearchQuery = '';

  async function fetchPromptsList() {
    try {
      const resp = await fetch('/api/assistant/prompts');
      if (resp.ok) {
        const data = await resp.json();
        if (data.prompts && Array.isArray(data.prompts)) {
          customPromptsCache = data.prompts;
          return customPromptsCache;
        }
      }
    } catch {}
    try {
      const saved = JSON.parse(localStorage.getItem(CUSTOM_PROMPTS_KEY) || '[]');
      customPromptsCache = [...DEFAULT_CUSTOM_PROMPTS, ...saved];
    } catch {
      customPromptsCache = [...DEFAULT_CUSTOM_PROMPTS];
    }
    return customPromptsCache;
  }

  function getCustomPrompts() {
    return customPromptsCache || DEFAULT_CUSTOM_PROMPTS;
  }

  async function savePromptItem(item) {
    try {
      const resp = await fetch('/api/assistant/prompts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(item)
      });
      if (resp.ok) {
        const data = await resp.json();
        await fetchPromptsList();
        return data.prompt;
      }
    } catch {}
    const id = item.id || `user_${Date.now()}`;
    const saved = JSON.parse(localStorage.getItem(CUSTOM_PROMPTS_KEY) || '[]');
    const idx = saved.findIndex((p) => p.id === id);
    const full = { ...item, id };
    if (idx >= 0) saved[idx] = full;
    else saved.unshift(full);
    localStorage.setItem(CUSTOM_PROMPTS_KEY, JSON.stringify(saved));
    await fetchPromptsList();
    return full;
  }

  async function deletePromptItem(id) {
    try {
      await fetch(`/api/assistant/prompts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {}
    try {
      const saved = JSON.parse(localStorage.getItem(CUSTOM_PROMPTS_KEY) || '[]');
      const filtered = saved.filter((p) => p.id !== id);
      localStorage.setItem(CUSTOM_PROMPTS_KEY, JSON.stringify(filtered));
    } catch {}
    await fetchPromptsList();
  }

  async function togglePromptStar(id) {
    try {
      const resp = await fetch('/api/assistant/prompts/toggle-favorite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (resp.ok) {
        await fetchPromptsList();
        return;
      }
    } catch {}
    if (customPromptsCache) {
      const item = customPromptsCache.find((p) => p.id === id);
      if (item) {
        item.isFavorite = !item.isFavorite;
        try {
          const saved = JSON.parse(localStorage.getItem(CUSTOM_PROMPTS_KEY) || '[]');
          const s = saved.find((p) => p.id === id);
          if (s) s.isFavorite = item.isFavorite;
          else saved.push({ ...item });
          localStorage.setItem(CUSTOM_PROMPTS_KEY, JSON.stringify(saved));
        } catch {}
      }
    }
  }

  async function installPromptPack(pack) {
    try {
      const resp = await fetch('/api/assistant/prompts/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pack })
      });
      if (resp.ok) {
        const data = await resp.json();
        await fetchPromptsList();
        return data;
      }
    } catch {}
    const saved = JSON.parse(localStorage.getItem(CUSTOM_PROMPTS_KEY) || '[]');
    const incoming = Array.isArray(pack) ? pack : pack?.prompts || [];
    const merged = [...incoming, ...saved];
    localStorage.setItem(CUSTOM_PROMPTS_KEY, JSON.stringify(merged));
    await fetchPromptsList();
    return { success: true, installed: incoming.length };
  }

  async function renderCustomPromptsView() {
    resultsContainerEl.classList.remove('hidden');
    resultsContainerEl.innerHTML = '<div class="helper" style="padding: 24px; text-align: center;">Загрузка шаблонов промптов...</div>';
    await fetchPromptsList();

    resultsContainerEl.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'assistant-custom-prompts-container';

    const header = document.createElement('div');
    header.className = 'assistant-history-header';
    header.innerHTML = `
      <div>
        <strong>Библиотека промптов кафедры</strong>
        <span>Готовые кафедральные шаблоны, избранное и персональные инструкции</span>
      </div>
    `;
    container.append(header);

    const toolbar = document.createElement('div');
    toolbar.className = 'assistant-prompt-toolbar';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'assistant-prompt-search-wrap';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'assistant-prompt-search';
    searchInput.placeholder = '🔍 Поиск по шаблонам (название, описание, текст, тег)...';
    searchInput.value = promptSearchQuery;
    searchInput.addEventListener('input', (e) => {
      promptSearchQuery = e.target.value.toLowerCase().trim();
      updateFilteredCards();
    });
    searchWrap.append(searchInput);
    toolbar.append(searchWrap);

    const filtersRow = document.createElement('div');
    filtersRow.className = 'assistant-prompt-filters';

    const standardTags = ['Заседания', 'Документы', 'Отчёты', 'Поиск', 'Формулы'];
    const filterDefs = [
      { id: 'all', label: 'Все' },
      { id: 'favorites', label: '★ Избранные' },
      { id: 'standards', label: '🏛️ Стандартные' },
      { id: 'custom', label: '👤 Мои шаблоны' }
    ];

    filterDefs.forEach((f) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `assistant-prompt-filter-btn ${promptActiveFilter === f.id ? 'active' : ''}`;
      btn.textContent = f.label;
      btn.addEventListener('click', () => {
        promptActiveFilter = f.id;
        toolbar.querySelectorAll('.assistant-prompt-filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        updateFilteredCards();
      });
      filtersRow.append(btn);
    });

    standardTags.forEach((tag) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `assistant-prompt-filter-btn ${promptActiveFilter === `tag:${tag}` ? 'active' : ''}`;
      btn.textContent = tag;
      btn.addEventListener('click', () => {
        promptActiveFilter = `tag:${tag}`;
        toolbar.querySelectorAll('.assistant-prompt-filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        updateFilteredCards();
      });
      filtersRow.append(btn);
    });
    toolbar.append(filtersRow);

    const actionsBar = document.createElement('div');
    actionsBar.className = 'assistant-prompt-actions-bar';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'primary-button small-button';
    addBtn.textContent = '＋ Свой шаблон';
    addBtn.addEventListener('click', () => openPromptEditorModal());

    const rightActions = document.createElement('div');
    rightActions.style.display = 'flex';
    rightActions.style.gap = '8px';

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'quiet-button small-button';
    importBtn.textContent = '📥 Импорт JSON';
    importBtn.title = 'Импортировать пакет промптов из JSON-файла';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.className = 'hidden';
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const res = await installPromptPack(parsed);
        showToast(`Импортировано шаблонов: ${res.installed || 0}`);
        renderCustomPromptsView();
      } catch (err) {
        showToast(`Ошибка импорта JSON: ${err.message}`);
      }
    });

    importBtn.addEventListener('click', () => fileInput.click());

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'quiet-button small-button';
    exportBtn.textContent = '📤 Экспорт JSON';
    exportBtn.title = 'Экспортировать текущие шаблоны в JSON-файл';
    exportBtn.addEventListener('click', () => {
      const pack = customPromptsCache || [];
      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
      const dl = document.createElement('a');
      dl.href = URL.createObjectURL(blob);
      dl.download = `kafedra-prompts-pack-${new Date().toISOString().slice(0, 10)}.json`;
      dl.click();
      URL.revokeObjectURL(dl.href);
      showToast('Пакет промптов сохранён');
    });

    rightActions.append(importBtn, exportBtn, fileInput);
    actionsBar.append(addBtn, rightActions);
    toolbar.append(actionsBar);
    container.append(toolbar);

    const listWrap = document.createElement('div');
    listWrap.className = 'assistant-custom-prompts-list';
    container.append(listWrap);

    function updateFilteredCards() {
      listWrap.innerHTML = '';
      const all = customPromptsCache || [];
      const filtered = all.filter((p) => {
        if (promptActiveFilter === 'favorites' && !p.isFavorite) return false;
        if (promptActiveFilter === 'standards' && (p.isStandard === false || p.id?.startsWith('user_'))) return false;
        if (promptActiveFilter === 'custom' && (p.isStandard !== false && !p.id?.startsWith('user_') && !p.id?.startsWith('custom_'))) return false;
        if (promptActiveFilter.startsWith('tag:')) {
          const reqTag = promptActiveFilter.replace('tag:', '');
          if (p.tag !== reqTag) return false;
        }
        if (promptSearchQuery) {
          const haystack = `${p.title || ''} ${p.description || ''} ${p.tag || ''} ${p.template || ''} ${p.systemPrompt || ''}`.toLowerCase();
          if (!haystack.includes(promptSearchQuery)) return false;
        }
        return true;
      });

      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = '<p>Шаблоны по заданным критериям не найдены.</p>';
        listWrap.append(empty);
        return;
      }

      filtered.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'assistant-custom-prompt-card';

        const head = document.createElement('div');
        head.className = 'assistant-custom-prompt-head';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'assistant-prompt-title-wrap';

        const starBtn = document.createElement('button');
        starBtn.type = 'button';
        starBtn.className = `assistant-star-btn ${p.isFavorite ? 'active' : ''}`;
        starBtn.textContent = '★';
        starBtn.title = p.isFavorite ? 'Убрать из избранного' : 'Добавить в избранное';
        starBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await togglePromptStar(p.id);
          starBtn.classList.toggle('active', Boolean(p.isFavorite));
          updateFilteredCards();
        });

        const strongTitle = document.createElement('strong');
        strongTitle.textContent = p.title || 'Без названия';
        titleWrap.append(starBtn, strongTitle);

        const tagBadge = document.createElement('span');
        tagBadge.className = 'assistant-custom-prompt-tag';
        tagBadge.textContent = p.tag || 'Общий';

        head.append(titleWrap, tagBadge);
        card.append(head);

        if (p.description) {
          const desc = document.createElement('div');
          desc.className = 'assistant-custom-prompt-desc';
          desc.textContent = p.description;
          card.append(desc);
        }

        if (p.template) {
          const preview = document.createElement('div');
          preview.className = 'assistant-prompt-preview';
          preview.textContent = p.template;
          card.append(preview);
        }

        const actions = document.createElement('div');
        actions.className = 'assistant-custom-prompt-actions';

        const isUserItem = p.isStandard === false || p.id?.startsWith('user_') || p.id?.startsWith('custom_');

        if (isUserItem) {
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'quiet-button small-button';
          delBtn.textContent = '🗑️ Удалить';
          delBtn.addEventListener('click', async () => {
            if (confirm(`Удалить шаблон «${p.title}»?`)) {
              await deletePromptItem(p.id);
              showToast('Шаблон удалён');
              updateFilteredCards();
            }
          });
          actions.append(delBtn);
        }

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'secondary-button small-button';
        editBtn.textContent = '✏️ Изменить';
        editBtn.addEventListener('click', () => openPromptEditorModal(p));
        actions.append(editBtn);

        const useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.className = 'primary-button small-button';
        useBtn.textContent = 'Использовать шаблон';
        useBtn.addEventListener('click', () => {
          setMode(p.mode || 'table-extract');
          textareaEl.value = p.template || '';
          const sysInput = sheetEl.querySelector('#assistant-custom-system-prompt');
          if (sysInput && p.systemPrompt) {
            sysInput.value = p.systemPrompt;
            const accord = sheetEl.querySelector('#assistant-prompt-accordion');
            if (accord) accord.open = true;
          }
          updateCharCount();
          saveDraft();
          textareaEl.focus();
          showToast(`Шаблон «${p.title}» загружен`);
        });
        actions.append(useBtn);

        card.append(actions);
        listWrap.append(card);
      });
    }

    updateFilteredCards();
    resultsContainerEl.append(container);
  }

  function openPromptEditorModal(promptData = null) {
    const existingModal = document.getElementById('assistant-prompt-modal-backdrop');
    if (existingModal) existingModal.remove();

    const isEdit = Boolean(promptData);
    const backdrop = document.createElement('div');
    backdrop.className = 'assistant-modal-backdrop';
    backdrop.id = 'assistant-prompt-modal-backdrop';

    backdrop.innerHTML = `
      <div class="assistant-modal-dialog" role="dialog" aria-modal="true">
        <h3>${isEdit ? 'Редактирование шаблона промпта' : 'Новый шаблон промпта'}</h3>
        <div class="assistant-form-group">
          <label for="ast-modal-title">Название шаблона *</label>
          <input type="text" id="ast-modal-title" value="${escapeHtml(promptData?.title || '')}" placeholder="например: 📋 Проверка повестки заседания" />
        </div>
        <div class="assistant-form-row">
          <div class="assistant-form-group">
            <label for="ast-modal-tag">Категория / Раздел</label>
            <input type="text" id="ast-modal-tag" value="${escapeHtml(promptData?.tag || 'Заседания')}" placeholder="Заседания, Документы, Отчёты..." />
          </div>
          <div class="assistant-form-group">
            <label for="ast-modal-mode">Режим ассистента</label>
            <select id="ast-modal-mode">
              <option value="protocol-analysis" ${promptData?.mode === 'protocol-analysis' ? 'selected' : ''}>Заседания и повестки</option>
              <option value="template-analyze" ${promptData?.mode === 'template-analyze' ? 'selected' : ''}>Анализ шаблонов (переменные)</option>
              <option value="compliance-check" ${promptData?.mode === 'compliance-check' ? 'selected' : ''}>Нормоконтроль и ГОСТ</option>
              <option value="report-synthesis" ${promptData?.mode === 'report-synthesis' ? 'selected' : ''}>Синтез отчётов</option>
              <option value="table-extract" ${promptData?.mode === 'table-extract' ? 'selected' : ''}>Извлечение таблиц</option>
              <option value="gap-repair" ${promptData?.mode === 'gap-repair' ? 'selected' : ''}>Поиск пропусков</option>
              <option value="archive-query" ${promptData?.mode === 'archive-query' ? 'selected' : ''}>Поиск в архиве</option>
              <option value="formula-calc" ${promptData?.mode === 'formula-calc' ? 'selected' : ''}>Формулы Calc / Excel</option>
            </select>
          </div>
        </div>
        <div class="assistant-form-group">
          <label for="ast-modal-desc">Краткое описание</label>
          <input type="text" id="ast-modal-desc" value="${escapeHtml(promptData?.description || '')}" placeholder="Пояснение, что делает этот шаблон..." />
        </div>
        <div class="assistant-form-group">
          <label for="ast-modal-sys">Системная инструкция (System prompt, необязательно)</label>
          <textarea id="ast-modal-sys" rows="3" placeholder="Роль и правила поведения для локальной модели...">${escapeHtml(promptData?.systemPrompt || '')}</textarea>
        </div>
        <div class="assistant-form-group">
          <label for="ast-modal-template">Текст шаблона (User template / заготовка запроса)</label>
          <textarea id="ast-modal-template" rows="5" placeholder="Текст запроса или заготовка с переменными {{...}}...">${escapeHtml(promptData?.template || textareaEl.value || '')}</textarea>
        </div>
        <label class="assistant-form-check">
          <input type="checkbox" id="ast-modal-fav" ${promptData?.isFavorite ? 'checked' : ''} />
          <span>★ Закрепить в избранном</span>
        </label>
        <div class="assistant-modal-footer">
          <button type="button" class="quiet-button" id="ast-modal-cancel">Отмена</button>
          <button type="button" class="primary-button" id="ast-modal-save">Сохранить шаблон</button>
        </div>
      </div>
    `;

    backdrop.querySelector('#ast-modal-cancel')?.addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });

    backdrop.querySelector('#ast-modal-save')?.addEventListener('click', async () => {
      const title = backdrop.querySelector('#ast-modal-title')?.value?.trim();
      if (!title) {
        alert('Пожалуйста, укажите название шаблона');
        return;
      }
      const tag = backdrop.querySelector('#ast-modal-tag')?.value?.trim() || 'Общий';
      const mode = backdrop.querySelector('#ast-modal-mode')?.value || 'table-extract';
      const description = backdrop.querySelector('#ast-modal-desc')?.value?.trim() || '';
      const systemPrompt = backdrop.querySelector('#ast-modal-sys')?.value?.trim() || '';
      const template = backdrop.querySelector('#ast-modal-template')?.value?.trim() || '';
      const isFavorite = Boolean(backdrop.querySelector('#ast-modal-fav')?.checked);

      await savePromptItem({
        id: promptData?.id,
        title,
        tag,
        mode,
        description,
        systemPrompt,
        template,
        isFavorite
      });

      backdrop.remove();
      showToast('Шаблон сохранён');
      if (currentMode === 'custom-prompts') {
        renderCustomPromptsView();
      }
    });

    document.body.append(backdrop);
  }

  async function renderDocumentGraphView() {
    resultsContainerEl.classList.remove('hidden');
    resultsContainerEl.innerHTML = '<div class="helper" style="padding: 24px; text-align: center;">Построение смыслового графа документов...</div>';

    let graphData = null;
    try {
      const resp = await fetch('/api/documents/graph');
      if (resp.ok) {
        graphData = await resp.json();
      }
    } catch {}

    if (!graphData || !graphData.nodes || graphData.nodes.length === 0) {
      resultsContainerEl.innerHTML = `
        <div class="empty-state">
          <strong>Граф документов пуст</strong>
          <p>В базе кафедры пока нет загруженных протоколов, планов или заседаний для построения смыслового графа.</p>
        </div>
      `;
      return;
    }

    resultsContainerEl.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'assistant-graph-container';

    let activeTypeFilter = 'all';
    let graphSearchQuery = '';
    let selectedNodeId = null;

    const toolbar = document.createElement('div');
    toolbar.className = 'assistant-graph-toolbar';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'assistant-graph-search';
    searchInput.placeholder = '🔍 Поиск по узлам (протоколы, темы, преподаватели)...';
    searchInput.addEventListener('input', (e) => {
      graphSearchQuery = e.target.value.toLowerCase().trim();
      updateGraphSelection();
    });
    toolbar.append(searchInput);

    const filters = document.createElement('div');
    filters.className = 'assistant-graph-filters';
    const filterTypes = [
      { id: 'all', label: 'Все' },
      { id: 'meeting', label: '🏛️ Заседания' },
      { id: 'plan', label: '📅 Планы' },
      { id: 'person', label: '👤 Преподаватели' },
      { id: 'topic', label: '🏷️ Темы' },
      { id: 'document', label: '📄 Документы' }
    ];
    filterTypes.forEach((ft) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `assistant-graph-filter-btn ${activeTypeFilter === ft.id ? 'active' : ''}`;
      btn.textContent = ft.label;
      btn.addEventListener('click', () => {
        activeTypeFilter = ft.id;
        filters.querySelectorAll('.assistant-graph-filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        updateGraphSelection();
      });
      filters.append(btn);
    });
    toolbar.append(filters);

    const zoomBar = document.createElement('div');
    zoomBar.className = 'assistant-graph-zoom-bar';
    let zoomLevel = 1.0;
    let panX = 0;
    let panY = 0;

    const zoomInBtn = document.createElement('button');
    zoomInBtn.type = 'button';
    zoomInBtn.className = 'assistant-graph-btn';
    zoomInBtn.textContent = '＋';
    zoomInBtn.title = 'Приблизить';
    zoomInBtn.addEventListener('click', () => {
      zoomLevel = Math.min(2.5, zoomLevel * 1.25);
      applyTransform();
    });

    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.type = 'button';
    zoomOutBtn.className = 'assistant-graph-btn';
    zoomOutBtn.textContent = '－';
    zoomOutBtn.title = 'Отдалить';
    zoomOutBtn.addEventListener('click', () => {
      zoomLevel = Math.max(0.4, zoomLevel / 1.25);
      applyTransform();
    });

    const zoomResetBtn = document.createElement('button');
    zoomResetBtn.type = 'button';
    zoomResetBtn.className = 'assistant-graph-btn';
    zoomResetBtn.textContent = '⟲';
    zoomResetBtn.title = 'Сбросить масштаб';
    zoomResetBtn.addEventListener('click', () => {
      zoomLevel = 1.0;
      panX = 0;
      panY = 0;
      applyTransform();
    });

    zoomBar.append(zoomInBtn, zoomOutBtn, zoomResetBtn);
    toolbar.append(zoomBar);
    container.append(toolbar);

    const width = 800;
    const height = 440;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'assistant-graph-svg');

    const viewport = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    viewport.setAttribute('class', 'assistant-graph-viewport');
    svg.append(viewport);

    function applyTransform() {
      viewport.setAttribute('transform', `translate(${panX}, ${panY}) scale(${zoomLevel})`);
    }

    let isPanning = false;
    let startX = 0;
    let startY = 0;

    svg.addEventListener('mousedown', (e) => {
      if (e.target.closest('.graph-node-group')) return;
      isPanning = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isPanning) return;
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      applyTransform();
    });

    window.addEventListener('mouseup', () => {
      isPanning = false;
    });

    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      zoomLevel = Math.max(0.4, Math.min(2.5, zoomLevel * delta));
      applyTransform();
    }, { passive: false });

    const nodes = graphData.nodes.map((n, i) => {
      const angle = (i / graphData.nodes.length) * Math.PI * 2;
      const radius = n.type === 'topic' ? 120 : 160 + (i % 3) * 30;
      return {
        ...n,
        x: 400 + Math.cos(angle) * radius,
        y: 220 + Math.sin(angle) * radius,
        vx: 0,
        vy: 0
      };
    });

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const edges = (graphData.edges || []).map((e) => ({
      ...e,
      sourceNode: nodeMap.get(e.source),
      targetNode: nodeMap.get(e.target)
    })).filter((e) => e.sourceNode && e.targetNode);

    // Run quick relaxation loop
    for (let iter = 0; iter < 32; iter++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const n1 = nodes[i];
          const n2 = nodes[j];
          const dx = n1.x - n2.x;
          const dy = n1.y - n2.y;
          const dist = Math.hypot(dx, dy) || 1;
          if (dist < 180) {
            const force = 1800 / (dist * dist + 80);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            n1.vx += fx; n1.vy += fy;
            n2.vx -= fx; n2.vy -= fy;
          }
        }
      }

      for (let e = 0; e < edges.length; e++) {
        const edge = edges[e];
        const dx = edge.targetNode.x - edge.sourceNode.x;
        const dy = edge.targetNode.y - edge.sourceNode.y;
        const dist = Math.hypot(dx, dy) || 1;
        const spring = (dist - 80) * 0.04;
        const sx = (dx / dist) * spring;
        const sy = (dy / dist) * spring;
        edge.sourceNode.vx += sx; edge.sourceNode.vy += sy;
        edge.targetNode.vx -= sx; edge.targetNode.vy -= sy;
      }

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.vx += (400 - n.x) * 0.008;
        n.vy += (220 - n.y) * 0.008;
        n.x = Math.max(45, Math.min(755, n.x + n.vx * 0.5));
        n.y = Math.max(35, Math.min(405, n.y + n.vy * 0.5));
        n.vx = 0;
        n.vy = 0;
      }
    }

    const NODE_COLORS = {
      meeting: '#38bdf8',
      protocol: '#38bdf8',
      plan: '#34d399',
      person: '#fbbf24',
      topic: '#a78bfa',
      document: '#22d3ee',
      decision: '#f43f5e'
    };

    const edgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    edgeGroup.setAttribute('class', 'assistant-graph-edges');

    const edgeElements = edges.map((edge) => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', edge.sourceNode.x);
      line.setAttribute('y1', edge.sourceNode.y);
      line.setAttribute('x2', edge.targetNode.x);
      line.setAttribute('y2', edge.targetNode.y);
      line.setAttribute('stroke', 'rgba(148, 163, 184, 0.25)');
      line.setAttribute('stroke-width', '1.2');
      edgeGroup.append(line);
      return { edge, line };
    });
    viewport.append(edgeGroup);

    const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    nodeGroup.setAttribute('class', 'assistant-graph-nodes');

    const inspector = document.createElement('div');
    inspector.className = 'assistant-graph-inspector hidden';

    const nodeElements = nodes.map((node) => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'graph-node-group');
      g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
      g.style.cursor = 'pointer';

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const radius = node.type === 'topic' ? 14 : (node.type === 'meeting' ? 12 : 10);
      circle.setAttribute('r', radius);
      circle.setAttribute('fill', NODE_COLORS[node.type] || '#94a3b8');
      circle.setAttribute('stroke', 'rgba(255, 255, 255, 0.2)');
      circle.setAttribute('stroke-width', '2');

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('y', radius + 11);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', '#f8fafc');
      text.setAttribute('font-size', '9.5');
      text.setAttribute('font-weight', '500');
      const label = node.label || node.id;
      text.textContent = label.length > 18 ? `${label.slice(0, 16)}…` : label;

      g.append(circle, text);

      g.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedNodeId = node.id;
        updateGraphSelection();
      });

      nodeGroup.append(g);
      return { node, g, circle, text };
    });
    viewport.append(nodeGroup);
    container.append(svg);

    svg.addEventListener('click', (e) => {
      if (e.target === svg || e.target === viewport) {
        selectedNodeId = null;
        updateGraphSelection();
      }
    });

    container.append(inspector);

    function updateGraphSelection() {
      const matchingType = (n) => activeTypeFilter === 'all' || n.type === activeTypeFilter;
      const matchingSearch = (n) => {
        if (!graphSearchQuery) return true;
        const haystack = `${n.label || ''} ${n.type || ''} ${JSON.stringify(n.meta || {})}`.toLowerCase();
        return haystack.includes(graphSearchQuery);
      };

      const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;
      const connectedNodeIds = new Set();
      if (selectedNode) {
        connectedNodeIds.add(selectedNode.id);
        edges.forEach((e) => {
          if (e.source === selectedNode.id) connectedNodeIds.add(e.target);
          if (e.target === selectedNode.id) connectedNodeIds.add(e.source);
        });
      }

      nodeElements.forEach(({ node, g, circle }) => {
        const matchesFilter = matchingType(node) && matchingSearch(node);
        const isSelected = selectedNode && node.id === selectedNode.id;
        const isNeighbor = selectedNode && connectedNodeIds.has(node.id);

        if (!matchesFilter) {
          g.style.opacity = '0.12';
          circle.setAttribute('stroke', 'none');
          return;
        }

        if (selectedNode) {
          if (isSelected) {
            g.style.opacity = '1';
            circle.setAttribute('stroke', '#ffffff');
            circle.setAttribute('stroke-width', '3.5');
          } else if (isNeighbor) {
            g.style.opacity = '0.95';
            circle.setAttribute('stroke', '#38bdf8');
            circle.setAttribute('stroke-width', '2');
          } else {
            g.style.opacity = '0.22';
            circle.setAttribute('stroke', 'none');
          }
        } else {
          g.style.opacity = '1';
          circle.setAttribute('stroke', 'rgba(255, 255, 255, 0.2)');
          circle.setAttribute('stroke-width', '2');
        }
      });

      edgeElements.forEach(({ edge, line }) => {
        if (selectedNode) {
          const isConnected = edge.source === selectedNode.id || edge.target === selectedNode.id;
          if (isConnected) {
            line.setAttribute('stroke', '#38bdf8');
            line.setAttribute('stroke-width', '2.2');
            line.style.opacity = '1';
          } else {
            line.style.opacity = '0.08';
          }
        } else {
          line.setAttribute('stroke', 'rgba(148, 163, 184, 0.25)');
          line.setAttribute('stroke-width', '1.2');
          line.style.opacity = '1';
        }
      });

      if (selectedNode) {
        inspector.classList.remove('hidden');
        renderInspector(selectedNode, connectedNodeIds);
      } else {
        inspector.classList.add('hidden');
        inspector.innerHTML = '';
      }
    }

    function renderInspector(node, neighborIds) {
      inspector.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'assistant-graph-inspector-head';

      const titleWrap = document.createElement('div');
      titleWrap.innerHTML = `<strong>${escapeHtml(node.label)}</strong> <span class="assistant-custom-prompt-tag">${escapeHtml(node.type)}</span>`;

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'quiet-button small-button';
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', () => {
        selectedNodeId = null;
        updateGraphSelection();
      });

      head.append(titleWrap, closeBtn);
      inspector.append(head);

      if (node.meta) {
        const metaList = document.createElement('div');
        metaList.style.fontSize = '12px';
        metaList.style.color = 'var(--muted, #666)';
        const metaEntries = Object.entries(node.meta).slice(0, 4);
        metaList.textContent = metaEntries.map(([k, v]) => `${k}: ${v}`).join(' • ');
        inspector.append(metaList);
      }

      const neighborsWrap = document.createElement('div');
      neighborsWrap.className = 'assistant-graph-neighbors';

      const neighborNodes = Array.from(neighborIds)
        .filter((id) => id !== node.id)
        .map((id) => nodeMap.get(id))
        .filter(Boolean);

      if (neighborNodes.length > 0) {
        const titleSpan = document.createElement('span');
        titleSpan.style.fontSize = '11.5px';
        titleSpan.style.fontWeight = '600';
        titleSpan.textContent = 'Связанные объекты:';
        neighborsWrap.append(titleSpan);

        neighborNodes.forEach((nb) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'assistant-graph-neighbor-chip';
          chip.textContent = `${nb.label} (${nb.type})`;
          chip.addEventListener('click', () => {
            selectedNodeId = nb.id;
            updateGraphSelection();
          });
          neighborsWrap.append(chip);
        });
        inspector.append(neighborsWrap);
      }

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '8px';
      actions.style.marginTop = '8px';

      const searchBtn = document.createElement('button');
      searchBtn.type = 'button';
      searchBtn.className = 'primary-button small-button';
      searchBtn.textContent = `🔍 Найти в архиве «${node.label.slice(0, 20)}»`;
      searchBtn.addEventListener('click', () => {
        setMode('archive-query');
        textareaEl.value = node.label;
        updateCharCount();
        handleProcess();
      });
      actions.append(searchBtn);
      inspector.append(actions);
    }

    resultsContainerEl.append(container);
  }

  function renderTemplateAnalyzeResult(result) {
    const wrap = document.createElement('div');
    wrap.className = 'assistant-template-result-wrap';

    if (result.templateRecommendation) {
      const rec = document.createElement('div');
      rec.className = 'assistant-summary-card';
      rec.innerHTML = `<strong>💡 Рекомендация по шаблону:</strong> ${escapeHtml(result.templateRecommendation)}`;
      wrap.append(rec);
    }

    if (result.summary) {
      const sumCard = document.createElement('div');
      sumCard.className = 'assistant-help-section';
      sumCard.style.marginBottom = '12px';
      sumCard.innerHTML = `<p>${escapeHtml(result.summary)}</p>`;
      wrap.append(sumCard);
    }

    const fields = Array.isArray(result.fields) ? [...result.fields] : [];

    const tableWrap = document.createElement('div');
    tableWrap.className = 'assistant-template-table-wrap';

    const table = document.createElement('table');
    table.className = 'assistant-template-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width: 26%;">Название реквизита</th>
          <th style="width: 28%;">Пример в тексте</th>
          <th style="width: 26%;">Маркер шаблона</th>
          <th style="width: 12%;">Область</th>
          <th style="width: 8%;"></th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');

    function renderRows() {
      tbody.innerHTML = '';
      fields.forEach((f, idx) => {
        const tr = document.createElement('tr');

        const tdLabel = document.createElement('td');
        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.className = 'assistant-template-input';
        labelInput.value = f.label || '';
        labelInput.addEventListener('input', (e) => { f.label = e.target.value; });
        tdLabel.append(labelInput);

        const tdSample = document.createElement('td');
        tdSample.textContent = f.sampleValue || '—';
        tdSample.style.color = 'var(--muted, #555)';
        tdSample.style.fontSize = '12px';

        const tdMarker = document.createElement('td');
        const markerInput = document.createElement('input');
        markerInput.type = 'text';
        markerInput.className = 'assistant-template-input assistant-template-marker';
        markerInput.value = f.suggestedMarker || `{{${f.key || 'field'}}}`;
        markerInput.addEventListener('input', (e) => { f.suggestedMarker = e.target.value; });
        tdMarker.append(markerInput);

        const tdScope = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = 'assistant-check-badge suggestion';
        badge.textContent = f.scope || 'document';
        tdScope.append(badge);

        const tdActions = document.createElement('td');
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'quiet-button small-button';
        delBtn.textContent = '✕';
        delBtn.title = 'Удалить поле';
        delBtn.addEventListener('click', () => {
          fields.splice(idx, 1);
          renderRows();
        });
        tdActions.append(delBtn);

        tr.append(tdLabel, tdSample, tdMarker, tdScope, tdActions);
        tbody.append(tr);
      });
    }

    renderRows();
    tableWrap.append(table);
    wrap.append(tableWrap);

    const toolbar = document.createElement('div');
    toolbar.style.display = 'flex';
    toolbar.style.flexWrap = 'wrap';
    toolbar.style.gap = '8px';
    toolbar.style.marginTop = '12px';
    toolbar.style.justifyContent = 'space-between';

    const leftButtons = document.createElement('div');
    leftButtons.style.display = 'flex';
    leftButtons.style.gap = '8px';

    const addFieldBtn = document.createElement('button');
    addFieldBtn.type = 'button';
    addFieldBtn.className = 'secondary-button small-button';
    addFieldBtn.textContent = '＋ Добавить реквизит';
    addFieldBtn.addEventListener('click', () => {
      const key = `custom_${Date.now()}`;
      fields.push({
        key,
        label: 'Новый реквизит',
        sampleValue: '',
        suggestedMarker: `{{${key}}}`,
        scope: 'custom'
      });
      renderRows();
    });

    const copyMarkersBtn = document.createElement('button');
    copyMarkersBtn.type = 'button';
    copyMarkersBtn.className = 'quiet-button small-button';
    copyMarkersBtn.textContent = '📋 Скопировать маркеры';
    copyMarkersBtn.addEventListener('click', () => {
      const text = fields.map((f) => f.suggestedMarker).filter(Boolean).join('\n');
      navigator.clipboard.writeText(text).then(() => showToast('Маркеры скопированы в буфер'));
    });

    leftButtons.append(addFieldBtn, copyMarkersBtn);

    const rightButtons = document.createElement('div');
    rightButtons.style.display = 'flex';
    rightButtons.style.gap = '8px';

    const applyToEditorBtn = document.createElement('button');
    applyToEditorBtn.type = 'button';
    applyToEditorBtn.className = 'primary-button small-button';
    applyToEditorBtn.textContent = '📄 Разметить текст в редакторе';
    applyToEditorBtn.title = 'Заменяет примеры значений на маркеры {{...}} в поле ввода';
    applyToEditorBtn.addEventListener('click', () => {
      let templated = textareaEl.value || '';
      fields.forEach((f) => {
        if (f.sampleValue && f.suggestedMarker && f.sampleValue.length > 1) {
          templated = templated.split(f.sampleValue).join(f.suggestedMarker);
        }
      });
      textareaEl.value = templated;
      updateCharCount();
      saveDraft();
      showToast('Текст в редакторе размечен маркерами шаблона!');
    });

    const saveAsPromptBtn = document.createElement('button');
    saveAsPromptBtn.type = 'button';
    saveAsPromptBtn.className = 'secondary-button small-button';
    saveAsPromptBtn.textContent = '💾 Сохранить как шаблон';
    saveAsPromptBtn.addEventListener('click', () => {
      openPromptEditorModal({
        title: 'Шаблон документа',
        mode: 'template-analyze',
        tag: 'Шаблоны',
        template: textareaEl.value
      });
    });

    rightButtons.append(applyToEditorBtn, saveAsPromptBtn);
    toolbar.append(leftButtons, rightButtons);
    wrap.append(toolbar);

    resultsContainerEl.append(wrap);
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
      adviceCard.innerHTML = `<strong>Рекомендация:</strong> ${escapeHtml(result.actionableAdvice)}`;
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
        if (m.verified) {
          const verifiedBadge = document.createElement('span');
          verifiedBadge.className = 'status-pill success';
          verifiedBadge.style.fontSize = '11px';
          verifiedBadge.style.padding = '2px 6px';
          verifiedBadge.textContent = '✓ Цитата найдена';
          head.append(verifiedBadge);
        }
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
        agHead.innerHTML = `<strong>Вопрос ${escapeHtml(ag.itemNumber)}:</strong> ${escapeHtml(ag.topic || 'Без названия')}`;
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
      sumCard.innerHTML = `<strong>Сводка:</strong> ${escapeHtml(data.executiveSummary)}`;
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
          <div class="assistant-fact-label">${escapeHtml(f.label)}</div>
          <div class="assistant-fact-value">${escapeHtml(f.value)}</div>
          <div class="assistant-fact-source">${escapeHtml(f.source || '')}</div>
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
        <div class="assistant-compliance-headline">${escapeHtml(data.summary || 'Советы и подсказки к оформлению')}</div>
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

  async function loadAssistantHistory({ append = false } = {}) {
    if (historyLoading) return;
    historyLoading = true;
    historyError = '';
    if (currentMode === 'history') renderHistoryView();
    try {
      const path = '/api/assistant/history?limit=30'
        + (append && historyNextCursor ? '&cursor=' + encodeURIComponent(historyNextCursor) : '');
      const response = await fetch(path);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || 'Не удалось получить историю.');
      historyRecords = append ? historyRecords.concat(payload.items || []) : (payload.items || []);
      historyNextCursor = payload.nextCursor || null;
    } catch (error) {
      historyError = error.message || 'История сейчас недоступна.';
    } finally {
      historyLoading = false;
      if (currentMode === 'history') renderHistoryView();
    }
  }

  async function openAssistantHistoryRecord(item) {
    try {
      const response = await fetch('/api/assistant/history/' + encodeURIComponent(item.id));
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || 'Запись недоступна.');
      const run = payload.entry;
      if (run.redacted) {
        showToast('Доступ к источнику отозван. Содержимое этого ответа скрыто.');
        return;
      }
      setMode(run.task);
      textareaEl.value = run.promptText || '';
      updateCharCount();
      saveDraft();
      resultsContainerEl.classList.remove('hidden');
      if (run.result) {
        renderResult(run.result, {
          sources: run.sources || [], durationMs: run.durationMs, rawResponse: run.rawResponse
        });
      } else {
        resultsContainerEl.textContent = run.status === 'aborted'
          ? 'Генерация была остановлена.' : 'Ответ не получен: ' + (run.error || run.status);
      }
      const label = document.createElement('p');
      label.className = 'assistant-history-restored';
      label.textContent = 'Сохранённый ответ · ' + new Date(run.createdAt).toLocaleString('ru-RU');
      resultsContainerEl.prepend(label);
    } catch (error) {
      showToast(error.message || 'Не удалось открыть ответ.');
    }
  }

  function renderHistoryView() {
    resultsContainerEl.classList.remove('hidden');
    resultsContainerEl.innerHTML = '';
    const wrap = document.createElement('section');
    wrap.className = 'assistant-history-view';

    const top = document.createElement('div');
    top.className = 'assistant-history-top';
    const title = document.createElement('h3');
    title.textContent = 'История запросов и ответов';
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'quiet-button small-button';
    refresh.textContent = 'Обновить';
    refresh.disabled = historyLoading;
    refresh.addEventListener('click', () => { void loadAssistantHistory(); });
    top.append(title, refresh);
    wrap.append(top);

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'assistant-history-search';
    search.placeholder = 'Найти в загруженной истории';
    search.setAttribute('aria-label', 'Поиск по истории запросов');
    search.value = historySearch;
    search.addEventListener('input', () => {
      historySearch = search.value;
      renderHistoryView();
      const next = resultsContainerEl.querySelector('.assistant-history-search');
      next?.focus();
      next?.setSelectionRange(historySearch.length, historySearch.length);
    });
    wrap.append(search);

    const filters = document.createElement('div');
    filters.className = 'assistant-history-filters';
    for (const [value, label] of [['all', 'Все'], ['success', 'Готовые'], ['favorites', 'Избранные']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'assistant-history-filter-btn' + (activeHistoryFilter === value ? ' active' : '');
      button.textContent = label;
      button.addEventListener('click', () => { activeHistoryFilter = value; renderHistoryView(); });
      filters.append(button);
    }
    wrap.append(filters);

    if (historyLoading || historyError) {
      const state = document.createElement('p');
      state.className = historyError ? 'error-text' : 'helper';
      state.textContent = historyError || 'Загрузка истории…';
      wrap.append(state);
    }
    const items = historyRecords.filter((item) => {
      if (activeHistoryFilter === 'success' && item.status !== 'completed') return false;
      if (activeHistoryFilter === 'favorites' && !isFavorite(item.promptText)) return false;
      return !historySearch || (item.promptText || '').toLocaleLowerCase('ru-RU')
        .includes(historySearch.toLocaleLowerCase('ru-RU'));
    });
    if (items.length === 0 && !historyLoading) {
      const empty = document.createElement('p');
      empty.className = 'helper';
      empty.textContent = historySearch ? 'В загруженной части истории совпадений нет.'
        : 'Сохранённых запросов пока нет.';
      wrap.append(empty);
    }
    const list = document.createElement('div');
    list.className = 'assistant-history-list';
    for (const item of items) {
      const row = document.createElement('article');
      row.className = 'assistant-history-item';
      const star = document.createElement('button');
      star.type = 'button';
      star.className = 'assistant-history-star-btn';
      star.textContent = isFavorite(item.promptText) ? '★' : '☆';
      star.setAttribute('aria-label', 'Добавить или убрать из избранного');
      star.addEventListener('click', () => {
        toggleFavorite({ query: item.promptText, mode: item.task });
        renderHistoryView();
      });
      row.append(star);

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'assistant-history-record';
      open.disabled = Boolean(item.redacted);
      const query = document.createElement('strong');
      query.textContent = item.redacted ? 'Ответ скрыт: недоступный источник'
        : (item.promptText || '(пустой запрос)').slice(0, 180);
      const meta = document.createElement('span');
      meta.className = 'assistant-history-meta';
      meta.textContent = [item.task, new Date(item.createdAt).toLocaleString('ru-RU'),
        item.status === 'completed' ? 'Готово' : item.status === 'aborted' ? 'Остановлено' : 'Ошибка'
      ].join(' · ');
      open.append(query, meta);
      open.addEventListener('click', () => { void openAssistantHistoryRecord(item); });
      row.append(open);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'quiet-button small-button';
      remove.textContent = 'Удалить';
      remove.setAttribute('aria-label', 'Удалить запись');
      remove.addEventListener('click', async () => {
        if (!window.confirm('Удалить этот сохранённый ответ?')) return;
        try {
          const response = await fetch('/api/assistant/history/' + encodeURIComponent(item.id), { method: 'DELETE' });
          if (!response.ok) throw new Error('Удалить запись не удалось.');
          historyRecords = historyRecords.filter((run) => run.id !== item.id);
          renderHistoryView();
        } catch (error) { showToast(error.message); }
      });
      row.append(remove);
      list.append(row);
    }
    wrap.append(list);

    if (historyNextCursor) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'secondary-button';
      more.textContent = 'Показать ещё';
      more.disabled = historyLoading;
      more.addEventListener('click', () => { void loadAssistantHistory({ append: true }); });
      wrap.append(more);
    }
    if (historyRecords.length) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'quiet-button small-button assistant-history-delete-all';
      clear.textContent = 'Удалить всю историю';
      clear.addEventListener('click', async () => {
        if (!window.confirm('Удалить все сохранённые ответы этого пользователя?')) return;
        try {
          const response = await fetch('/api/assistant/history', { method: 'DELETE' });
          if (!response.ok) throw new Error('Не удалось очистить историю.');
          historyRecords = [];
          historyNextCursor = null;
          renderHistoryView();
        } catch (error) { showToast(error.message); }
      });
      wrap.append(clear);
    }
    if (getHistory().length) {
      const note = document.createElement('p');
      note.className = 'helper assistant-history-legacy';
      note.textContent = 'Ранние записи сохранены в памяти этого браузера. Они не перенесены автоматически, поскольку не были привязаны к пользователю.';
      wrap.append(note);
    }
    resultsContainerEl.append(wrap);
  }

  function open(options = {}) {
    ensureElements();
    backdropEl.classList.remove('hidden');
    sheetEl.classList.remove('hidden');
    checkStatus();

    if (options.contextTitle) {
      contextBannerEl.classList.remove('hidden');
      contextBannerEl.innerHTML = `<strong>Контекст:</strong> ${escapeHtml(options.contextTitle)}`;
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
