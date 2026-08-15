import { test, expect } from '@playwright/test';

function addDays(key, days) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

const learned = {
  'calendar.mode': [{ value: 'week', count: 5, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'calendar.new.kind': [{ value: 'task', count: 4, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'calendar.new.category': [{ value: 'science', count: 6, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'calendar.new.importance': [{ value: 'high', count: 3, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'calendar.new.reminder': [{ value: '1440', count: 4, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'calendar.new.date_offset': [{ value: 'd:7', count: 4, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'template.field.required': [{ value: '0', count: 3, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'template.field.type': [{ value: 'number', count: 4, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'template.field.strategy': [{ value: 'next_line', count: 4, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'template.document.type': [{ value: 'directive_document', count: 3, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'work.periodic.period_kind': [{ value: 'calendar_year', count: 6, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'work.periodic.direction': [{ value: 'science', count: 5, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'work.periodic.start_offset': [{ value: 'd:0', count: 4, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'work.periodic.due_offset': [{ value: 'd:14', count: 4, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'search.filter.source_kind': [
    { value: 'science', count: 7, lastSelectedAt: '2026-08-15T06:00:00.000Z' },
    { value: 'directive', count: 2, lastSelectedAt: '2026-08-15T05:00:00.000Z' }
  ]
};

async function localPreferences(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('kafedra-ui-preferences-v2') || '{}'));
}

async function selectNativeWithKeyboard(locator, value) {
  const values = await locator.locator('option').evaluateAll((options) => options.map((option) => option.value));
  const index = values.indexOf(value);
  expect(index).toBeGreaterThanOrEqual(0);
  await locator.focus();
  await locator.press('Home');
  for (let step = 0; step < index; step += 1) await locator.press('ArrowDown');
  await locator.press('Enter');
  await expect(locator).toHaveValue(value);
}

test('обучаемый UX охватывает новые даты, типы и фильтры, но не перестраивает интерфейс', async ({ page }) => {
  await page.addInitScript((seed) => {
    localStorage.setItem('kafedra-ui-preferences-v2', JSON.stringify(seed));
  }, learned);

  await page.goto('/');
  await expect(page.locator('[data-calendar-mode="week"]')).toHaveClass(/active/);
  await expect(page.locator('#calendar-mode-switch [data-calendar-mode]')).toHaveText(['Месяц', 'Неделя', 'Задачи']);

  const today = await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });

  await page.locator('#create-button').click();
  await expect(page.locator('#event-kind')).toHaveValue('task');
  await expect(page.locator('#event-category')).toHaveValue('science');
  await expect(page.locator('#event-importance')).toHaveValue('high');
  await expect(page.locator('#event-reminder')).toHaveValue('1440');
  await expect(page.locator('#event-date')).toHaveValue(addDays(today, 7));

  await page.locator('#event-title').fill('Проверка общего обучаемого UX');
  await selectNativeWithKeyboard(page.locator('#event-category'), 'education');
  await page.locator('#event-date').fill(today);
  await page.locator('#event-form button[type="submit"]').click();
  await expect(page.locator('#event-sheet')).toHaveClass(/hidden/);

  await expect.poll(async () => {
    const prefs = await localPreferences(page);
    return prefs['calendar.new.category']?.find((item) => item.value === 'education')?.count || 0;
  }).toBe(1);
  const afterCalendar = await localPreferences(page);
  expect(afterCalendar['calendar.new.kind'][0].count).toBe(4);
  expect(afterCalendar['calendar.mode'][0].count).toBe(5);
  expect(afterCalendar['calendar.new.date_offset']?.some((item) => /^\d{4}-\d{2}-\d{2}$/u.test(item.value))).toBeFalsy();

  const existing = page.locator('[data-calendar-item]').filter({ hasText: 'Проверка общего обучаемого UX' }).first();
  await expect(existing).toBeVisible();
  await existing.click();
  await expect(page.locator('#event-category')).toHaveValue('education');
  await expect(page.locator('#event-date')).toHaveValue(today);
  await page.locator('#event-sheet [data-close-sheet]').click();

  const addOnDay = page.locator('[data-new-on-date]').first();
  const explicitDate = await addOnDay.getAttribute('data-new-on-date');
  await addOnDay.click();
  await expect(page.locator('#event-date')).toHaveValue(explicitDate);
  await page.locator('#event-sheet [data-close-sheet]').click();

  await page.locator('[data-view="work"]').first().click();
  await expect(page.locator('#periodic-task-form select[name="periodKind"]')).toHaveValue('calendar_year');
  await expect(page.locator('#periodic-task-form select[name="direction"]')).toHaveValue('science');
  await expect(page.locator('#periodic-task-form input[name="startsAt"]')).toHaveValue(today);
  await expect(page.locator('#periodic-task-form input[name="dueDate"]')).toHaveValue(addDays(today, 14));
  await expect(page.locator('#periodic-task-form input[name="periodKey"]')).toHaveValue(String(new Date(`${today}T12:00:00`).getFullYear()));

  await page.locator('[data-view="search"]').first().click();
  const sourceKind = page.locator('#search-filters select[name="sourceKind"]');
  await expect(sourceKind).toHaveValue('');
  await expect.poll(async () => sourceKind.locator('option').evaluateAll((options) => options.map((option) => option.value).slice(0, 3)))
    .toEqual(['', 'science', 'directive']);
  await selectNativeWithKeyboard(sourceKind, 'directive');
  await expect.poll(async () => {
    const prefs = await localPreferences(page);
    return prefs['search.filter.source_kind']?.find((item) => item.value === 'directive')?.count || 0;
  }).toBe(3);
  await expect(sourceKind).toHaveValue('directive');

  await expect(page.locator('#calendar-mode-switch [data-calendar-mode]')).toHaveText(['Месяц', 'Неделя', 'Задачи']);
});
