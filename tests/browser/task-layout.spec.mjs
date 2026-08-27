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
  await expect(row.locator('.task-copy')).toBeVisible();

  let geometry = null;
  await expect.poll(async () => {
    geometry = await row.evaluate(async (element) => {
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      const copyElement = element.querySelector('.task-copy');
      const titleElement = element.querySelector('.task-title');
      const metaElement = element.querySelector('.task-meta');
      if (!copyElement || !titleElement || !metaElement) return null;

      const box = (node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      return {
        copy: box(copyElement),
        title: box(titleElement),
        meta: box(metaElement)
      };
    }).catch(() => null);
    return Boolean(
      geometry
      && geometry.copy.width > 0
      && geometry.title.width > 0
      && geometry.meta.width > 0
    );
  }, { timeout: 5_000 }).toBe(true);

  expect(geometry.meta.y).toBeGreaterThanOrEqual(geometry.title.y + geometry.title.height - 1);
  expect(geometry.title.x).toBeGreaterThanOrEqual(geometry.copy.x - 1);
  expect(geometry.title.x + geometry.title.width).toBeLessThanOrEqual(
    geometry.copy.x + geometry.copy.width + 1
  );
});
