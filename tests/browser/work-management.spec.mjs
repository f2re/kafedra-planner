import { test, expect } from '@playwright/test';

test('распоряжение создаёт поручение и отображается в рабочем поиске', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'workflow-desktop', 'Основной рабочий поток запускается в изолированном desktop-проекте');
  await page.goto('/');
  await page.locator('button[data-view="documents"]:visible').first().click();
  await page.locator('#file-input').setInputFiles({
    name: 'rasporyazhenie.txt', mimeType: 'text/plain',
    buffer: Buffer.from('РАСПОРЯЖЕНИЕ\nот 5 августа 2026 года № 47-р\nО подготовке отчёта\nРАСПОРЯЖАЮСЬ:\n1. Подготовить отчёт по НИР до 20 августа 2026 года. Ответственный: Иванов Иван Иванович.', 'utf8')
  });
  await expect.poll(async () => {
    const response = await page.request.get('/api/directives');
    return (await response.json()).items?.length || 0;
  }, { timeout: 30_000 }).toBeGreaterThan(0);
  await page.locator('button[data-view="work"]:visible').first().click();
  await expect(page.locator('[data-view-panel="work"]')).toBeVisible();
  await expect(page.locator('#work-results')).toContainText('47-р');
  await expect(page.locator('#work-results')).toContainText('Подготовить отчёт');
});
