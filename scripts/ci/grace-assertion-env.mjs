#!/usr/bin/env node
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHANGE_ID_PATTERN = /^C-[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/u;
const PLAYWRIGHT_COMMAND_MARKER = 'playwright test';

function decodeXml(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/gu, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

export function extractCommandTexts(planXml) {
  return [...String(planXml).matchAll(/<Command>([\s\S]*?)<\/Command>/gu)]
    .map((match) => decodeXml(match[1]).trim())
    .filter(Boolean);
}

export function commandNeedsPlaywright(command) {
  const normalized = String(command || '').replace(/\\\s*\n/gu, ' ').trim();
  const lower = normalized.toLowerCase();
  if (lower === PLAYWRIGHT_COMMAND_MARKER || lower.startsWith(`${PLAYWRIGHT_COMMAND_MARKER} `)) return true;
  const segments = normalized.split(/[;&|()"']/u).map((value) => value.trim()).filter(Boolean);
  return segments.some((segment) =>
    /^(?:[A-Z_][A-Z0-9_]*=\S+\s+)*(?:npx\s+(?:--yes\s+)?(?:playwright(?:@[\w.-]+)?\s+)?|)playwright\s+test(?:\s|$)/iu.test(segment)
    || /^(?:[A-Z_][A-Z0-9_]*=\S+\s+)*npm\s+(?:run\s+)?test:browser(?:[\w:-]*)?(?:\s|$)/iu.test(segment)
  );
}

export function inspectPlanXml(planXml) {
  const commands = extractCommandTexts(planXml);
  return {
    commandCount: commands.length,
    playwright: commands.some(commandNeedsPlaywright)
  };
}

export function planPath(root, changeId) {
  if (!CHANGE_ID_PATTERN.test(String(changeId || ''))) {
    throw new Error(`Invalid GRACE change id: ${changeId || '<empty>'}`);
  }
  return resolve(root, '.grace', 'changes', 'active', changeId, 'plan.xml');
}

export async function inspectChangePlan({ root = process.cwd(), changeId }) {
  const path = planPath(root, changeId);
  const xml = await readFile(path, 'utf8');
  return { changeId, path, ...inspectPlanXml(xml) };
}

function argumentsFrom(argv) {
  const result = { root: process.cwd(), changeId: '', githubOutput: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--change') result.changeId = argv[++index] || '';
    else if (value === '--root') result.root = resolve(argv[++index] || '.');
    else if (value === '--github-output') result.githubOutput = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!result.changeId) throw new Error('--change is required.');
  return result;
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const result = await inspectChangePlan(options);
  if (options.githubOutput) {
    const output = process.env.GITHUB_OUTPUT;
    if (!output) throw new Error('GITHUB_OUTPUT is required with --github-output.');
    await appendFile(output, `playwright=${result.playwright}\ncommand_count=${result.commandCount}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const executed = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (executed) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
