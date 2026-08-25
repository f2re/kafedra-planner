#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  collectAcceptanceEvidence020,
  compareAcceptanceEvidence020
} from '../packages/system/src/acceptance-020.mjs';

function args(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) { result._.push(value); continue; }
    const name = value.slice(2);
    if (['full'].includes(name)) result[name] = true;
    else result[name] = argv[++index];
  }
  return result;
}

function paths(input) {
  const dataDir = resolve(input['data-dir'] || process.env.KAFEDRA_DATA_DIR || '/var/lib/kafedra-planner');
  const applicationDir = resolve(input['application-dir'] || process.env.KAFEDRA_APP_DIR || '/opt/kafedra-planner/current');
  const backupDir = resolve(input['backup-dir'] || process.env.KAFEDRA_BACKUP_DIR || join(dataDir, 'backups'));
  const databasePath = resolve(input.database || process.env.KAFEDRA_DATABASE_PATH || join(dataDir, 'database.sqlite3'));
  return { dataDir, applicationDir, backupDir, databasePath };
}

async function outputJson(value, path) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (!path || path === '-') process.stdout.write(body);
  else {
    await mkdir(dirname(resolve(path)), { recursive: true });
    await writeFile(resolve(path), body, { mode: 0o600 });
    process.stdout.write(`${resolve(path)}\n`);
  }
}

async function main() {
  const input = args(process.argv.slice(2));
  const command = input._[0] || 'collect';
  if (command === 'collect') {
    const evidence = await collectAcceptanceEvidence020({
      ...paths(input),
      requireFull: input.full === true
    });
    await outputJson(evidence, input.output);
    process.exitCode = evidence.acceptance.status === 'fail' ? 1 : 0;
    return;
  }
  if (command === 'compare') {
    const beforePath = input._[1];
    const afterPath = input._[2];
    if (!beforePath || !afterPath) throw new Error('usage: target-acceptance-020 compare before.json after.json [--output result.json]');
    const before = JSON.parse(await readFile(resolve(beforePath), 'utf8'));
    const after = JSON.parse(await readFile(resolve(afterPath), 'utf8'));
    const comparison = compareAcceptanceEvidence020(before, after);
    await outputJson(comparison, input.output);
    process.exitCode = comparison.status === 'equal' ? 0 : 2;
    return;
  }
  throw new Error(`unknown_command:${command}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
