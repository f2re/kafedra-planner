import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitFor(url, predicate, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = await response.json();
        if (!predicate || predicate(body)) return body;
      }
    } catch (error) { lastError = error; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw lastError || new Error(`Timeout waiting for ${url}`);
}

test('сквозной импорт плана: документ → worker → план → календарь → поиск', { timeout: 35_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kafedra-plan-e2e-'));
  const port = await freePort();
  const env = {
    ...process.env,
    KAFEDRA_DATA_DIR: dataDir,
    KAFEDRA_DATABASE_PATH: join(dataDir, 'e2e.sqlite3'),
    KAFEDRA_PORT: String(port),
    KAFEDRA_HOST: '127.0.0.1',
    KAFEDRA_WORKER_POLL_MS: '50',
    KAFEDRA_LOG_LEVEL: 'error',
    KAFEDRA_AUTH_ENABLED: 'false'
  };
  const api = spawn(process.execPath, ['apps/api/src/main.mjs'], { cwd: resolve('.'), env, stdio: 'ignore' });
  const worker = spawn(process.execPath, ['apps/worker/src/main.mjs'], { cwd: resolve('.'), env, stdio: 'ignore' });
  try {
    await waitFor(`http://127.0.0.1:${port}/api/system/health`, (body) => body.status === 'ok');
    const fixture = await readFile(new URL('./fixtures/plan.txt', import.meta.url));
    const upload = await fetch(`http://127.0.0.1:${port}/api/documents`, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'x-file-name': encodeURIComponent('План кафедры 2026-2027.txt'),
        'x-document-type': 'plan',
        'idempotency-key': 'e2e-plan-2026-27'
      },
      body: fixture
    });
    assert.equal(upload.status, 202);
    const accepted = await upload.json();
    const document = await waitFor(
      `http://127.0.0.1:${port}/api/documents/${accepted.documentId}`,
      (body) => ['processed', 'needs_review'].includes(body.processing_status)
    );
    assert.equal(document.document_type, 'department_plan');
    assert.equal(document.processing_status, 'needs_review');

    const plans = await (await fetch(`http://127.0.0.1:${port}/api/plans?periodKey=2026%2F27`)).json();
    assert.equal(plans.items.length, 1);
    assert.equal(plans.items[0].item_count, 4);
    const plan = await (await fetch(`http://127.0.0.1:${port}/api/plans/${plans.items[0].id}`)).json();
    assert.equal(plan.items.length, 4);
    assert.ok(plan.items.some((item) => item.due_date === '2026-10-20'));
    assert.ok(plan.items.some((item) => item.starts_at === null && item.due_date === null));

    const calendar = await (await fetch(`http://127.0.0.1:${port}/api/calendar?from=2026-09-01&to=2026-11-30`)).json();
    const projected = calendar.items.filter((item) => item.source_kind === 'plan_item');
    assert.equal(projected.length, 3);
    assert.ok(projected.every((item) => item.origin_document_id === accepted.documentId));
    assert.ok(projected.some((item) => item.item_kind === 'task' && item.starts_at === '2026-10-20'));

    const searchResult = await (await fetch(`http://127.0.0.1:${port}/api/search?q=${encodeURIComponent('методические материалы')}`)).json();
    assert.ok(searchResult.items.some((item) => item.source_kind === 'plan_item'));

    const duplicate = await fetch(`http://127.0.0.1:${port}/api/documents`, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'x-file-name': encodeURIComponent('План кафедры 2026-2027.txt'),
        'x-document-type': 'plan',
        'idempotency-key': 'e2e-plan-2026-27'
      },
      body: fixture
    });
    assert.equal(duplicate.status, 202);
    assert.equal((await duplicate.json()).duplicateRequest, true);
    const calendarAfterDuplicate = await (await fetch(`http://127.0.0.1:${port}/api/calendar?from=2026-09-01&to=2026-11-30`)).json();
    assert.equal(calendarAfterDuplicate.items.filter((item) => item.source_kind === 'plan_item').length, 3);
  } finally {
    api.kill('SIGTERM');
    worker.kill('SIGTERM');
    await Promise.allSettled([
      new Promise((resolveExit) => api.once('exit', resolveExit)),
      new Promise((resolveExit) => worker.once('exit', resolveExit))
    ]);
    await rm(dataDir, { recursive: true, force: true });
  }
});
