import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../packages/storage/src/database.mjs';
import { addSearchFragment, search } from '../packages/storage/src/search.mjs';

function setupDb() {
  const db = new Database(':memory:', { migrationsDir: './migrations' });
  db.run('INSERT INTO workspaces(id, code, name, created_at) VALUES(?, ?, ?, ?)', 'ws-test', 'TEST', 'Тестовая кафедра', new Date().toISOString());
  return db;
}

test('search sanitizes complex question punctuation without FTS5 syntax errors', async () => {
  const db = setupDb();

  addSearchFragment(db, {
    workspaceId: 'ws-test',
    sourceKind: 'meeting',
    sourceId: 'meeting-42',
    title: 'Заседание кафедры №5',
    content: 'На заседании кафедры обсуждалась статья о влажности воздуха и методах измерения. Приняты решения утвердить план.'
  });

  // Query containing ?, punctuation, stop words
  const question = 'На каком заседании кафедры обсуждалась статья о влажности и какие решения были приняты?';
  const results = search(db, 'ws-test', question);

  assert.ok(Array.isArray(results), 'Should return an array');
  assert.ok(results.length >= 1, 'Should find the meeting discussing humidity article');
  assert.equal(results[0].source_id, 'meeting-42');
});

test('search handles exotic punctuation (?, !, ", \', -, +, /, :, ;) safely', async () => {
  const db = setupDb();

  addSearchFragment(db, {
    workspaceId: 'ws-test',
    sourceKind: 'meeting',
    sourceId: 'meeting-43',
    title: 'Протокол 7 (срочно!)',
    content: 'Рассмотрены формулы Calc/Excel и ВПР: данные 100% согласованы.'
  });

  const query = 'Протокол 7! Calc/Excel + "ВПР": 100%?';
  const results = search(db, 'ws-test', query);

  assert.ok(Array.isArray(results));
  assert.ok(results.length >= 1);
  assert.equal(results[0].source_id, 'meeting-43');
});
