import { test, expect } from '@playwright/test';

async function mockPreferences(page) {
  await page.route('**/api/ui-preferences**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/ui-preferences/controls') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          controls: { learningEnabled: true, pinned: {}, safePinKeys: ['calendar.mode'] }
        })
      });
    }
    if (request.method() === 'GET' && url.pathname === '/api/ui-preferences') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          controls: { learningEnabled: true, pinned: {}, safePinKeys: ['calendar.mode'] },
          preferences: { 'calendar.mode': [{ value: 'week', count: 9, lastSelectedAt: '2030-01-01T00:00:00.000Z' }] }
        })
      });
    }
    return route.continue();
  });
}

test('Подсказки: компактные controls и безопасное закрепление', async ({ page }) => {
  await mockPreferences(page);
  await page.goto('/');
  await page.waitForFunction(() => window.kafedraUiPreferences && window.kafedraPreferenceOrigin);

  const button = page.locator('#preference-controls-button');
  await expect(button).toBeVisible();
  await button.click();
  const popover = page.locator('#preference-controls-popover');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('Учитывать мои частые выборы');
  await expect(popover).toContainText('Сбросить подсказки');
  await expect(popover).toContainText('Вид календаря');
  await expect(popover.getByRole('button', { name: 'Закрепить' })).toBeVisible();
  await expect(popover).not.toHaveCSS('animation-name', /.+/);

  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(button).toBeFocused();
});

test('saved и trusted explicit origin блокируют позднюю suggested-подстановку', async ({ page }) => {
  await mockPreferences(page);
  await page.goto('/');
  await page.waitForFunction(() => window.kafedraPreferenceOrigin);

  await page.evaluate(() => {
    const root = document.createElement('section');
    root.className = 'plan-fact-tools';
    root.innerHTML = `
      <select id="plan-fact-view-select"><option value="saved-1" selected>Сохранённый вид</option></select>
      <select id="r6-saved-control"><option value="mine" selected>Мои</option><option value="department">Кафедра</option></select>
      <input id="r6-explicit-control" value="до правки">
    `;
    document.body.append(root);
  });

  await expect.poll(() => page.locator('#r6-saved-control').getAttribute('data-ui-preference-origin')).toBe('saved');
  await expect(page.locator('#r6-saved-control')).toHaveAttribute('data-ui-preference-dirty', '1');
  expect(await page.evaluate(() => window.kafedraPreferenceOrigin.canApply(document.querySelector('#r6-saved-control')))).toBe(false);

  const explicit = page.locator('#r6-explicit-control');
  await explicit.fill('ручной выбор');
  await expect(explicit).toHaveAttribute('data-ui-preference-origin', 'explicit');
  expect(await page.evaluate(() => window.kafedraPreferenceOrigin.canApply(document.querySelector('#r6-explicit-control')))).toBe(false);

  const values = await page.evaluate(() => {
    const saved = document.querySelector('#r6-saved-control');
    const explicitControl = document.querySelector('#r6-explicit-control');
    if (window.kafedraPreferenceOrigin.canApply(saved)) saved.value = 'department';
    if (window.kafedraPreferenceOrigin.canApply(explicitControl)) explicitControl.value = 'поздняя подсказка';
    return { saved: saved.value, explicit: explicitControl.value };
  });
  expect(values).toEqual({ saved: 'mine', explicit: 'ручной выбор' });
});
