#!/usr/bin/env node
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { diagnoseLlm } from '../packages/ai/src/diagnostics.mjs';
import { proposeDirectiveWithLlama } from '../packages/ai/src/llama-client.mjs';
import { createSearchAssistant } from '../packages/ai/src/search-assistant.mjs';

// Diagnostic fixtures, never imported into the business database.
const cases = [
  ['meeting', 'заседание о полярных циклонах', 'Заседание кафедры',
    'На заседании кафедры рассмотрены результаты НИР по полярным циклонам.'],
  ['scientific_item', 'статья о полярных циклонах', 'Статья о полярных циклонах',
    'В статье описаны признаки полярных циклонов по данным спутника Арктика-М.'],
  ['document', 'отчёт о полярных циклонах', 'Отчёт о НИР',
    'В отчёте о НИР приведены результаты исследования полярных циклонов.']
];
const source = 'ПРИКАЗ № 7. ПРИКАЗЫВАЮ: 1. Подготовить отчёт до 20 августа 2026 года. Ответственный: Иванов Иван Иванович.';

async function sourceHashes() {
  const files = ['diagnostics.mjs', 'llama-client.mjs', 'directive-task.mjs', 'search-tasks.mjs', 'search-assistant.mjs'];
  return Object.fromEntries(await Promise.all(files.map(async (name) => [name,
    createHash('sha256').update(await readFile(new URL(`../packages/ai/src/${name}`, import.meta.url))).digest('hex')])));
}

export async function runLlmAcceptance(config, { fetchImpl = globalThis.fetch } = {}) {
  const report = {
    format: 'kafedra-llm-acceptance-v1', status: 'failed',
    coverage: 'Synthetic application calls only; no business database, ACL, browser or target OS acceptance.',
    generatedAt: new Date().toISOString(), sourceHashes: await sourceHashes(), checks: []
  };
  report.diagnostics = await diagnoseLlm(config, { fetchImpl });
  if (report.diagnostics.status !== 'ready') return report;
  report.searchDeadlineMs = Math.min(config.llmTimeoutMs || 45000, 30000);
  for (const [kind, query, title, snippet] of cases) {
    const started = Date.now();
    const target = { source_kind: kind, source_id: 'acceptance-target', title, snippet,
      route: { kind, id: 'acceptance-target' }, status: 'processed' };
    const unrelated = { source_kind: 'plan', source_id: 'acceptance-unrelated', title: 'Ремонт аудитории',
      snippet: 'В плане предусмотрен ремонт учебной аудитории.', route: { kind: 'plan', id: 'acceptance-unrelated' } };
    let queries = [];
    // Exercise both existing model tasks, without pretending this is a SQLite retrieval test.
    const context = { scope: ['llm-acceptance', kind], query, filters: {}, items: [],
      retrieve: (expanded) => { queries = expanded; return { items: [target, unrelated], relatedQueries: [] }; } };
    const assistant = createSearchAssistant({ config, fetchImpl });
    try {
      let result = assistant.request(context, { start: true, generation: '1' });
      const initialStatus = result.status;
      while (['queued', 'running'].includes(result.status) && Date.now() - started < report.searchDeadlineMs + 1000) {
        await sleep(25);
        result = assistant.request(context);
      }
      const expectedId = `${kind}:acceptance-target`;
      const passed = initialStatus === 'queued' && result.status === 'ready' && queries.length > 0
        && result.tasks?.length === 2 && result.suggestions?.length === 1
        && result.suggestions[0].id === expectedId;
      report.checks.push({ name: `search-${kind}`, status: passed ? 'passed' : 'failed',
        assistantStatus: result.status, durationMs: Date.now() - started, queries,
        selectedIds: (result.suggestions || []).map((item) => item.id), tasks: result.tasks || [] });
    } finally { assistant.close(); }
  }
  const directive = await proposeDirectiveWithLlama({ config, text: source, deterministic: {}, fetchImpl });
  const assignments = directive.output?.assignments;
  const passed = directive.status === 'completed' && directive.output?.kind === 'order'
    && directive.output.documentNumber === '7' && assignments?.length === 1
    && assignments[0].dueDate === '2026-08-20' && assignments[0].executors?.includes('Иванов Иван Иванович');
  report.checks.push({ name: 'directive', status: passed ? 'passed' : 'failed',
    proposalStatus: directive.status, error: directive.error || null, durationMs: directive.durationMs,
    promptVersion: directive.promptVersion, inputSha256: directive.inputSha256, metadata: directive.metadata });
  report.status = report.checks.length === 4 && report.checks.every((item) => item.status === 'passed') ? 'passed' : 'failed';
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) {
    process.stderr.write('Использование: node scripts/llm-acceptance.mjs (конфигурация KAFEDRA_LLM_* из окружения).\n');
    process.exitCode = 2;
  } else {
    try {
      const { loadConfig } = await import('../packages/config/src/index.mjs');
      const result = await runLlmAcceptance(loadConfig());
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (result.status !== 'passed') process.exitCode = 1;
    } catch {
      process.stderr.write('Прикладная проверка не завершена; проверьте конфигурацию и комплект файлов приложения.\n');
      process.exitCode = 1;
    }
  }
}
