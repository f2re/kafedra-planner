const scienceLifecycleState = {
  itemId: null,
  item: null,
  plans: [],
  people: [],
  documents: [],
  mutationTimer: null
};

const $sl = (selector, root = document) => root.querySelector(selector);

function escScience(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

async function scienceLifecycleApi(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  return data;
}

function ensureScienceLifecycleStyles() {
  if ($sl('#science-lifecycle-next-styles')) return;
  const link = document.createElement('link');
  link.id = 'science-lifecycle-next-styles';
  link.rel = 'stylesheet';
  link.href = '/science-lifecycle-next.css';
  document.head.append(link);
}

function ensureScienceLifecycleModal() {
  if ($sl('#science-lifecycle-modal')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="science-lifecycle-backdrop" class="science-lifecycle-backdrop hidden"></div>
    <section id="science-lifecycle-modal" class="science-lifecycle-modal hidden" role="dialog" aria-modal="true" aria-labelledby="science-lifecycle-modal-title"></section>
  `);
}

function closeScienceLifecycleModal() {
  $sl('#science-lifecycle-backdrop')?.classList.add('hidden');
  $sl('#science-lifecycle-modal')?.classList.add('hidden');
  document.body.classList.remove('science-lifecycle-modal-open');
}

function showScienceLifecycleModal(html) {
  ensureScienceLifecycleModal();
  $sl('#science-lifecycle-modal').innerHTML = html;
  $sl('#science-lifecycle-backdrop').classList.remove('hidden');
  $sl('#science-lifecycle-modal').classList.remove('hidden');
  document.body.classList.add('science-lifecycle-modal-open');
}

function lifecycleLabel(value) {
  return {
    idea: 'Замысел', drafting: 'Готовится', submitted: 'Подано', revision: 'Доработка',
    accepted: 'Принято', published: 'Опубликовано', rejected: 'Отклонено', archived: 'Архив'
  }[value] || value;
}

function kindLabel(value) {
  return {
    article: 'Статья', conference: 'Конференция', grant: 'Грант', patent: 'Патент',
    project: 'Проект', research_report: 'Отчёт НИР', other: 'Другое'
  }[value] || value;
}

function dateLabel(value) {
  if (!value) return 'не указана';
  const date = new Date(`${String(value).slice(0, 10)}T09:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function formError(form, message = '') {
  let target = $sl('[data-science-lifecycle-error]', form);
  if (!target) {
    target = document.createElement('div');
    target.dataset.scienceLifecycleError = '1';
    target.className = 'science-lifecycle-error hidden';
    target.setAttribute('role', 'alert');
    $sl('.science-lifecycle-actions', form)?.insertAdjacentElement('beforebegin', target);
  }
  target.textContent = message;
  target.classList.toggle('hidden', !message);
}

async function loadLifecycleItem(itemId = scienceLifecycleState.itemId) {
  if (!itemId) return null;
  const item = await scienceLifecycleApi(`/api/science/${encodeURIComponent(itemId)}/lifecycle`);
  scienceLifecycleState.itemId = itemId;
  scienceLifecycleState.item = item;
  decorateScienceInspector();
  return item;
}

function affiliationList(item) {
  if (!(item.affiliations || []).length) return '<span class="science-lifecycle-muted">Аффилиации не определены.</span>';
  return `<ul class="science-affiliation-list">${item.affiliations.map((row) => `
    <li><strong>${escScience(row.author_raw)}</strong><span>${escScience(row.unit_name_snapshot || row.unit_name || 'Подразделение не указано')}${row.position_name_snapshot || row.position_name ? ` · ${escScience(row.position_name_snapshot || row.position_name)}` : ''}</span><small>на ${escScience(dateLabel(row.valid_on))}${row.source_kind === 'manual' ? ' · исправлено вручную' : ''}</small></li>
  `).join('')}</ul>`;
}

function decorateScienceInspector() {
  const item = scienceLifecycleState.item;
  const body = $sl('#ux-inspector-body');
  if (!item || !body || !$sl('#ux-inspector') || $sl('#ux-inspector').classList.contains('hidden')) return;
  let panel = $sl('#science-lifecycle-panel', body);
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'science-lifecycle-panel';
    panel.className = 'inspector-section science-lifecycle-panel';
    body.append(panel);
  }
  panel.innerHTML = `
    <header class="science-lifecycle-summary">
      <div><span class="science-lifecycle-chip" data-status="${escScience(item.lifecycle_status)}">${escScience(lifecycleLabel(item.lifecycle_status))}</span><strong>${escScience(kindLabel(item.kind))}</strong></div>
      <div class="science-lifecycle-panel-actions"><button class="secondary-button" type="button" data-science-editor>Изменить карточку</button><button class="secondary-button" type="button" data-science-transition>Изменить этап</button></div>
    </header>
    <dl class="science-lifecycle-facts">
      <div><dt>Следующее действие</dt><dd>${escScience(item.next_action || 'не указано')}</dd></div>
      <div><dt>Срок</dt><dd>${escScience(dateLabel(item.next_action_due))}</dd></div>
      <div><dt>Целевое издание/мероприятие</dt><dd>${escScience(item.target_venue || item.venue || 'не указано')}</dd></div>
      <div><dt>Связь с планом</dt><dd>${item.plan_link ? `${escScience(item.plan_link.plan_title)} · ${escScience(item.plan_link.plan_item_title)}` : 'не создана'}</dd></div>
    </dl>
    <div class="science-lifecycle-subhead"><strong>Аффилиации на дату публикации</strong></div>
    ${affiliationList(item)}
    <div class="science-lifecycle-inline-actions">
      ${item.plan_link ? `<button class="secondary-button" type="button" data-open-plan-source="${escScience(item.plan_link.plan_id)}">Открыть план</button><button class="quiet-button" type="button" data-science-unlink-plan>Убрать связь</button>` : '<button class="primary-button" type="button" data-science-link-plan>Добавить в план</button>'}
    </div>
    ${(item.lifecycle_events || []).length ? `<details><summary>История этапов · ${item.lifecycle_events.length}</summary><ol class="science-lifecycle-history">${item.lifecycle_events.map((event) => `<li><strong>${escScience(lifecycleLabel(event.to_status))}</strong><span>${escScience(dateLabel(event.event_date))}${event.note ? ` · ${escScience(event.note)}` : ''}</span></li>`).join('')}</ol></details>` : ''}
  `;
}

function authorsText(item) {
  return (item.authors || []).map((author) => typeof author === 'string' ? author : author.name).filter(Boolean).join('\n');
}

function editorForm(item) {
  return `
    <header class="science-lifecycle-modal-head"><div><span>Подтверждённая коррекция</span><h3 id="science-lifecycle-modal-title">Изменить научную карточку</h3></div><button class="icon-button" type="button" data-science-lifecycle-close>×</button></header>
    <form class="science-lifecycle-modal-body" data-science-editor-form>
      <label class="field"><span>Название</span><input name="title" value="${escScience(item.title)}" required></label>
      <div class="science-lifecycle-grid-two">
        <label class="field"><span>Вид</span><select name="kind">${[['article','Статья'],['conference','Конференция'],['grant','Грант'],['patent','Патент'],['project','Проект'],['research_report','Отчёт НИР'],['other','Другое']].map(([value,label]) => `<option value="${value}" ${item.kind === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label class="field"><span>Год</span><input name="publicationYear" type="number" min="1900" max="2200" value="${escScience(item.publication_year || '')}"></label>
      </div>
      <div class="science-lifecycle-grid-two">
        <label class="field"><span>DOI</span><input name="doi" value="${escScience(item.doi || '')}"></label>
        <label class="field"><span>Дата публикации</span><input name="publishedAt" type="date" value="${escScience(item.published_at || '')}"></label>
      </div>
      <label class="field"><span>Издание или мероприятие</span><input name="venue" value="${escScience(item.venue || '')}"></label>
      <label class="field"><span>Авторы, по одному в строке</span><textarea name="authors" rows="4" required>${escScience(authorsText(item))}</textarea></label>
      <label class="field"><span>Классификации через запятую</span><input name="classifications" value="${escScience((item.classifications || []).join(', '))}"></label>
      <label class="field"><span>Следующее действие</span><input name="nextAction" value="${escScience(item.next_action || '')}" placeholder="Например, отправить доработанную рукопись"></label>
      <div class="science-lifecycle-grid-two">
        <label class="field"><span>Срок действия</span><input name="nextActionDue" type="date" value="${escScience(item.next_action_due || '')}"></label>
        <label class="field"><span>Целевое издание</span><input name="targetVenue" value="${escScience(item.target_venue || '')}"></label>
      </div>
      <label class="field"><span>Причина исправления</span><textarea name="reason" rows="2" required placeholder="Например, уточнено по опубликованной статье"></textarea></label>
      <p class="science-lifecycle-helper">Исходное извлечённое значение останется в доказательстве. Коррекция сохранится отдельной ревизией.</p>
      <div class="science-lifecycle-actions"><button class="secondary-button" type="button" data-science-lifecycle-close>Отмена</button><button class="primary-button" type="submit">Сохранить</button></div>
    </form>`;
}

async function loadDocuments() {
  if (scienceLifecycleState.documents.length) return scienceLifecycleState.documents;
  const data = await scienceLifecycleApi('/api/documents?limit=500');
  scienceLifecycleState.documents = data.items || [];
  return scienceLifecycleState.documents;
}

function transitionForm(item) {
  return `
    <header class="science-lifecycle-modal-head"><div><span>Научная работа</span><h3 id="science-lifecycle-modal-title">Изменить этап</h3></div><button class="icon-button" type="button" data-science-lifecycle-close>×</button></header>
    <form class="science-lifecycle-modal-body" data-science-transition-form>
      <div class="science-lifecycle-grid-two">
        <label class="field"><span>Новый этап</span><select name="status">${[['idea','Замысел'],['drafting','Готовится'],['submitted','Подано'],['revision','Доработка'],['accepted','Принято'],['published','Опубликовано'],['rejected','Отклонено'],['archived','Архив']].map(([value,label]) => `<option value="${value}" ${item.lifecycle_status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label class="field"><span>Дата события</span><input name="eventDate" type="date" value="${new Date().toISOString().slice(0,10)}" required></label>
      </div>
      <label class="field"><span>Пояснение</span><textarea name="note" rows="2" placeholder="Например, получено письмо редакции"></textarea></label>
      <label class="field"><span>Подтверждающий документ</span><select name="evidenceDocumentVersionId"><option value="">Не выбран</option>${scienceLifecycleState.documents.map((document) => `<option value="${escScience(document.current_version_id || '')}">${escScience(document.title || document.original_name)}</option>`).join('')}</select></label>
      <label class="field"><span>Следующее действие</span><input name="nextAction" value="${escScience(item.next_action || '')}"></label>
      <div class="science-lifecycle-grid-two"><label class="field"><span>Срок</span><input name="nextActionDue" type="date" value="${escScience(item.next_action_due || '')}"></label><label class="field"><span>Целевое издание</span><input name="targetVenue" value="${escScience(item.target_venue || '')}"></label></div>
      <div class="science-lifecycle-actions"><button class="secondary-button" type="button" data-science-lifecycle-close>Отмена</button><button class="primary-button" type="submit">Сохранить этап</button></div>
    </form>`;
}

async function loadPlanChoices() {
  const [plans, people] = await Promise.all([
    scienceLifecycleApi('/api/plans?limit=500'),
    scienceLifecycleApi('/api/people')
  ]);
  scienceLifecycleState.plans = (plans.items || []).filter((plan) => plan.origin_kind === 'manual' && plan.status === 'active');
  scienceLifecycleState.people = (people.items || []).filter((person) => person.status !== 'inactive');
}

function peopleChecks() {
  return scienceLifecycleState.people.map((person) => `<label class="science-person-choice"><input type="checkbox" name="executorPersonIds" value="${escScience(person.id)}"><span>${escScience(person.display_name)}</span></label>`).join('') || '<div class="science-lifecycle-helper">Сотрудники не добавлены.</div>';
}

function peopleOptions() {
  return `<option value="">Не выбран</option>${scienceLifecycleState.people.map((person) => `<option value="${escScience(person.id)}">${escScience(person.display_name)}</option>`).join('')}`;
}

function planLinkForm(item) {
  return `
    <header class="science-lifecycle-modal-head"><div><span>Наука → план</span><h3 id="science-lifecycle-modal-title">Добавить мероприятие в план</h3></div><button class="icon-button" type="button" data-science-lifecycle-close>×</button></header>
    <form class="science-lifecycle-modal-body" data-science-plan-form>
      <label class="field"><span>План</span><select name="planId" required>${scienceLifecycleState.plans.map((plan) => `<option value="${escScience(plan.id)}">${escScience(plan.title)} · ${escScience(plan.period_key || '')}</option>`).join('')}</select></label>
      <label class="field"><span>Мероприятие</span><input name="title" value="${escScience(item.next_action || `Подготовить: ${item.title}`)}" required></label>
      <div class="science-lifecycle-grid-two"><label class="field"><span>Начало</span><input name="startsAt" type="date"></label><label class="field"><span>Контрольный срок</span><input name="dueDate" type="date" value="${escScience(item.next_action_due || '')}"></label></div>
      <label class="field"><span>Режим исполнения</span><select name="executionMode" data-science-execution-mode><option value="track">Контрольная точка</option><option value="assigned">Поручение</option><option value="open">Открытая задача</option></select></label>
      <section class="science-executors hidden" data-science-executors><strong>Исполнители</strong><div class="science-people-list">${peopleChecks()}</div><label class="field"><span>Контролирует</span><select name="controllerPersonId">${peopleOptions()}</select></label></section>
      <div class="science-lifecycle-actions"><button class="secondary-button" type="button" data-science-lifecycle-close>Отмена</button><button class="primary-button" type="submit">Добавить в план</button></div>
    </form>`;
}

async function saveEditor(form) {
  const data = new FormData(form);
  const submit = $sl('button[type="submit"]', form);
  submit.disabled = true;
  formError(form, '');
  try {
    const item = await scienceLifecycleApi(`/api/science/${encodeURIComponent(scienceLifecycleState.itemId)}/editor`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: data.get('title'), kind: data.get('kind'), doi: data.get('doi') || null,
        publicationYear: data.get('publicationYear') || null, publishedAt: data.get('publishedAt') || null,
        venue: data.get('venue') || null,
        authors: String(data.get('authors') || '').split(/\r?\n/u).map((name) => name.trim()).filter(Boolean),
        classifications: String(data.get('classifications') || '').split(',').map((value) => value.trim()).filter(Boolean),
        nextAction: data.get('nextAction') || null, nextActionDue: data.get('nextActionDue') || null,
        targetVenue: data.get('targetVenue') || null, reason: data.get('reason')
      })
    });
    scienceLifecycleState.item = item;
    closeScienceLifecycleModal();
    decorateScienceInspector();
  } catch (error) {
    formError(form, error.message);
    submit.disabled = false;
  }
}

async function saveTransition(form) {
  const data = new FormData(form);
  const submit = $sl('button[type="submit"]', form);
  submit.disabled = true;
  formError(form, '');
  try {
    const item = await scienceLifecycleApi(`/api/science/${encodeURIComponent(scienceLifecycleState.itemId)}/lifecycle-events`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: data.get('status'), eventDate: data.get('eventDate'), note: data.get('note') || null,
        evidenceDocumentVersionId: data.get('evidenceDocumentVersionId') || null,
        nextAction: data.get('nextAction') || null, nextActionDue: data.get('nextActionDue') || null,
        targetVenue: data.get('targetVenue') || null
      })
    });
    scienceLifecycleState.item = item;
    closeScienceLifecycleModal();
    decorateScienceInspector();
  } catch (error) {
    formError(form, error.message);
    submit.disabled = false;
  }
}

async function savePlanLink(form) {
  const data = new FormData(form);
  const submit = $sl('button[type="submit"]', form);
  submit.disabled = true;
  formError(form, '');
  try {
    const item = await scienceLifecycleApi(`/api/science/${encodeURIComponent(scienceLifecycleState.itemId)}/plan-link`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        planId: data.get('planId'), title: data.get('title'), startsAt: data.get('startsAt') || null,
        dueDate: data.get('dueDate') || null, executionMode: data.get('executionMode'),
        executorPersonIds: data.getAll('executorPersonIds'), controllerPersonId: data.get('controllerPersonId') || null
      })
    });
    scienceLifecycleState.item = item;
    closeScienceLifecycleModal();
    decorateScienceInspector();
  } catch (error) {
    formError(form, error.message);
    submit.disabled = false;
  }
}

document.addEventListener('click', async (event) => {
  const scienceCard = event.target.closest('[data-science-id]');
  if (scienceCard) {
    scienceLifecycleState.itemId = scienceCard.dataset.scienceId;
    setTimeout(() => loadLifecycleItem().catch(() => {}), 80);
  }
  if (event.target.closest('[data-science-lifecycle-close]') || event.target === $sl('#science-lifecycle-backdrop')) return closeScienceLifecycleModal();
  if (event.target.closest('[data-science-editor]')) return showScienceLifecycleModal(editorForm(scienceLifecycleState.item));
  if (event.target.closest('[data-science-transition]')) {
    await loadDocuments();
    return showScienceLifecycleModal(transitionForm(scienceLifecycleState.item));
  }
  if (event.target.closest('[data-science-link-plan]')) {
    await loadPlanChoices();
    if (!scienceLifecycleState.plans.length) return showScienceLifecycleModal(`<header class="science-lifecycle-modal-head"><div><h3 id="science-lifecycle-modal-title">Сначала создайте ручной план</h3></div><button class="icon-button" type="button" data-science-lifecycle-close>×</button></header><div class="science-lifecycle-modal-body"><p>Импортированный план нельзя молча изменять. Создайте ручной план или добавьте пункт из раздела «Планы».</p><div class="science-lifecycle-actions"><button class="primary-button" type="button" data-science-lifecycle-close>Понятно</button></div></div>`);
    return showScienceLifecycleModal(planLinkForm(scienceLifecycleState.item));
  }
  if (event.target.closest('[data-science-unlink-plan]')) {
    showScienceLifecycleModal(`<header class="science-lifecycle-modal-head"><div><span>Связь с планом</span><h3 id="science-lifecycle-modal-title">Убрать связь</h3></div><button class="icon-button" type="button" data-science-lifecycle-close>×</button></header><form class="science-lifecycle-modal-body" data-science-unlink-form><p>Пункт плана и поручение сохранятся. Удалится только связь с научной карточкой.</p><label class="field"><span>Причина</span><textarea name="reason" required rows="2"></textarea></label><div class="science-lifecycle-actions"><button class="secondary-button" type="button" data-science-lifecycle-close>Отмена</button><button class="primary-button" type="submit">Убрать связь</button></div></form>`);
  }
}, true);

document.addEventListener('change', (event) => {
  if (event.target.matches('[data-science-execution-mode]')) {
    $sl('[data-science-executors]', event.target.form)?.classList.toggle('hidden', event.target.value === 'track');
  }
});

document.addEventListener('submit', async (event) => {
  const editor = event.target.closest('[data-science-editor-form]');
  if (editor) { event.preventDefault(); saveEditor(editor); return; }
  const transition = event.target.closest('[data-science-transition-form]');
  if (transition) { event.preventDefault(); saveTransition(transition); return; }
  const plan = event.target.closest('[data-science-plan-form]');
  if (plan) { event.preventDefault(); savePlanLink(plan); return; }
  const unlink = event.target.closest('[data-science-unlink-form]');
  if (unlink) {
    event.preventDefault();
    const submit = $sl('button[type="submit"]', unlink);
    submit.disabled = true;
    try {
      scienceLifecycleState.item = await scienceLifecycleApi(`/api/science/${encodeURIComponent(scienceLifecycleState.itemId)}/unlink-plan`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: new FormData(unlink).get('reason') })
      });
      closeScienceLifecycleModal();
      decorateScienceInspector();
    } catch (error) {
      formError(unlink, error.message);
      submit.disabled = false;
    }
  }
});

new MutationObserver(() => {
  clearTimeout(scienceLifecycleState.mutationTimer);
  scienceLifecycleState.mutationTimer = setTimeout(decorateScienceInspector, 50);
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });

ensureScienceLifecycleStyles();
ensureScienceLifecycleModal();
window.kafedraLoadScienceLifecycle = loadLifecycleItem;
