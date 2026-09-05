import { test, expect } from '@playwright/test';

async function createMeeting(page, year, number) {
  const response = await page.request.post('/api/meetings', {
    data: { meetingDate: `${year}-09-15`, protocolNumber: number }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function openSearch(page) {
  await page.goto('/');
  await page.locator('#open-search').click();
  await expect(page.locator('[data-view-panel="search"]')).toHaveClass(/active/);
}

test('поиск: Enter открывает существующее заседание, К поиску восстанавливает условия и фокус', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name.includes('mobile');
  const year = mobile ? 2046 : 2045;
  const number = `R5-${mobile ? 'M' : 'D'}-${Date.now()}`;
  const meeting = await createMeeting(page, year, number);

  await openSearch(page);
  await page.locator('#search-input').fill('Заседание кафедры');
  await page.locator('#search-filters [name="sourceKind"]').selectOption('protocol');
  const more = page.locator('#search-more-filters');
  await more.evaluate((node) => { node.open = true; });
  await page.locator('#search-filters [name="number"]').fill(number);

  const card = page.locator(`[data-search-route-kind="meeting"][data-search-route-id="${meeting.id}"]`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#search-active-filters')).toContainText(number);
  await page.evaluate(() => {
    document.body.style.minHeight = '2400px';
    window.scrollTo(0, 420);
  });
  await card.focus();
  await card.press('Enter');

  await expect(page.locator('[data-view-panel="meetings"]')).toHaveClass(/active/);
  await expect(page.locator('#meeting-detail')).toContainText(number, { timeout: 12_000 });
  const back = page.locator('#search-return-action');
  await expect(back).toBeVisible();
  await back.click();

  await expect(page.locator('[data-view-panel="search"]')).toHaveClass(/active/);
  await expect(page.locator('#search-input')).toHaveValue('Заседание кафедры');
  await expect(page.locator('#search-filters [name="sourceKind"]')).toHaveValue('protocol');
  await expect(page.locator('#search-filters [name="number"]')).toHaveValue(number);
  await expect(more).toHaveJSProperty('open', true);
  await expect(card).toBeFocused({ timeout: 12_000 });
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(250);
});

test('поиск: редкие фильтры раскрываются один раз, недоступный route остаётся inline', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name.includes('mobile');
  const year = mobile ? 2048 : 2047;
  const number = `R5-X-${mobile ? 'M' : 'D'}-${Date.now()}`;
  const meeting = await createMeeting(page, year, number);

  await openSearch(page);
  await expect(page.locator('#search-more-filters')).not.toHaveJSProperty('open', true);
  await page.locator('#search-more-filters > summary').click();
  await expect(page.locator('#search-more-filters')).toHaveJSProperty('open', true);
  await page.locator('#search-filters [name="sourceKind"]').selectOption('protocol');
  await page.locator('#search-filters [name="number"]').fill(number);
  const card = page.locator(`[data-search-route-kind="meeting"][data-search-route-id="${meeting.id}"]`);
  await expect(card).toBeVisible({ timeout: 15_000 });

  await page.evaluate(() => { window.__r5ExactRoute = window.kafedraOpenExactRoute; window.kafedraOpenExactRoute = async () => false; });
  await card.focus();
  await card.press('Enter');
  await expect(page.locator('[data-view-panel="search"]')).toHaveClass(/active/);
  await expect(card.locator('.search-route-error')).toContainText('недоступен');
  await expect(page.locator('#search-return-action')).toBeHidden();
  await page.evaluate(() => { window.kafedraOpenExactRoute = window.__r5ExactRoute; delete window.__r5ExactRoute; });
});
