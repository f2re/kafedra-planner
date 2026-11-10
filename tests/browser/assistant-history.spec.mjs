import { test, expect } from '@playwright/test';

test('ассистент: структурированный fallback, безопасный текст, действия с документом и история', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const sourceText = 'Оригинал протокола заседания, сохранённый в архиве.';
  const upload = await page.request.post('/api/documents', {
    headers: { 'x-file-name': 'assistant-evidence.txt', 'content-type': 'text/plain' },
    data: Buffer.from(sourceText, 'utf8')
  });
  expect(upload.status()).toBe(202);
  const accepted = await upload.json();
  const docId = accepted.documentId;
  expect(docId).toBeTruthy();
  const doc = await (await page.request.get('/api/documents/' + encodeURIComponent(docId))).json();
  const versionId = accepted.documentVersionId || doc.current_version_id || null;
  const sources = [{
    kind: 'document', id: docId, documentId: docId, versionId,
    title: 'Протокол-источник', snippet: 'Оригинал протокола заседания.',
    previewAvailable: true
  }];
  const result = { type: 'raw', text: '# Итоги поиска\n- Документ найден\n- <img src=x onerror=alert(1)>' };
  const savedRun = {
    id: 'fixture-run-1', task: 'archive-query', promptText: 'Найти протокол-источник',
    status: 'completed', result, sources, createdAt: new Date().toISOString(),
    durationMs: 7, redacted: false
  };
  let streamCalls = 0;
  await page.route('**/api/assistant/stream', async (route) => {
    streamCalls += 1;
    await route.fulfill({
      status: 200, contentType: 'text/event-stream',
      body: 'event: token\ndata: {"delta":"Найден материал."}\n\n'
        + 'event: done\ndata: ' + JSON.stringify({
          status: 'completed', runId: savedRun.id, historySaved: true,
          result, sources, durationMs: 7
        }) + '\n\n'
    });
  });
  await page.route('**/api/assistant/history**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/' + savedRun.id)) {
      return route.fulfill({ json: { ok: true, entry: savedRun } });
    }
    return route.fulfill({ json: { ok: true, items: [savedRun], nextCursor: null } });
  });

  await page.goto('/');
  await page.locator('#open-assistant').click();
  await page.locator('.assistant-mode-tab[data-mode="archive-query"]').click();
  await page.locator('#assistant-input').fill('Найти протокол-источник');
  await page.locator('#assistant-process-btn').click();

  await expect(page.locator('.assistant-plain-answer h3')).toHaveText('Итоги поиска');
  await expect(page.locator('.assistant-plain-answer')).toContainText('Документ найден');
  expect(await page.locator('.assistant-plain-answer img').count()).toBe(0);
  await expect(page.locator('.assistant-source-section')).toContainText('Протокол-источник');
  const original = page.locator('.assistant-source-actions a').filter({ hasText: 'Открыть оригинал' });
  await expect(original).toHaveAttribute('href', /\/api\/documents\/.*\/content\?variant=original/u);
  const preview = page.locator('.assistant-source-actions a').filter({ hasText: 'Предпросмотр' });
  await expect(preview).toBeVisible();
  const download = page.locator('.assistant-source-actions a').filter({ hasText: 'Скачать' });
  await expect(download).toHaveAttribute('href', /download=1/u);
  const originalResponse = await page.request.get(await original.getAttribute('href'));
  expect(originalResponse.ok()).toBeTruthy();
  expect(await originalResponse.text()).toBe(sourceText);

  await page.locator('.assistant-mode-tab[data-mode="history"]').click();
  await expect(page.locator('.assistant-history-list')).toContainText('Найти протокол-источник');
  await page.locator('.assistant-history-record').click();
  await expect(page.locator('.assistant-history-restored')).toBeVisible();
  await expect(page.locator('.assistant-plain-answer')).toContainText('Документ найден');
  expect(streamCalls).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('ассистент показывает ошибку SSE вместо пустого результата', async ({ page }) => {
  await page.route('**/api/assistant/stream', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/event-stream',
      body: 'event: error\ndata: {"status":"unavailable","message":"Локальная модель недоступна"}\n\n' });
  });
  await page.goto('/');
  await page.locator('#open-assistant').click();
  await page.locator('#assistant-input').fill('Проверка ошибки');
  await page.locator('#assistant-process-btn').click();
  await expect(page.locator('#assistant-results')).toContainText('Локальная модель недоступна');
});
