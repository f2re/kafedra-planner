import { test, expect } from '@playwright/test';

function navigationButton(page) {
  return page.locator('.nav-item[data-view="plans"]');
}

async function createPlan(page, title, yearStart) {
  const response = await page.request.post('/api/plans', {
    data: { title, planKind: 'department', periodKind: 'calendar', yearStart }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function archivePlan(page, planId) {
  const response = await page.request.post(`/api/plans/${planId}/archive`, {
    data: { reason: 'Проверка переключателя архива' }
  });
  expect(response.ok()).toBeTruthy();
}

async function openPlans(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraSetView === 'function', null, { timeout: 12_000 });
  await navigationButton(page).click();
  await expect(page.locator('[data-view-panel="plans"]')).toBeVisible();
  await expect(page.locator('#plans-lifecycle-segment')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => console.log(`[plans-lifecycle:${error.stack || error.message}]`));
});

test('Планы: однокликовый переключатель сохраняет поиск и использует серверный status', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const suffix = `segment-${Date.now()}`;
  const activeTitle = `Текущий план ${suffix}`;
  const archivedTitle = `Архивный план ${suffix}`;
  const active = await createPlan(page, activeTitle, 2088);
  const archived = await createPlan(page, archivedTitle, 2089);
  await archivePlan(page, archived.id);

  const requests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/plans') {
      requests.push({
        status: url.searchParams.get('status'),
        q: url.searchParams.get('q') || ''
      });
    }
  });

  await openPlans(page);
  const segment = page.locator('#plans-lifecycle-segment');
  const currentTab = segment.getByRole('tab', { name: 'Текущие' });
  const archiveTab = segment.getByRole('tab', { name: 'Архив' });
  const source = page.locator('#plans-lifecycle-status');

  await expect(segment).toHaveAttribute('role', 'tablist');
  await expect(currentTab).toHaveAttribute('aria-selected', 'true');
  await expect(archiveTab).toHaveAttribute('aria-selected', 'false');
  await expect(source).toBeHidden();
  await expect(source).toHaveAttribute('aria-hidden', 'true');

  await page.locator('#plans-q').fill(suffix);
  await expect(page.locator(`.plan-card[data-plan-id="${active.id}"]`)).toBeVisible();
  await page.locator(`.plan-card[data-plan-id="${active.id}"]`).click();
  await expect(page.locator('#plan-detail')).toContainText(activeTitle);

  await archiveTab.click();
  await expect(archiveTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#plans-q')).toHaveValue(suffix);
  await expect(page.locator(`.plan-card[data-plan-id="${archived.id}"]`)).toBeVisible();
  await expect(page.locator('#plan-detail')).toContainText(archivedTitle);
  await expect(page.locator('#plan-detail')).not.toContainText(activeTitle);
  await expect.poll(() => requests.some((item) => item.status === 'archived' && item.q === suffix)).toBeTruthy();

  await archiveTab.press('ArrowLeft');
  await expect(currentTab).toBeFocused();
  await expect(currentTab).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => requests.some((item) => item.status === 'active' && item.q === suffix)).toBeTruthy();

  await currentTab.press('End');
  await expect(archiveTab).toBeFocused();
  await expect(archiveTab).toHaveAttribute('aria-selected', 'true');

  await currentTab.focus();
  await currentTab.press('Space');
  await expect(currentTab).toHaveAttribute('aria-selected', 'true');
  await archiveTab.focus();
  await archiveTab.press('Enter');
  await expect(archiveTab).toHaveAttribute('aria-selected', 'true');

  await page.locator('#plans-q').fill(`нет-${suffix}`);
  await expect(page.locator('#plans-list .empty-state')).toHaveText('Архивных планов по этим условиям нет.');
  await expect(page.locator('#plan-detail')).not.toContainText(archivedTitle);
  await currentTab.click();
  await expect(page.locator('#plans-q')).toHaveValue(`нет-${suffix}`);
  await expect(page.locator('#plans-list .empty-state')).toHaveText('Текущих планов по этим условиям нет.');
});

test('Планы: суженное desktop-окно сохраняет геометрию и reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 900, height: 700 });
  await openPlans(page);

  const tabs = page.locator('#plans-lifecycle-segment [role="tab"]');
  await expect(tabs).toHaveCount(2);
  for (let index = 0; index < 2; index += 1) {
    expect((await tabs.nth(index).boundingBox())?.height || 0).toBeGreaterThanOrEqual(44);
  }

  const transition = await tabs.first().evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(transition.split(',').every((value) => value.trim() === '0s')).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  await expect(page.locator('[data-mobile-mode], [data-plans-mobile-mode]')).toHaveCount(0);
});
