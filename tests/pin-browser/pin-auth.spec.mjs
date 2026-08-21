import { test, expect } from '@playwright/test';

async function logout(page) {
  await page.locator('.auth-user-button').click();
  await Promise.all([
    page.waitForResponse((candidate) => candidate.url().endsWith('/api/auth/logout') && candidate.request().method() === 'POST'),
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.locator('[data-auth-action="logout"]').click()
  ]);
  await expect(page.locator('#auth-gate')).toBeVisible();
}

async function pinLogin(page, pin) {
  const responsePromise = page.waitForResponse(
    (candidate) => candidate.url().endsWith('/api/auth/login') && candidate.request().method() === 'POST'
  );
  const navigationPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
  await page.locator('#auth-pin-login-form input[name="pin"]').fill(pin);
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  await navigationPromise;
  await expect(page.locator('#auth-user-control')).toBeVisible();
}

test('первый вход задаёт четыре цифры, затем система просит только PIN', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#auth-gate')).toBeVisible();
  await expect(page.locator('#auth-title')).toHaveText('Задайте PIN-код');
  await expect(page.locator('#auth-gate input[name="username"]')).toHaveCount(0);
  await expect(page.locator('#auth-gate input[name="password"]')).toHaveCount(0);

  await page.locator('#auth-pin-setup-form input[name="pin"]').fill('4826');
  await page.locator('#auth-pin-setup-form input[name="pinConfirm"]').fill('4826');
  const [setupResponse] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().endsWith('/api/auth/setup-pin') && candidate.request().method() === 'POST'),
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.locator('#auth-pin-setup-form button[type="submit"]').click()
  ]);
  expect(setupResponse.ok()).toBe(true);
  await expect(page.locator('#auth-user-control')).toBeVisible();
  await expect(page.locator('.auth-user-button')).toHaveText('Доступ');

  await logout(page);
  await expect(page.locator('#auth-title')).toHaveText('Введите PIN-код');
  await expect(page.locator('#auth-gate input')).toHaveCount(1);
  await expect(page.locator('#auth-gate input[name="username"]')).toHaveCount(0);

  const wrongResponsePromise = page.waitForResponse(
    (candidate) => candidate.url().endsWith('/api/auth/login') && candidate.request().method() === 'POST'
  );
  await page.locator('#auth-pin-login-form input[name="pin"]').fill('1111');
  const wrongResponse = await wrongResponsePromise;
  expect(wrongResponse.status()).toBe(401);
  await expect(page.locator('#auth-login-error')).toHaveText('Неверный PIN-код.');

  await pinLogin(page, '4826');
  await page.locator('.auth-user-button').click();
  await page.locator('[data-auth-action="pin"]').click();
  await expect(page.locator('#auth-pin-dialog')).toBeVisible();
  await page.locator('#auth-pin-change-form input[name="currentPin"]').fill('4826');
  await page.locator('#auth-pin-change-form input[name="newPin"]').fill('1357');
  await page.locator('#auth-pin-change-form input[name="newPinConfirm"]').fill('1357');
  const [changeResponse] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().endsWith('/api/auth/change-pin') && candidate.request().method() === 'POST'),
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.locator('#auth-pin-change-form button[type="submit"]').click()
  ]);
  expect(changeResponse.ok()).toBe(true);
  await expect(page.locator('#auth-user-control')).toBeVisible();

  await logout(page);
  await pinLogin(page, '1357');
});
