import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '../packages/storage/src/database.mjs';
import { ensureDefaultWorkspace } from '../packages/storage/src/bootstrap.mjs';
import { persistScientificItem, listScientificItems } from '../packages/science/src/service.mjs';

const migrationsDir = resolve('migrations');

test('научная статья индексируется по автору и классификации', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-science-'));
  const database = new Database(join(dir, 'test.sqlite3'), { migrationsDir });
  try {
    const workspace = ensureDefaultWorkspace(database);
    database.run(`INSERT INTO people(id, workspace_id, display_name, normalized_name, created_at, updated_at)
      VALUES ('person-1', ?, 'Иванов И.И.', 'иванов и и', '2026-01-01', '2026-01-01')`, workspace.id);
    const item = persistScientificItem(database, {
      workspaceId: workspace.id,
      result: {
        kind: 'article', title: 'Методы наукастинга', abstractText: 'Радарный прогноз осадков',
        publishedAt: '2026-01-01', publicationYear: 2026, venue: 'Метеорология',
        doi: '10.1234/test.1', authors: ['Иванов И.И.'],
        classifications: [{ kind: 'vak', value: 'ВАК' }, { kind: 'rinc', value: 'РИНЦ' }],
        confidence: 0.9, evidence: {}
      }
    });
    assert.equal(item.doi, '10.1234/test.1');
    assert.equal(listScientificItems(database, workspace.id, { author: 'Иванов' }).length, 1);
    assert.equal(listScientificItems(database, workspace.id, { classification: 'ВАК' }).length, 1);
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
