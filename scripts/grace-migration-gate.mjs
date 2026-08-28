#!/usr/bin/env node
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  analyzeMigrationDiff,
  listTreeFiles,
  parseArguments,
  readChangedEntries,
  repositoryRoot,
  runCommand,
  runGit
} from './lib/grace-governance.mjs';

function runMigration(applicationDir, databasePath, dataDir) {
  const environment = {
    ...process.env,
    KAFEDRA_APPLICATION_DIR: applicationDir,
    KAFEDRA_DATA_DIR: dataDir,
    KAFEDRA_DATABASE_PATH: databasePath,
    KAFEDRA_BACKUP_DIR: join(dataDir, 'backups'),
    KAFEDRA_SKIP_AUTO_BACKUP: '1',
    KAFEDRA_AUTO_BACKUP_BEFORE_MIGRATION: 'false',
    KAFEDRA_BACKUP_REQUIRED: 'false',
    KAFEDRA_BACKUP_INCLUDE_APPLICATION: 'false'
  };
  runCommand(process.execPath, [join(applicationDir, 'scripts', 'migrate.mjs')], {
    cwd: applicationDir,
    env: environment,
    stdio: 'inherit'
  });
}

export async function verifyMigrationUpgrade({ root, base, head, entries, runBackupSelftest = true }) {
  const baseFiles = listTreeFiles(base, 'migrations', { cwd: root });
  const headFiles = listTreeFiles(head, 'migrations', { cwd: root });
  const analysis = analyzeMigrationDiff({ entries, baseFiles, headFiles });
  if (analysis.errors.length) throw new Error(analysis.errors.join('\n'));
  if (analysis.newMigrations.length === 0) {
    console.log('GRACE migration gate: SQL-миграции в diff отсутствуют.');
    return { changed: false, ...analysis };
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'kafedra-migration-gate-'));
  const baseWorktree = join(temporaryRoot, 'base');
  const dataDir = join(temporaryRoot, 'data');
  const databasePath = join(dataDir, 'upgrade.sqlite3');
  let worktreeAdded = false;
  try {
    runGit(['worktree', 'add', '--detach', baseWorktree, base], { cwd: root, stdio: 'inherit' });
    worktreeAdded = true;
    runMigration(baseWorktree, databasePath, dataDir);
    runMigration(root, databasePath, dataDir);
    runMigration(root, databasePath, dataDir);

    const { Database } = await import('../packages/storage/src/database.mjs');
    const database = new Database(databasePath, { readonly: true });
    try {
      if (!database.quickCheck()) throw new Error('PRAGMA quick_check вернул результат, отличный от ok.');
      const foreignKeyErrors = database.foreignKeyCheck();
      if (foreignKeyErrors.length > 0) {
        throw new Error(`PRAGMA foreign_key_check обнаружил нарушения: ${JSON.stringify(foreignKeyErrors)}`);
      }
      const schemaVersion = database.getSchemaVersion();
      if (schemaVersion !== analysis.headMax) {
        throw new Error(`Версия schema_migrations ${schemaVersion}, ожидалась ${analysis.headMax}.`);
      }
      const rows = database.all('SELECT version, name FROM schema_migrations ORDER BY version');
      const expected = headFiles
        .map((file) => ({ version: Number(file.match(/^migrations\/(\d{3})_/)?.[1]), name: file.slice('migrations/'.length) }))
        .filter((item) => Number.isFinite(item.version));
      if (JSON.stringify(rows) !== JSON.stringify(expected)) {
        throw new Error(`schema_migrations не совпадает с деревом HEAD. Получено ${JSON.stringify(rows)}, ожидалось ${JSON.stringify(expected)}.`);
      }
    } finally {
      database.close();
    }

    if (runBackupSelftest) {
      runCommand('npm', ['run', 'backup:selftest'], { cwd: root, stdio: 'inherit' });
    }
    console.log(`GRACE migration gate: upgrade ${analysis.baseMax} → ${analysis.headMax}, повторный migrate, quick_check, foreign_key_check и rollback через backup/restore проверены.`);
    return { changed: true, ...analysis };
  } finally {
    if (worktreeAdded) {
      runCommand('git', ['worktree', 'remove', '--force', baseWorktree], { cwd: root, allowFailure: true, stdio: 'ignore' });
    }
    if (existsSync(temporaryRoot)) rmSync(temporaryRoot, { recursive: true, force: true });
    runCommand('git', ['worktree', 'prune'], { cwd: root, allowFailure: true, stdio: 'ignore' });
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const root = repositoryRoot();
  const baseRef = String(args.base || process.env.GRACE_BASE_SHA || 'HEAD^');
  const headRef = String(args.head || process.env.GRACE_HEAD_SHA || 'HEAD');
  const { base, head, entries } = readChangedEntries(baseRef, headRef, { cwd: root });
  await verifyMigrationUpgrade({
    root,
    base,
    head,
    entries,
    runBackupSelftest: !args['skip-backup-selftest']
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
