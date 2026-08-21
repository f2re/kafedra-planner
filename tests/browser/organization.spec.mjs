import { test, expect } from '@playwright/test';

async function createPerson(page, displayName) {
  const response = await page.request.post('/api/people', { data: { displayName } });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test.beforeEach(async ({ page }, testInfo) => {
  page.on('pageerror', (error) => console.log(`[organization:${testInfo.project.name}:pageerror] ${error.stack || error.message}`));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      console.log(`[organization:${testInfo.project.name}:${message.type()}] ${message.text()}`);
    }
  });
});

test('Оргструктура: подразделение → должность → перевод → руководитель → исторический срез', async ({ page }, testInfo) => {
  const suffix = testInfo.project.name;
  const employee = await createPerson(page, `Сотрудник структуры ${suffix}`);
  const manager = await createPerson(page, `Руководитель структуры ${suffix}`);
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraOpenOrganization === 'function', null, { timeout: 15_000 });
  await page.evaluate(() => window.kafedraOpenOrganization());
  await expect(page.locator('#organization-panel')).toBeVisible();

  await page.locator('[data-org-add-unit]').click();
  const unitForm = page.locator('[data-org-unit-form]');
  await unitForm.locator('[name="name"]').fill(`Кафедра истории ${suffix}`);
  await unitForm.locator('[name="code"]').fill(`history-${suffix}`);
  await unitForm.locator('[name="unitKind"]').selectOption('department');
  await unitForm.locator('button[type="submit"]').click();
  await expect(page.locator('#organization-tree')).toContainText(`Кафедра истории ${suffix}`, { timeout: 15_000 });

  await page.locator('[data-org-add-position]').click();
  const positionForm = page.locator('[data-org-position-form]');
  await positionForm.locator('[name="name"]').fill(`Доцент ${suffix}`);
  await positionForm.locator('[name="code"]').fill(`docent-${suffix}`);
  await positionForm.locator('[name="category"]').selectOption('teaching');
  await positionForm.locator('button[type="submit"]').click();
  await expect(page.locator('#organization-positions')).toContainText(`Доцент ${suffix}`, { timeout: 15_000 });

  const employeeRow = page.locator(`[data-org-person-id="${employee.id}"]`);
  await employeeRow.locator('[data-org-appoint]').click();
  let appointmentForm = page.locator('[data-org-appointment-form]');
  await appointmentForm.locator('[name="organizationUnitId"]').selectOption({ label: `Кафедра истории ${suffix}` });
  await appointmentForm.locator('[name="positionTitleSnapshot"]').fill(`Ассистент ${suffix}`);
  await appointmentForm.locator('[name="validFrom"]').fill('2020-01-01');
  await appointmentForm.locator('button[type="submit"]').click();
  await expect(employeeRow).toContainText(`Ассистент ${suffix}`, { timeout: 15_000 });

  await employeeRow.locator('[data-org-appoint]').click();
  appointmentForm = page.locator('[data-org-appointment-form]');
  await appointmentForm.locator('[name="organizationUnitId"]').selectOption({ label: `Кафедра истории ${suffix}` });
  await appointmentForm.locator('[name="positionId"]').selectOption({ label: `Доцент ${suffix}` });
  await appointmentForm.locator('[name="validFrom"]').fill('2023-01-01');
  await appointmentForm.locator('button[type="submit"]').click();
  await expect(employeeRow).toContainText(`Доцент ${suffix}`, { timeout: 15_000 });

  const historical = await page.request.get(`/api/people/${encodeURIComponent(employee.id)}/organization?at=2021-06-01`);
  expect(historical.ok()).toBeTruthy();
  const historicalBody = await historical.json();
  expect(historicalBody.primary.position_title_snapshot).toBe(`Ассистент ${suffix}`);
  expect(historicalBody.primary.valid_to).toBe('2022-12-31');

  const current = await page.request.get(`/api/people/${encodeURIComponent(employee.id)}/organization?at=2026-06-01`);
  expect(current.ok()).toBeTruthy();
  expect((await current.json()).primary.position_name).toBe(`Доцент ${suffix}`);

  const unitRow = page.locator('[data-org-unit-id]').filter({ hasText: `Кафедра истории ${suffix}` }).first();
  await unitRow.locator('[data-org-manager]').click();
  const managerForm = page.locator('[data-org-manager-form]');
  await managerForm.locator('[name="personId"]').selectOption(manager.id);
  await managerForm.locator('[name="validFrom"]').fill('2023-01-01');
  await managerForm.locator('button[type="submit"]').click();
  await expect(unitRow).toContainText(`Руководитель структуры ${suffix}`, { timeout: 15_000 });

  const withManager = await page.request.get(`/api/people/${encodeURIComponent(employee.id)}/organization?at=2026-06-01`);
  expect((await withManager.json()).manager.person_id).toBe(manager.id);

  await employeeRow.locator('[data-org-appoint]').click();
  appointmentForm = page.locator('[data-org-appointment-form]');
  await appointmentForm.locator('[name="organizationUnitId"]').selectOption({ label: `Кафедра истории ${suffix}` });
  await appointmentForm.locator('[name="positionId"]').selectOption({ label: `Доцент ${suffix}` });
  await appointmentForm.locator('[name="validFrom"]').fill('2025-06-01');
  await appointmentForm.locator('[name="validTo"]').fill('2025-01-01');
  await appointmentForm.locator('button[type="submit"]').click();
  await expect(appointmentForm.locator('[data-org-form-error]')).toContainText('Дата окончания', { timeout: 15_000 });
  await expect(appointmentForm.locator('[name="validFrom"]')).toHaveValue('2025-06-01');
  await expect(appointmentForm.locator('[name="validTo"]')).toHaveValue('2025-01-01');

  await page.locator('[data-org-editor-close]').click();
  await employeeRow.locator('[data-org-history]').click();
  await expect(page.locator('.organization-history')).toContainText('2020-01-01');
  await expect(page.locator('.organization-history')).toContainText('2022-12-31');
  await expect(page.locator('.organization-history')).toContainText('2023-01-01');
});
