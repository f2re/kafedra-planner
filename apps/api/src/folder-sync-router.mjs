import { AppError } from '../../../packages/core/src/errors.mjs';
import { readJson, sendJson } from './http-utils.mjs';
import {
  listWatchedFolders,
  getWatchedFolder,
  saveWatchedFolder,
  deleteWatchedFolder,
  getFolderSyncFiles
} from '../../../packages/folder-sync/src/folder-sync-store.mjs';
import { syncWatchedFolder } from '../../../packages/folder-sync/src/sync-engine.mjs';

function workspaceOf(database, request) {
  if (request.auth?.workspaceId) {
    const workspace = database.get('SELECT * FROM workspaces WHERE id = ?', request.auth.workspaceId);
    if (workspace) return workspace;
  }
  const requested = request.headers['x-workspace-id'];
  if (typeof requested === 'string') {
    const workspace = database.get('SELECT * FROM workspaces WHERE id = ? OR code = ?', requested, requested);
    if (workspace) return workspace;
  }
  const workspace = database.get('SELECT * FROM workspaces ORDER BY created_at LIMIT 1');
  if (!workspace) throw new AppError('workspace_not_initialized', 'Рабочее пространство не создано.', 500);
  return workspace;
}

export function createFolderSyncRouter({ database, config, logger }) {
  const dataDir = config?.dataDir || process.cwd();
  const blobDir = config?.blobDir || process.cwd();

  return async function folderSyncRouter(request, response, url) {
    const path = url.pathname;
    const method = request.method;

    if (method === 'GET' && path === '/api/folder-sync') {
      const items = listWatchedFolders(dataDir);
      sendJson(response, 200, { items, folders: items });
      return true;
    }

    if (method === 'POST' && path === '/api/folder-sync') {
      const body = await readJson(request);
      if (!body.folderPath || typeof body.folderPath !== 'string' || !body.folderPath.trim()) {
        throw new AppError('folder_path_required', 'Укажите путь к сетевой или локальной папке.', 400);
      }
      const folder = saveWatchedFolder(dataDir, body);
      sendJson(response, 201, { folder, ...folder });
      return true;
    }

    if (method === 'POST' && path === '/api/folder-sync/sync-all') {
      const workspace = workspaceOf(database, request);
      const folders = listWatchedFolders(dataDir);
      const results = [];
      for (const folder of folders) {
        if (!folder.enabled) continue;
        try {
          const res = await syncWatchedFolder({
            database,
            workspaceId: workspace.id,
            dataDir,
            blobDir,
            folder,
            logger
          });
          results.push({ folderId: folder.id, ...res });
        } catch (err) {
          results.push({ folderId: folder.id, ok: false, error: err.message });
        }
      }
      sendJson(response, 200, { ok: true, results });
      return true;
    }

    const itemMatch = /^\/api\/folder-sync\/([^/]+)$/.exec(path);
    if (itemMatch) {
      const folderId = decodeURIComponent(itemMatch[1]);
      if (method === 'GET') {
        const folder = getWatchedFolder(dataDir, folderId);
        if (!folder) throw new AppError('folder_not_found', 'Папка не найдена.', 404);
        sendJson(response, 200, folder);
        return true;
      }
      if (method === 'PATCH') {
        const existing = getWatchedFolder(dataDir, folderId);
        if (!existing) throw new AppError('folder_not_found', 'Папка не найдена.', 404);
        const body = await readJson(request);
        const updated = saveWatchedFolder(dataDir, { ...existing, ...body, id: folderId });
        sendJson(response, 200, { folder: updated, ...updated });
        return true;
      }
      if (method === 'DELETE') {
        const deleted = deleteWatchedFolder(dataDir, folderId);
        if (!deleted) throw new AppError('folder_not_found', 'Папка не найдена.', 404);
        sendJson(response, 200, { ok: true, deleted: true });
        return true;
      }
    }

    const syncMatch = /^\/api\/folder-sync\/([^/]+)\/sync$/.exec(path);
    if (syncMatch && method === 'POST') {
      const folderId = decodeURIComponent(syncMatch[1]);
      const folder = getWatchedFolder(dataDir, folderId);
      if (!folder) throw new AppError('folder_not_found', 'Папка не найдена.', 404);
      const workspace = workspaceOf(database, request);
      const res = await syncWatchedFolder({
        database,
        workspaceId: workspace.id,
        dataDir,
        blobDir,
        folder,
        logger
      });
      sendJson(response, 200, { ok: res.ok, result: res, ...res });
      return true;
    }

    const filesMatch = /^\/api\/folder-sync\/([^/]+)\/files$/.exec(path);
    if (filesMatch && method === 'GET') {
      const folderId = decodeURIComponent(filesMatch[1]);
      const folder = getWatchedFolder(dataDir, folderId);
      if (!folder) throw new AppError('folder_not_found', 'Папка не найдена.', 404);
      const files = getFolderSyncFiles(dataDir, folderId);
      sendJson(response, 200, { folderId, items: files });
      return true;
    }

    return false;
  };
}
