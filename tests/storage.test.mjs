import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { enqueueJob, acquireJob, completeJob } from '../packages/storage/src/jobs.mjs';

const migrationsDir = resolve('migrations');

test('мигрирует базу, арендует задания и умеет приостанавливать отдельный вид работ', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-storage-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    assert.equal(workspace.code, 'main');
    const job = enqueueJob(database, { kind: 'test', payload: { value: 1 }, idempotencyKey: 'test:1' });
    const duplicate = enqueueJob(database, { kind: 'test', payload: { value: 2 }, idempotencyKey: 'test:1' });
    assert.equal(duplicate.id, job.id);
    const acquired = acquireJob(database, 'worker-1', 60);
    assert.equal(acquired.id, job.id);
    assert.equal(acquired.attempts, 1);
    assert.equal(acquireJob(database, 'worker-2', 60), null);
    completeJob(database, job.id);
    assert.equal(database.get('SELECT status FROM jobs WHERE id = ?', job.id).status, 'completed');

    const paused = enqueueJob(database, { kind: 'deliver_notification', payload: { value: 3 }, priority: 100 });
    const document = enqueueJob(database, { kind: 'process_document', payload: { value: 4 }, priority: 10 });
    const next = acquireJob(database, 'worker-1', 60, new Date(), { excludeKinds: ['deliver_notification'] });
    assert.equal(next.id, document.id);
    assert.equal(database.get('SELECT status FROM jobs WHERE id = ?', paused.id).status, 'queued');
    completeJob(database, document.id);
    assert.equal(database.quickCheck(), true);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});