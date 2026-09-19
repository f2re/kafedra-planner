const VERSION = 'search-evidence-v1';
const qs = (selector) => document.querySelector(selector);
const preferenceKey = 'kafedra.search-assistant.disabled';
const client = [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export function createSearchAssistantUi({ isActive, currentParams, openItem }) {
  let root;
  let list;
  let status;
  let checkbox;
  let retry;
  let disclosure;
  let timer;
  let active;
  let sequence = 0;
  let last;
  let enabled = true;
  try { enabled = sessionStorage.getItem(preferenceKey) !== '1'; } catch { /* Private browsing may disable storage. */ }

  function ensureUi() {
    if (root) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = '/search-assistant.css';
    document.head.append(link);
    root = document.createElement('section');
    root.id = 'search-assistant'; root.className = 'search-assistant';
    root.setAttribute('aria-label', 'Подсказки по найденным материалам');
    const header = document.createElement('div'); header.className = 'search-assistant-header';
    const label = document.createElement('label');
    checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = enabled;
    label.append(checkbox, document.createTextNode('Подсказки'));
    status = document.createElement('span'); status.setAttribute('role', 'status');
    retry = document.createElement('button'); retry.type = 'button'; retry.className = 'text-button';
    retry.textContent = 'Повторить подбор'; retry.hidden = true;
    header.append(label, status, retry);
    disclosure = document.createElement('details'); disclosure.hidden = true;
    const summary = document.createElement('summary'); summary.textContent = 'Показать фрагменты';
    const note = document.createElement('p'); note.className = 'search-assistant-note';
    note.textContent = 'Выдержки из поисковой выдачи. Перед включением в отчёт проверьте исходный материал.';
    list = document.createElement('ul');
    disclosure.append(summary, note, list);
    root.append(header, disclosure);
    qs('#search-filters')?.after(root);
    checkbox.addEventListener('change', () => {
      enabled = checkbox.checked;
      try { sessionStorage.setItem(preferenceKey, enabled ? '0' : '1'); } catch { /* Preference remains valid in this tab. */ }
      if (last) start(last.params, last.payload);
    });
    retry.addEventListener('click', () => { if (last) start(last.params, last.payload); });
  }

  function cancel() {
    ++sequence;
    clearTimeout(timer);
    timer = null;
    const previous = active;
    active = null;
    previous?.controller?.abort();
    if (previous?.started) {
      const params = new URLSearchParams({ assist: 'cancel', assistContext: client, assistGeneration: previous.generation });
      // Cancellation is scoped to this tab and generation, so a late cancellation cannot stop a newer search.
      fetch(`/api/search?${params}`, { headers: { 'x-kafedra-assistant': VERSION }, keepalive: true }).catch(() => {});
    }
    if (root) {
      root.hidden = true;
      disclosure.hidden = true;
      disclosure.open = false;
      list.replaceChildren();
    }
  }

  function display(payload) {
    const advice = payload.assistant || { status: 'disabled' };
    retry.hidden = true;
    disclosure.hidden = true;
    list.replaceChildren();
    if (advice.status === 'disabled') { root.hidden = true; return; }
    if (advice.status === 'ready') {
      const items = new Map((payload.items || []).map((item) => [`${item.source_kind}:${item.source_id}`, item]));
      for (const suggestion of advice.suggestions || []) {
        const item = items.get(suggestion.id);
        if (!item?.route || typeof suggestion.quote !== 'string') continue;
        const row = document.createElement('li');
        const open = document.createElement('button'); open.type = 'button'; open.className = 'search-assistant-source';
        open.textContent = item.title || 'Открыть материал';
        open.setAttribute('aria-label', `Открыть: ${item.title || 'материал'}`);
        const quote = document.createElement('blockquote'); quote.textContent = suggestion.quote;
        open.addEventListener('click', async () => {
          open.disabled = true;
          try { await openItem(item); } catch { status.textContent = 'Материал изменился. Повторите поиск.'; }
          finally { open.disabled = false; }
        });
        row.append(open, quote);
        list.append(row);
      }
      status.textContent = list.childElementCount ? `Подобрано фрагментов: ${list.childElementCount}` : 'Подходящих фрагментов не найдено';
      disclosure.hidden = !list.childElementCount;
      return;
    }
    status.textContent = {
      queued: 'Подбор ожидает очереди…', running: 'Подбираю фрагменты…', empty: 'Недостаточно материала для подсказок',
      idle: 'Материалы изменились. Подбор можно повторить.', busy: 'Подбор занят. Обычный поиск доступен.',
      rejected: 'Ответ модели не прошёл проверку. Используйте обычную выдачу.',
      unavailable: 'Подсказки временно недоступны. Обычный поиск доступен.'
    }[advice.status] || 'Обычный поиск доступен.';
    retry.hidden = !['idle', 'busy', 'unavailable', 'rejected'].includes(advice.status);
  }

  function start(params, payload) {
    cancel();
    last = { params: new URLSearchParams(params), payload };
    if (!isActive() || !payload.assistant || payload.assistant.status === 'disabled'
      || !payload.items?.length || (params.get('q') || '').trim().length < 3) return;
    ensureUi();
    root.hidden = false;
    retry.hidden = true;
    checkbox.checked = enabled;
    if (!enabled) { status.textContent = 'Выключены в этой вкладке'; return; }
    status.textContent = 'Подбираю фрагменты…';
    const ticket = sequence;
    const run = { generation: String(ticket), started: false, controller: new AbortController(), polls: 0 };
    active = run;
    const requestParams = new URLSearchParams(params);
    requestParams.set('assistContext', client);
    requestParams.set('assistGeneration', run.generation);
    const live = () => active === run && sequence === ticket && !run.controller.signal.aborted && isActive();
    async function poll(mode) {
      if (!live()) return;
      requestParams.set('assist', mode);
      run.started = true;
      try {
        const response = await fetch(`/api/search?${requestParams}`, {
          signal: run.controller.signal, headers: { 'x-kafedra-assistant': VERSION }, cache: 'no-store'
        });
        if (!live()) return;
        if (response.status === 401 || response.status === 403) { cancel(); return; }
        if (!response.ok) throw new Error('search_unavailable');
        const result = await response.json();
        if (!live()) return;
        display(result);
        if (['queued', 'running'].includes(result.assistant?.status)) {
          if (++run.polls >= 12) {
            cancel(); root.hidden = false;
            status.textContent = 'Подбор занимает больше времени. Обычный поиск доступен.';
            retry.hidden = false;
            return;
          }
          timer = setTimeout(() => poll('poll'), Math.min(4000, 1500 + run.polls * 300));
        } else {
          run.started = false;
          active = null;
        }
      } catch (error) {
        if (!live() || error?.name === 'AbortError') return;
        cancel(); root.hidden = false;
        status.textContent = 'Подсказки временно недоступны. Обычный поиск доступен.';
        retry.hidden = false;
      }
    }
    // Do not spend model time on each keystroke; the ordinary search has already finished.
    timer = setTimeout(() => poll('start'), 700);
  }

  function resume() {
    if (!active && last && isActive() && currentParams().toString() === last.params.toString()) {
      start(last.params, last.payload);
    }
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); else resume(); });
  window.addEventListener('pagehide', cancel);
  return { start, cancel, resume };
}
