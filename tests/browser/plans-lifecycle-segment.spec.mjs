import { test, expect } from '@playwright/test';

function plansNavigation(page) {
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
  await plansNavigation(page).click();
  await expect(page.locator('[data-view-panel="plans"]')).toBeVisible();
  await expect(page.locator('#plans-lifecycle-segment')).toBeVisible();
}

function waitForPlansRequest(page, status, q = null) {
  return page.waitForResponse((response) => {
    if (response.request().method() !== 'GET') return false;
    const url = new URL(response.url());
    if (url.pathname !== '/api/plans' || url.searchParams.get('status') !== status) return false;
    return q === null || (url.searchParams.get('q') || '') === q;
  });
}

async function chooseMode(page, tab, status, q = null, action = 'click') {
  const response = waitForPlansRequest(page, status, q);
  if (action === 'click') await tab.click();
  else await tab.press(action);
  expect((await response).ok()).toBeTruthy();
}

test.beforeEach(async ({ page }, testInfo) => {
  page.on('pageerror', (error) => console.log(`[plans-lifecycle:${testInfo.project.name}] ${error.stack || error.message}`));
});

test('Планы: сегмент переключает server status и сохраняет поиск без stale detail', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const suffix = `segment-${Date.now()}`;
  const activeTitle = `Текущий план ${suffix}`;
  const archivedTitle = `Архивный план ${suffix}`;
  const active = await createPlan(page, activeTitle, 2088);
  const archived = await createPlan(page, archivedTitle, 2089);
  await archivePlan(page, archived.id);

  await openPlans(page);
  const segment = page.locator('#plans-lifecycle-segment');
  const currentTab = segment.getByRole('tab', { name: 'Текущие' });
  const archiveTab = segment.getByRole('tab', { name: 'Архив' });
  const source = page.locator('#plans-lifecycle-status');

  await expect(segment).toHaveAttribute('role', 'tablist');
  await expect(segment).toHaveAttribute('aria-orientation', 'horizontal');
  await expect(currentTab).toHaveAttribute('aria-selected', 'true');
  await expect(currentTab).toHaveAttribute('tabindex', '0');
  await expect(archiveTab).toHaveAttribute('aria-selected', 'false');
  await expect(archiveTab).toHaveAttribute('tabindex', '-1');
  await expect(source).toBeHidden();
  await expect(source).toHaveAttribute('aria-hidden', 'true');

  await page.locator('#plans-q').fill(suffix);
  await expect(page.locator(`.plan-card[data-plan-id="${active.id}"]`)).toBeVisible();
  await page.locator(`.plan-card[data-plan-id="${active.id}"]`).click();
  await expect(page.locator('#plan-detail')).toContainText(activeTitle);

  await chooseMode(page, archiveTab, 'archived', suffix);
  await expect(archiveTab).toHaveAttribute('aria-selected', 'true');
  await expect(archiveTab).toHaveAttribute('tabindex', '0');
  await expect(page.locator('#plans-q')).toHaveValue(suffix);
  await expect(page.locator(`.plan-card[data-plan-id="${archived.id}"]`)).toBeVisible();
  await expect(page.locator('#plan-detail')).toContainText(archivedTitle);
  await expect(page.locator('#plan-detail')).not.toContainText(activeTitle);

  await chooseMode(page, archiveTab, 'active', suffix, 'ArrowLeft');
  await expect(currentTab).toBeFocused();
  await expect(currentTab).toHaveAttribute('aria-selected', 'true');

  await chooseMode(page, currentTab, 'archived', suffix, 'End');
  await expect(archiveTab).toBeFocused();
  await expect(archiveTab).toHaveAttribute('aria-selected', 'true');

  await currentTab.focus();
  await chooseMode(page, currentTab, 'active', suffix, 'Space');
  await expect(currentTab).toHaveAttribute('aria-selected', 'true');
  await archiveTab.focus();
  await chooseMode(page, archiveTab, 'archived', suffix, 'Enter');
  await expect(archiveTab).toHaveAttribute('aria-selected', 'true');

  const missing = `нет-${suffix}`;
  const archiveEmptyResponse = waitForPlansRequest(page, 'archived', missing);
  await page.locator('#plans-q').fill(missing);
  expect((await archiveEmptyResponse).ok()).toBeTruthy();
  await expect(page.locator('#plans-list .empty-state')).toHaveText('Архивных планов по этим условиям нет.');
  await expect(page.locator('#plan-detail')).not.toContainText(archivedTitle);

  await chooseMode(page, currentTab, 'active', missing);
  await expect(page.locator('#plans-q')).toHaveValue(missing);
  await expect(page.locator('#plans-list .empty-state')).toHaveText('Текущих планов по этим условиям нет.');
  await expect(page.locator('#plan-detail')).not.toContainText(activeTitle);
});

test('Планы: constrained desktop сохраняет 44px, reduced motion и не создаёт mobile mode', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1024, height: 768 });
  await openPlans(page);

  const segment = page.locator('#plans-lifecycle-segment');
  const tabs = segment.getByRole('tab');
  await expect(tabs).toHaveCount(2);
  for (let index = 0; index < 2; index += 1) {
    const box = await tabs.nth(index).boundingBox();
    expect(box).not.toBeNull();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  const transition = await tabs.first().evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(transition.split(',').every((value) => value.trim() === '0s')).toBeTruthy();
  const geometry = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  await expect(page.locator('[data-mobile-mode], [data-plans-mobile-mode], [data-plans-mobile-detail]')).toHaveCount(0);
});
