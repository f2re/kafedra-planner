import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';

async function withDatabase(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-nested-transaction-'));
  const database = new Database(join(dir, 'test.sqlite3'));
  try {
    database.exec('CREATE TABLE values_log(id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT;');
    await fn(database);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('вложенная транзакция фиксируется внутри внешней', async () => {
  await withDatabase((database) => {
    database.transaction(() => {
      database.run('INSERT INTO values_log(value) VALUES (?)', 'outer');
      database.transaction(() => {
        database.run('INSERT INTO values_log(value) VALUES (?)', 'inner');
      });
    });
    assert.deepEqual(
      database.all('SELECT value FROM values_log ORDER BY id').map((row) => row.value),
      ['outer', 'inner']
    );
  });
});

test('ошибка вложенной транзакции откатывает только savepoint', async () => {
  await withDatabase((database) => {
    database.transaction(() => {
      database.run('INSERT INTO values_log(value) VALUES (?)', 'before');
      assert.throws(() => database.transaction(() => {
        database.run('INSERT INTO values_log(value) VALUES (?)', 'rolled-back');
        throw new Error('inner failure');
      }), /inner failure/);
      database.run('INSERT INTO values_log(value) VALUES (?)', 'after');
    });
    assert.deepEqual(
      database.all('SELECT value FROM values_log ORDER BY id').map((row) => row.value),
      ['before', 'after']
    );
    assert.equal(database.quickCheck(), true);
  });
});
