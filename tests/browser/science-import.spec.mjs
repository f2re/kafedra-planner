import { test, expect } from '@playwright/test';

function navigationButton(page, view) {
  const mobile = Number(page.viewportSize()?.width || 0) <= 720;
  return mobile
    ? page.locator(`.mobile-tab[data-view="${view}"]`)
    : page.locator(`.nav-item[data-view="${view}"]`);
}

test.beforeEach(async ({ page }, testInfo) => {
  page.on('pageerror', (error) => console.log(`[science-import:${testInfo.project.name}:pageerror] ${error.stack || error.message}`));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) console.log(`[science-import:${testInfo.project.name}:${message.type()}] ${message.text()}`);
  });
});

test('Наука: CSV → сопоставление → частичный импорт → повтор без дублей', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraSetView === 'function', null, { timeout: 12_000 });
  await navigationButton(page, 'science').click();
  await expect(page.locator('[data-science-import-open]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-science-import-open]').click();

  const name = `science-bulk-${testInfo.project.name}.csv`;
  const csv = [
    'Название;Вид;Авторы;DOI;Год;Этап',
    `Массовая статья ${testInfo.project.name};Статья;Иванов И.И.;10.1000/${testInfo.project.name};2026;Опубликовано`,
    ';Статья;Петров П.П.;;2026;Готовится',
    `Дубликат ${testInfo.project.name};Статья;Иванов И.И.;10.1000/${testInfo.project.name};2026;Опубликовано`
  ].join('\n');
  const upload = page.locator('[data-science-import-upload-form]');
  await upload.locator('[name="file"]').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await upload.locator('button[type="submit"]').click();

  const mapping = page.locator('[data-science-import-mapping-form]');
  await expect(mapping).toBeVisible({ timeout: 30_000 });
  await expect(mapping).toContainText('3 строк');
  await expect(mapping.locator('[name="title"]')).toHaveValue('0');
  await expect(mapping.locator('[name="authors"]')).toHaveValue('2');

  let failOnce = true;
  await page.route('**/api/science-imports', async (route) => {
    if (route.request().method() === 'POST' && failOnce) {
      failOnce = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Временная ошибка запуска импорта.' } })
      });
      return;
    }
    await route.continue();
  });
  await mapping.locator('button[type="submit"]').click();
  await expect(mapping.locator('[data-science-import-error]')).toContainText('Временная ошибка', { timeout: 15_000 });
  await expect(mapping.locator('[name="title"]')).toHaveValue('0');

  const importResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/science-imports') && response.request().method() === 'POST'
  );
  await mapping.locator('button[type="submit"]').click();
  expect([201,207]).toContain((await importResponse).status());

  await expect(page.locator('.science-import-summary')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.science-import-summary')).toContainText('1');
  await expect(page.locator('.science-import-results')).toContainText('Добавлено');
  await expect(page.locator('.science-import-results')).toContainText('Пропущено');
  await expect(page.locator('.science-import-results')).toContainText('Ошибка');

  const list = await (await page.request.get(`/api/science?q=${encodeURIComponent(`Массовая статья ${testInfo.project.name}`)}`)).json();
  expect(list.items).toHaveLength(1);
  const runs = await (await page.request.get('/api/science-imports')).json();
  const run = runs.items.find((item) => item.source_name === name);
  expect(run).toBeTruthy();
  expect(run.imported_rows).toBe(1);
  expect(run.skipped_rows).toBe(1);
  expect(run.error_rows).toBe(1);

  await page.locator('[data-science-import-close]').last().click();
  await expect(page.locator('#science-import-modal')).toHaveClass(/hidden/);
});
