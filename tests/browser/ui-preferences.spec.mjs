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
  ],
  'meeting.chairperson': [],
  'meeting.secretary': []
};

test('обучаемый UX охватывает новые даты, типы и фильтры, но не перестраивает интерфейс', async ({ page }) => {
  const recorded = [];
  await page.route('**/api/ui-preferences', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ preferences: learned }) });
    }
    recorded.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ preferences: {} }) });
  });

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
  await page.locator('#event-category').selectOption('education');
  await page.locator('#event-date').fill(today);
  await page.locator('#event-form button[type="submit"]').click();
  await expect(page.locator('#event-sheet')).toHaveClass(/hidden/);

  await expect.poll(() => recorded.length).toBeGreaterThan(0);
  const calendarWrite = recorded.find((entry) => entry.choices?.some((choice) => choice.key === 'calendar.new.category'));
  expect(calendarWrite).toBeTruthy();
  expect(calendarWrite.choices).toEqual(expect.arrayContaining([
    { key: 'calendar.new.category', value: 'education' },
    { key: 'calendar.new.date_offset', value: 'd:0' }
  ]));
  expect(recorded.flatMap((entry) => entry.choices || []).some((choice) => choice.value === today)).toBeFalsy();
  expect(recorded.flatMap((entry) => entry.choices || []).some((choice) => choice.key === 'calendar.new.kind')).toBeFalsy();

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
  await sourceKind.selectOption('directive');
  await expect(sourceKind).toHaveValue('directive');
  await expect.poll(() => recorded.flatMap((entry) => entry.choices || []).some((choice) => choice.key === 'search.filter.source_kind' && choice.value === 'directive')).toBeTruthy();

  await expect(page.locator('#calendar-mode-switch [data-calendar-mode]')).toHaveText(['Месяц', 'Неделя', 'Задачи']);
});
