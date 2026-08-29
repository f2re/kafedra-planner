export const ACTION_IDS = Object.freeze([
  'calendar.task.create','calendar.event.create','document.upload','plan.create','plan.upload',
  'plan.item.create','work.periodic.create','directive.create','meeting.create','template.create',
  'science.import','science.report','review.open'
]);

const ACTION_ID_SET = new Set(ACTION_IDS);
const GROUPS = Object.freeze([
  ['work','Работа'],['plans','Планы'],['documents','Документы'],
  ['meetings','Заседания'],['science','Наука'],['more','Ещё']
]);

function score(value, action, context) {
  return Number(typeof value === 'function' ? value(context, action) : value || 0);
}
function frequency(frequencies, id) {
  return Number(frequencies instanceof Map ? frequencies.get(id) || 0 : frequencies?.[id] || 0);
}
export function rankActions(actions, context = {}, frequencies = new Map()) {
  return actions.filter((action) => action?.id && action.available !== false).map((action, index) => ({
    ...action,
    _order: index,
    _score: [
      score(action.explicitScore, action, context), score(action.domainScore, action, context),
      score(action.periodScore, action, context), frequency(frequencies, action.id), Number(action.staticPriority || 0)
    ]
  })).sort((left, right) => {
    for (let index = 0; index < left._score.length; index += 1) {
      const difference = right._score[index] - left._score[index];
      if (difference) return difference;
    }
    return left._order - right._order;
  });
}
export function matchesActionQuery(action, query) {
  const terms = String(query || '').toLocaleLowerCase('ru-RU').trim().split(/\s+/u).filter(Boolean);
  if (!terms.length) return true;
  const haystack = [action.label, action.detail, ...(action.keywords || [])].filter(Boolean).join(' ').toLocaleLowerCase('ru-RU');
  return terms.every((term) => haystack.includes(term));
}
export function destinationFromDocument(document) {
  const documentId = document?.id || document?.document_id || null;
  const status = document?.processing_status || document?.status || 'unknown';
  if (['queued','extracting','processing','uploaded'].includes(status)) return { kind: 'processing', documentId };
  if (status === 'failed') return { kind: 'failed', documentId };
  const result = (Array.isArray(document?.extractionRuns) ? document.extractionRuns : []).find((run) => run?.result)?.result || null;
  if (result?.protocol?.id) return { kind: 'meeting', objectId: result.protocol.id, documentId };
  if (result?.plan?.id) return { kind: 'plan', objectId: result.plan.id, documentId };
  if (result?.directive?.id) return { kind: 'directive', objectId: result.directive.id, documentId };
  if (result?.science?.id) return { kind: 'science', objectId: result.science.id, documentId };
  if (document?.meetings?.[0]?.id) return { kind: 'meeting', objectId: document.meetings[0].id, documentId };
  if ((document?.review || document?.reviews || []).length) return { kind: 'review', documentId };
  return { kind: status === 'needs_review' ? 'review' : 'document', documentId };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const registry = new Map();
  const transportFetch = window.fetch.bind(window);
  const state = {
    open: false, group: 'work', query: '', date: null, opener: null, bypassCreate: false,
    documentId: null, uploadType: 'auto', pending: null, armed: false
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');

  function view() {
    return $('.nav-item.active[data-view],.mobile-tab.active[data-view]')?.dataset.view
      || $('[data-view-panel].active')?.dataset.viewPanel || 'calendar';
  }
  function groupFor(current = view()) {
    if (current === 'plans') return 'plans';
    if (['documents','templates','directive-archive'].includes(current)) return 'documents';
    if (current === 'meetings') return 'meetings';
    if (current === 'science') return 'science';
    if (current === 'review') return 'more';
    return 'work';
  }
  function periodScore(id, now = new Date()) {
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (id.endsWith('.report') && last - now.getDate() <= 5) return 20;
    if (['plan.create','plan.upload'].includes(id) && [8,9,12,1].includes(now.getMonth() + 1)) return 12;
    if (id === 'meeting.create' && now.getDate() >= 20) return 4;
    return 0;
  }
  function context() {
    const current = view();
    return {
      view: current, group: groupFor(current), explicitDate: state.date,
      reviewCount: Number($('#review-badge')?.textContent || 0),
      hasCurrentPlan: Boolean($('.plan-card.active[data-plan-id]')), now: new Date()
    };
  }
  function frequencies() {
    try { return window.kafedraUiPreferences?.ranking?.('action.center.action') || new Map(); }
    catch { return new Map(); }
  }
  function actions() {
    const ctx = context();
    return [...registry.values()].map((action) => ({
      ...action,
      available: action.available ? Boolean(action.available(ctx)) : true,
      explicitScore: action.explicitScore ? action.explicitScore(ctx) : 0,
      domainScore: action.domainScore ? action.domainScore(ctx) : (action.group === ctx.group ? 20 : 0),
      periodScore: action.periodScore ? action.periodScore(ctx) : periodScore(action.id, ctx.now)
    }));
  }
  function ranked() { return rankActions(actions(), context(), frequencies()); }

  function ensureUi() {
    if (!$('#action-center-styles')) {
      const link = document.createElement('link');
      link.id = 'action-center-styles'; link.rel = 'stylesheet'; link.href = '/action-center.css';
      document.head.append(link);
    }
    if (!$('#action-center-backdrop')) document.body.insertAdjacentHTML('beforeend', `
      <div id="action-center-backdrop" class="action-center-backdrop hidden"></div>
      <section id="action-center" class="action-center hidden" role="dialog" aria-modal="true" aria-labelledby="action-center-title">
        <header class="action-center-head"><div><span class="action-center-eyebrow">Быстрое действие</span><h2 id="action-center-title">Добавить</h2><p id="action-center-context"></p></div><button class="icon-button" type="button" data-action-center-close aria-label="Закрыть">×</button></header>
        <div class="action-center-body">
          <label class="action-center-search"><span aria-hidden="true">⌕</span><input id="action-center-search" type="search" placeholder="Что нужно сделать?" autocomplete="off"></label>
          <label id="action-center-drop" class="action-center-drop"><input id="action-center-file" type="file" hidden><span class="action-center-drop-icon" aria-hidden="true">↑</span><span><strong>Загрузить документ</strong><small>PDF, Word, Excel, ODS, текст или скан — назначение определится после сохранения.</small></span></label>
          <section id="action-center-status" class="action-center-status hidden" aria-live="polite"></section>
          <section class="action-center-section"><div class="action-center-section-head"><strong>Рекомендуется</strong><span>3 действия</span></div><div id="action-center-recommendations" class="action-center-recommendations"></div></section>
          <div id="action-center-groups" class="action-center-groups" role="tablist" aria-label="Группы действий"></div>
          <div id="action-center-list" class="action-center-list"></div>
        </div>
      </section>`);
    document.body.classList.add('action-center-ready');
    if ($('#create-button')) $('#create-button').textContent = '+ Добавить';
  }
  function dateText() {
    if (!state.date) return 'Выберите действие или просто загрузите документ.';
    const date = new Date(`${state.date}T09:00:00`);
    const label = Number.isNaN(date.getTime()) ? state.date : new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(date);
    return `Действия для ${label}. Выбранная дата важнее персональных подсказок.`;
  }
  function actionHtml(action, recommended = false) {
    return `<button type="button" class="action-center-action${recommended ? ' recommended' : ''}" data-action-center-action="${esc(action.id)}"><span class="action-center-action-icon" aria-hidden="true">${esc(action.icon || '＋')}</span><span><strong>${esc(action.label)}</strong><small>${esc(action.detail || '')}</small></span><span class="action-center-chevron" aria-hidden="true">›</span></button>`;
  }
  function render() {
    ensureUi();
    const list = ranked();
    $('#action-center-context').textContent = dateText();
    $('#action-center-groups').innerHTML = GROUPS.map(([id,label]) => `<button type="button" role="tab" aria-selected="${state.group === id}" class="${state.group === id ? 'active' : ''}" data-action-center-group="${id}">${label}</button>`).join('');
    $('#action-center-recommendations').innerHTML = list.slice(0,3).map((action) => actionHtml(action,true)).join('');
    const visible = list.filter((action) => state.query ? matchesActionQuery(action,state.query) : action.group === state.group);
    $('#action-center-list').innerHTML = visible.length ? visible.map((action) => actionHtml(action)).join('') : '<div class="action-center-empty">Подходящих действий нет. Можно загрузить документ — система определит дальнейший маршрут автоматически.</div>';
  }
  function openCenter({ date = null, opener = null } = {}) {
    ensureUi(); state.date = date; state.query = ''; state.group = date ? 'work' : groupFor(); state.opener = opener || document.activeElement; state.open = true;
    $('#action-center-search').value = ''; $('#action-center-status').classList.add('hidden'); render();
    $('#action-center-backdrop').classList.remove('hidden'); $('#action-center').classList.remove('hidden'); document.body.classList.add('action-center-open');
    requestAnimationFrame(() => $('#action-center-search')?.focus());
  }
  function closeCenter({ restoreFocus = true } = {}) {
    if (!state.open) return; state.open = false;
    $('#action-center-backdrop')?.classList.add('hidden'); $('#action-center')?.classList.add('hidden'); document.body.classList.remove('action-center-open');
    if (restoreFocus) requestAnimationFrame(() => state.opener?.focus?.());
  }
  function status(kind, title, body, buttons = '') {
    const element = $('#action-center-status');
    element.className = `action-center-status ${kind}`;
    element.innerHTML = `<strong>${esc(title)}</strong><span>${esc(body)}</span>${buttons}`;
  }
  async function waitFor(selector, attempts = 30, delay = 80) {
    for (let index = 0; index < attempts; index += 1) {
      const target = $(selector); if (target) return target;
      await new Promise((resolve) => setTimeout(resolve,delay));
    }
    return null;
  }
  async function activateView(name) {
    const button = $(`[data-view="${CSS.escape(name)}"]`); if (button) button.click(); else window.kafedraSetView?.(name);
    await new Promise((resolve) => setTimeout(resolve,0));
  }
  async function clickInView(name, selector, expandedForm = null) {
    await activateView(name);
    if (expandedForm) {
      const form = await waitFor(expandedForm,12);
      if (form && !form.classList.contains('work-smart-collapsed')) { form.querySelector('input,select,textarea')?.focus(); return; }
    }
    const target = await waitFor(selector); if (!target) throw new Error('Действие пока недоступно в текущем контексте.'); target.click();
  }

  function clearLearning() { state.pending = null; state.armed = false; }
  async function recordPreference(id) {
    if (!ACTION_ID_SET.has(id)) return;
    try {
      const interactionId = `action-center:${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
      await transportFetch('/api/ui-preferences',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({interactionId,choices:[{key:'action.center.action',value:id}]})});
    } catch {}
  }
  function requestMatches(action, method, path) {
    return Boolean(action?.mutation?.some((rule) => rule.method === method && rule.path.test(path)));
  }
  const observedFetch = window.fetch.bind(window);
  window.fetch = async function actionCenterFetch(input, init = {}) {
    const response = await observedFetch(input,init);
    try {
      const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const url = new URL(input instanceof Request ? input.url : String(input),window.location.origin);
      const pending = state.pending;
      if (response.ok && state.armed && pending && url.origin === window.location.origin && requestMatches(pending,method,url.pathname)) {
        clearLearning(); recordPreference(pending.id);
      }
    } catch {}
    return response;
  };

  function launchCalendar(kind) {
    const button = $('#create-button'); if (!button) throw new Error('Форма календаря недоступна.');
    state.bypassCreate = true; button.click(); state.bypassCreate = false;
    if ($('#event-kind')) $('#event-kind').value = kind;
    if ($('#event-date')) {
      if (state.date) { $('#event-date').value = state.date; $('#event-date').dataset.uiPreferenceExplicitDate = '1'; }
      else $('#event-date').dataset.uiPreferenceExplicitDate = '0';
    }
    $('#event-title')?.focus();
  }
  async function launchPlanCreate() {
    await activateView('plans');
    const create = await waitFor('[data-manual-create-plan]',10,80);
    if (create) return create.click();
    const fallback = await waitFor('[data-manual-calendar-add]',10,80);
    if (!fallback) throw new Error('Создание ручного плана пока недоступно.'); fallback.click();
  }
  async function launchAction(id) {
    const action = registry.get(id); if (!action || (action.available && !action.available(context()))) return;
    if (!action.keepOpen) closeCenter({restoreFocus:false});
    state.pending = action; state.armed = action.record === 'immediate';
    try {
      await action.launch(context());
      if (action.record === 'immediate') { clearLearning(); recordPreference(action.id); }
    } catch (error) {
      clearLearning(); openCenter({date:state.date,opener:state.opener}); status('error','Не удалось открыть действие',error.message || 'Попробуйте ещё раз.');
    }
  }
  async function exact(destination) {
    if (destination.kind === 'meeting') {
      closeCenter({restoreFocus:false});
      if (typeof window.kafedraOpenMeeting === 'function') return window.kafedraOpenMeeting(destination.objectId);
      return activateView('meetings');
    }
    if (destination.kind === 'plan') {
      closeCenter({restoreFocus:false}); await activateView('plans');
      (await waitFor(`[data-plan-id="${CSS.escape(destination.objectId)}"]`,35,100))?.click(); return;
    }
    if (destination.kind === 'directive') {
      closeCenter({restoreFocus:false}); await activateView('directive-archive');
      (await waitFor(`[data-directive-id="${CSS.escape(destination.objectId)}"]`,35,100))?.click(); return;
    }
    if (destination.kind === 'science') {
      closeCenter({restoreFocus:false}); await activateView('science');
      (await waitFor(`[data-science-id="${CSS.escape(destination.objectId)}"]`,35,100))?.click(); return;
    }
    closeCenter({restoreFocus:false}); window.kafedraSetView?.(destination.kind === 'review' ? 'review' : 'documents');
  }
  async function poll(documentId) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const response = await transportFetch(`/api/documents/${encodeURIComponent(documentId)}`);
      const document = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(document?.error?.message || `Ошибка HTTP ${response.status}`);
      const destination = destinationFromDocument(document);
      if (destination.kind === 'processing') {
        status('processing','Документ сохранён','Распознаём структуру и определяем рабочий сценарий. Исходник уже сохранён.');
        await new Promise((resolve) => setTimeout(resolve,350)); continue;
      }
      if (destination.kind === 'failed') {
        status('error','Исходник сохранён','Обработка завершилась ошибкой. Повторно загружать файл не нужно.', '<div class="action-center-status-actions"><button type="button" data-action-center-open-documents>Документы</button><button type="button" data-action-center-open-review>Проверка</button></div>'); return destination;
      }
      if (['meeting','plan','directive','science'].includes(destination.kind)) {
        const labels = {meeting:'заседание',plan:'план',directive:'распоряжение',science:'научную карточку'};
        status('success','Документ распознан',`Открываем ${labels[destination.kind]} именно из этого загруженного файла.`); await exact(destination); return destination;
      }
      if (destination.kind === 'review') {
        status('review','Нужно уточнение','Исходник и извлечённые данные сохранены. Открываем только вопросы, которые нельзя решить безопасно автоматически.'); await exact(destination); return destination;
      }
      status('success','Документ готов','Файл сохранён. Предметный тип не был угадан без достаточных оснований.'); await exact(destination); return destination;
    }
    status('processing','Документ сохранён','Обработка продолжается. Повторная загрузка не требуется.', '<div class="action-center-status-actions"><button type="button" data-action-center-open-documents>Документы</button></div>');
    return {kind:'processing',documentId};
  }
  async function upload(file) {
    if (!(file instanceof File) || !file.size) return;
    status('processing','Сохраняем исходник',`Файл «${file.name}» сначала будет сохранён неизменяемо.`);
    if (!state.pending) state.pending = registry.get('document.upload'); state.armed = true;
    try {
      const response = await window.fetch('/api/documents',{method:'POST',headers:{
        'content-type':file.type || 'application/octet-stream','x-file-name':encodeURIComponent(file.name),
        'x-document-type':state.uploadType || 'auto','idempotency-key':`action-center:${file.name}:${file.size}:${file.lastModified}`
      },body:file});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
      state.documentId = data.documentId; state.uploadType = 'auto'; await poll(data.documentId);
    } catch (error) {
      clearLearning(); state.uploadType = 'auto';
      status('error',state.documentId ? 'Исходник уже сохранён' : 'Не удалось сохранить документ',
        state.documentId ? 'Не загружайте файл повторно. Откройте уже сохранённый документ.' : error.message,
        state.documentId ? '<div class="action-center-status-actions"><button type="button" data-action-center-open-documents>Документы</button></div>' : '');
    }
  }
  function register(action) {
    if (!action || !ACTION_ID_SET.has(action.id)) throw new Error(`Unknown Action Center id: ${action?.id || ''}`);
    registry.set(action.id,Object.freeze({...action})); if (state.open) render();
  }
  const groupScore = (group) => (ctx) => ctx.group === group ? 20 : 0;
  const dateScore = (ctx) => ctx.explicitDate ? 100 : 0;
  register({id:'calendar.task.create',group:'work',label:'Создать задачу',detail:'Срок, категория и напоминание',icon:'✓',keywords:['задача','поручение','срок'],staticPriority:100,explicitScore:dateScore,domainScore:groupScore('work'),formSelector:'#event-form',mutation:[{method:'POST',path:/^\/api\/calendar$/u}],launch:()=>launchCalendar('task')});
  register({id:'calendar.event.create',group:'work',label:'Добавить событие',detail:'Событие или контрольная точка',icon:'○',keywords:['событие','календарь','дата'],staticPriority:90,explicitScore:dateScore,domainScore:groupScore('work'),formSelector:'#event-form',mutation:[{method:'POST',path:/^\/api\/calendar$/u}],launch:()=>launchCalendar('event')});
  register({id:'document.upload',group:'documents',label:'Загрузить документ',detail:'Тип и следующий шаг определятся автоматически',icon:'↑',keywords:['pdf','word','excel','файл','скан'],staticPriority:95,keepOpen:true,domainScore:groupScore('documents'),mutation:[{method:'POST',path:/^\/api\/documents$/u}],launch:()=>{state.uploadType='auto';$('#action-center-file')?.click();}});
  register({id:'plan.create',group:'plans',label:'Создать план',detail:'Новый план без исходного файла',icon:'▦',keywords:['план','годовой'],staticPriority:70,domainScore:groupScore('plans'),formSelector:'#manual-plan-create-form',mutation:[{method:'POST',path:/^\/api\/plans$/u}],launch:launchPlanCreate});
  register({id:'plan.upload',group:'plans',label:'Загрузить план',detail:'Word, Excel, ODS, PDF или текст',icon:'↑',keywords:['план','excel','xlsx','docx'],staticPriority:80,keepOpen:true,domainScore:groupScore('plans'),mutation:[{method:'POST',path:/^\/api\/documents$/u}],launch:()=>{state.uploadType='plan';$('#action-center-file')?.click();}});
  register({id:'plan.item.create',group:'plans',label:'Добавить пункт в план',detail:'Исполнители, даты и режим исполнения',icon:'＋',keywords:['пункт','мероприятие'],staticPriority:60,available:()=>Boolean($('[data-manual-add-item]')),explicitScore:dateScore,domainScore:(ctx)=>ctx.hasCurrentPlan?80:0,formSelector:'#manual-plan-item-form',mutation:[{method:'POST',path:/^\/api\/plans\/[^/]+\/items$/u}],launch:()=>{const button=$('[data-manual-add-item]');if(!button)throw new Error('Сначала откройте конкретный ручной план.');button.click();}});
  register({id:'work.periodic.create',group:'work',label:'Периодическая задача',detail:'Повторяющаяся работа по периоду',icon:'↻',keywords:['периодическая','регулярная'],staticPriority:55,domainScore:groupScore('work'),formSelector:'#periodic-task-form',mutation:[{method:'POST',path:/^\/api\/periodic-tasks$/u}],launch:()=>clickInView('work','#work-create-periodic','#periodic-task-form')});
  register({id:'directive.create',group:'documents',label:'Добавить распоряжение',detail:'Приказ, распоряжение, указ или поручение',icon:'⌑',keywords:['приказ','указ','распоряжение'],staticPriority:68,domainScore:groupScore('documents'),formSelector:'#directive-create-form',mutation:[{method:'POST',path:/^\/api\/directive-archive$/u}],launch:()=>clickInView('directive-archive','#directive-add')});
  register({id:'meeting.create',group:'meetings',label:'Создать заседание',detail:'Дата, повестка и участники',icon:'◫',keywords:['заседание','протокол','повестка'],staticPriority:68,domainScore:groupScore('meetings'),formSelector:'#meeting-create-form',mutation:[{method:'POST',path:/^\/api\/meetings$/u}],launch:()=>clickInView('meetings','#meeting-create-button')});
  register({id:'template.create',group:'documents',label:'Создать шаблон извлечения',detail:'На основе обработанного документа',icon:'◇',keywords:['шаблон','поля','извлечение'],staticPriority:40,domainScore:groupScore('documents'),mutation:[{method:'POST',path:/^\/api\/templates$/u}],launch:()=>clickInView('templates','#template-from-document')});
  register({id:'science.import',group:'science',label:'Импортировать научные данные',detail:'CSV, JSON, Excel или ODS',icon:'↑',keywords:['наука','импорт','статья','таблица'],staticPriority:48,domainScore:groupScore('science'),formSelector:'[data-science-import-mapping-form]',mutation:[{method:'POST',path:/^\/api\/science-imports$/u}],launch:()=>clickInView('science','[data-science-import-open]')});
  register({id:'science.report',group:'science',label:'Сформировать научный отчёт',detail:'DOCX или CSV по выбранному периоду',icon:'▤',keywords:['отчёт','наука','docx','csv'],staticPriority:45,domainScore:groupScore('science'),formSelector:'[data-science-report-form]',mutation:[{method:'POST',path:/^\/api\/science-reports$/u}],launch:()=>clickInView('science','[data-science-report-open]')});
  register({id:'review.open',group:'more',label:'Продолжить проверку',detail:'Только неоднозначности, требующие человека',icon:'!',keywords:['проверка','ошибка','неоднозначность'],staticPriority:35,domainScore:(ctx)=>ctx.reviewCount>0?90:(ctx.group==='more'?20:0),record:'immediate',launch:()=>window.kafedraSetView?.('review')});

  document.addEventListener('submit',(event)=>{if(state.pending?.formSelector&&event.target.matches(state.pending.formSelector))state.armed=true;},true);
  document.addEventListener('change',(event)=>{
    if(event.target.id==='action-center-file'){const file=event.target.files?.[0];event.target.value='';if(file)upload(file);return;}
  },true);
  document.addEventListener('dragover',(event)=>{if(state.open&&event.target.closest?.('#action-center-drop')){event.preventDefault();$('#action-center-drop')?.classList.add('dragging');}},true);
  document.addEventListener('dragleave',(event)=>{if(state.open&&event.target.closest?.('#action-center-drop'))$('#action-center-drop')?.classList.remove('dragging');},true);
  document.addEventListener('drop',(event)=>{if(!state.open||!event.target.closest?.('#action-center-drop'))return;event.preventDefault();$('#action-center-drop')?.classList.remove('dragging');const file=event.dataTransfer?.files?.[0];if(file){state.pending=registry.get('document.upload');state.armed=false;state.uploadType='auto';upload(file);}},true);
  document.addEventListener('click',(event)=>{
    if(event.target.closest?.('#action-center-drop')&&!event.target.closest?.('[data-action-center-action]')){state.pending=registry.get('document.upload');state.armed=false;state.uploadType='auto';}
    const create=event.target.closest?.('#create-button');if(create&&!state.bypassCreate){event.preventDefault();event.stopImmediatePropagation();openCenter({opener:create});return;}
    const day=event.target.closest?.('[data-new-on-date]');if(day){event.preventDefault();event.stopImmediatePropagation();openCenter({date:day.dataset.newOnDate||null,opener:day});return;}
    if(event.target.closest?.('[data-action-center-close]')||event.target.id==='action-center-backdrop'){event.preventDefault();closeCenter();return;}
    const group=event.target.closest?.('[data-action-center-group]');if(group){state.group=group.dataset.actionCenterGroup;render();return;}
    const action=event.target.closest?.('[data-action-center-action]');if(action){launchAction(action.dataset.actionCenterAction);return;}
    if(event.target.closest?.('[data-action-center-open-documents]')){closeCenter({restoreFocus:false});window.kafedraSetView?.('documents');return;}
    if(event.target.closest?.('[data-action-center-open-review]')){closeCenter({restoreFocus:false});window.kafedraSetView?.('review');return;}
    if(state.pending&&event.target.closest?.('[data-close-sheet],[data-manual-close],[data-meeting-modal-close],[data-directive-modal-close],[data-science-import-close],[data-science-report-close]'))clearLearning();
    if(state.pending?.id==='template.create'&&event.target.closest?.('#save-template'))state.armed=true;
  },true);
  document.addEventListener('input',(event)=>{if(event.target.id==='action-center-search'){state.query=event.target.value;render();}},true);
  document.addEventListener('keydown',(event)=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLocaleLowerCase()==='n'){event.preventDefault();event.stopImmediatePropagation();openCenter({opener:document.activeElement});return;}
    if(event.key==='Escape'&&state.open){event.preventDefault();event.stopImmediatePropagation();closeCenter();}
  },true);

  ensureUi();
  window.kafedraActions={register,open:openCenter,close:closeCenter,actions:()=>[...registry.values()],rank:ranked,destinationFromDocument};
}
