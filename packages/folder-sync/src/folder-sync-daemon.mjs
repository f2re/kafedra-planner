import { listWatchedFolders } from './folder-sync-store.mjs';
import { syncWatchedFolder } from './sync-engine.mjs';

export function startFolderSyncDaemon({ database, workspaceId, dataDir, blobDir, logger, intervalMs = 15000 }) {
  let isRunning = false;
  let isStopped = false;

  async function checkAndSync() {
    if (isRunning || isStopped) return;
    isRunning = true;
    try {
      const folders = listWatchedFolders(dataDir);
      const now = Date.now();
      for (const folder of folders) {
        if (!folder.enabled) continue;
        const lastSync = folder.lastSyncedAt ? Date.parse(folder.lastSyncedAt) : 0;
        const intervalMsFolder = Math.max(10, Number(folder.intervalSeconds || 30)) * 1000;
        if (now - lastSync >= intervalMsFolder) {
          try {
            await syncWatchedFolder({
              database,
              workspaceId,
              dataDir,
              blobDir,
              folder,
              logger
            });
          } catch (err) {
            if (logger) logger.warn('folder sync daemon error', { folderId: folder.id, error: err.message });
          }
        }
      }
    } catch (err) {
      if (logger) logger.warn('folder sync daemon iteration failed', { error: err.message });
    } finally {
      isRunning = false;
    }
  }

  const timer = setInterval(() => {
    checkAndSync().catch(() => {});
  }, intervalMs);
  timer.unref?.();

  // Run initial sweep after small delay
  setTimeout(() => {
    checkAndSync().catch(() => {});
  }, 1000).unref?.();

  return {
    stop() {
      isStopped = true;
      clearInterval(timer);
    },
    syncNow(folderId) {
      const folders = listWatchedFolders(dataDir);
      const target = folderId ? folders.find((f) => f.id === folderId) : null;
      if (target) {
        return syncWatchedFolder({ database, workspaceId, dataDir, blobDir, folder: target, logger });
      }
      return checkAndSync();
    }
  };
}
