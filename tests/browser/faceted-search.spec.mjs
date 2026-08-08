import { test, expect } from '@playwright/test';

test('единый поиск фильтрует периодическую задачу без текстового запроса и сбрасывается одним действием', async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.includes('mobile') ? 'моб' : 'деск';
  const personResponse = await page.request.post('/api/people', {
    data: { displayName: `Петров Фасетный ${suffix}` }
  });
  expect(personResponse.ok()).toBeTruthy();
  const person = await personResponse.json();
  const taskResponse = await page.request.post('/api/periodic-tasks', {
    data: {
      ownerPersonId: person.id,
      title: `Семестровая проверка поиска ${suffix}`,
      periodKind: 'semester', periodKey: '2026-1',
      startsAt: '2026-08-18', dueDate: '2026-09-15', direction: 'education'
    }
  });
  expect(taskResponse.ok()).toBeTruthy();

  await page.goto('/');
  await page.evaluate(() => window.kafedraSetView('search'));
  await expect(page.locator('[data-view-panel="search"]')).toBeVisible();
  const filters = page.locator('#search-filters');
  await expect(filters).toBeVisible();
  await filters.locator('select[name="sourceKind"]').selectOption('periodic_task');
  await filters.locator('input[name="person"]').fill('Петров Фасетный');
  await filters.locator('input[name="period"]').fill('2026-1');

  const result = page.locator('#search-results .search-result-next').filter({ hasText: `Семестровая проверка поиска ${suffix}` }).first();
  await expect(result).toBeVisible();
  await expect(result).toContainText('Периодическая задача');
  await expect(result).toContainText('2026-09-15');
  await expect(result).toContainText('2026-1');
  await expect(page.locator('#search-count')).toContainText('Найдено:');

  await filters.getByRole('button', { name: 'Сбросить' }).click();
  await expect(page.locator('#search-results')).toContainText('Введите текст или выберите один из фильтров');

  await page.locator('#search-input').fill(`проверка поиска ${suffix}`);
  await expect(result).toBeVisible();
});
