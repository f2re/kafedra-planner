import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { enqueueJob, acquireJob } from '../packages/storage/src/jobs.mjs';
import { systemHealth } from '../packages/storage/src/system.mjs';
import { extractDepartmentProtocol } from '../packages/protocols/src/extractor.mjs';

const root = await mkdtemp(join(tmpdir(), 'kafedra-smoke-'));
try {
  await mkdir(join(root, 'blobs'), { recursive: true });
  await writeFile(join(root, 'sample.txt'), 'ПРОТОКОЛ № 1\n05.08.2026\n1. Вопрос\nРЕШИЛИ: Выполнить до 10.08.2026.');
  const database = new Database(join(root, 'smoke.sqlite3'), { migrationsDir: resolve('migrations') });
  const workspace = ensureDefaultWorkspace(database);
  const parsed = extractDepartmentProtocol('ПРОТОКОЛ № 1\n05.08.2026\n1. Вопрос\nРЕШИЛИ: Выполнить до 10.08.2026.');
  if (parsed.protocolNumber !== '1' || parsed.meetingDate !== '2026-08-05') throw new Error('Protocol smoke failed');
  enqueueJob(database, { kind: 'smoke', payload: {}, idempotencyKey: 'smoke' });
  if (!acquireJob(database, 'smoke-worker', 30)) throw new Error('Job queue smoke failed');
  const health = systemHealth(database);
  if (health.status !== 'ok') throw new Error('Database health failed');
  console.log(JSON.stringify({ status: 'ok', workspaceId: workspace.id, schemaVersion: health.schemaVersion }));
  database.close();
} finally {
  await rm(root, { recursive: true, force: true });
}
