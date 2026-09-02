import { test, expect } from '@playwright/test';

async function createPlan(request, title, yearStart) {
  const response = await request.post('/api/plans', { data: {
    title,
    planKind: 'department',
    periodKind: 'calendar',
    yearStart
  }});
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test('desktop plans switch current/archive through the existing server lifecycle', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop-only lifecycle control.');
  await page.setViewportSize({ width: 1440, height: 900 });

  const suffix = `desktop-${Date.now()}`;
  const currentPlan = await createPlan(request, `Текущий план ${suffix}`, 2026);
  const archivedPlan = await createPlan(request, `Архивный план ${suffix}`, 2025);
  const archived = await request.post(`/api/plans/${archivedPlan.id}/archive`, {
    data: { reason: 'Проверка desktop-переключателя' }
  });
  expect(archived.ok()).toBeTruthy();

  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraSetView === 'function');
  await page.locator('.nav-item[data-view="plans"]').click();
  await expect(page.locator('[data-view-panel="plans"]')).toBeVisible();

  const segment = page.locator('#plans-lifecycle-segment');
  const bridge = page.locator('#plans-lifecycle-status');
  const current = segment.getByRole('tab', { name: 'Текущие' });
  const archive = segment.getByRole('tab', { name: 'Архив' });

  await expect(segment).toBeVisible();
  await expect(segment).toHaveAttribute('role', 'tablist');
  await expect(bridge).toBeHidden();
  await expect(bridge).toHaveAttribute('aria-hidden', 'true');
  await expect(current).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(`.plan-card[data-plan-id="${currentPlan.id}"]`)).toBeVisible();

  await page.locator('#plans-q').fill(suffix);
  await archive.click();
  await expect(bridge).toHaveValue('archived');
  await expect(archive).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#plans-q')).toHaveValue(suffix);
  await expect(page.locator(`.plan-card[data-plan-id="${archivedPlan.id}"]`)).toBeVisible();
  await expect(page.locator(`.plan-card[data-plan-id="${currentPlan.id}"]`)).toHaveCount(0);

  await archive.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(current).toBeFocused();
  await expect(current).toHaveAttribute('aria-selected', 'true');
  await expect(bridge).toHaveValue('active');
  await expect(page.locator(`.plan-card[data-plan-id="${currentPlan.id}"]`)).toBeVisible();

  await current.focus();
  await page.keyboard.press('End');
  await expect(archive).toBeFocused();
  await expect(bridge).toHaveValue('archived');
  await page.keyboard.press('Home');
  await expect(current).toBeFocused();
  await expect(bridge).toHaveValue('active');

  const targets = await segment.getByRole('tab').evaluateAll((tabs) => tabs.map((tab) => {
    const box = tab.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  for (const target of targets) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(current).toHaveCSS('transition-duration', '0s');

  await page.setViewportSize({ width: 700, height: 900 });
  await expect(page.locator('#plans-lifecycle-segment')).toHaveCount(0);
  await expect(bridge).toBeVisible();
  await expect(bridge).not.toHaveAttribute('aria-hidden', 'true');
});
