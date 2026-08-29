import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_IDS, rankActions, destinationFromDocument, matchesActionQuery } from '../public/action-center.js';
import { recordUiPreferences, supportedUiPreferenceKeys } from '../packages/preferences/src/service.mjs';

function fakePreferenceDatabase() {
  return {
    rows: [],
    all() { return []; },
    get() { return null; },
    run(_sql, ...values) { this.rows.push(values); },
    transaction(fn) { return fn(); }
  };
}

test('domain context outranks learned frequency and recommendations keep deterministic order', () => {
  const actions = [
    { id: 'calendar.task.create', available: true, explicitScore: 100, domainScore: 20, periodScore: 0, staticPriority: 100 },
    { id: 'science.report', available: true, explicitScore: 0, domainScore: 0, periodScore: 20, staticPriority: 45 },
    { id: 'document.upload', available: true, explicitScore: 0, domainScore: 0, periodScore: 0, staticPriority: 95 },
    { id: 'plan.create', available: false, explicitScore: 500, domainScore: 500, periodScore: 500, staticPriority: 500 }
  ];
  const frequencies = new Map([['science.report', 999], ['calendar.task.create', 1]]);
  const ranked = rankActions(actions, { explicitDate: '2026-09-17' }, frequencies);
  assert.equal(ranked[0].id, 'calendar.task.create');
  assert.equal(ranked.some((action) => action.id === 'plan.create'), false);
  assert.deepEqual(ranked.slice(0, 3).map((action) => action.id), [
    'calendar.task.create', 'science.report', 'document.upload'
  ]);
});

test('deterministic action search uses labels and keywords', () => {
  assert.equal(matchesActionQuery({ label: 'Загрузить план', keywords: ['excel', 'word'] }, 'план excel'), true);
  assert.equal(matchesActionQuery({ label: 'Создать заседание', keywords: ['протокол'] }, 'план'), false);
});

test('document destination follows exact persisted processing result and never guesses unknown files', () => {
  assert.deepEqual(destinationFromDocument({ id: 'doc1', processing_status: 'extracting' }), { kind: 'processing', documentId: 'doc1' });
  assert.deepEqual(destinationFromDocument({ id: 'doc2', processing_status: 'processed', extractionRuns: [{ result: { protocol: { id: 'meeting1' } } }] }),
    { kind: 'meeting', objectId: 'meeting1', documentId: 'doc2' });
  assert.deepEqual(destinationFromDocument({ id: 'doc3', processing_status: 'processed', extractionRuns: [{ result: { plan: { id: 'plan1' } } }] }),
    { kind: 'plan', objectId: 'plan1', documentId: 'doc3' });
  assert.deepEqual(destinationFromDocument({ id: 'doc4', processing_status: 'processed', extractionRuns: [{ result: { directive: { id: 'dir1' } } }] }),
    { kind: 'directive', objectId: 'dir1', documentId: 'doc4' });
  assert.deepEqual(destinationFromDocument({ id: 'doc5', processing_status: 'processed', extractionRuns: [{ result: { science: { id: 'science1' } } }] }),
    { kind: 'science', objectId: 'science1', documentId: 'doc5' });
  assert.deepEqual(destinationFromDocument({ id: 'doc6', processing_status: 'needs_review', extractionRuns: [{ result: {} }] }),
    { kind: 'review', documentId: 'doc6' });
  assert.deepEqual(destinationFromDocument({ id: 'doc7', processing_status: 'processed', extractionRuns: [{ result: {} }] }),
    { kind: 'document', documentId: 'doc7' });
});

test('action.center.action is allowlisted but unknown action ids fail closed', () => {
  assert.ok(supportedUiPreferenceKeys().includes('action.center.action'));
  const database = fakePreferenceDatabase();
  assert.doesNotThrow(() => recordUiPreferences(database, 'workspace', 'account', {
    interactionId: 'action-center:test-1',
    choices: [{ key: 'action.center.action', value: ACTION_IDS[0] }]
  }));
  assert.throws(() => recordUiPreferences(database, 'workspace', 'account', {
    interactionId: 'action-center:test-2',
    choices: [{ key: 'action.center.action', value: 'dangerous.delete.everything' }]
  }), /Недопустимое значение/u);
});
