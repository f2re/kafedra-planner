import { test, expect } from '@playwright/test';

async function createPerson(page, displayName) {
  const response = await page.request.post('/api/people', { data: { displayName } });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function openOrganization(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraOpenOrganization === 'function', null, { timeout: 12_000 });
  await page.evaluate(() => window.kafedraOpenOrganization());
  await expect(page.locator('#organization-shell-panel')).toBeVisible();
  await expect(page.locator('#organization-admin')).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => window.kafedraLoadOrganization?.());
  await expect(page.locator('#organization-tree')).not.toContainText('Загрузка структуры', { timeout: 15_000 });
}

test.beforeEach(async ({ page }, testInfo) => {
  page.on('pageerror', (error) => console.log(`[organization:${testInfo.project.name}:pageerror] ${error.stack || error.message}`));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) console.log(`[organization:${testInfo.project.name}:${message.type()}] ${message.text()}`);
  });
});

test('Оргструктура: подразделение → должность → назначение → историческая дата', async ({ page }, testInfo) => {
  const employee = await createPerson(page, `Сотрудник структуры ${testInfo.project.name}`);
  const manager = await createPerson(page, `Руководитель структуры ${testInfo.project.name}`);
  await openOrganization(page);

  await page.locator('[data-organization-add-unit]').click();
  const unitForm = page.locator('[data-organization-unit-form]');
  await expect(unitForm).toBeVisible();
  await unitForm.locator('[name="name"]').fill(`Кафедра истории ${testInfo.project.name}`);
  await unitForm.locator('[name="code"]').fill(`HIST-${testInfo.project.name}`);
  await unitForm.locator('[name="validFrom"]').fill('2020-01-01');
  await unitForm.locator('button[type="submit"]').click();
  await expect(page.locator('#organization-tree')).toContainText(`Кафедра истории ${testInfo.project.name}`, { timeout: 15_000 });

  await page.locator('[data-organization-add-position]').click();
  const positionForm = page.locator('[data-organization-position-form]');
  await positionForm.locator('[name="name"]').fill(`Доцент ${testInfo.project.name}`);
  await positionForm.locator('button[type="submit"]').click();
  await expect(page.locator('#organization-notice')).toContainText('Должность добавлена', { timeout: 15_000 });

  const employeeCard = page.locator(`[data-organization-person-id="${employee.id}"]`);
  await expect(employeeCard).toBeVisible();
  await employeeCard.locator('[data-organization-appoint]').click();
  const historicalForm = page.locator('[data-organization-appointment-form]');
  await historicalForm.locator('[name="unitId"]').selectOption({ label: `Кафедра истории ${testInfo.project.name}` });
  await historicalForm.locator('[name="positionId"]').selectOption({ label: `Доцент ${testInfo.project.name}` });
  await historicalForm.locator('[name="managerPersonId"]').selectOption(manager.id);
  await historicalForm.locator('[name="validFrom"]').fill('2020-01-01');
  await historicalForm.locator('[name="validTo"]').fill('2022-12-31');
  await historicalForm.locator('button[type="submit"]').click();
  await expect(page.locator('#organization-notice')).toContainText('Назначение сохранено', { timeout: 15_000 });

  const oldResponse = await page.request.get(`/api/people/${encodeURIComponent(employee.id)}/organization?asOf=2021-06-01`);
  expect(oldResponse.ok()).toBeTruthy();
  const old = await oldResponse.json();
  expect(old.appointment.unit_name).toBe(`Кафедра истории ${testInfo.project.name}`);
  expect(old.appointment.position_name).toBe(`Доцент ${testInfo.project.name}`);
  expect(old.appointment.valid_to).toBe('2022-12-31');

  await employeeCard.locator('[data-organization-appoint]').click();
  const currentForm = page.locator('[data-organization-appointment-form]');
  await currentForm.locator('[name="unitId"]').selectOption({ label: `Кафедра истории ${testInfo.project.name}` });
  await currentForm.locator('[name="positionId"]').selectOption({ label: `Доцент ${testInfo.project.name}` });
  await currentForm.locator('[name="managerPersonId"]').selectOption(manager.id);
  await currentForm.locator('[name="validFrom"]').fill('2023-01-01');
  await currentForm.locator('button[type="submit"]').click();
  await expect(page.locator('#organization-notice')).toContainText('Назначение сохранено', { timeout: 15_000 });
  await expect(employeeCard).toContainText(`Доцент ${testInfo.project.name}`, { timeout: 15_000 });

  const currentResponse = await page.request.get(`/api/people/${encodeURIComponent(employee.id)}/organization?asOf=2026-08-25`);
  expect(currentResponse.ok()).toBeTruthy();
  const current = await currentResponse.json();
  expect(current.appointment.position_name).toBe(`Доцент ${testInfo.project.name}`);
  expect(current.appointment.valid_from).toBe('2023-01-01');

  await employeeCard.locator('[data-organization-history]').click();
  await expect(page.locator('.organization-history')).toContainText('2020-01-01');
  await expect(page.locator('.organization-history')).toContainText('2023-01-01');
  await page.locator('#organization-modal [data-organization-close]').click();
  await expect(page.locator('#organization-modal')).toHaveClass(/hidden/);

  await employeeCard.locator('[data-organization-appoint]').click();
  const overlap = page.locator('[data-organization-appointment-form]');
  await overlap.locator('[name="unitId"]').selectOption({ label: `Кафедра истории ${testInfo.project.name}` });
  await overlap.locator('[name="positionId"]').selectOption({ label: `Доцент ${testInfo.project.name}` });
  await overlap.locator('[name="validFrom"]').fill('2024-01-01');
  await overlap.locator('[name="validTo"]').fill('2025-01-01');
  await overlap.locator('[name="closePrevious"]').uncheck();
  await overlap.locator('button[type="submit"]').click();
  await expect(overlap.locator('[data-organization-form-error]')).toContainText('уже есть основное назначение', { timeout: 15_000 });
  await expect(overlap.locator('[name="validFrom"]')).toHaveValue('2024-01-01');
});
