import { test, expect } from '@playwright/test';

test('Архив распоряжений: загрузка, материал, поиск и календарь', async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.includes('mobile') ? 'моб' : 'деск';
  const number = `DA-${suffix}-25`;
  const title = `Проверка архива распоряжений ${suffix}`;
  const materialTitle = `Итоговый отчёт архива ${suffix}`;

  await page.goto('/');
  const archiveTab = page.locator('[data-view="directive-archive"]:visible').first();
  await expect(archiveTab).toBeVisible();
  await archiveTab.click();
  await expect(page.locator('[data-view-panel="directive-archive"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Распоряжения и отчётные материалы' })).toBeVisible();

  await page.getByRole('button', { name: 'Добавить распоряжение' }).click();
  const createForm = page.locator('#directive-create-form');
  await expect(createForm).toBeVisible();
  await createForm.locator('input[name="file"]').setInputFiles({
    name: `directive-${suffix}.pdf`, mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\narchive directive fixture\n%%EOF')
  });
  await createForm.locator('input[name="number"]').fill(number);
  await createForm.locator('input[name="issuedAt"]').fill('2026-08-25');
  await createForm.locator('input[name="title"]').fill(title);
  await createForm.locator('select[name="direction"]').selectOption('organizational');
  await createForm.locator('textarea[name="summary"]').fill('Проверка полного вертикального сценария хранения распоряжения.');
  await page.getByRole('button', { name: 'Сохранить распоряжение' }).click();

  const row = page.locator('[data-directive-id]').filter({ hasText: number }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText(title);
  await expect(page.locator('#directive-detail')).toContainText(number);
  await expect(page.locator('#directive-detail')).toContainText('Отчётных материалов пока нет');

  await page.getByRole('button', { name: 'Добавить материал' }).click();
  const materialForm = page.locator('#directive-material-form');
  await expect(materialForm).toBeVisible();
  await materialForm.locator('input[name="file"]').setInputFiles({
    name: `report-${suffix}.txt`, mimeType: 'text/plain',
    buffer: Buffer.from(`Итоговый отчёт для ${number}. Результаты выполнены полностью.`, 'utf8')
  });
  await materialForm.locator('select[name="kind"]').selectOption('report');
  await materialForm.locator('input[name="materialDate"]').fill('2026-08-25');
  await materialForm.locator('input[name="title"]').fill(materialTitle);
  await materialForm.locator('textarea[name="note"]').fill('Подтверждающий отчётный материал.');
  await page.getByRole('button', { name: 'Прикрепить материал' }).click();

  await expect(page.locator('#directive-detail')).toContainText(materialTitle);
  await expect(page.locator('#directive-detail')).toContainText('Отчёт');
  await expect(row).toContainText('1 мат.');

  await page.locator('#directive-q').fill(materialTitle);
  await expect(row).toBeVisible();
  await page.locator('#directive-report').selectOption('with');
  await expect(row).toBeVisible();

  await page.getByRole('button', { name: 'Календарь' }).click();
  const calendarEntry = page.locator('.directive-calendar-entry').filter({ hasText: number }).first();
  await expect(calendarEntry).toBeVisible();
  await calendarEntry.click();
  await expect(page.locator('#directive-detail')).toContainText(materialTitle);

  const archive = await page.request.get(`/api/directive-archive?q=${encodeURIComponent(number)}&limit=10`);
  expect(archive.ok()).toBeTruthy();
  const archiveJson = await archive.json();
  const item = archiveJson.items.find((candidate) => candidate.document_number === number);
  expect(item).toBeTruthy();

  const detail = await page.request.get(`/api/directive-archive/${encodeURIComponent(item.id)}`);
  expect(detail.ok()).toBeTruthy();
  const detailJson = await detail.json();
  expect(detailJson.item.material_count).toBe(1);
  expect(detailJson.item.materials[0].title).toBe(materialTitle);

  const original = await page.request.get(detailJson.item.source_content_url);
  expect(original.ok()).toBeTruthy();

  const calendar = await page.request.get('/api/calendar?from=2026-08-25&to=2026-08-25&limit=1000');
  expect(calendar.ok()).toBeTruthy();
  const calendarJson = await calendar.json();
  expect(calendarJson.items.some((candidate) => candidate.source_kind === 'directive' && candidate.source_id === item.id)).toBe(true);
});
