import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function openDatabaseProcess(databasePath) {
  const moduleUrl = pathToFileURL(resolve('packages/storage/src/database.mjs')).href;
  const migrationsDir = resolve('migrations');
  const program = `
    import { Database } from ${JSON.stringify(moduleUrl)};
    const database = new Database(${JSON.stringify(databasePath)}, { migrationsDir: ${JSON.stringify(migrationsDir)} });
    database.run('INSERT OR IGNORE INTO workspaces(id, code, name, created_at) VALUES (?, ?, ?, ?)', 'ws_main', 'main', 'Кафедра', new Date().toISOString());
    database.close();
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program], {
    cwd: resolve('.'),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolveExit, reject) => {
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => resolveExit({ code, stderr }));
  });
}

test('несколько процессов одновременно открывают и мигрируют одну SQLite-базу', { timeout: 30_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kafedra-concurrent-'));
  const databasePath = join(directory, 'shared.sqlite3');
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => openDatabaseProcess(databasePath)));
    assert.deepEqual(results.map((result) => result.code), Array(8).fill(0), results.map((result) => result.stderr).join('\n'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
