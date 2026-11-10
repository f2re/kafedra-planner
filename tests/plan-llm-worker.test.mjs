import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { registerDocument, requestDocumentReprocess } from '../packages/storage/src/documents.mjs';
import { completeJob } from '../packages/storage/src/jobs.mjs';
import { loadConfig } from '../packages/config/src/index.mjs';
import { dispatchJob } from '../apps/worker/src/processor.mjs';

const logger = { info() {}, warn() {} };
const text = [
  'ПЛАН РАБОТЫ ИНСТИТУТА', 'на 2026 календарный год',
  '№ | Мероприятие | Срок проведения | Ответственный',
  '1 | Научная конференция | 20 ноября 2026 | Иванов И.И.',
  '2 | Методическое совещание | 25 ноября 2026 | Петров П.П.',
  'Подготовить методические рекомендации по итогам семестра'
].join('\n');

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-plan-worker-'));
  const config = loadConfig({ KAFEDRA_DATA_DIR: dir, KAFEDRA_PREVIEW_ENABLED: 'false',
    KAFEDRA_OCR_ENABLED: 'false', KAFEDRA_LLM_ENABLED: 'true', KAFEDRA_LLM_ENDPOINT: 'http://127.0.0.1:1' }, resolve('.'));
  const database = new Database(config.databasePath, { migrationsDir: config.migrationsDir });
  t.after(async () => { database.close(); await rm(dir, { recursive: true, force: true }); });
  const workspace = ensureDefaultWorkspace(database);
  const path = join(dir, 'source.txt');
  await writeFile(path, text, 'utf8');
  const register = (requestedType, key) => registerDocument(database, {
    workspaceId: workspace.id, title: 'План института', originalName: 'source.txt', mediaType: 'text/plain',
    detectedFormat: 'text', requestedType, idempotencyKey: key,
    blob: { sha256: createHash('sha256').update(text).digest('hex'), sizeBytes: Buffer.byteLength(text), storagePath: path }
  });
  const process = async (jobId) => {
    await dispatchJob(database, database.get('SELECT * FROM jobs WHERE id = ?', jobId), logger, config);
    completeJob(database, jobId);
  };
  return { database, workspace, config, register, process };
}

test('working plan is persisted and optional jobs queued before any LLM request', async (t) => {
  const { database, register, process } = await fixture(t);
  const document = register('plan', 'plan-source');
  await process(document.jobId);
  assert.equal(database.get('SELECT COUNT(*) n FROM plans').n, 1);
  assert.equal(database.get('SELECT COUNT(*) n FROM plan_items').n, 2);
  assert.equal(database.get('SELECT COUNT(*) n FROM calendar_items WHERE source_kind = ?', 'plan_item').n, 2);
  assert.ok(database.get("SELECT COUNT(*) n FROM jobs WHERE kind = 'enrich_plan'").n > 0);
  assert.equal(database.get('SELECT COUNT(*) n FROM llm_extraction_runs').n, 0);
  const jobs = database.get("SELECT COUNT(*) n FROM jobs WHERE kind = 'enrich_plan'").n;
  await process(document.jobId);
  assert.equal(database.get('SELECT COUNT(*) n FROM plans').n, 1);
  assert.equal(database.get("SELECT COUNT(*) n FROM jobs WHERE kind = 'enrich_plan'").n, jobs);
});

test('explicit plan template never materializes sample events, including reprocessing without a requested type', async (t) => {
  const { database, workspace, register, process } = await fixture(t);
  const document = register('plan_template', 'monthly-template-source');
  await process(document.jobId);
  assert.equal(database.get('SELECT document_type FROM documents WHERE id = ?', document.documentId).document_type, 'plan_template');
  assert.equal(database.get('SELECT processing_status FROM document_versions WHERE id = ?', document.versionId).processing_status, 'processed');
  for (const table of ['plans', 'plan_items', 'calendar_items', 'meetings', 'llm_extraction_runs']) {
    assert.equal(database.get(`SELECT COUNT(*) n FROM ${table}`).n, 0, table);
  }
  assert.equal(database.get("SELECT COUNT(*) n FROM jobs WHERE kind = 'enrich_plan'").n, 0);
  assert.equal(database.get("SELECT COUNT(*) n FROM review_items WHERE issue_code = 'document_type_unknown'").n, 0);
  const repeat = requestDocumentReprocess(database, { workspaceId: workspace.id, documentId: document.documentId });
  assert.equal(JSON.parse(database.get('SELECT payload_json FROM jobs WHERE id = ?', repeat.jobId).payload_json).requestedType, 'auto');
  await process(repeat.jobId);
  assert.equal(database.get('SELECT COUNT(*) n FROM plans').n, 0);
  assert.equal(database.get('SELECT document_type FROM documents WHERE id = ?', document.documentId).document_type, 'plan_template');
});
