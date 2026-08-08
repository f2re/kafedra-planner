import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

async function waitFor(url, predicate, timeoutMs = 15_000) {
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
    await new Promise((done) => setTimeout(done, 80));
  }
  throw lastError || new Error(`Timeout waiting for ${url}`);
}

test('worker сохраняет явно выбранный вид основания и не дублирует повторную загрузку', { timeout: 30_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kafedra-directive-worker-'));
  const port = await freePort();
  const env = {
    ...process.env,
    KAFEDRA_DATA_DIR: dataDir,
    KAFEDRA_DATABASE_PATH: join(dataDir, 'worker.sqlite3'),
    KAFEDRA_PORT: String(port),
    KAFEDRA_HOST: '127.0.0.1',
    KAFEDRA_WORKER_POLL_MS: '40',
    KAFEDRA_LOG_LEVEL: 'error',
    KAFEDRA_AUTH_ENABLED: 'false',
    KAFEDRA_PREVIEW_ENABLED: 'false',
    KAFEDRA_OCR_ENABLED: 'false',
    KAFEDRA_LLM_ENABLED: 'false'
  };
  const api = spawn(process.execPath, ['apps/api/src/main.mjs'], { cwd: resolve('.'), env, stdio: 'ignore' });
  const worker = spawn(process.execPath, ['apps/worker/src/main.mjs'], { cwd: resolve('.'), env, stdio: 'ignore' });
  const text = [
    'РАСПОРЯЖЕНИЕ',
    'от 8 августа 2026 года № 99-р',
    'О подготовке контрольного отчёта',
    '',
    'РАСПОРЯЖАЮСЬ:',
    '1. Подготовить контрольный отчёт до 20 августа 2026 года. Ответственный: Иванов Иван Иванович.',
    'Директор А.А. Смирнов'
  ].join('\n');

  try {
    await waitFor(`http://127.0.0.1:${port}/api/system/health`, (body) => body.status === 'ok');
    const headers = {
      'content-type': 'text/plain',
      'x-file-name': 'directive.txt',
      'x-document-type': 'order',
      'idempotency-key': 'directive-requested-order'
    };
    const upload = await fetch(`http://127.0.0.1:${port}/api/documents`, {
      method: 'POST', headers, body: text
    });
    assert.equal(upload.status, 202);

    const directives = await waitFor(
      `http://127.0.0.1:${port}/api/directives`,
      (body) => body.items?.length === 1
    );
    assert.equal(directives.items[0].directive_kind, 'order');
    assert.equal(directives.items[0].document_number, '99-р');

    const detailResponse = await fetch(`http://127.0.0.1:${port}/api/directives/${directives.items[0].id}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.equal(detail.directive_kind, 'order');
    assert.equal(detail.assignments.length, 1);
    assert.match(detail.evidence.kind.raw, /РАСПОРЯЖЕНИЕ/u);
    assert.equal(detail.evidence.kind.locator.startLine, 1);

    const duplicate = await fetch(`http://127.0.0.1:${port}/api/documents`, {
      method: 'POST', headers, body: text
    });
    assert.equal(duplicate.status, 202);
    assert.equal((await duplicate.json()).duplicateRequest, true);
    const afterDuplicate = await (await fetch(`http://127.0.0.1:${port}/api/directives`)).json();
    assert.equal(afterDuplicate.items.length, 1);
  } finally {
    api.kill('SIGTERM');
    worker.kill('SIGTERM');
    await Promise.allSettled([
      new Promise((done) => api.once('exit', done)),
      new Promise((done) => worker.once('exit', done))
    ]);
    await rm(dataDir, { recursive: true, force: true });
  }
});
