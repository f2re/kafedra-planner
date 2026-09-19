import { test, expect } from '@playwright/test';

async function returnFromInspector(page, testInfo) {
  const inspector = page.locator('#ux-inspector');
  await expect(inspector).toBeVisible();
  const back = inspector.locator('#search-return-action');
  await expect(back).toBeVisible();
  await expect(page.locator('#search-return-action')).toHaveCount(1);
  const bounds = await back.boundingBox();
  expect(bounds.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('search-inspector-return.png') });
  await back.click();
  await expect(inspector).toBeHidden();
  await expect(page.locator('#sheet-backdrop')).toBeHidden();
  await expect(page.locator('[data-view-panel="search"]')).toBeVisible();
}

test('фоновые подсказки не заменяют выдачу, сохраняют фокус и отключаются', async ({ page }, testInfo) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const title = `Фоновый подбор отчёта ${testInfo.project.name}`;
  const personResponse = await page.request.post('/api/people', { data: { displayName: title } });
  expect(personResponse.ok()).toBeTruthy();
  const person = await personResponse.json();
  const taskResponse = await page.request.post('/api/periodic-tasks', { data: {
    ownerPersonId: person.id, title, description: 'Фоновый подбор материалов для научного отчёта кафедры.',
    periodKind: 'semester', periodKey: '2026-1',
    startsAt: '2026-08-18', dueDate: '2026-09-15', direction: 'education'
  } });
  expect(taskResponse.ok()).toBeTruthy();
  let starts = 0;
  let unavailable = false;
  // Only model advice is replaced; candidates and routes come from the real search API.
  await page.route('**/api/search?**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('assist') === 'cancel') return route.fulfill({ json: { assistant: { status: 'cancelled' } } });
    if (!url.searchParams.get('q')?.includes('Фоновый подбор')) return route.continue();
    const response = await route.fetch();
    const payload = await response.json();
    const mode = url.searchParams.get('assist');
    payload.assistant = { status: 'idle', suggestions: [] };
    if (mode === 'start') { starts++; payload.assistant.status = 'queued'; }
    if (mode === 'poll') {
      const item = payload.items.find((candidate) => candidate.source_kind === 'periodic_task' && candidate.title === title);
      payload.assistant = { status: unavailable ? 'unavailable' : 'ready', suggestions: item ? [{
        id: `${item.source_kind}:${item.source_id}`,
        quote: item.snippet.replace(/<\/?mark>/gu, '').replace(/\s+/gu, ' ').trim().slice(0, 240)
      }] : [] };
    }
    return route.fulfill({ response, json: payload });
  });
  await page.goto('/');
  await page.evaluate(() => window.kafedraSetView('search'));
  await expect(page.locator('#search-filters')).toBeVisible();
  await page.locator('#search-input').fill(title);
  await expect(page.locator('#search-results')).toContainText(title);
  const order = await page.locator('#search-results [data-search-result-key]').evaluateAll((nodes) => nodes.map((node) => node.dataset.searchResultKey));
  await expect(page.locator('#search-assistant [role="status"]')).toContainText('Подобрано материалов: 1');
  await expect(page.locator('#search-input')).toBeFocused();
  expect(await page.locator('#search-assistant details').evaluate((node) => node.open)).toBe(false);
  expect(await page.locator('#search-results [data-search-result-key]').evaluateAll((nodes) => nodes.map((node) => node.dataset.searchResultKey))).toEqual(order);
  await page.locator('#search-assistant summary').click();
  await expect(page.locator('#search-assistant blockquote')).toContainText('Фоновый подбор');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.search-assistant-source').click();
  await returnFromInspector(page, testInfo);
  await expect(page.locator('#search-input')).toHaveValue(title);
  await expect(page.locator('#search-assistant')).toBeVisible();
  await page.locator('#search-assistant input').uncheck();
  const previousStarts = starts;
  await page.locator('#search-input').fill('Фоновый подбор');
  await expect(page.locator('#search-assistant [role="status"]')).toHaveText('Выключены в этой вкладке');
  await page.waitForTimeout(1000);
  expect(starts).toBe(previousStarts);
  unavailable = true;
  await page.locator('#search-assistant input').check();
  await expect(page.locator('#search-assistant [role="status"]')).toContainText('временно недоступны');
  await expect(page.locator('#search-results')).toContainText(title);
  expect(pageErrors).toEqual([]);
});

test('семантический подбор находит материал при пустой выдаче и сохраняет явные фильтры', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const query = 'образование атмосферных вихрей';
  const title = `Циклогенез — материалы ${testInfo.project.name}`;
  const person = await (await page.request.post('/api/people', { data: { displayName: `Поиск смысла ${testInfo.project.name}` } })).json();
  const response = await page.request.post('/api/periodic-tasks', { data: {
    ownerPersonId: person.id, title, description: 'Циклогенез и развитие барических депрессий над морем.',
    periodKind: 'semester', periodKey: '2026-1', startsAt: '2026-08-18', dueDate: '2026-09-15', direction: 'education'
  } });
  expect(response.ok()).toBeTruthy();
  await page.route('**/api/search?**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('assist') === 'cancel') return route.fulfill({ json: { assistant: { status: 'cancelled' } } });
    if (url.searchParams.get('q') !== query) return route.continue();
    const response = await route.fetch();
    const payload = await response.json();
    payload.assistant = { status: 'idle', suggestions: [] };
    if (url.searchParams.get('assist') === 'start') payload.assistant.status = 'queued';
    if (url.searchParams.get('assist') === 'poll') {
      // The model's proposed query retrieves real indexed application data under the same filters.
      const expandedUrl = new URL(url);
      expandedUrl.searchParams.set('q', 'циклогенез'); expandedUrl.searchParams.delete('assist');
      const found = await (await route.fetch({ url: expandedUrl.href })).json();
      const item = found.items.find((candidate) => candidate.title === title);
      const quote = item?.snippet.replace(/<\/?mark>/gu, '').slice(0, 240);
      payload.assistant = { status: 'ready', items: item ? [{ ...item, matched_by: 'meaning', matched_query: 'циклогенез' }] : [],
        relatedQueries: item ? [{ query: 'циклогенез', count: 1, kind: 'meaning' }] : [],
        suggestions: item ? [{ id: `${item.source_kind}:${item.source_id}`, quote }] : [] };
    }
    return route.fulfill({ response, json: payload });
  });
  await page.goto('/');
  await expect(page.locator('#search-filters')).toBeAttached();
  await page.evaluate(() => window.kafedraSetView('search'));
  await page.locator('#search-filters [name="sourceKind"]').selectOption('periodic_task');
  await page.locator('#search-input').fill(query);
  await expect(page.locator('#search-results')).toContainText('По словам запроса совпадений нет');
  await expect(page.locator('#search-assistant [role="status"]')).toContainText('Подобрано материалов: 1');
  await expect(page.locator('#search-input')).toBeFocused();
  await page.locator('#search-assistant summary').click();
  await expect(page.locator('#search-assistant')).toContainText(title);
  await page.locator('.search-assistant-source').click();
  await returnFromInspector(page, testInfo);
  await expect(page.locator('#search-input')).toHaveValue(query);
  await expect(page.locator('#search-assistant [role="status"]')).toContainText('Подобрано материалов: 1');
  await page.locator('#search-assistant summary').click();
  await expect(page.locator('#search-assistant .search-related-queries button')).toBeVisible();
  await page.locator('#search-assistant .search-related-queries button').click();
  await expect(page.locator('#search-input')).toHaveValue('циклогенез');
  await expect(page.locator('#search-filters [name="sourceKind"]')).toHaveValue('periodic_task');
  await expect(page.locator('#search-results')).toContainText(title);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
