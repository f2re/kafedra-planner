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

test('release candidate защищает изменения и предоставляет администрирование', async ({ page }) => {
  await login(page, 'admin', 'AdminPassword2026');

  const me = await (await page.request.get('/api/auth/me')).json();
  expect(me.authenticated).toBe(true);
  expect(me.csrfToken).toBeTruthy();

  const noCsrf = await page.request.post('/api/admin/sessions/revoke-all', {
    data: { keepCurrent: true },
    headers: { 'x-csrf-token': '' }
  });
  expect(noCsrf.status()).toBe(403);

  await page.locator('.auth-user-button').click();
  await page.locator('[data-auth-action="admin"]').click();
  await expect(page.locator('#admin-access-panel')).toBeVisible();
  await expect(page.locator('#admin-access-status')).toContainText('Готово к эксплуатации');
  await expect(page.locator('#admin-accounts-body')).toContainText('Администратор Системы');

  await page.locator('#admin-account-create select[name="personId"]').selectOption('person-outsider');
  await page.locator('#admin-account-create input[name="username"]').fill('outsider');
  await page.locator('#admin-account-create select[name="role"]').selectOption('staff');
  await page.locator('#admin-account-create input[name="password"]').fill('OutsiderPass2026');
  await page.locator('#admin-account-create button[type="submit"]').click();
  await expect(page.locator('#admin-accounts-body')).toContainText('Иванов Иван Иванович');

  page.once('dialog', (dialog) => dialog.accept());
  const [revokeResponse] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith('/api/admin/sessions/revoke-all')
        && response.request().method() === 'POST'
    ),
    page.locator('#admin-revoke-all').click()
  ]);
  expect(revokeResponse.status()).toBe(200);
  const sessionsResponse = await page.request.get('/api/admin/sessions');
  expect(sessionsResponse.status()).toBe(200);
  const sessions = await sessionsResponse.json();
  expect(sessions.items.filter((item) => item.active)).toHaveLength(1);
  expect(sessions.items.find((item) => item.active)?.current).toBe(true);

  await page.locator('[data-admin-close]').click();
  await page.locator('.auth-user-button').click();
  await page.locator('[data-auth-action="logout"]').click();
  await expect(page.locator('#auth-gate')).toBeVisible();

  await page.locator('#auth-login-form input[name="username"]').fill('director');
  await page.locator('#auth-login-form input[name="password"]').fill('DirectorPass2026');
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('#auth-login-form button[type="submit"]').click()
  ]);
  await expect(page.locator('#auth-user-control')).toBeVisible();

  const descendant = await page.request.get(
    '/api/personal-notifications?personId=person-staff'
  );
  expect(descendant.status()).toBe(200);
  const outsider = await page.request.get(
    '/api/personal-notifications?personId=person-outsider'
  );
  expect(outsider.status()).toBe(403);
});
