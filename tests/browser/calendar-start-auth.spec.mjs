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

async function openSettings(page) {
  await page.locator('.auth-user-button').click();
  await expect(page.locator('[data-auth-action="settings"]')).toBeVisible();
  await page.locator('[data-auth-action="settings"]').click();
  await expect(page.locator('#calendar-start-settings-form')).toBeVisible();
  return page.locator('#calendar-start-settings-form');
}

async function logout(page) {
  const close = page.locator('#calendar-start-settings-sheet [data-close-sheet]').first();
  if (await close.isVisible().catch(() => false)) await close.click();
  await page.locator('.auth-user-button').click();
  await page.locator('[data-auth-action="logout"]').click();
  await expect(page.locator('#auth-gate')).toBeVisible();
}

test('явная Неделя переживает повторный вход и имеет приоритет над learned Месяц', async ({ page }) => {
  await login(page, 'staff', 'StaffPassword2026');

  await page.evaluate(async () => {
    for (let index = 0; index < 3; index += 1) {
      const response = await fetch('/api/ui-preferences', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          interactionId: `browser-learned-month-${index}`,
          choices: [{ key: 'calendar.mode', value: 'month' }]
        })
      });
      if (!response.ok) throw new Error(`preference ${response.status}`);
    }
  });

  let form = await openSettings(page);
  await form.locator('select[name="calendarStartMode"]').selectOption('week');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('#calendar-start-settings-status')).toContainText('Сохранено');
  await expect(page.locator('[data-calendar-mode="week"]')).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(page.locator('#auth-user-control')).toBeVisible();
  await expect(page.locator('[data-calendar-mode="week"]')).toHaveAttribute('aria-selected', 'true');

  await logout(page);
  await page.locator('#auth-login-form input[name="username"]').fill('staff');
  await page.locator('#auth-login-form input[name="password"]').fill('StaffPassword2026');
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('#auth-login-form button[type="submit"]').click()
  ]);
  await expect(page.locator('#auth-user-control')).toBeVisible();
  await expect(page.locator('[data-calendar-mode="week"]')).toHaveAttribute('aria-selected', 'true');

  form = await openSettings(page);
  await form.locator('select[name="calendarStartMode"]').selectOption('auto');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('#calendar-start-settings-status')).toContainText('Сохранено');
  await page.reload();
  await expect(page.locator('#auth-user-control')).toBeVisible();
  await expect(page.locator('[data-calendar-mode="month"]')).toHaveAttribute('aria-selected', 'true');
});
