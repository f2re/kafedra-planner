import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readPreferenceControls,
  resetLearnedPreferences,
  setPinnedPreference,
  setPreferenceLearning
} from '../packages/preferences/src/controls.mjs';
import { effectiveUiPreferences } from '../apps/api/src/ui-preferences-router.mjs';

class MemoryPreferenceDb {
  constructor(rows = []) { this.rows = rows.map((row) => ({ ...row })); }
  transaction(callback) { return callback(); }
  get(sql, ...args) {
    if (/COUNT\(\*\) AS count/u.test(sql)) {
      const [workspaceId, accountId] = args;
      return { count: this.rows.filter((row) => row.workspace_id === workspaceId && row.account_id === accountId).length };
    }
    if (/interaction_id = 'control'/u.test(sql)) {
      const [workspaceId, accountId, contextKey] = args;
      return [...this.rows].reverse().find((row) => row.workspace_id === workspaceId
        && row.account_id === accountId && row.context_key === contextKey && row.interaction_id === 'control');
    }
    if (/choice_value = \?/u.test(sql) && /interaction_id NOT IN/u.test(sql)) {
      const [workspaceId, accountId, contextKey, choiceValue] = args;
      const present = this.rows.some((row) => row.workspace_id === workspaceId
        && row.account_id === accountId && row.context_key === contextKey
        && row.choice_value === choiceValue && !['control', 'pin', 'explicit'].includes(row.interaction_id));
      return present ? { present: 1 } : undefined;
    }
    return undefined;
  }
  all(sql, ...args) {
    if (/interaction_id = 'pin'/u.test(sql)) {
      const [workspaceId, accountId] = args;
      return this.rows.filter((row) => row.workspace_id === workspaceId && row.account_id === accountId
        && row.interaction_id === 'pin' && row.context_key.startsWith('__pin__:'));
    }
    if (/GROUP BY context_key, choice_value/u.test(sql)) {
      const [workspaceId, accountId, ...keys] = args;
      const groups = new Map();
      for (const row of this.rows) {
        if (row.workspace_id !== workspaceId || row.account_id !== accountId || !keys.includes(row.context_key)) continue;
        const key = `${row.context_key}\u0000${row.choice_value}`;
        const current = groups.get(key) || {
          context_key: row.context_key,
          choice_value: row.choice_value,
          count: 0,
          last_selected_at: row.selected_at
        };
        current.count += 1;
        if (String(row.selected_at) > String(current.last_selected_at)) current.last_selected_at = row.selected_at;
        groups.set(key, current);
      }
      return [...groups.values()].sort((a, b) => b.count - a.count
        || String(b.last_selected_at).localeCompare(String(a.last_selected_at)));
    }
    return [];
  }
  run(sql, ...args) {
    if (/DELETE FROM ui_choice_preferences/u.test(sql)) {
      const [workspaceId, accountId] = args;
      if (/context_key = \? AND interaction_id = 'control'/u.test(sql)) {
        const contextKey = args[2];
        this.rows = this.rows.filter((row) => !(row.workspace_id === workspaceId && row.account_id === accountId
          && row.context_key === contextKey && row.interaction_id === 'control'));
      } else if (/context_key = \? AND interaction_id = 'pin'/u.test(sql)) {
        const contextKey = args[2];
        this.rows = this.rows.filter((row) => !(row.workspace_id === workspaceId && row.account_id === accountId
          && row.context_key === contextKey && row.interaction_id === 'pin'));
      } else if (/interaction_id NOT IN/u.test(sql)) {
        this.rows = this.rows.filter((row) => !(row.workspace_id === workspaceId && row.account_id === accountId
          && !['control', 'pin', 'explicit'].includes(row.interaction_id)
          && !row.context_key.startsWith('__control.') && !row.context_key.startsWith('__pin__:')));
      }
      return { changes: 1 };
    }
    if (/INSERT INTO ui_choice_preferences/u.test(sql)) {
      const [workspaceId, accountId, contextKey, choiceValue, selectedAt] = args;
      const interactionId = /'control'/u.test(sql) ? 'control' : /'pin'/u.test(sql) ? 'pin' : 'choice';
      this.rows.push({ workspace_id: workspaceId, account_id: accountId, context_key: contextKey,
        choice_value: choiceValue, interaction_id: interactionId, selected_at: selectedAt });
      return { changes: 1 };
    }
    return { changes: 0 };
  }
}

function learned(workspaceId, accountId, key, value, count) {
  return Array.from({ length: count }, (_, index) => ({
    workspace_id: workspaceId, account_id: accountId, context_key: key, choice_value: value,
    interaction_id: `choice-${index}`, selected_at: `2030-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
  }));
}

test('learning controls and reset are isolated by account and preserve pins/explicit rows', () => {
  const rows = [
    ...learned('ws', 'a1', 'calendar.mode', 'week', 2),
    ...learned('ws', 'a1', 'calendar.mode', 'month', 5),
    ...learned('ws', 'a2', 'calendar.mode', 'tasks', 3),
    { workspace_id: 'ws', account_id: 'a1', context_key: '__calendar_start_mode__', choice_value: 'week', interaction_id: 'explicit', selected_at: '2030-02-01T00:00:00.000Z' }
  ];
  const db = new MemoryPreferenceDb(rows);

  assert.equal(readPreferenceControls(db, 'ws', 'a1').learningEnabled, true);
  setPinnedPreference(db, 'ws', 'a1', 'calendar.mode', 'week', '2030-03-01T00:00:00.000Z');
  setPreferenceLearning(db, 'ws', 'a1', false, '2030-03-02T00:00:00.000Z');
  const controls = readPreferenceControls(db, 'ws', 'a1');
  assert.equal(controls.learningEnabled, false);
  assert.equal(controls.pinned['calendar.mode'], 'week');

  const reset = resetLearnedPreferences(db, 'ws', 'a1');
  assert.equal(reset.deleted, 7);
  assert.equal(readPreferenceControls(db, 'ws', 'a1').pinned['calendar.mode'], 'week');
  assert.ok(db.rows.some((row) => row.account_id === 'a1' && row.interaction_id === 'explicit'));
  assert.equal(db.rows.filter((row) => row.account_id === 'a2' && row.interaction_id.startsWith('choice-')).length, 3);
});

test('pinned safe default outranks frequency and survives disabled learning', () => {
  const db = new MemoryPreferenceDb([
    ...learned('ws', 'a1', 'calendar.mode', 'month', 8),
    ...learned('ws', 'a1', 'calendar.mode', 'week', 2)
  ]);
  setPinnedPreference(db, 'ws', 'a1', 'calendar.mode', 'week', '2030-04-01T00:00:00.000Z');
  let controls = readPreferenceControls(db, 'ws', 'a1');
  let effective = effectiveUiPreferences(db, 'ws', 'a1', ['calendar.mode'], controls);
  assert.equal(effective['calendar.mode'][0].value, 'week');
  assert.equal(effective['calendar.mode'][0].pinned, true);

  setPreferenceLearning(db, 'ws', 'a1', false, '2030-04-02T00:00:00.000Z');
  controls = readPreferenceControls(db, 'ws', 'a1');
  effective = effectiveUiPreferences(db, 'ws', 'a1', ['calendar.mode'], controls);
  assert.deepEqual(effective['calendar.mode'], [{ value: 'week', count: Number.MAX_SAFE_INTEGER, pinned: true }]);
});

test('unsafe or unseen defaults cannot be pinned', () => {
  const db = new MemoryPreferenceDb(learned('ws', 'a1', 'calendar.mode', 'week', 1));
  assert.throws(() => setPinnedPreference(db, 'ws', 'a1', 'work.periodic.edit.status', 'completed'), /preference_pin_key_forbidden/u);
  assert.throws(() => setPinnedPreference(db, 'ws', 'a1', 'calendar.mode', 'month'), /preference_pin_value_unknown/u);
});
