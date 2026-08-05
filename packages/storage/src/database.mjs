import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const sleepState = new Int32Array(new SharedArrayBuffer(4));

function isBusyError(error) {
  const errcode = Number(error?.errcode);
  if (errcode === 5 || errcode === 6) return true;
  return /SQLITE_(?:BUSY|LOCKED)|database is (?:busy|locked)/i.test(String(error?.message || error));
}

function pause(milliseconds) {
  Atomics.wait(sleepState, 0, 0, milliseconds);
}

function retryBusy(operation, { attempts = 120, delayMs = 25 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (!isBusyError(error) || attempt === attempts - 1) throw error;
      lastError = error;
      pause(Math.min(250, delayMs * (1 + Math.floor(attempt / 4))));
    }
  }
  throw lastError;
}

export class Database {
  constructor(path, { migrationsDir, readonly = false } = {}) {
    mkdirSync(dirname(path), { recursive: true });
    this.path = path;
    this.db = new DatabaseSync(path, {
      open: true,
      readOnly: readonly,
      timeout: 30_000
    });
    this.db.exec('PRAGMA busy_timeout = 30000; PRAGMA foreign_keys = ON;');
    if (!readonly) {
      retryBusy(() => this.db.exec('PRAGMA journal_mode = WAL;'));
      this.db.exec('PRAGMA synchronous = NORMAL;');
      if (migrationsDir) this.migrate(migrationsDir);
    }
  }

  migrate(migrationsDir) {
    retryBusy(() => this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `));
    const files = readdirSync(migrationsDir)
      .filter((name) => /^\d+_.*\.sql$/.test(name))
      .sort((a, b) => a.localeCompare(b, 'en'));
    for (const name of files) {
      const version = Number.parseInt(name.split('_', 1)[0], 10);
      const sql = readFileSync(join(migrationsDir, name), 'utf8');
      this.transaction(() => {
        if (this.get('SELECT 1 AS present FROM schema_migrations WHERE version = ?', version)) return;
        this.db.exec(sql);
        this.run(
          'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
          version,
          name,
          new Date().toISOString()
        );
      });
    }
  }

  transaction(fn, mode = 'IMMEDIATE') {
    return retryBusy(() => {
      this.db.exec(`BEGIN ${mode}`);
      try {
        const value = fn();
        this.db.exec('COMMIT');
        return value;
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch {}
        throw error;
      }
    });
  }

  run(sql, ...params) {
    return retryBusy(() => this.db.prepare(sql).run(...params));
  }

  get(sql, ...params) {
    return retryBusy(() => this.db.prepare(sql).get(...params));
  }

  all(sql, ...params) {
    return retryBusy(() => this.db.prepare(sql).all(...params));
  }

  exec(sql) {
    return retryBusy(() => this.db.exec(sql));
  }

  close() {
    this.db.close();
  }

  quickCheck() {
    return this.get('PRAGMA quick_check')?.quick_check === 'ok';
  }
}
