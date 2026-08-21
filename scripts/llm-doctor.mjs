#!/usr/bin/env node
import { loadConfig } from '../packages/config/src/index.mjs';
import { diagnoseLlm } from '../packages/ai/src/diagnostics.mjs';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const optional = args.has('--optional');
const result = await diagnoseLlm(loadConfig());
if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
else {
  const labels = {
    disabled: 'LLM выключен', ready: 'LLM готов', model_missing: 'Выбранная модель не найдена',
    unavailable: 'LLM недоступен', timeout: 'LLM не ответил вовремя', incompatible: 'LLM API несовместим',
    misconfigured: 'LLM настроен неполно'
  };
  process.stdout.write(`${result.status === 'ready' || result.status === 'disabled' ? '✓' : '✗'} ${labels[result.status] || result.status}`);
  if (result.endpoint) process.stdout.write(`: ${result.endpoint}`);
  if (result.selectedModel) process.stdout.write(` · ${result.selectedModel}`);
  process.stdout.write('\n');
}
if (!optional && !['ready', 'disabled'].includes(result.status)) process.exitCode = 1;
