import { protocolDialog } from './protocol-batch.js';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (s) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[s]);
}

const TYPE_LABELS = {
  protocol: 'Протоколы заседаний',
  plan: 'Планы работы',
  report: 'Отчёты кафедры',
  auto: 'Автоопределение вида'
};

const INTERVAL_LABELS = {
  15: 'Каждые 15 секунд',
  30: 'Каждые 30 секунд',
  60: 'Каждую минуту',
  300: 'Каждые 5 минут',
  900: 'Каждые 15 минут',
  0: 'Только вручную'
};

export async function openFolderSyncDialog({ onUpdated, defaultType = 'protocol' } = {}) {
  if (!document.querySelector('#folder-sync-style')) {
    const link = document.createElement('link');
    link.id = 'folder-sync-style';
    link.rel = 'stylesheet';
    link.href = '/folder-sync.css';
    document.head.append(link);
  }

  let folders = [];
  let busy = false;
  let statusMessage = '';
  let showAddForm = false;

  async function fetchFolders() {
    try {
      const res = await fetch('/api/folder-sync');
      if (!res.ok) throw new Error(`Ошибка загрузки (${res.status})`);
      const data = await res.json();
      folders = data.folders || [];
    } catch (err) {
      statusMessage = `Не удалось загрузить папки: ${err.message}`;
    }
  }

  await fetchFolders();

  const dialog = protocolDialog('Синхронизация сетевых и локальных папок', '<div id="folder-sync-body"></div>');
  const bodyRoot = dialog.querySelector('#folder-sync-body');

  function render() {
    bodyRoot.innerHTML = `
      <div class="folder-sync-container">
        <p class="folder-sync-intro">
          Укажите пути к сетевым или локальным папкам (например, сетевая папка кафедры с протоколами за текущий год).
          Система автоматически отслеживает новые файлы и изменения в существующих документах,
          сохраняет новые версии и мгновенно переиндексирует поиск без ручной загрузки.
        </p>

        <div class="folder-sync-toolbar">
          <button type="button" class="primary-button" data-sync-action="toggle-add" ${busy ? 'disabled' : ''}>
            ${showAddForm ? '✕ Скрыть форму' : '+ Подключить папку'}
          </button>
          <button type="button" class="secondary-button" data-sync-action="sync-all" ${busy || !folders.length ? 'disabled' : ''}>
            ↻ Синхронизировать всё
          </button>
          <button type="button" class="secondary-button" data-close-tools>Закрыть</button>
        </div>

        ${statusMessage ? `<div class="folder-sync-status" role="status">${esc(statusMessage)}</div>` : ''}

        ${showAddForm ? renderAddForm() : ''}

        <div class="folder-sync-list">
          ${folders.length === 0 ? `
            <div class="folder-sync-empty">
              Нет подключенных папок. Нажмите <strong>«+ Подключить папку»</strong>, чтобы настроить автоматическое отслеживание.
            </div>
          ` : folders.map(renderFolderItem).join('')}
        </div>
      </div>
    `;

    attachEvents();
  }

  function renderAddForm() {
    const currentYear = new Date().getFullYear();
    return `
      <form class="folder-sync-form" data-sync-form>
        <h3>Подключение новой папки</h3>
        <div class="protocol-tools-fields">
          <label>
            <span>Название папки / метка</span>
            <input name="name" type="text" placeholder="например, Протоколы 2026 (сеть)" required>
          </label>
          <label>
            <span>Тип документов</span>
            <select name="documentType">
              <option value="protocol" ${defaultType === 'protocol' ? 'selected' : ''}>Протоколы заседаний</option>
              <option value="plan" ${defaultType === 'plan' ? 'selected' : ''}>Планы работы кафедры</option>
              <option value="report">Отчёты кафедры</option>
              <option value="auto">Автоопределение</option>
            </select>
          </label>
          <label style="grid-column: 1 / -1;">
            <span>Путь к папке в файловой системе (сетевой ресурс или локальная папка)</span>
            <input name="folderPath" type="text" placeholder="/mnt/share/protocols-2026 или /opt/data/kafedra" required>
            <small style="color:var(--muted); font-size:11px;">Сетевые папки Windows/Samba монтируются в систему (например, /mnt/share или /media/share).</small>
          </label>
          <label>
            <span>Периодичность проверки</span>
            <select name="intervalSeconds">
              <option value="15">Каждые 15 секунд</option>
              <option value="30" selected>Каждые 30 секунд</option>
              <option value="60">Каждую минуту</option>
              <option value="300">Каждые 5 минут</option>
              <option value="0">Только вручную</option>
            </select>
          </label>
          <label>
            <span>Год документов (для протоколов)</span>
            <input name="targetYear" type="number" min="2000" max="2099" value="${currentYear}">
          </label>
          <label style="display:flex; align-items:center; gap:8px; margin-top:22px;">
            <input name="recursive" type="checkbox" value="1">
            <span>Проверять вложенные подпапки</span>
          </label>
        </div>
        <div class="protocol-tools-actions" style="margin-top:12px;">
          <button type="submit" class="primary-button" ${busy ? 'disabled' : ''}>Сохранить и запустить</button>
          <button type="button" class="secondary-button" data-sync-action="cancel-add" ${busy ? 'disabled' : ''}>Отмена</button>
        </div>
      </form>
    `;
  }

  function renderFolderItem(folder) {
    const isScanning = folder.syncState === 'scanning';
    const isError = Boolean(folder.lastError);
    const isEnabled = folder.enabled !== false;
    const lastSyncTime = folder.lastSyncedAt
      ? new Date(folder.lastSyncedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : 'ещё не выполнялась';

    return `
      <div class="folder-sync-card ${!isEnabled ? 'is-disabled' : ''}" data-folder-id="${esc(folder.id)}">
        <div class="folder-sync-card-header">
          <div class="folder-sync-title-group">
            <span class="folder-sync-icon">📁</span>
            <div>
              <strong>${esc(folder.name)}</strong>
              <div class="folder-sync-path">${esc(folder.folderPath)}</div>
            </div>
          </div>
          <div class="folder-sync-badges">
            <span class="folder-sync-badge type">${esc(TYPE_LABELS[folder.documentType] || folder.documentType)}</span>
            ${folder.targetYear ? `<span class="folder-sync-badge year">${esc(folder.targetYear)} год</span>` : ''}
            <span class="folder-sync-badge status ${isScanning ? 'scanning' : isError ? 'error' : isEnabled ? 'active' : 'disabled'}">
              ${isScanning ? '⏳ Синхронизация…' : isError ? '⚠ Ошибка доступа' : isEnabled ? '✓ Активно' : '⏸ Приостановлено'}
            </span>
          </div>
        </div>

        <div class="folder-sync-meta">
          <span>Интервал: ${esc(INTERVAL_LABELS[folder.intervalSeconds] || `${folder.intervalSeconds}с`)}</span>
          <span>${folder.recursive ? 'Включая подпапки' : 'Без подпапок'}</span>
          <span>Последняя проверка: ${esc(lastSyncTime)}</span>
        </div>

        ${isError ? `<div class="folder-sync-error" role="alert">${esc(folder.lastError)}</div>` : ''}

        <div class="folder-sync-card-actions">
          <button type="button" class="secondary-button" data-sync-action="sync-one" data-id="${esc(folder.id)}" ${busy || isScanning ? 'disabled' : ''}>
            ${isScanning ? 'Синхронизация…' : '↻ Синхронизировать сейчас'}
          </button>
          <button type="button" class="secondary-button" data-sync-action="toggle-enabled" data-id="${esc(folder.id)}" ${busy ? 'disabled' : ''}>
            ${isEnabled ? 'Приостановить' : 'Включить'}
          </button>
          <button type="button" class="secondary-button" style="color:var(--danger, #dc2626);" data-sync-action="delete" data-id="${esc(folder.id)}" ${busy ? 'disabled' : ''}>
            Удалить
          </button>
        </div>
      </div>
    `;
  }

  function attachEvents() {
    const form = bodyRoot.querySelector('[data-sync-form]');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        busy = true;
        statusMessage = 'Сохранение папки…';
        render();

        const formData = new FormData(form);
        const payload = {
          name: formData.get('name'),
          folderPath: formData.get('folderPath'),
          documentType: formData.get('documentType'),
          intervalSeconds: Number(formData.get('intervalSeconds')) || 30,
          targetYear: formData.get('targetYear') ? Number(formData.get('targetYear')) : null,
          recursive: Boolean(formData.get('recursive')),
          enabled: true
        };

        try {
          const res = await fetch('/api/folder-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const result = await res.json();
          if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);

          showAddForm = false;
          statusMessage = 'Папка успешно подключена. Запуск первичной синхронизации…';
          await fetchFolders();
          render();

          // Trigger initial sync immediately
          if (result.folder?.id) {
            await triggerSync(result.folder.id);
          }
        } catch (err) {
          statusMessage = `Ошибка: ${err.message}`;
          busy = false;
          render();
        }
      });
    }

    bodyRoot.querySelectorAll('[data-sync-action]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const action = btn.dataset.syncAction;
        const id = btn.dataset.id;

        if (action === 'toggle-add') {
          showAddForm = !showAddForm;
          render();
        } else if (action === 'cancel-add') {
          showAddForm = false;
          render();
        } else if (action === 'sync-one' && id) {
          await triggerSync(id);
        } else if (action === 'sync-all') {
          await triggerSyncAll();
        } else if (action === 'toggle-enabled' && id) {
          const folder = folders.find((f) => f.id === id);
          if (!folder) return;
          try {
            busy = true;
            render();
            await fetch(`/api/folder-sync/${encodeURIComponent(id)}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled: folder.enabled === false })
            });
            await fetchFolders();
          } catch (err) {
            statusMessage = `Ошибка: ${err.message}`;
          } finally {
            busy = false;
            render();
          }
        } else if (action === 'delete' && id) {
          if (!confirm('Отключить отслеживание этой папки? Уже загруженные файлы и протоколы останутся в системе.')) return;
          try {
            busy = true;
            render();
            await fetch(`/api/folder-sync/${encodeURIComponent(id)}`, { method: 'DELETE' });
            await fetchFolders();
            statusMessage = 'Папка отключена.';
          } catch (err) {
            statusMessage = `Ошибка: ${err.message}`;
          } finally {
            busy = false;
            render();
          }
        }
      });
    });
  }

  async function triggerSync(id) {
    busy = true;
    statusMessage = 'Выполняется синхронизация файлов…';
    render();
    try {
      const res = await fetch(`/api/folder-sync/${encodeURIComponent(id)}/sync`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const r = data.result || {};
      statusMessage = `Синхронизация завершена: добавлено новых файлов: ${r.addedCount || 0}, обновлено версий: ${r.updatedCount || 0}, без изменений: ${r.unchangedCount || 0}`;
      await fetchFolders();
      if (onUpdated) onUpdated();
    } catch (err) {
      statusMessage = `Ошибка синхронизации: ${err.message}`;
    } finally {
      busy = false;
      render();
    }
  }

  async function triggerSyncAll() {
    busy = true;
    statusMessage = 'Выполняется синхронизация всех папок…';
    render();
    try {
      const res = await fetch('/api/folder-sync/sync-all', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      statusMessage = 'Синхронизация всех папок завершена успешно.';
      await fetchFolders();
      if (onUpdated) onUpdated();
    } catch (err) {
      statusMessage = `Ошибка синхронизации: ${err.message}`;
    } finally {
      busy = false;
      render();
    }
  }

  render();
  dialog.showModal();
}
