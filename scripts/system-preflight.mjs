#!/usr/bin/env node
import { inspectSystem, renderPreflight } from '../packages/system/src/preflight.mjs';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const strict = args.has('--strict');
const requireFull = args.has('--require-full');
const result = inspectSystem();

if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
else process.stdout.write(`${renderPreflight(result)}\n`);

if (strict && result.requiredMissing.length) process.exitCode = 2;
if (requireFull && (result.requiredMissing.length || !result.capabilities.ocr || !result.capabilities.officePreview)) {
  process.exitCode = 3;
}
