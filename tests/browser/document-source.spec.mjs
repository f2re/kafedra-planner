import { test, expect } from '@playwright/test';

async function openDocuments(page) {
  const button = page.locator('button[data-view="documents"]:visible').first();
  await button.click();
  await expect(page.locator('[data-view-panel="documents"]')).toBeVisible();
}

async function uploadAndWait(page) {
  await openDocuments(page);
  await page.locator('#file-input').setInputFiles({
    name: 'evidence.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Название: Отчёт кафедры\nДата: 5 августа 2026 года\nКоличество публикаций: 12', 'utf8')
  });
  await expect.poll(async () => {
    const response = await page.request.get('/api/documents');
    const body = await response.json();
    return body.items?.[0]?.processing_status;
  }, { timeout: 30_000 }).toMatch(/processed|needs_review/);
  await page.locator('button[data-view="calendar"]:visible').first().click();
  await openDocuments(page);
}

test('desktop: документ показывает структурный источник в инспекторе', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Проверка только настольного проекта');
  await page.goto('/');
  await uploadAndWait(page);
  await page.locator('.document-title').first().click();
  await expect(page.locator('#ux-inspector')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Источник документа' })).toBeVisible();
  await expect(page.locator('[data-structure-block]').first()).toContainText('Название');
});

test('mobile: инспектор остаётся доступным как нижний лист', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Проверка только мобильного проекта');
  await page.goto('/');
  await uploadAndWait(page);
  await page.locator('.document-title').first().click();
  const inspector = page.locator('#ux-inspector');
  await expect(inspector).toBeVisible();
  const box = await inspector.boundingBox();
  const viewport = page.viewportSize();
  expect(box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeGreaterThan(viewport.height * 0.85);
});
