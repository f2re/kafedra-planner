import { test, expect } from '@playwright/test';

function addDays(key, days) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function navigationButton(page, view) {
  const mobile = Number(page.viewportSize()?.width || 0) <= 720;
  return mobile ? page.locator(`.mobile-tab[data-view="${view}"]`) : page.locator(`.nav-item[data-view="${view}"]`);
}

async function createPerson(page, displayName, managerId = null) {
  const response = await page.request.post('/api/people', { data: { displayName, managerId } });
  if (!response.ok()) throw new Error(await response.text());
  return await response.json();
}

async function createPlan(page, title) {
  const year = new Date().getFullYear();
  const response = await page.request.post('/api/plans', {
    data: {
      title,
      planKind: 'department',
      periodKind: 'calendar',
      yearStart: year,
      yearEnd: year
    }
  });
  if (!response.ok()) throw new Error(await response.text());
  return await response.json();
}

async function openPlans(page, planId) {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraSetView === 'function', null, { timeout: 15_000 });
  await navigationButton(page, 'plans').click();
  await expect(page.locator('[data-view-panel="plans"]')).toBeVisible();
  const card = page.locator(`.plan-card[data-plan-id="${planId}"]`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.click();
  await expect(page.locator(`[data-manual-add-item="${planId}"]`)).toBeVisible({ timeout: 15_000 });
}

async function openNewItem(page, planId) {
  const button = page.locator(`[data-manual-add-item="${planId}"]`);
  await expect(button).toBeVisible({ timeout: 15_000 });
  await button.click();
  const form = page.locator('#manual-plan-item-form[data-manual-adaptive-patched="1"]');
  await expect(form).toBeVisible({ timeout: 15_000 });
  return form;
}

async function localPreferences(page) {
  return await page.evaluate(() => JSON.parse(localStorage.getItem('kafedra-ui-preferences-v2') || '{}'));
}

test('ручной пункт плана: безопасные defaults, руководитель из структуры и обучение только явным изменениям', async ({ page }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const manager = await createPerson(page, `Руководитель ${suffix}`);
  const secondManager = await createPerson(page, `Второй руководитель ${suffix}`);
  const learnedController = await createPerson(page, `Частый контролирующий ${suffix}`);
  const preferredExecutor = await createPerson(page, `Частый исполнитель ${suffix}`, manager.id);
  const otherExecutor = await createPerson(page, `Другой исполнитель ${suffix}`, secondManager.id);
  const plan = await createPlan(page, `Адаптивный план ${suffix}`);

  const learned = {
    'plan.item.direction': [{ value: 'science', count: 5, lastSelectedAt: '2026-08-26T06:00:00.000Z' }],
    'plan.item.execution_mode': [{ value: 'assigned', count: 4, lastSelectedAt: '2026-08-26T06:00:00.000Z' }],
    'plan.item.executor': [{ value: preferredExecutor.id, count: 6, lastSelectedAt: '2026-08-26T06:00:00.000Z' }],
    'plan.item.controller': [{ value: learnedController.id, count: 9, lastSelectedAt: '2026-08-26T06:00:00.000Z' }],
    'plan.item.start_offset': [{ value: 'd:2', count: 3, lastSelectedAt: '2026-08-26T06:00:00.000Z' }],
    'plan.item.end_offset': [{ value: 'none', count: 3, lastSelectedAt: '2026-08-26T06:00:00.000Z' }],
    'plan.item.due_offset': [{ value: 'd:14', count: 3, lastSelectedAt: '2026-08-26T06:00:00.000Z' }]
  };
  await page.addInitScript((seed) => {
    localStorage.setItem('kafedra-ui-preferences-v2', JSON.stringify(seed));
  }, learned);

  await openPlans(page, plan.id);
  const today = await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });

  let form = await openNewItem(page, plan.id);
  await expect(form.locator('[name="direction"]')).toHaveValue('science');
  await expect(form.locator('[name="executionMode"]')).toHaveValue('assigned');
  await expect(form.locator('[name="primaryExecutorPersonId"]')).toHaveValue(preferredExecutor.id);
  await expect(form.locator('[name="controllerPersonId"]')).toHaveValue(manager.id);
  await expect(form.locator('[name="startsAt"]')).toHaveValue(addDays(today, 2));
  await expect(form.locator('[name="endsAt"]')).toHaveValue('');
  await expect(form.locator('[name="dueDate"]')).toHaveValue(addDays(today, 16));
  await expect(form.locator('[name="primaryExecutorPersonId"]')).toHaveAttribute('required', '');

  const firstTitle = `Подготовить материалы ${suffix}`;
  await form.locator('[name="title"]').fill(firstTitle);
  const createResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/plans/${plan.id}/items`
    && response.request().method() === 'POST'
  );
  await form.locator('button[type="submit"]').click();
  expect((await createResponse).ok()).toBeTruthy();
  await expect(page.locator('#manual-plan-modal')).toHaveClass(/hidden/);

  let preferences = await localPreferences(page);
  for (const [key, rows] of Object.entries(learned)) {
    expect(preferences[key][0].count, key).toBe(rows[0].count);
  }

  let planResponse = await page.request.get(`/api/plans/${encodeURIComponent(plan.id)}`);
  let storedPlan = await planResponse.json();
  const firstItem = storedPlan.items.find((item) => item.title === firstTitle);
  expect(firstItem).toBeTruthy();
  expect(firstItem.direction).toBe('science');
  expect(firstItem.execution_mode).toBe('assigned');
  expect(firstItem.responsible_person_id).toBe(preferredExecutor.id);
  expect(firstItem.starts_at).toBe(addDays(today, 2));
  expect(firstItem.due_date).toBe(addDays(today, 16));
  expect(firstItem.assignment.executors.find((item) => item.role === 'executor')?.person_id).toBe(preferredExecutor.id);
  expect(firstItem.assignment.executors.find((item) => item.role === 'controller')?.person_id).toBe(manager.id);

  form = await openNewItem(page, plan.id);
  const startValue = await form.locator('[name="startsAt"]').inputValue();
  await form.locator('[name="direction"]').selectOption('education');
  await form.locator('[name="primaryExecutorPersonId"]').selectOption(otherExecutor.id);
  await expect(form.locator('[name="controllerPersonId"]')).toHaveValue(secondManager.id);
  await form.locator('[name="dueDate"]').fill(addDays(startValue, 21));
  const secondTitle = `Провести обсуждение ${suffix}`;
  await form.locator('[name="title"]').fill(secondTitle);
  const secondResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/plans/${plan.id}/items`
    && response.request().method() === 'POST'
  );
  await form.locator('button[type="submit"]').click();
  expect((await secondResponse).ok()).toBeTruthy();

  await expect.poll(async () => {
    const current = await localPreferences(page);
    return current['plan.item.executor']?.find((row) => row.value === otherExecutor.id)?.count || 0;
  }).toBe(1);
  preferences = await localPreferences(page);
  expect(preferences['plan.item.direction'].find((row) => row.value === 'education')?.count).toBe(1);
  expect(preferences['plan.item.due_offset'].find((row) => row.value === 'd:21')?.count).toBe(1);
  expect(preferences['plan.item.controller'][0].value).toBe(learnedController.id);
  expect(preferences['plan.item.controller'][0].count).toBe(9);
  expect(preferences['plan.item.execution_mode'][0].count).toBe(4);

  planResponse = await page.request.get(`/api/plans/${encodeURIComponent(plan.id)}`);
  storedPlan = await planResponse.json();
  const secondItem = storedPlan.items.find((item) => item.title === secondTitle);
  expect(secondItem.assignment.executors.find((item) => item.role === 'executor')?.person_id).toBe(otherExecutor.id);
  expect(secondItem.assignment.executors.find((item) => item.role === 'controller')?.person_id).toBe(secondManager.id);

  const editButton = page.locator(`[data-manual-edit-item="${secondItem.id}"]`);
  await expect(editButton).toBeVisible({ timeout: 15_000 });
  await editButton.click();
  const editForm = page.locator('#manual-plan-item-form[data-manual-adaptive-patched="1"]');
  await expect(editForm).toBeVisible({ timeout: 15_000 });
  await expect(editForm.locator('[name="direction"]')).toHaveValue('education');
  await expect(editForm.locator('[name="executionMode"]')).toHaveValue('assigned');
  await expect(editForm.locator('[name="primaryExecutorPersonId"]')).toHaveValue(otherExecutor.id);
  await expect(editForm.locator('[name="controllerPersonId"]')).toHaveValue(secondManager.id);
  await page.locator('[data-manual-close]').last().click();

  await navigationButton(page, 'calendar').click();
  await expect(page.locator('[data-view-panel="calendar"]')).toBeVisible();
  await page.locator('[data-manual-calendar-add]:visible').click();
  await page.locator('#manual-calendar-plan-select').selectOption(plan.id);
  await page.locator('[data-manual-calendar-plan-next]').click();
  const calendarForm = page.locator('#manual-plan-item-form[data-manual-adaptive-patched="1"]');
  await expect(calendarForm).toBeVisible({ timeout: 15_000 });
  await expect(calendarForm.locator('[name="startsAt"]')).toHaveValue(today);
});
