import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function latestMigrationVersion(migrationsDir = resolve('migrations')) {
  const versions = readdirSync(migrationsDir)
    .map((name) => /^(\d+)_.*\.sql$/u.exec(name))
    .filter(Boolean)
    .map((match) => Number.parseInt(match[1], 10));
  if (!versions.length) throw new Error('schema_migrations_not_found');
  return Math.max(...versions);
}

export const CURRENT_SCHEMA_VERSION = latestMigrationVersion();
