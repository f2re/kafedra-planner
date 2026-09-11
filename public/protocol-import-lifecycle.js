import { meetingApi, escMeeting } from './meetings-state.js';

let view = 'active';
let year = null;
let notice = '';
const pending = new Set();

export function protocolImportView() { return view; }
export function resetProtocolImportView() { view = 'active'; notice = ''; }
export function protocolImportIsArchived(item) { return item.lifecycle_status === 'archived'; }
export function selectProtocolImportItems(items, selectedYear) {
  if (year !== selectedYear) { year = selectedYear; resetProtocolImportView(); }
  return items.filter((item) => protocolImportIsArchived(item) === (view === 'archived'));
}
export function archivedUploadNotice() {
  notice = 'Файл уже сохранён в архиве. Откройте «Архив» и восстановите его; повторная загрузка не создаёт копию.';
}

export function renderProtocolImportLifecycle(root, allItems, visibleItems, { render, refresh, dismissLocal }) {
  if (!document.getElementById('protocol-import-lifecycle-styles')) {
    const link = document.createElement('link');
    link.id = 'protocol-import-lifecycle-styles';
    link.rel = 'stylesheet';
    link.href = '/protocol-import-lifecycle.css';
    document.head.append(link);
  }
  const archived = allItems.filter(protocolImportIsArchived).length;
  const bar = document.createElement('div');
  bar.className = 'protocol-batch-bar';
  bar.innerHTML = `<button class="secondary-button" type="button" data-protocol-archive-view>${view === 'archived' ? 'К загрузкам' : `Архив (${archived})`}</button>
    <span class="protocol-batch-notice" role="status">${escMeeting(notice)}</span>`;
  root.prepend(bar);
  bar.querySelector('button').addEventListener('click', () => {
    view = view === 'active' ? 'archived' : 'active';
    notice = '';
    render();
  });
  root.querySelectorAll('[data-protocol-import-item]').forEach((row, index) => {
    const item = visibleItems[index];
    if (!item) return;
    const archivedItem = protocolImportIsArchived(item);
    if (archivedItem) row.querySelector('.protocol-import-state').textContent = 'В архиве';
    const saved = Boolean(item.document_id);
    if (!saved && item.state !== 'failed') return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'link-button';
    button.dataset.protocolCleanup = saved ? item.document_id : item.id;
    button.textContent = !saved ? 'Убрать из списка' : archivedItem ? 'Восстановить' : 'В архив';
    button.disabled = pending.has(item.document_id) || ['processing', 'uploading'].includes(item.state);
    row.querySelector('.protocol-import-actions').append(button);
    button.addEventListener('click', async () => {
      if (!saved) { dismissLocal(item.id); render(); return; }
      if (pending.has(item.document_id)) return;
      if (!archivedItem && !window.confirm(`Убрать файл «${item.original_name || item.title || 'Протокол'}» в архив?\n\nИсходник и история сохранятся. Уже созданные заседания и решения не удаляются. Файл можно восстановить.`)) return;
      pending.add(item.document_id);
      notice = archivedItem ? 'Восстанавливается…' : 'Переносится в архив…';
      render();
      let changed = false;
      try {
        const action = archivedItem ? 'restore' : 'archive';
        await meetingApi(`/api/documents/${encodeURIComponent(item.document_id)}/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(archivedItem ? {} : { reason: 'Убран из очереди импорта протоколов пользователем' })
        });
        item.lifecycle_status = archivedItem ? 'active' : 'archived';
        notice = archivedItem ? 'Файл восстановлен. Он доступен в загрузках.' : 'Файл в архиве. Исходник, заседание и история сохранены.';
        changed = true;
      } catch (error) {
        notice = error.message || 'Не удалось изменить состояние файла.';
      } finally {
        pending.delete(item.document_id);
        render();
      }
      if (changed) {
        try { await refresh(); }
        catch (error) { notice += ` Список не обновлён: ${error.message}`; render(); }
      }
    });
  });
}
