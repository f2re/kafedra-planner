import {
  meetingsState,
  $m,
  escMeeting,
  meetingApi,
  openMeetingModal,
  showMeetingNotice
} from './meetings-state.js';
import { openMeetingTemplateEditor, refreshMeetingSettingsState } from './meeting-template-editor.js';

let installed = false;
let libraryState = { items: [], includeArchived: false, pendingVersion: null };

function ensureStyles() {
  if ($m('#meeting-template-library-styles')) return;
  const link = document.createElement('link');
  link.id = 'meeting-template-library-styles';
  link.rel = 'stylesheet';
  link.href = '/meeting-template-library.css';
  document.head.append(link);
}

function readinessLabel(item) {
  if (item.lifecycle_status === 'archived') return 'Архив';
  return {
    ready: item.draft_profile_revision ? `Готов · черновик ${item.draft_profile_revision}` : 'Готов',
    legacy_compatible: 'Готов · совместимый',
    draft: 'Черновик',
    needs_setup: 'Требует настройки',
    error: 'Ошибка'
  }[item.readiness] || 'Требует проверки';
}

function kindLabel(kind) {
  return kind === 'extract' ? 'Выписка' : 'Протокол';
}

function versionLabel(item) {
  return `Версия ${Number(item.version_no || 1)}`;
}

function usageLabel(item) {
  const values = [
    Number(item.meeting_count || 0) ? `${Number(item.meeting_count)} заседаний` : null,
    Number(item.generated_document_count || 0) ? `${Number(item.generated_document_count)} документов` : null,
    Number(item.test_run_count || 0) ? `${Number(item.test_run_count)} проверок` : null
  ].filter(Boolean);
  return values.length ? values.join(' · ') : 'Пока не использовался';
}

function actionButtons(item) {
  if (item.lifecycle_status === 'archived') {
    return `<button type="button" class="secondary-button" data-template-library-restore="${escMeeting(item.id)}">Восстановить</button>`;
  }
  const selectable = ['ready', 'legacy_compatible'].includes(item.readiness);
  return `
    <button type="button" class="secondary-button" data-template-library-configure="${escMeeting(item.id)}">${item.readiness === 'ready' ? 'Проверить поля' : 'Настроить поля'}</button>
    <button type="button" class="secondary-button" data-template-library-test="${escMeeting(item.id)}" ${selectable ? '' : 'disabled'}>Тестовое заполнение</button>
    <a class="secondary-button" href="${escMeeting(item.original_url)}" target="_blank" rel="noopener">Скачать исходник</a>
    <button type="button" class="secondary-button" data-template-library-version="${escMeeting(item.id)}">Новая версия</button>
    <button type="button" class="secondary-button" data-template-library-default="${escMeeting(item.id)}" ${selectable && !item.is_default ? '' : 'disabled'}>${item.is_default ? 'Основной' : 'Сделать основным'}</button>
    <button type="button" class="danger-text-button" data-template-library-archive="${escMeeting(item.id)}">В архив</button>
  `;
}

function cardHtml(item) {
  return `<article class="meeting-template-library-card ${item.is_default ? 'is-default' : ''}" data-template-library-card="${escMeeting(item.id)}">
    <div class="meeting-template-library-card-head">
      <div><span class="meeting-template-library-kind">${kindLabel(item.document_kind)}</span><h4>${escMeeting(item.display_name)}</h4></div>
      ${item.is_default ? '<span class="meeting-template-library-default">Основной</span>' : ''}
    </div>
    <div class="meeting-template-library-meta">
      <span>${versionLabel(item)}</span><span>${escMeeting(readinessLabel(item))}</span><span>${escMeeting(item.created_by_name || 'Добавлен оператором')}</span>
    </div>
    <p>${escMeeting(item.original_name)}</p>
    <small>${escMeeting(usageLabel(item))}</small>
    ${item.archive_reason ? `<div class="meeting-template-library-reason">Причина архива: ${escMeeting(item.archive_reason)}</div>` : ''}
    <div class="meeting-template-library-actions">${actionButtons(item)}</div>
  </article>`;
}

function renderLibrary() {
  const target = $m('#meeting-template-library-list');
  if (!target) return;
  const items = libraryState.items.filter((item) =>
    libraryState.includeArchived ? item.lifecycle_status === 'archived' : item.lifecycle_status === 'active'
  );
  target.innerHTML = items.length
    ? items.map(cardHtml).join('')
    : `<div class="empty-state">${libraryState.includeArchived ? 'Архив шаблонов пуст.' : 'Шаблонов пока нет. Загрузите DOCX в настройках заседаний.'}</div>`;
  for (const button of document.querySelectorAll('[data-template-library-filter]')) {
    button.classList.toggle('active', button.dataset.templateLibraryFilter === (libraryState.includeArchived ? 'archived' : 'active'));
  }
}

async function loadLibrary() {
  const data = await meetingApi('/api/meeting-template-library?includeArchived=1');
  libraryState.items = data.items || [];
  renderLibrary();
}

function libraryShell() {
  return `
    <header class="meeting-modal-head">
      <div><span>Заседания кафедры</span><h3>Шаблоны протоколов и выписок</h3></div>
      <button type="button" class="icon-button" data-close-meeting-modal>×</button>
    </header>
    <div class="meeting-template-library-body">
      <div class="meeting-template-library-toolbar">
        <div class="meeting-template-library-filters">
          <button type="button" data-template-library-filter="active" class="active">Рабочие</button>
          <button type="button" data-template-library-filter="archived">Архив</button>
        </div>
        <span>Новая версия не изменяет уже созданные заседания.</span>
      </div>
      <div id="meeting-template-library-list" class="meeting-template-library-list"><div class="empty-state">Загрузка…</div></div>
      <input id="meeting-template-library-version-file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden>
    </div>
  `;
}

export async function openMeetingTemplateLibrary() {
  ensureStyles();
  openMeetingModal(libraryShell());
  try {
    await loadLibrary();
  } catch (error) {
    $m('#meeting-template-library-list').innerHTML = `<div class="empty-state">${escMeeting(error.message || 'Не удалось загрузить библиотеку.')}</div>`;
  }
}

function itemById(id) {
  return libraryState.items.find((item) => item.id === id) || null;
}

async function configure(item) {
  await openMeetingTemplateEditor({
    kind: item.document_kind,
    versionId: item.document_version_id,
    title: `${item.display_name} · ${versionLabel(item)}`,
    onBack: openMeetingTemplateLibrary,
    onSaved: async () => {
      await refreshMeetingSettingsState();
      await loadLibrary();
    }
  });
}

function projectionRun(run) {
  const style = run.style || {};
  const classes = ['meeting-template-run'];
  if (style.bold) classes.push('is-bold');
  if (style.italic) classes.push('is-italic');
  if (style.underline) classes.push('is-underline');
  if (style.strike) classes.push('is-strike');
  return `<span class="${classes.join(' ')}">${escMeeting(run.text)}</span>`;
}

function projectionParagraph(element) {
  const alignment = element.style?.alignment === 'both' ? 'justify' : element.style?.alignment;
  const alignClass = ['left', 'center', 'right', 'justify'].includes(alignment)
    ? ` meeting-template-align-${alignment}` : '';
  return `<p class="meeting-template-element${alignClass}">${(element.runs || []).map(projectionRun).join('') || escMeeting(element.text || ' ')}</p>`;
}

function projectionBlock(block) {
  if (block.kind !== 'table') return projectionParagraph(block);
  return `<table class="meeting-template-table"><tbody>${(block.rows || []).map((row) =>
    `<tr>${(row.cells || []).map((cell) => `<td${Number(cell.columnSpan) > 1 ? ` colspan="${Number(cell.columnSpan)}"` : ''}>${(cell.paragraphs || []).map(projectionParagraph).join('')}</td>`).join('')}</tr>`
  ).join('')}</tbody></table>`;
}

function openTestResult(item, result) {
  openMeetingModal(`
    <header class="meeting-modal-head">
      <div><span>Тестовое заполнение</span><h3>${escMeeting(item.display_name)} · ${versionLabel(item)}</h3></div>
      <button type="button" class="secondary-button" data-return-template-library>Назад к библиотеке</button>
    </header>
    <div class="meeting-template-test-body">
      <section class="meeting-template-workspace"><div class="meeting-template-page">${(result.analysis?.blocks || []).map(projectionBlock).join('')}</div></section>
      <aside class="meeting-template-test-actions">
        <strong>${result.duplicateRequest ? 'Показан ранее проверенный результат' : 'Создан новый проверочный документ'}</strong>
        <p>В документ подставлены два вопроса. Исходный шаблон и профиль не изменены.</p>
        <a class="primary-button" href="${escMeeting(result.originalUrl)}" target="_blank" rel="noopener">Скачать тестовый DOCX</a>
        ${result.previewUrl ? `<a class="secondary-button" href="${escMeeting(result.previewUrl)}" target="_blank" rel="noopener">Открыть PDF-preview</a>` : `<div class="meeting-template-library-reason">PDF-preview: ${escMeeting(result.preview_error || result.preview_status || 'LibreOffice недоступен')}. DOCX сохранён и остаётся доступен.</div>`}
      </aside>
    </div>
  `);
}

async function testTemplate(item) {
  showMeetingNotice('Формируется тестовый документ с двумя вопросами…');
  const result = await meetingApi(`/api/meeting-template-library/${encodeURIComponent(item.id)}/test`, { method: 'POST' });
  openTestResult(item, result);
}

async function makeDefault(item) {
  await meetingApi(`/api/meeting-template-library/${encodeURIComponent(item.id)}/default`, { method: 'POST' });
  await refreshMeetingSettingsState();
  await loadLibrary();
  showMeetingNotice('Основной шаблон изменён. Старые заседания сохраняют прежнюю версию.');
}

function replacementOptions(item) {
  return libraryState.items.filter((candidate) =>
    candidate.id !== item.id
    && candidate.document_kind === item.document_kind
    && candidate.lifecycle_status === 'active'
    && ['ready', 'legacy_compatible'].includes(candidate.readiness)
  ).map((candidate) => `<option value="${escMeeting(candidate.id)}">${escMeeting(candidate.display_name)} · ${versionLabel(candidate)}</option>`).join('');
}

async function openArchiveDialog(item) {
  const impact = await meetingApi(`/api/meeting-template-library/${encodeURIComponent(item.id)}/impact`);
  openMeetingModal(`
    <header class="meeting-modal-head"><div><span>Архив шаблона</span><h3>${escMeeting(item.display_name)}</h3></div><button type="button" class="icon-button" data-close-meeting-modal>×</button></header>
    <form id="meeting-template-archive-form" class="meeting-modal-body" data-catalog-id="${escMeeting(item.id)}">
      <div class="meeting-template-impact">
        <span><b>${Number(impact.meetings)}</b> заседаний</span><span><b>${Number(impact.generatedDocuments)}</b> документов</span><span><b>${Number(impact.profiles)}</b> редакций профиля</span><span><b>${Number(impact.testRuns)}</b> тестов</span>
      </div>
      <p class="meeting-helper">Архивирование не удаляет исходный DOCX, профили, заседания или сформированные документы. Старое заседание продолжит использовать точную сохранённую версию.</p>
      ${impact.isDefault ? `<label class="field"><span>Новый основной шаблон</span><select name="replacementCatalogId" required><option value="">Выберите замену</option>${replacementOptions(item)}</select></label>` : ''}
      <label class="field"><span>Причина</span><textarea name="reason" rows="3" required placeholder="Например: заменён новой утверждённой формой"></textarea></label>
      <div class="meeting-modal-actions"><button type="button" class="secondary-button" data-return-template-library>Отмена</button><span class="spacer"></span><button type="submit" class="primary-button">Переместить в архив</button></div>
    </form>
  `);
}

async function archiveFromForm(form) {
  const data = Object.fromEntries(new FormData(form));
  await meetingApi(`/api/meeting-template-library/${encodeURIComponent(form.dataset.catalogId)}/archive`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data)
  });
  await refreshMeetingSettingsState();
  await openMeetingTemplateLibrary();
  showMeetingNotice('Шаблон перемещён в обратимый архив.');
}

async function restore(item) {
  await meetingApi(`/api/meeting-template-library/${encodeURIComponent(item.id)}/restore`, { method: 'POST' });
  await loadLibrary();
  showMeetingNotice('Шаблон восстановлен в рабочий список.');
}

async function uploadVersion(file) {
  const source = libraryState.pendingVersion;
  if (!source || !file) return;
  const query = new URLSearchParams({
    kind: source.document_kind,
    seriesId: source.series_id,
    displayName: source.display_name
  });
  const response = await window.fetch(`/api/meeting-templates?${query}`, {
    method: 'POST',
    headers: {
      'content-type': file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'x-file-name': encodeURIComponent(file.name)
    },
    body: file
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Ошибка HTTP ${response.status}`);
  await refreshMeetingSettingsState();
  await configure({
    ...data.catalog,
    original_name: file.name,
    document_version_id: data.version_id,
    display_name: source.display_name,
    version_no: data.catalog?.version_no || Number(source.version_no) + 1,
    document_kind: source.document_kind
  });
}

function enhanceSettingsForm() {
  const form = $m('#meeting-settings-form');
  if (!form || form.querySelector('[data-open-template-library]')) return;
  const actions = form.querySelector('.meeting-modal-actions');
  if (!actions) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary-button';
  button.dataset.openTemplateLibrary = '';
  button.textContent = 'Шаблоны документов';
  actions.prepend(button);
}

function bindGlobalEvents() {
  document.addEventListener('click', async (event) => {
    try {
      if (event.target.closest?.('[data-open-template-library]')) return openMeetingTemplateLibrary();
      const filter = event.target.closest?.('[data-template-library-filter]');
      if (filter) {
        libraryState.includeArchived = filter.dataset.templateLibraryFilter === 'archived';
        return renderLibrary();
      }
      const configureButton = event.target.closest?.('[data-template-library-configure]');
      if (configureButton) return configure(itemById(configureButton.dataset.templateLibraryConfigure));
      const testButton = event.target.closest?.('[data-template-library-test]');
      if (testButton) return testTemplate(itemById(testButton.dataset.templateLibraryTest));
      const defaultButton = event.target.closest?.('[data-template-library-default]');
      if (defaultButton) return makeDefault(itemById(defaultButton.dataset.templateLibraryDefault));
      const archiveButton = event.target.closest?.('[data-template-library-archive]');
      if (archiveButton) return openArchiveDialog(itemById(archiveButton.dataset.templateLibraryArchive));
      const restoreButton = event.target.closest?.('[data-template-library-restore]');
      if (restoreButton) return restore(itemById(restoreButton.dataset.templateLibraryRestore));
      const versionButton = event.target.closest?.('[data-template-library-version]');
      if (versionButton) {
        libraryState.pendingVersion = itemById(versionButton.dataset.templateLibraryVersion);
        return $m('#meeting-template-library-version-file')?.click();
      }
      if (event.target.closest?.('[data-return-template-library]')) return openMeetingTemplateLibrary();
    } catch (error) {
      showMeetingNotice(error.message || 'Не удалось выполнить действие с шаблоном.');
    }
  });
  document.addEventListener('change', async (event) => {
    if (event.target.id !== 'meeting-template-library-version-file') return;
    const file = event.target.files?.[0];
    event.target.value = '';
    try { await uploadVersion(file); } catch (error) { showMeetingNotice(error.message || 'Не удалось загрузить новую версию.'); }
  });
  document.addEventListener('submit', async (event) => {
    if (event.target.id !== 'meeting-template-archive-form') return;
    event.preventDefault();
    try { await archiveFromForm(event.target); } catch (error) { showMeetingNotice(error.message || 'Не удалось архивировать шаблон.'); }
  });
}

export function installMeetingTemplateLibraryEnhancer() {
  if (installed) return;
  installed = true;
  ensureStyles();
  bindGlobalEvents();
  document.addEventListener('meeting-modal-opened', enhanceSettingsForm);
  enhanceSettingsForm();
}
