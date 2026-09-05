import { test, expect } from '@playwright/test';

function viewButton(page, view) {
  const mobile = Number(page.viewportSize()?.width || 0) <= 720;
  return mobile
    ? page.locator(`.mobile-tab[data-view="${view}"]`).first()
    : page.locator(`.nav-item[data-view="${view}"]`).first();
}

test('периодическая задача: Выполнено → Вернуть в работу без файла и модалки', async ({ page }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const personResponse = await page.request.post('/api/people', { data: { displayName: `Исполнитель R4 ${suffix}` } });
  expect(personResponse.ok()).toBeTruthy();
  const owner = await personResponse.json();
  const taskResponse = await page.request.post('/api/periodic-tasks', {
    data: {
      ownerPersonId: owner.id,
      title: `Прямая задача R4 ${suffix}`,
      periodKind: 'semester', periodKey: '2044-1',
      startsAt: '2044-09-10', dueDate: '2044-09-20', direction: 'organizational'
    }
  });
  expect(taskResponse.ok()).toBeTruthy();
  const task = await taskResponse.json();

  await page.goto('/');
  await viewButton(page, 'work').click();
  const card = page.locator(`#work-results [data-work-kind="periodic_task"][data-work-id="${task.id}"]`);
  await expect(card).toBeVisible();
  await card.click();

  const inspector = page.locator('#ux-inspector-body');
  const complete = inspector.getByRole('button', { name: 'Выполнено' });
  await expect(complete).toBeVisible();
  await complete.click();
  await expect(page.locator('#meeting-modal')).toHaveCount(0);
  await expect(inspector.getByRole('button', { name: 'Вернуть в работу' })).toBeVisible();
  await expect.poll(async () => (await (await page.request.get(`/api/periodic-tasks/${task.id}`)).json()).status).toBe('completed');

  await inspector.getByRole('button', { name: 'Вернуть в работу' }).click();
  await expect(inspector.getByRole('button', { name: 'Выполнено' })).toBeVisible();
  await expect.poll(async () => (await (await page.request.get(`/api/periodic-tasks/${task.id}`)).json()).status).toBe('open');
});
