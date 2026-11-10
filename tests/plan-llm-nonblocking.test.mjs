import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from '../packages/storage/src/database.mjs';

async function listen(server) {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return server.address().port;
}

async function waitFor(check, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch {}
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error('nonblocking_plan_condition_timeout');
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((done) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
    child.once('exit', () => { clearTimeout(timer); done(); });
    child.kill('SIGTERM');
  });
}

test('one held LLM request does not block importing another document or prematurely complete its job', { timeout: 25_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-plan-nonblocking-'));
  let release;
  const held = new Promise((done) => { release = done; });
  let inFlight = 0;
  let maxInFlight = 0;
  let requestStarted = false;
  const model = createServer(async (request, response) => {
    for await (const _chunk of request) { /* Drain request before holding the model response. */ }
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    requestStarted = true;
    await held;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ model: 'delayed-fixture', choices: [{ finish_reason: 'stop',
      message: { content: '{"items":[]}' } }] }));
    inFlight -= 1;
  });
  const modelPort = await listen(model);
  const reservation = createServer();
  const port = await listen(reservation);
  await new Promise((done) => reservation.close(done));
  const databasePath = join(dir, 'planner.sqlite3');
  const env = {
    ...process.env, KAFEDRA_DATA_DIR: dir, KAFEDRA_DATABASE_PATH: databasePath,
    KAFEDRA_HOST: '127.0.0.1', KAFEDRA_PORT: String(port),
    KAFEDRA_AUTH_ENABLED: 'false', KAFEDRA_PREVIEW_ENABLED: 'false', KAFEDRA_OCR_ENABLED: 'false',
    KAFEDRA_LLM_ENABLED: 'true', KAFEDRA_LLM_ENDPOINT: `http://127.0.0.1:${modelPort}`,
    KAFEDRA_LLM_MODEL: 'delayed-fixture', KAFEDRA_LLM_TIMEOUT_MS: '15000',
    KAFEDRA_WORKER_LEASE_SECONDS: '10', KAFEDRA_WORKER_POLL_MS: '250', KAFEDRA_LOG_LEVEL: 'error'
  };
  const api = spawn(process.execPath, ['apps/api/src/main.mjs'], { cwd: resolve('.'), env, stdio: 'ignore' });
  const worker = spawn(process.execPath, ['apps/worker/src/main.mjs'], { cwd: resolve('.'), env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const upload = async (key, body) => {
    const result = await fetch(`${base}/api/documents`, { method: 'POST', headers: {
      'content-type': 'text/plain', 'x-file-name': `${key}.txt`, 'x-document-type': 'plan', 'idempotency-key': key
    }, body });
    assert.equal(result.status, 202);
    return result.json();
  };
  try {
    await waitFor(async () => (await fetch(`${base}/api/system/health`)).ok);
    const first = await upload('first-plan', 'ПЛАН РАБОТЫ КАФЕДРЫ на 2026 календарный год\nПодготовить методические указания');
    await waitFor(() => requestStarted);
    const second = await upload('second-plan', 'ПЛАН РАБОТЫ КАФЕДРЫ на 2026 календарный год\nПровести научный семинар 20 ноября 2026 года');
    const plans = await waitFor(async () => {
      const result = await (await fetch(`${base}/api/plans`)).json();
      return result.items?.length === 2 ? result.items : null;
    });
    assert.equal(inFlight, 1, 'second document finished while the model response remains held');
    const secondPlan = plans.find((plan) => plan.source_document_id === second.documentId);
    assert.ok(secondPlan);
    const detail = await (await fetch(`${base}/api/plans/${secondPlan.id}`)).json();
    assert.equal(detail.items.length, 1);
    assert.equal(detail.items[0].starts_at, '2026-11-20');
    const db = new Database(databasePath, { migrationsDir: resolve('migrations') });
    try {
      const active = db.get("SELECT status, lease_until FROM jobs WHERE kind = 'enrich_plan' AND status = 'running'");
      assert.equal(active?.status, 'running');
      assert.ok(Date.parse(active.lease_until) - Date.now() > 25_000, 'lease covers request timeout and completion margin');
    } finally { db.close(); }
    release();
    const firstPlan = plans.find((plan) => plan.source_document_id === first.documentId);
    await waitFor(async () => {
      const rows = await (await fetch(`${base}/api/plans/${firstPlan.id}/source-rows`)).json();
      return rows.llm?.status === 'completed';
    });
    assert.equal(maxInFlight, 1);
  } finally {
    release();
    await Promise.all([stop(api), stop(worker)]);
    model.closeAllConnections();
    await new Promise((done) => model.close(done));
    await rm(dir, { recursive: true, force: true });
  }
});
