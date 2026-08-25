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
  const appointmentForm = page.locator('[data-organization-appointment-form]');
  await appointmentForm.locator('[name="unitId"]').selectOption({ label: `Кафедра истории ${testInfo.project.name}` });
  await appointmentForm.locator('[name="positionId"]').selectOption({ label: `Доцент ${testInfo.project.name}` });
  await appointmentForm.locator('[name="managerPersonId"]').selectOption(manager.id);
  await appointmentForm.locator('[name="validFrom"]').fill('2020-01-01');
  await appointmentForm.locator('[name="validTo"]').fill('2022-12-31');
  await appointmentForm.locator('button[type="submit"]').click();
  await expect(employeeCard).toContainText(`Доцент ${testInfo.project.name}`, { timeout: 15_000 });

  await employeeCard.locator('[data-organization-appoint]').click();
  const nextAppointment = page.locator('[data-organization-appointment-form]');
  await nextAppointment.locator('[name="unitId"]').selectOption({ label: `Кафедра истории ${testInfo.project.name}` });
  await nextAppointment.locator('[name="positionId"]').selectOption({ label: `Доцент ${testInfo.project.name}` });
  await nextAppointment.locator('[name="validFrom"]').fill('2023-01-01');
  await nextAppointment.locator('button[type="submit"]').click();
  await expect(page.locator('#organization-notice')).toContainText('Назначение сохранено', { timeout: 15_000 });

  const oldResponse = await page.request.get(`/api/people/${encodeURIComponent(employee.id)}/organization?asOf=2021-06-01`);
  expect(oldResponse.ok()).toBeTruthy();
  const old = await oldResponse.json();
  expect(old.appointment.unit_name).toBe(`Кафедра истории ${testInfo.project.name}`);
  expect(old.appointment.valid_to).toBe('2022-12-31');

  await employeeCard.locator('[data-organization-history]').click();
  await expect(page.locator('.organization-history')).toContainText('2020-01-01');
  await expect(page.locator('.organization-history')).toContainText('2023-01-01');

  await page.locator('[data-organization-appoint]').last().click();
  const overlap = page.locator('[data-organization-appointment-form]');
  await overlap.locator('[name="unitId"]').selectOption({ label: `Кафедра истории ${testInfo.project.name}` });
  await overlap.locator('[name="validFrom"]').fill('2024-01-01');
  await overlap.locator('[name="validTo"]').fill('2025-01-01');
  await overlap.locator('[name="closePrevious"]').uncheck();
  await overlap.locator('button[type="submit"]').click();
  await expect(overlap.locator('[data-organization-form-error]')).toContainText('уже есть основное назначение', { timeout: 15_000 });
  await expect(overlap.locator('[name="validFrom"]')).toHaveValue('2024-01-01');
});
