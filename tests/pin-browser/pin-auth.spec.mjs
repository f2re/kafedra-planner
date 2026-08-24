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

test('первый вход пошагово задаёт четыре цифры, затем система просит только PIN', async ({ page }) => {
  let firstProfile = true;
  await page.route('**/api/auth/me', async (route) => {
    const response = await route.fetch();
    if (!firstProfile) {
      await route.fulfill({ response });
      return;
    }
    firstProfile = false;
    const payload = await response.json();
    delete payload.authMode;
    await route.fulfill({ response, json: payload });
  });

  await page.goto('/');
  await expect(page.locator('#auth-gate')).toBeVisible();
  await expect(page.locator('#auth-title')).toHaveText('Задайте PIN-код');
  await expect(page.locator('#auth-pin-step')).toHaveText('Шаг 1 из 2');
  await expect(page.locator('#auth-gate input')).toHaveCount(1);
  await expect(page.locator('#auth-gate input[name="username"]')).toHaveCount(0);
  await expect(page.locator('#auth-gate input[name="password"]')).toHaveCount(0);

  await page.evaluate(async () => { await fetch('/api/people'); });
  await expect(page.locator('#auth-title')).toHaveText('Задайте PIN-код');
  await expect(page.locator('#auth-pin-setup-form')).toBeVisible();

  const setupInput = page.locator('#auth-pin-setup-form input[name="pin"]');
  await setupInput.fill('4826');
  await expect(page.locator('#auth-title')).toHaveText('Повторите PIN-код');
  await expect(page.locator('#auth-pin-step')).toHaveText('Шаг 2 из 2');
  await expect(setupInput).toHaveValue('');

  await setupInput.fill('1111');
  await expect(page.locator('#auth-title')).toHaveText('Задайте PIN-код');
  await expect(page.locator('#auth-pin-step')).toHaveText('Шаг 1 из 2');
  await expect(page.locator('#auth-login-error')).toHaveText('PIN-коды не совпали. Введите новый код ещё раз.');
  await expect(setupInput).toHaveValue('');

  await setupInput.fill('4826');
  await expect(page.locator('#auth-title')).toHaveText('Повторите PIN-код');
  const setupResponsePromise = page.waitForResponse(
    (candidate) => candidate.url().endsWith('/api/auth/setup-pin') && candidate.request().method() === 'POST'
  );
  const setupNavigationPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
  await setupInput.fill('4826');
  const setupResponse = await setupResponsePromise;
  expect(setupResponse.ok()).toBe(true);
  await setupNavigationPromise;
  await expect(page.locator('#auth-user-control')).toBeVisible();
  await expect(page.locator('.auth-user-button')).toHaveText('Доступ');

  await logout(page);
  await expect(page.locator('#auth-title')).toHaveText('Введите PIN-код');
  await expect(page.locator('#auth-gate input')).toHaveCount(1);
  await expect(page.locator('#auth-gate input[name="username"]')).toHaveCount(0);

  const pinInput = page.locator('#auth-pin-login-form input[name="pin"]');
  await pinInput.fill('48');
  await page.evaluate(async () => { await fetch('/api/people'); });
  await expect(pinInput).toHaveValue('48');

  const wrongResponsePromise = page.waitForResponse(
    (candidate) => candidate.url().endsWith('/api/auth/login') && candidate.request().method() === 'POST'
  );
  await pinInput.fill('1111');
  const wrongResponse = await wrongResponsePromise;
  expect(wrongResponse.status()).toBe(401);
  await expect(page.locator('#auth-login-error')).toHaveText('Неверный PIN-код.');
  await expect(pinInput).toHaveValue('');
  await expect(pinInput).toBeFocused();

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
