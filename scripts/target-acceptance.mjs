#!/usr/bin/env node
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  collectAcceptanceEvidence,
  compareAcceptanceEvidence
} from '../packages/system/src/acceptance.mjs';

function parseArgs(argv) {
  const [command = 'capture', ...rest] = argv;
  const options = {};
  const positional = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    if (['require-full'].includes(key)) options[key] = true;
    else options[key] = rest[++index];
  }
  return { command, options, positional };
}

function parseEnvFile(text) {
  const result = {};
  for (const rawLine of String(text || '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
}

async function loadConfigFile(path) {
  if (!path) return {};
  return parseEnvFile(await readFile(path, 'utf8'));
}

async function writeJson(path, payload) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await chmod(absolute, 0o600);
  return absolute;
}

function usage() {
  return `Использование:\n\n  node scripts/target-acceptance.mjs capture [--config /etc/kafedra-planner/kafedra-planner.env] [--output /tmp/acceptance.json] [--require-full]\n  node scripts/target-acceptance.mjs compare BEFORE.json AFTER.json [--output /tmp/compare.json]\n`;
}

const { command, options, positional } = parseArgs(process.argv.slice(2));
if (!['capture', 'compare'].includes(command)) {
  process.stderr.write(usage());
  process.exit(2);
}

if (command === 'compare') {
  if (positional.length < 2) {
    process.stderr.write(usage());
    process.exit(2);
  }
  const before = JSON.parse(await readFile(resolve(positional[0]), 'utf8'));
  const after = JSON.parse(await readFile(resolve(positional[1]), 'utf8'));
  const comparison = compareAcceptanceEvidence(before, after);
  if (options.output) await writeJson(options.output, comparison);
  process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`);
  process.exitCode = comparison.status === 'equal' ? 0 : 3;
} else {
  const fileConfig = await loadConfigFile(options.config);
  const env = { ...fileConfig, ...process.env };
  const dataDir = options['data-dir'] || env.KAFEDRA_DATA_DIR || '/var/lib/kafedra-planner';
  const databasePath = options.database || env.KAFEDRA_DATABASE_PATH || `${dataDir}/kafedra-planner.sqlite3`;
  const backupDir = options['backup-dir'] || env.KAFEDRA_BACKUP_DIR || '/var/backups/kafedra-planner';
  const applicationDir = options['application-dir'] || env.KAFEDRA_APPLICATION_DIR || '/opt/kafedra-planner/current';
  const evidence = await collectAcceptanceEvidence({
    databasePath,
    dataDir,
    backupDir,
    applicationDir,
    requireFull: options['require-full'] === true
  });
  const output = options.output || `acceptance-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`;
  const outputPath = await writeJson(output, evidence);
  process.stdout.write(`${JSON.stringify({
    status: evidence.acceptance.status,
    output: outputPath,
    schemaVersion: evidence.database.schemaVersion,
    stableDigest: evidence.database.stableDigest,
    blobs: evidence.database.blobs.count,
    failures: evidence.acceptance.failures,
    warnings: evidence.acceptance.warnings
  })}\n`);
  process.exitCode = evidence.acceptance.status === 'fail' ? 4 : 0;
}
