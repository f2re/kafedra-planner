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

async function waitFor(url, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = await response.json();
        if (!predicate || predicate(body)) return body;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw lastError || new Error(`Timeout waiting for ${url}`);
}

test('сквозной путь: загрузка протокола, worker, календарь и поиск', { timeout: 30_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kafedra-e2e-'));
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
    const fixture = await readFile(new URL('./fixtures/protocol.txt', import.meta.url));
    const upload = await fetch(`http://127.0.0.1:${port}/api/documents`, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'x-file-name': 'protocol.txt',
        'x-document-type': 'protocol',
        'idempotency-key': 'e2e-protocol'
      },
      body: fixture
    });
    assert.equal(upload.status, 202);
    const accepted = await upload.json();
    assert.match(accepted.documentId, /^doc_/);
    const duplicateUpload = await fetch(`http://127.0.0.1:${port}/api/documents`, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'x-file-name': 'protocol.txt',
        'x-document-type': 'protocol',
        'idempotency-key': 'e2e-protocol'
      },
      body: fixture
    });
    assert.equal(duplicateUpload.status, 202);
    assert.equal((await duplicateUpload.json()).duplicateRequest, true);
    const documents = await waitFor(
      `http://127.0.0.1:${port}/api/documents`,
      (body) => body.items?.[0]?.processing_status === 'processed'
    );
    assert.equal(documents.items[0].document_type, 'department_protocol');

    const overview = await (await fetch(`http://127.0.0.1:${port}/api/overview`)).json();
    assert.equal(overview.documents, 1);
    assert.equal(overview.meetings, 1);
    assert.equal(overview.reviewOpen, 1);

    const calendar = await (await fetch(`http://127.0.0.1:${port}/api/calendar?from=2026-08-01&to=2026-10-31`)).json();
    assert.equal(calendar.items.length, 3);
    assert.ok(calendar.items.some((item) => item.starts_at === '2026-09-15'));

    const search = await (await fetch(`http://127.0.0.1:${port}/api/search?q=${encodeURIComponent('сводный отчёт')}`)).json();
    assert.ok(search.items.length >= 1);
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
