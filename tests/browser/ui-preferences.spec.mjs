import { test, expect } from '@playwright/test';

const learned = {
  'calendar.mode': [{ value: 'week', count: 5, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'calendar.new.kind': [{ value: 'task', count: 4, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'calendar.new.category': [{ value: 'science', count: 6, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'calendar.new.importance': [{ value: 'high', count: 3, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'calendar.new.reminder': [{ value: '1440', count: 4, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'template.field.required': [{ value: '0', count: 3, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'template.document.type': [{ value: 'directive_document', count: 3, lastSelectedAt: '2026-08-15T06:00:00.000Z' }],
  'meeting.chairperson': [],
  'meeting.secretary': []
};

test('обучаемые defaults не переставляют кнопки и считают только изменённое человеком', async ({ page }) => {
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

  await page.locator('#create-button').click();
  await expect(page.locator('#event-kind')).toHaveValue('task');
  await expect(page.locator('#event-category')).toHaveValue('science');
  await expect(page.locator('#event-importance')).toHaveValue('high');
  await expect(page.locator('#event-reminder')).toHaveValue('1440');
  await page.locator('#event-title').fill('Проверка обучаемого значения');
  await page.locator('#event-date').fill('2026-09-20');

  await page.locator('#event-category').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const selectedCategory = await page.locator('#event-category').inputValue();
  await page.locator('#event-form button[type="submit"]').click();
  await expect(page.locator('#event-sheet')).toHaveClass(/hidden/);

  await expect.poll(() => recorded.length).toBeGreaterThan(0);
  const calendarWrite = recorded.find((entry) => entry.choices?.some((choice) => choice.key === 'calendar.new.category'));
  expect(calendarWrite).toBeTruthy();
  expect(calendarWrite.choices).toEqual([{ key: 'calendar.new.category', value: selectedCategory }]);
  expect(recorded.flatMap((entry) => entry.choices || []).some((choice) => choice.key === 'calendar.new.kind')).toBeFalsy();
  expect(recorded.flatMap((entry) => entry.choices || []).some((choice) => choice.key === 'calendar.mode')).toBeFalsy();
  await expect(page.locator('#calendar-mode-switch [data-calendar-mode]')).toHaveText(['Месяц', 'Неделя', 'Задачи']);
});
