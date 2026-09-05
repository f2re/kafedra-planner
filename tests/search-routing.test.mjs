import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { routeForSearchResult } from '../apps/api/src/search-router.mjs';

function databaseFixture() {
  return {
    get(sql, workspaceId, sourceId) {
      if (/FROM plan_items/u.test(sql) && workspaceId === 'ws' && sourceId === 'item-1') return { id: 'plan-1' };
      if (/FROM decisions/u.test(sql) && workspaceId === 'ws' && sourceId === 'decision-1') return { id: 'meeting-1' };
      return undefined;
    }
  };
}

test('search route maps direct domain results without inventing a new object', () => {
  const database = databaseFixture();
  assert.deepEqual(routeForSearchResult(database, 'ws', { source_kind: 'document', source_id: 'doc-1' }), { kind: 'document', id: 'doc-1' });
  assert.deepEqual(routeForSearchResult(database, 'ws', { source_kind: 'meeting', source_id: 'meeting-2' }), { kind: 'meeting', id: 'meeting-2' });
  assert.deepEqual(routeForSearchResult(database, 'ws', { source_kind: 'assignment', source_id: 'assignment-1' }), { kind: 'assignment', id: 'assignment-1' });
  assert.deepEqual(routeForSearchResult(database, 'ws', { source_kind: 'periodic_task', source_id: 'periodic-1' }), { kind: 'periodic_task', id: 'periodic-1' });
  assert.deepEqual(routeForSearchResult(database, 'ws', { source_kind: 'plan', source_id: 'plan-2' }), { kind: 'plan', id: 'plan-2' });
  assert.deepEqual(routeForSearchResult(database, 'ws', { source_kind: 'directive', source_id: 'directive-1' }), { kind: 'directive', id: 'directive-1' });
  assert.deepEqual(routeForSearchResult(database, 'ws', { source_kind: 'scientific_item', source_id: 'science-1' }), { kind: 'science', id: 'science-1' });
});

test('search route resolves child results to their existing parent card', () => {
  const database = databaseFixture();
  assert.deepEqual(routeForSearchResult(database, 'ws', { source_kind: 'plan_item', source_id: 'item-1' }), { kind: 'plan', id: 'plan-1' });
  assert.deepEqual(routeForSearchResult(database, 'ws', { source_kind: 'decision', source_id: 'decision-1' }), { kind: 'meeting', id: 'meeting-1' });
  assert.deepEqual(routeForSearchResult(database, 'ws', {
    source_kind: 'template_extraction', source_id: 'extract-1', source_document_id: 'doc-2'
  }), { kind: 'document', id: 'doc-2' });
  assert.equal(routeForSearchResult(database, 'ws', { source_kind: 'plan_item', source_id: 'missing' }), null);
  assert.equal(routeForSearchResult(database, 'ws', { source_kind: 'unknown', source_id: 'x' }), null);
});

test('search UI reuses the canonical exact-route opener and progressive disclosure', async () => {
  const [search, actionCenter] = await Promise.all([
    readFile(new URL('../public/search-next.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/action-center.js', import.meta.url), 'utf8')
  ]);
  assert.match(actionCenter, /window\.kafedraOpenExactRoute\s*=\s*openExactRoute/u);
  assert.match(actionCenter, /route\.kind === 'assignment'/u);
  assert.match(actionCenter, /route\.kind === 'periodic_task'/u);
  assert.match(search, /window\.kafedraOpenExactRoute/u);
  assert.match(search, /search-more-filters/u);
  assert.match(search, /К поиску/u);
  assert.match(search, /data-search-clear-filter/u);
  assert.doesNotMatch(search, /window\.open\([^)]*route/u);
});
