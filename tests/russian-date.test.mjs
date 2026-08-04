import test from 'node:test';
import assert from 'node:assert/strict';
import { findRussianDates, firstRussianDate } from '../packages/protocols/src/russian-date.mjs';

test('читает словесную и цифровую дату', () => {
  assert.equal(firstRussianDate('от 5 августа 2026 года')?.value, '2026-08-05');
  assert.equal(firstRussianDate('Срок 15.09.2026')?.value, '2026-09-15');
});

test('отбрасывает невозможные даты', () => {
  assert.equal(findRussianDates('31.02.2026').length, 0);
});
