import { test, expect } from '@playwright/test';

test('без авторизации стартовый режим хранится локально и не меняется обычным переключением', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#calendar-settings-button')).toBeVisible();
  await page.locator('#calendar-settings-button').click();
  const form = page.locator('#calendar-start-settings-form');
  await expect(form).toBeVisible();
  await form.locator('select[name="calendarStartMode"]').selectOption('week');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('#calendar-start-settings-status')).toContainText('Сохранено');
  await expect(page.locator('[data-calendar-mode="week"]')).toHaveAttribute('aria-selected', 'true');

  await page.locator('#calendar-start-settings-sheet [data-close-sheet]').first().click();
  await page.locator('[data-calendar-mode="month"]').click();
  await expect(page.locator('[data-calendar-mode="month"]')).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(page.locator('[data-calendar-mode="week"]')).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => localStorage.getItem('kafedra-calendar-start-mode-v1'))).toBe('week');
});

test('старый localStorage остаётся безопасным fallback для режима Автоматически', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kafedra-calendar-mode', 'tasks'));
  await page.goto('/');
  await expect(page.locator('[data-calendar-mode="tasks"]')).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => localStorage.getItem('kafedra-calendar-start-mode-v1'))).toBeNull();
});
