import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlanDateWindow } from '../packages/plans/src/date.mjs';
import { extractLineItems } from '../packages/plans/src/items.mjs';

const calendar = { periodKind: 'calendar', yearStart: 2026, yearEnd: 2026 };
const academic = { periodKind: 'academic', yearStart: 2026, yearEnd: 2027 };
const windowOf = (text, period = calendar) => {
  const result = parsePlanDateWindow(text, period);
  return [result.start, result.end, result.precision];
};

test('impossible explicit days remain unresolved instead of becoming an entire month', () => {
  for (const value of ['31 февраля 2026', '«00» июля 2026', '32 ноября', '31.04.2026', '10.13.2026', '2026-02-29']) {
    assert.deepEqual(windowOf(value), [null, null, 'invalid'], value);
    assert.equal(parsePlanDateWindow(value, calendar).raw, value);
  }
  assert.deepEqual(windowOf('29 февраля 2024'), ['2024-02-29', null, 'day']);
  assert.deepEqual(windowOf('29 февраля 2026'), [null, null, 'invalid']);
});

test('shared month and cross-month ranges retain both endpoints and reject reversed ranges', () => {
  for (const value of ['10–12 ноября 2026', '10-12 ноября 2026', 'с 10 по 12 ноября']) {
    assert.deepEqual(windowOf(value), ['2026-11-10', '2026-11-12', 'range'], value);
  }
  assert.deepEqual(windowOf('28 ноября – 2 декабря 2026'), ['2026-11-28', '2026-12-02', 'range']);
  assert.deepEqual(windowOf('10.11–12.11.2026'), ['2026-11-10', '2026-11-12', 'range']);
  assert.deepEqual(windowOf('10.11-12.11.2026'), ['2026-11-10', '2026-11-12', 'range']);
  assert.deepEqual(windowOf('15 ноября 2026 г. — 2 декабря 2026'), ['2026-11-15', '2026-12-02', 'range']);
  assert.deepEqual(windowOf('12–10 ноября 2026'), [null, null, 'invalid']);
  assert.deepEqual(windowOf('28–31 февраля 2026'), [null, null, 'invalid']);
  const items = extractLineItems([{ text: '1. Провести семинар 28 ноября – 2 декабря 2026', locator: { line: 1 } }], calendar);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Провести семинар');
  assert.equal(items[0].startsAt, '2026-11-28');
  assert.equal(items[0].endsAt, '2026-12-02');
});

test('year inheritance uses the plan period without guessing a missing year or rolling a calendar year', () => {
  assert.deepEqual(windowOf('20 декабря – 10 января', academic), ['2026-12-20', '2027-01-10', 'range']);
  assert.deepEqual(windowOf('20 декабря – 10 января', calendar), [null, null, 'invalid']);
  assert.deepEqual(windowOf('20 декабря – 10 января 2027', null), [null, null, 'invalid']);
  assert.deepEqual(windowOf('10–12 ноября', null), [null, null, 'none']);
  assert.deepEqual(windowOf('15 февраля', academic), ['2027-02-15', null, 'day']);
  assert.deepEqual(windowOf('15.11'), ['2026-11-15', null, 'day']);
  assert.deepEqual(windowOf('2026-11-15'), ['2026-11-15', null, 'day']);
});

test('separate dates are not silently converted into a continuous calendar interval', () => {
  for (const value of ['10 ноября 2026 и 15 ноября 2026', '10.11.2026, 15.11.2026', '10–12 ноября 2026 и 15 декабря 2026']) {
    assert.deepEqual(windowOf(value), [null, null, 'none'], value);
  }
});

test('month and quarter precision remains intact, including explicit month ranges', () => {
  assert.deepEqual(windowOf('в ноябре 2026'), ['2026-11-01', '2026-11-30', 'month']);
  assert.deepEqual(windowOf('ноябрь — декабрь 2026'), ['2026-11-01', '2026-12-31', 'range']);
  assert.deepEqual(windowOf('IV квартал 2026'), ['2026-10-01', '2026-12-31', 'quarter']);
  assert.deepEqual(windowOf('ноябрь и декабрь 2026'), [null, null, 'none']);
  assert.deepEqual(windowOf('по мере необходимости'), [null, null, 'none']);
});
