import { test, expect } from '@playwright/test';

async function openDocuments(page, projectName) {
  const selector = projectName === 'mobile'
    ? '.mobile-tab[data-view="documents"]'
    : '.nav-item[data-view="documents"]';
  await page.locator(selector).click();
  await expect(page.locator('[data-view-panel="documents"]')).toBeVisible();
}

test('оригинальное изображение показывается в инспекторе на desktop и mobile', async ({ page }, testInfo) => {
  await page.goto('/');
  await openDocuments(page, testInfo.project.name);

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2SIAAAAASUVORK5CYII=',
    'base64'
  );
  await page.locator('#file-input').setInputFiles({
    name: `scan-${testInfo.project.name}.png`,
    mimeType: 'image/png',
    buffer: png
  });

  await expect.poll(async () => {
    const response = await page.request.get('/api/documents');
    const body = await response.json();
    return body.items?.find((item) => item.original_name === `scan-${testInfo.project.name}.png`)?.processing_status;
  }, { timeout: 30_000 }).toMatch(/processed|needs_review/);

  await openDocuments(page, testInfo.project.name);
  await page.locator('.document-title', { hasText: `scan-${testInfo.project.name}` }).click();
  await expect(page.locator('#document-native-preview')).toBeVisible();
  await expect(page.locator('#document-preview-image')).toBeVisible();
  await expect(page.locator('#document-native-preview')).toContainText('OCR: отключён');
});
