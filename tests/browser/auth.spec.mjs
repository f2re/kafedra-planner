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

async function logout(page) {
  await page.locator('.auth-user-button').click();
  await page.locator('[data-auth-action="logout"]').click();
  await expect(page.locator('#auth-gate')).toBeVisible();
}

async function selectNativeWithKeyboard(locator, value) {
  const values = await locator.locator('option').evaluateAll((options) => options.map((option) => option.value));
  const index = values.indexOf(value);
  expect(index).toBeGreaterThanOrEqual(0);
  await locator.focus();
  await locator.press('Home');
  for (let step = 0; step < index; step += 1) await locator.press('ArrowDown');
  await locator.press('Enter');
  await expect(locator).toHaveValue(value);
}

test('сотрудник получает личный контур и настраивает доставку, руководитель — подчинённых', async ({ page }) => {
  await login(page, 'staff', 'StaffPassword2026');
  const me = await (await page.request.get('/api/auth/me')).json();
  expect(me.authenticated).toBe(true);
  expect(me.role).toBe('staff');
  expect(me.user.person.id).toBe('person-staff');

  const own = await page.request.get('/api/personal-notifications?personId=person-staff');
  expect(own.status()).toBe(200);
  const foreign = await page.request.get('/api/personal-notifications?personId=person-manager');
  expect(foreign.status()).toBe(403);
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
  await expect(page.locator('[data-auth-action="delivery"]')).toBeVisible();
  await page.locator('[data-auth-action="delivery"]').click();
  await expect(page.locator('#notification-delivery-panel')).toBeVisible();
  await expect(page.locator('#delivery-availability')).toContainText('Почта: сервер готов');
  await page.locator('#notification-delivery-form input[name="smtpEnabled"]').check();
  await page.locator('#notification-delivery-form input[name="emailAddress"]').fill('staff@department.test');
  await page.locator('#notification-delivery-form input[name="dailyDigestEnabled"]').check();
  await page.locator('#notification-delivery-form input[name="dailyDigestTime"]').fill('08:30');
  await page.locator('#notification-delivery-form input[name="quietHoursEnabled"]').check();
  await page.locator('#notification-delivery-form input[name="quietStart"]').fill('21:30');
  await page.locator('#notification-delivery-form input[name="quietEnd"]').fill('07:30');
  await page.locator('#notification-delivery-form input[name="timezone"]').fill('Europe/Moscow');
  await page.locator('#notification-delivery-form button[type="submit"]').click();
  await expect(page.locator('#notification-delivery-status')).toContainText('Настройки сохранены');

  const profile = await (await page.request.get('/api/notification-delivery/profile')).json();
  expect(profile.profile.personId).toBe('person-staff');
  expect(profile.profile.smtpEnabled).toBe(true);
  expect(profile.profile.emailAddress).toBe('staff@department.test');
  expect(profile.profile.dailyDigestTime).toBe('08:30');

  const foreignAttempt = await page.evaluate(async () => {
    const response = await fetch('/api/notification-delivery/profile', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        personId: 'person-manager', smtpEnabled: true, emailAddress: 'still-staff@department.test',
        immediateEnabled: true, quietHoursEnabled: false, timezone: 'Europe/Moscow'
      })
    });
    return { status: response.status, body: await response.json() };
  });
  expect(foreignAttempt.status).toBe(200);
  expect(foreignAttempt.body.profile.personId).toBe('person-staff');
  const adminDiagnosticsDenied = await page.request.get('/api/admin/notification-delivery');
  expect(adminDiagnosticsDenied.status()).toBe(403);
  await page.locator('[data-delivery-close]').first().click();

  await logout(page);
  await page.locator('#auth-login-form input[name="username"]').fill('manager');
  await page.locator('#auth-login-form input[name="password"]').fill('ManagerPass2026');
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('#auth-login-form button[type="submit"]').click()
  ]);
  await expect(page.locator('#auth-user-control')).toBeVisible();

  const managerProfile = page.locator('#current-person-select');
  await expect(managerProfile).toBeEnabled();
  await expect(managerProfile.locator('option[value="person-staff"]')).toHaveCount(1);
  await selectNativeWithKeyboard(managerProfile, 'person-staff');
  await page.evaluate(() => {
    const marker = document.createElement('span');
    marker.hidden = true;
    document.body.append(marker);
    marker.remove();
  });
  await expect(managerProfile).toHaveValue('person-staff');
  await page.reload();
  await expect(page.locator('#auth-user-control')).toBeVisible();
  await expect(page.locator('#current-person-select')).toHaveValue('person-staff');

  const subordinate = await page.request.get('/api/personal-notifications?personId=person-staff');
  expect(subordinate.status()).toBe(200);
  const outsider = await page.request.get('/api/personal-notifications?personId=person-outsider');
  expect(outsider.status()).toBe(403);
  const managerAdminDenied = await page.request.get('/api/admin/notification-delivery');
  expect(managerAdminDenied.status()).toBe(403);

  await logout(page);
  await page.locator('#auth-login-form input[name="username"]').fill('admin');
  await page.locator('#auth-login-form input[name="password"]').fill('AdminPassword2026');
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('#auth-login-form button[type="submit"]').click()
  ]);
  await expect(page.locator('#auth-user-control')).toBeVisible();
  const diagnostics = await page.request.get('/api/admin/notification-delivery');
  expect(diagnostics.status()).toBe(200);
  const diagnosticsBody = await diagnostics.json();
  expect(diagnosticsBody.channelsConfigured.smtp).toBe(true);
  expect(diagnosticsBody.profiles).toBeGreaterThanOrEqual(1);
  expect(diagnosticsBody.counts.error).toBeGreaterThanOrEqual(1);

  await page.locator('.auth-user-button').click();
  await page.locator('[data-auth-action="delivery"]').click();
  await expect(page.locator('#delivery-admin-section')).toBeVisible();
  await expect(page.locator('#delivery-admin-summary')).toContainText('Профили');
  const retry = page.locator('[data-delivery-retry]').first();
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(page.locator('#notification-delivery-status')).toContainText('Повторная отправка поставлена в очередь');
});
