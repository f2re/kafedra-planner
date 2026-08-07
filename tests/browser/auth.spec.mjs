import { test, expect } from '@playwright/test';

async function login(page, username, password) {
  await page.goto('/');
  await expect(page.locator('#auth-gate')).toBeVisible();
  await page.locator('#auth-login-form input[name="username"]').fill(username);
  await page.locator('#auth-login-form input[name="password"]').fill(password);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('#auth-login-form button[type="submit"]').click()
  ]);
  await expect(page.locator('#auth-user-control')).toBeVisible();
}

async function visiblePlans(page) {
  const response = await page.request.get('/api/plans?scope=personal');
  expect(response.status()).toBe(200);
  return (await response.json()).items;
}

async function visiblePlanCalendar(page) {
  const response = await page.request.get('/api/calendar?from=2026-08-01&to=2026-08-31');
  expect(response.status()).toBe(200);
  return (await response.json()).items.filter((item) => item.source_kind === 'plan_item');
}

async function visiblePlanSources(page) {
  const response = await page.request.get('/api/plans/calendar-sources?limit=10000');
  expect(response.status()).toBe(200);
  return (await response.json()).items;
}

test('сотрудник получает только личный контур, руководитель — подчинённых', async ({ page }) => {
  await login(page, 'staff', 'StaffPassword2026');
  const me = await (await page.request.get('/api/auth/me')).json();
  expect(me.authenticated).toBe(true);
  expect(me.role).toBe('staff');
  expect(me.user.person.id).toBe('person-staff');

  const own = await page.request.get('/api/personal-notifications?personId=person-staff');
  expect(own.status()).toBe(200);
  const foreign = await page.request.get('/api/personal-notifications?personId=person-manager');
  expect(foreign.status()).toBe(403);
  const staffPlans = await visiblePlans(page);
  expect(staffPlans.map((item) => item.title)).toEqual(['Личный план сотрудника']);
  const staffCalendar = await visiblePlanCalendar(page);
  expect(staffCalendar.map((item) => item.title)).toEqual(['Личное мероприятие сотрудника']);
  const staffSources = await visiblePlanSources(page);
  expect(staffSources.map((item) => item.plan_title)).toEqual(['Личный план сотрудника']);

  const adminDenied = await page.request.post('/api/admin/accounts', {
    data: {
      personId: 'person-outsider',
      username: 'other',
      password: 'OtherPassword2026',
      role: 'staff'
    }
  });
  expect(adminDenied.status()).toBe(403);

  await page.locator('.auth-user-button').click();
  await page.locator('[data-auth-action="logout"]').click();
  await expect(page.locator('#auth-gate')).toBeVisible();
  await page.locator('#auth-login-form input[name="username"]').fill('manager');
  await page.locator('#auth-login-form input[name="password"]').fill('ManagerPass2026');
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('#auth-login-form button[type="submit"]').click()
  ]);
  await expect(page.locator('#auth-user-control')).toBeVisible();

  const subordinate = await page.request.get('/api/personal-notifications?personId=person-staff');
  expect(subordinate.status()).toBe(200);
  const outsider = await page.request.get('/api/personal-notifications?personId=person-outsider');
  expect(outsider.status()).toBe(403);
  const managerPlans = await visiblePlans(page);
  expect(managerPlans.map((item) => item.title)).toEqual(['Личный план сотрудника']);
  const managerCalendar = await visiblePlanCalendar(page);
  expect(managerCalendar.map((item) => item.title)).toEqual(['Личное мероприятие сотрудника']);
  const managerSources = await visiblePlanSources(page);
  expect(managerSources.map((item) => item.plan_title)).toEqual(['Личный план сотрудника']);
});
