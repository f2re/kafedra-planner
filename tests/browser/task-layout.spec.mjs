import { test, expect } from '@playwright/test';

test('режим задач держит заголовок и происхождение отдельными строками', async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  const title = 'Проверка геометрии задачи';
  const created = await page.request.post('/api/calendar', {
    data: {
      title,
      kind: 'task',
      startsAt: today,
      category: 'science',
      importance: 'normal',
      reminderMinutes: null,
      description: 'План кафедры · контрольный срок',
      allDay: true
    }
  });
  expect(created.ok()).toBeTruthy();

  await page.goto('/');
  await page.locator('[data-calendar-mode="tasks"]').click();

  const row = page.locator('.task-row', { hasText: title }).first();
  await expect(row).toBeVisible();

  const copyBox = await row.locator('.task-copy').boundingBox();
  const titleBox = await row.locator('.task-title').boundingBox();
  const metaBox = await row.locator('.task-meta').boundingBox();

  expect(copyBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(metaBox).not.toBeNull();
  expect(metaBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);
  expect(titleBox.x).toBeGreaterThanOrEqual(copyBox.x - 1);
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(copyBox.x + copyBox.width + 1);
});
