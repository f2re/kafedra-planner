import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { replaceDocumentBlocks } from '../packages/storage/src/document-structure.mjs';
import { completeJob } from '../packages/storage/src/jobs.mjs';
import { saveLlmSettings } from '../packages/ai/src/llm-config-store.mjs';
import { extractPlan } from '../packages/plans/src/extractor.mjs';
import { getPlan, persistPlan, listPlanSourceRows, materializePlanSourceRow } from '../packages/plans/src/service.mjs';
import { enqueuePlanLlmJobs, processPlanLlmJob } from '../apps/worker/src/plan-llm-job.mjs';

const now = '2026-11-10T09:00:00.000Z';
const title = 'Подготовить методические указания';
const logger = { info() {}, warn() {} };
const cell = (text, row, column) => ({ text,
  locator: { table: 1, row, column }, metadata: { table: 1, row, column } });

async function fixture(t, { prose = false, oversized = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-plan-llm-'));
  const database = new Database(join(dir, 'db.sqlite3'), { migrationsDir: resolve('migrations') });
  t.after(async () => { database.close(); await rm(dir, { recursive: true, force: true }); });
  const workspace = ensureDefaultWorkspace(database);
  database.run('INSERT INTO file_blobs(sha256,size_bytes,media_type,storage_path,created_at) VALUES (?,?,?,?,?)',
    'plan-llm-source', 1, 'text/plain', '/tmp/immutable-plan-fixture.txt', now);
  database.run(`INSERT INTO documents(id,workspace_id,title,document_type,status,current_version_id,created_at,updated_at)
    VALUES ('doc',?,'План института','organization_plan','needs_review','version',?,?)`, workspace.id, now, now);
  database.run(`INSERT INTO document_versions(id,document_id,version_no,blob_sha256,original_name,media_type,
    detected_format,processing_status,uploaded_at) VALUES ('version','doc',1,'plan-llm-source','plan.txt','text/plain','text','needs_review',?)`, now);
  const blocks = prose ? [
    { text: 'ПЛАН РАБОТЫ КАФЕДРЫ на 2026 календарный год', locator: { line: 1 } },
    { text: title, locator: { line: 2 } },
    ...(oversized ? [{ text: 'Очень длинное мероприятие '.repeat(1000), locator: { line: 3 } }] : [])
  ] : [
    { text: 'ПЛАН РАБОТЫ КАФЕДРЫ на 2026 календарный год', locator: { line: 1 } },
    cell('Что сделать', 1, 1), cell('Когда', 1, 2), cell('Кто', 1, 3),
    cell(title, 2, 1), cell('до 20 ноября', 2, 2), cell('Иванов И.И.', 2, 3)
  ];
  replaceDocumentBlocks(database, { documentVersionId: 'version', blocks, extractor: 'test', version: '1' });
  const result = extractPlan({ text: blocks.map((block) => block.text).join('\n'), blocks, requestedType: 'department_plan' });
  const plan = persistPlan(database, { workspaceId: workspace.id, documentVersionId: 'version', result, now });
  const config = { dataDir: dir, llmEnabled: true, llmEndpoint: 'http://localhost:8081',
    llmModel: 'initial-model', llmContextSize: 8192 };
  const jobs = () => database.all("SELECT * FROM jobs WHERE kind = 'enrich_plan' ORDER BY created_at, id");
  return { database, workspace, plan, config, jobs, dir };
}

function responseForRequest(options) {
  const body = JSON.parse(options.body);
  const input = JSON.parse(body.messages[1].content);
  const rows = input.rows.filter((row) => row.text.includes(title));
  return new Response(JSON.stringify({ model: body.model, choices: [{ finish_reason: 'stop', message: {
    content: JSON.stringify({ items: rows.map((row) => ({
      sourceRowKey: row.sourceRowKey, title, sourceQuote: row.text,
      dateRaw: null, deadlineRaw: row.text.includes('до 20 ноября') ? 'до 20 ноября' : null,
      responsibleRaw: row.text.includes('Иванов И.И.') ? 'Иванов И.И.' : null,
      expectedResult: null, activityKind: 'methodological'
    })) })
  } }] }), { headers: { 'content-type': 'application/json' } });
}

test('LLM parsing is queued after a working plan, saves proposals with provenance, and materializes once', async (t) => {
  const f = await fixture(t);
  const { database, workspace, plan, config, jobs } = f;
  assert.equal(getPlan(database, workspace.id, plan.id).items.length, 0);
  const before = database.all('SELECT id,raw_text,cells_json,locator_json FROM plan_source_rows ORDER BY id');
  const queued = enqueuePlanLlmJobs(database, { workspaceId: workspace.id, planId: plan.id, config });
  assert.ok(queued.queued > 0);
  assert.equal(listPlanSourceRows(database, workspace.id, plan.id).llm.status, 'pending');
  assert.equal(enqueuePlanLlmJobs(database, { workspaceId: workspace.id, planId: plan.id, config }).queued, 0);
  let calls = 0;
  for (const job of jobs()) {
    await processPlanLlmJob(database, job, logger, config, {
      fetchImpl: async (_url, options) => { calls += 1; return responseForRequest(options); }
    });
    completeJob(database, job.id);
    const duplicate = await processPlanLlmJob(database, job, logger, config, {
      fetchImpl: async () => { throw new Error('duplicate_request'); }
    });
    assert.equal(duplicate.duplicate, true);
  }
  assert.equal(calls, jobs().length);
  assert.deepEqual(database.all('SELECT id,raw_text,cells_json,locator_json FROM plan_source_rows ORDER BY id'), before);
  let source = listPlanSourceRows(database, workspace.id, plan.id);
  assert.equal(source.llm.status, 'completed');
  assert.equal(source.llm.proposed, 1);
  const row = source.items.find((entry) => entry.suggestion?.llm);
  assert.ok(row.attention);
  assert.equal(row.suggestion.tasks[0].dueDate, '2026-11-20');
  assert.equal(row.suggestion.llm.promptVersion, 'plan-extract-v1');
  assert.equal(getPlan(database, workspace.id, plan.id).items.length, 0, 'proposal does not create a fact');
  const accepted = materializePlanSourceRow(database, workspace.id, plan.id, row.id, { tasks: row.suggestion.tasks });
  const saved = accepted.plan.items[0];
  assert.equal(saved.evidence.activityKind, 'methodological');
  assert.equal(saved.evidence.llmProposal.sourceQuote, row.rawText);
  assert.ok(saved.evidence.llmProposal.runId);
  assert.equal(saved.calendar_items.length, 1);
  const repeated = materializePlanSourceRow(database, workspace.id, plan.id, row.id, { tasks: row.suggestion.tasks });
  assert.deepEqual(repeated.savedItemIds, accepted.savedItemIds);
  source = listPlanSourceRows(database, workspace.id, plan.id);
  assert.equal(source.llm.proposed, 0);
  assert.equal(source.items.find((entry) => entry.id === row.id).attention, false);
});

test('LLM never overwrites a row materialized while the request is in flight', async (t) => {
  const { database, workspace, plan, config, jobs } = await fixture(t, { prose: true });
  enqueuePlanLlmJobs(database, { workspaceId: workspace.id, planId: plan.id, config });
  const row = listPlanSourceRows(database, workspace.id, plan.id).items.find((entry) => entry.rawText === title);
  let savedItem;
  for (const job of jobs()) {
    await processPlanLlmJob(database, job, logger, config, { fetchImpl: async (_url, options) => {
      if (!savedItem) {
        const saved = materializePlanSourceRow(database, workspace.id, plan.id, row.id, { tasks: [{
          title: 'Ручная правка оператора', dueDate: '2026-12-15', direction: 'education'
        }] });
        savedItem = saved.plan.items[0];
      }
      return responseForRequest(options);
    } });
    completeJob(database, job.id);
  }
  const actual = getPlan(database, workspace.id, plan.id).items[0];
  assert.equal(actual.title, 'Ручная правка оператора');
  assert.equal(actual.due_date, '2026-12-15');
  assert.equal(actual.evidence_json, savedItem.evidence_json);
  assert.equal(listPlanSourceRows(database, workspace.id, plan.id).items.find((entry) => entry.id === row.id).suggestion.llm, undefined);
});

test('failed optional chunks preserve the document and can be explicitly retried with current settings', async (t) => {
  const { database, workspace, plan, config, jobs, dir } = await fixture(t, { prose: true });
  enqueuePlanLlmJobs(database, { workspaceId: workspace.id, planId: plan.id, config });
  saveLlmSettings(dir, { llmModel: 'updated-local-model' }, config);
  for (const job of jobs()) {
    const failed = await processPlanLlmJob(database, job, logger, config, { fetchImpl: async (_url, options) => {
      assert.equal(JSON.parse(options.body).model, 'updated-local-model');
      return new Response('', { status: 503 });
    } });
    assert.equal(failed.status, 'failed');
    completeJob(database, job.id);
  }
  assert.equal(database.get("SELECT processing_status FROM document_versions WHERE id = 'version'").processing_status, 'needs_review');
  assert.equal(database.get('SELECT COUNT(*) n FROM plans').n, 1);
  assert.equal(listPlanSourceRows(database, workspace.id, plan.id).llm.status, 'failed');
  // Restore the queued configuration to exercise retry of the same job identity.
  saveLlmSettings(dir, { llmModel: config.llmModel }, config);
  const ids = jobs().map((job) => job.id);
  assert.equal(enqueuePlanLlmJobs(database, { workspaceId: workspace.id, planId: plan.id, config, retryFailed: true }).queued, ids.length);
  assert.deepEqual(jobs().map((job) => job.id), ids);
  for (const job of jobs()) {
    await processPlanLlmJob(database, job, logger, config, { fetchImpl: async (_url, options) => responseForRequest(options) });
    completeJob(database, job.id);
  }
  assert.equal(listPlanSourceRows(database, workspace.id, plan.id).llm.status, 'completed');
  assert.ok(database.get('SELECT COUNT(*) n FROM llm_extraction_runs').n > jobs().length, 'failure history is preserved');
});

test('unrecognized prose and oversized rows remain visible; disabled LLM creates no jobs', async (t) => {
  const { database, workspace, plan, config } = await fixture(t, { prose: true, oversized: true });
  const rows = listPlanSourceRows(database, workspace.id, plan.id).items;
  assert.equal(rows.length, 3);
  assert.equal(rows[1].rawText, title);
  assert.equal(enqueuePlanLlmJobs(database, { workspaceId: workspace.id, planId: plan.id,
    config: { ...config, llmEnabled: false } }).status, 'disabled');
  assert.equal(database.get('SELECT COUNT(*) n FROM jobs').n, 0);
  const result = enqueuePlanLlmJobs(database, { workspaceId: workspace.id, planId: plan.id, config });
  assert.equal(result.skipped.length, 1);
  assert.equal(listPlanSourceRows(database, workspace.id, plan.id).llm.skipped, 1);
  assert.equal(database.get('SELECT COUNT(*) n FROM plan_source_rows').n, 3);
});

test('a stale worker cannot publish LLM proposals after losing the job lease', async (t) => {
  const { database, workspace, plan, config, jobs } = await fixture(t, { prose: true });
  enqueuePlanLlmJobs(database, { workspaceId: workspace.id, planId: plan.id, config });
  const initial = jobs()[0];
  database.run("UPDATE jobs SET status = 'running', locked_by = 'worker-one' WHERE id = ?", initial.id);
  const job = database.get('SELECT * FROM jobs WHERE id = ?', initial.id);
  const result = await processPlanLlmJob(database, job, logger, config, { fetchImpl: async (_url, options) => {
    database.run("UPDATE jobs SET locked_by = 'worker-two' WHERE id = ?", job.id);
    return responseForRequest(options);
  } });
  assert.equal(result.status, 'skipped');
  assert.equal(result.error, 'lease_lost');
  assert.equal(database.get('SELECT COUNT(*) n FROM llm_extraction_runs').n, 0);
  assert.equal(listPlanSourceRows(database, workspace.id, plan.id).llm.proposed, 0);
  assert.equal(database.get('SELECT locked_by FROM jobs WHERE id = ?', job.id).locked_by, 'worker-two');
});
