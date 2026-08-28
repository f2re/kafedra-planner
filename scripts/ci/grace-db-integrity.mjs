import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { readMigrationInventory } from '../../packages/storage/src/database.mjs';

function schemaDigest(database) {
  const schema = database.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all();
  const migrations = database.prepare(`
    SELECT version, name
    FROM schema_migrations
    ORDER BY version
  `).all();
  return createHash('sha256')
    .update(JSON.stringify({ schema, migrations }))
    .digest('hex');
}

export function checkDatabaseIntegrity({ databasePath, migrationsDir }) {
  const dbPath = resolve(databasePath);
  const migrationRoot = resolve(migrationsDir);
  if (!existsSync(dbPath)) throw new Error(`Database does not exist: ${dbPath}`);
  const expected = readMigrationInventory(migrationRoot)
    .map(({ version, name }) => ({ version, name }));
  const database = new DatabaseSync(dbPath, {
    open: true,
    readOnly: false,
    timeout: 30_000
  });
  try {
    database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 30000;');
    const quickRows = database.prepare('PRAGMA quick_check').all();
    const quickErrors = quickRows
      .map((row) => row.quick_check)
      .filter((value) => value !== 'ok');
    if (quickErrors.length) {
      throw new Error(`PRAGMA quick_check failed: ${quickErrors.join('; ')}`);
    }
    const foreignKeyRows = database.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyRows.length) {
      throw new Error(`PRAGMA foreign_key_check returned ${foreignKeyRows.length} violation(s).`);
    }
    const applied = database.prepare(`
      SELECT version, name
      FROM schema_migrations
      ORDER BY version
    `).all().map((row) => ({
      version: Number(row.version),
      name: String(row.name)
    }));
    if (JSON.stringify(applied) !== JSON.stringify(expected)) {
      throw new Error(
        `schema_migrations mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(applied)}.`
      );
    }
    return {
      ok: true,
      schemaVersion: expected.at(-1)?.version || 0,
      migrations: expected.length,
      schemaDigest: schemaDigest(database)
    };
  } finally {
    database.close();
  }
}
