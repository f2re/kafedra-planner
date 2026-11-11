#!/usr/bin/env node
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatAgentCatalogue, formatAgentGuide } from '../packages/ai/src/task-catalogue.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log('Usage: node scripts/export-agent-prompts.mjs [--output-dir DIR]');
  console.log('Default: update the repository manifest. --output-dir: export manifest, standalone probe and guide only to DIR.');
} else if (args.length === 0) {
  const path = join(root, 'packages/ai/department-agents.json');
  writeFileSync(path, formatAgentCatalogue(), 'utf8');
  console.log(`Каталог промптов: ${path}`);
} else if (args.length === 2 && args[0] === '--output-dir' && args[1] && !args[1].startsWith('--')) {
  const directory = resolve(args[1]);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'department-agents.json'), formatAgentCatalogue(), 'utf8');
  writeFileSync(join(directory, 'AGENTS_GUIDE.md'), formatAgentGuide(), 'utf8');
  const probe = join(directory, 'test-remote-agents.sh');
  copyFileSync(join(root, 'scripts/agent-probe.sh'), probe);
  chmodSync(probe, 0o755);
  console.log(`Каталог, диагностика и справочник: ${directory}`);
} else {
  console.error('Usage: node scripts/export-agent-prompts.mjs [--output-dir DIR]');
  process.exitCode = 2;
}
