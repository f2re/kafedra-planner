import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarContextDate, calendarPlanContinuation } from '../public/calendar-plan-flow.js';

test('calendar plan continuation chooses create direct or choose without learning', () => {
  assert.deepEqual(calendarPlanContinuation([]), { mode: 'create', planId: null, plans: [] });
  assert.deepEqual(calendarPlanContinuation([{ id: 'plan_one', title: 'Один' }]), {
    mode: 'direct', planId: 'plan_one', plans: [{ id: 'plan_one', title: 'Один' }]
  });
  assert.deepEqual(calendarPlanContinuation([{ id: 'plan_a' }, { id: 'plan_b' }]), {
    mode: 'choose', planId: 'plan_a', plans: [{ id: 'plan_a' }, { id: 'plan_b' }]
  });
  assert.equal(calendarPlanContinuation([{ title: 'без id' }]).mode, 'create');
});

test('calendar context keeps an explicit valid date and otherwise uses local fallback', () => {
  assert.equal(calendarContextDate('2026-09-17'), '2026-09-17');
  assert.equal(calendarContextDate('bad', new Date(2026, 8, 5, 12, 0, 0)), '2026-09-05');
});
