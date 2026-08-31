import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS,
  ACTION_GROUPS,
  ACTION_IDS,
  filterActions,
  rankActions,
  recommendActions
} from '../public/action-registry.js';
import { supportedUiPreferenceKeys } from '../packages/preferences/src/service.mjs';

test('реестр действий имеет стабильные группы и уникальные разрешённые идентификаторы', () => {
  assert.equal(new Set(ACTION_IDS).size, ACTION_IDS.length);
  assert.deepEqual(ACTION_GROUPS.map((group) => group.id), [
    'calendar', 'documents', 'plans', 'work', 'meetings', 'academic', 'science'
  ]);
  assert.ok(ACTIONS.every((action) => ACTION_GROUPS.some((group) => group.id === action.group)));
  assert.ok(supportedUiPreferenceKeys().includes('action.center.action'));
});

test('явный календарный контекст сильнее накопленной частоты', () => {
  const ranked = rankActions(ACTIONS, {
    context: { date: '2026-09-14', view: 'calendar', month: 9 },
    frequencies: { 'plan.upload': 10_000, 'directive.upload': 8_000 }
  });
  assert.deepEqual(ranked.slice(0, 2).map((action) => action.id), [
    'calendar.task', 'calendar.event'
  ]);
});

test('частота меняет только порядок доступных действий и не скрывает каталог', () => {
  const initial = rankActions(ACTIONS).map((action) => action.id);
  const learned = rankActions(ACTIONS, {
    frequencies: { 'meeting.upload': 20 }
  }).map((action) => action.id);
  assert.equal(initial.length, ACTIONS.length);
  assert.equal(learned.length, ACTIONS.length);
  assert.equal(learned[0], 'meeting.upload');
  assert.deepEqual(new Set(learned), new Set(initial));
});

test('поиск детерминированно находит предметные действия', () => {
  assert.deepEqual(filterActions(ACTIONS, 'протокол').map((action) => action.id), [
    'meeting.create', 'meeting.upload'
  ]);
  assert.deepEqual(filterActions(ACTIONS, 'EXCEL').map((action) => action.id), [
    'document.upload', 'plan.upload', 'academic.import'
  ]);
  assert.deepEqual(filterActions(ACTIONS, 'ведомость').map((action) => action.id), [
    'academic.import'
  ]);
});

test('рекомендации содержат три доступных действия в детерминированном порядке', () => {
  const recommendations = recommendActions({
    available: (action) => action.id !== 'calendar.task'
  });
  assert.equal(recommendations.length, 3);
  assert.ok(recommendations.every((action) => action.id !== 'calendar.task'));
  assert.deepEqual(recommendations.map((action) => action.id), [
    'calendar.event', 'document.upload', 'template.create'
  ]);
});
