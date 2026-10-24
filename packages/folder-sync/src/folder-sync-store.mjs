import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from '../../core/src/ids.mjs';

const CONFIG_FILENAME = 'folder-sync-configs.json';

function ensureDataFile(dataDir) {
  const dir = dataDir || process.cwd();
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch {}
  }
  return join(dir, CONFIG_FILENAME);
}

export function loadFolderSyncData(dataDir) {
  const filePath = ensureDataFile(dataDir);
  if (!existsSync(filePath)) {
    return { folders: [], state: {} };
  }
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      folders: Array.isArray(parsed?.folders) ? parsed.folders : [],
      state: (parsed?.state && typeof parsed.state === 'object') ? parsed.state : {}
    };
  } catch {
    return { folders: [], state: {} };
  }
}

export function saveFolderSyncData(dataDir, data) {
  const filePath = ensureDataFile(dataDir);
  const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const payload = JSON.stringify({
    folders: Array.isArray(data?.folders) ? data.folders : [],
    state: (data?.state && typeof data.state === 'object') ? data.state : {}
  }, null, 2);
  writeFileSync(tempPath, payload, 'utf8');
  renameSync(tempPath, filePath);
}

export function listWatchedFolders(dataDir) {
  const data = loadFolderSyncData(dataDir);
  return data.folders;
}

export function getWatchedFolder(dataDir, id) {
  const data = loadFolderSyncData(dataDir);
  return data.folders.find((f) => f.id === id) || null;
}

export function saveWatchedFolder(dataDir, input) {
  const data = loadFolderSyncData(dataDir);
  const now = new Date().toISOString();
  let folder = data.folders.find((f) => f.id === input.id);

  const cleanPath = String(input.folderPath || '').trim();
  const cleanName = String(input.name || cleanPath || 'Сетевая папка').trim().slice(0, 150);
  const docType = ['protocol', 'plan', 'report', 'directive', 'auto'].includes(input.documentType)
    ? input.documentType
    : 'auto';
  const targetYear = input.targetYear ? Number(input.targetYear) : null;
  const recursive = Boolean(input.recursive);
  const enabled = input.enabled !== undefined ? Boolean(input.enabled) : true;
  const intervalSeconds = Math.max(10, Math.min(Number(input.intervalSeconds || 30), 86400));

  if (folder) {
    folder.name = cleanName;
    folder.folderPath = cleanPath;
    folder.documentType = docType;
    folder.targetYear = targetYear;
    folder.recursive = recursive;
    folder.enabled = enabled;
    folder.intervalSeconds = intervalSeconds;
    folder.updatedAt = now;
  } else {
    folder = {
      id: input.id || newId('fsync'),
      name: cleanName,
      folderPath: cleanPath,
      documentType: docType,
      targetYear,
      recursive,
      enabled,
      intervalSeconds,
      lastSyncedAt: null,
      lastError: null,
      filesCount: 0,
      createdAt: now,
      updatedAt: now
    };
    data.folders.push(folder);
  }

  saveFolderSyncData(dataDir, data);
  return folder;
}

export function deleteWatchedFolder(dataDir, id) {
  const data = loadFolderSyncData(dataDir);
  const index = data.folders.findIndex((f) => f.id === id);
  if (index === -1) return false;

  data.folders.splice(index, 1);
  // Clean up state keys for this folder
  const prefix = `${id}:`;
  for (const key of Object.keys(data.state)) {
    if (key.startsWith(prefix)) {
      delete data.state[key];
    }
  }

  saveFolderSyncData(dataDir, data);
  return true;
}

export function getFolderSyncFiles(dataDir, folderId) {
  const data = loadFolderSyncData(dataDir);
  const prefix = `${folderId}:`;
  const files = [];
  for (const [key, val] of Object.entries(data.state)) {
    if (key.startsWith(prefix)) {
      files.push({
        relativePath: key.slice(prefix.length),
        ...val
      });
    }
  }
  return files;
}
