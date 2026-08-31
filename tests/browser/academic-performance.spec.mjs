import { test, expect } from '@playwright/test';

function navigationButton(page) {
  const mobile = Number(page.viewportSize()?.width || 0) <= 720;
  return mobile
    ? page.locator('.mobile-tab[data-view="academic-performance"]')
    : page.locator('.nav-item[data-view="academic-performance"]');
}

test.beforeEach(async ({ page }, testInfo) => {
  page.on('pageerror', (error) => console.log(`[academic:${testInfo.project.name}:pageerror] ${error.stack || error.message}`));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) console.log(`[academic:${testInfo.project.name}:${message.type()}] ${message.text()}`);
  });
});

test('Успеваемость: ячейки метаполей → ручная группа → сводка по учебному периоду', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraSetView === 'function', null, { timeout: 12_000 });
  await expect(navigationButton(page)).toBeVisible({ timeout: 15_000 });
  await navigationButton(page).click();
  await expect(page.getByRole('heading', { name: 'Успеваемость' })).toBeVisible();
  await page.locator('[data-academic-import-open]').click();

  const name = `academic-${testInfo.project.name}.csv`;
  const csv = [
    'Учебный год;2026/2027',
    'Семестр;1 семестр',
    'Группа;ИВТ-31',
    'Итоговая ведомость',
    '№;ФИО;Математика;Физика',
    '1;Иванов Иван;5;н/а',
    '2;Петрова Анна;4;3',
    '3;Сидоров Пётр;2;зачтено'
  ].join('\n');
  const upload = page.locator('[data-academic-upload-form]');
  await upload.locator('[name="file"]').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8')
  });
  await upload.locator('button[type="submit"]').click();

  const mapping = page.locator('[data-academic-mapping-form]');
  await expect(mapping).toBeVisible({ timeout: 35_000 });
  await expect(mapping).toContainText('Структура оценок найдена автоматически');
  await expect(mapping.locator('[data-meta-mode="academicYear"]')).toHaveValue('cell');
  await expect(mapping.locator('[data-meta-cell="academicYear"]')).toHaveValue(JSON.stringify(['Таблица', 'B1']));
  await expect(mapping.locator('[data-meta-cell="semester"]')).toHaveValue(JSON.stringify(['Таблица', 'B2']));
  await expect(mapping.locator('[data-academic-header-row]')).toHaveValue('5');
  await expect(mapping.locator('[data-academic-student-column]')).toHaveValue('2');

  await mapping.locator('[data-meta-mode="groupCode"]').selectOption('manual');
  await mapping.locator('[data-meta-manual="groupCode"]').fill('ИВТ-31');
  await mapping.locator('button[type="submit"]').click();

  await expect(page.getByRole('heading', { name: 'Сводка готова' })).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('.academic-result-grid')).toContainText('2026/2027');
  await expect(page.locator('.academic-result-grid')).toContainText('ИВТ-31');
  await page.locator('[data-academic-finish]').click();

  await expect(page.locator('.academic-year').getByText('2026/2027', { exact: true })).toBeVisible();
  await expect(page.locator('.academic-semester').getByText('1 семестр', { exact: true })).toBeVisible();
  await expect(page.locator('.academic-group-button').getByText('ИВТ-31', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Группа ИВТ-31' })).toBeVisible();
  await expect(page.locator('.academic-metadata-strip')).toContainText('введено вручную');
  await expect(page.locator('.academic-metadata-strip')).toContainText('B1');
  await expect(page.locator('.academic-summary-table')).toContainText('Математика');
  await expect(page.locator('.academic-summary-table')).toContainText('Физика');
  const totalSelector = page.locator('[data-academic-total-import]');
  await expect(totalSelector).toHaveCount(1);
  await expect(totalSelector).toBeChecked();
  await expect(page.locator('.academic-period-totals')).toContainText('Итоги по выбранным группам');
  await expect(page.locator('.academic-totals-table')).toContainText('3,67');
  await totalSelector.uncheck();
  await expect(page.locator('.academic-period-totals')).toContainText('Выберите хотя бы одну группу');
  await totalSelector.check();
  await expect(page.locator('.academic-totals-table')).toContainText('3,67');

  await page.locator('[data-academic-discipline]').filter({ hasText: 'Математика' }).click();
  await expect(page.getByRole('heading', { name: 'Математика' })).toBeVisible();
  await expect(page.locator('.academic-student-list')).toContainText('C6');
  await expect(page.locator('.academic-student-list')).toContainText('C8');
  await page.locator('[data-academic-details-close]').click();

  const reportResponse = await page.request.get('/api/academic-performance/export?format=csv');
  expect(reportResponse.status()).toBe(200);
  const report = await reportResponse.text();
  expect(report).toContain('Учебный год;Семестр;Учебная группа;Дисциплина');
  expect(report).toContain('2026/2027;1;ИВТ-31;Математика');
  expect(report).toContain('ИТОГИ ПО ДИСЦИПЛИНАМ');
  expect(report).toContain('2026/2027;1;ИВТ-31;Математика');
  expect(report).toContain('3,67');
});

test('Успеваемость: мобильный экран сохраняет иерархию и основное действие', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraSetView === 'function', null, { timeout: 12_000 });
  await expect(navigationButton(page)).toBeVisible({ timeout: 15_000 });
  await navigationButton(page).click();
  await expect(page.getByRole('heading', { name: 'Успеваемость' })).toBeVisible();
  await expect(page.locator('[data-academic-import-open]')).toBeVisible();
  await expect(page.locator('.academic-layout')).toHaveCSS('grid-template-columns', /.+/u);
  await page.locator('[data-academic-import-open]').click();
  await expect(page.locator('[data-academic-modal]')).toBeVisible();
  await expect(page.locator('[data-academic-upload-form]')).toBeVisible();
});


test('Успеваемость: reduced motion даёт нулевую длительность на desktop и mobile', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraSetView === 'function', null, { timeout: 12_000 });
  await expect(navigationButton(page)).toBeVisible({ timeout: 15_000 });
  await navigationButton(page).click();
  await page.locator('[data-academic-import-open]').click();
  const motion = await page.locator('[data-academic-modal]').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      transitionDuration: style.transitionDuration,
      animationDuration: style.animationDuration,
      animationName: style.animationName
    };
  });
  expect(motion.transitionDuration).toBe('0s');
  expect(motion.animationDuration).toBe('0s');
  expect(motion.animationName).toBe('none');
  await expect(page.getByRole('heading', { name: 'Загрузить ведомость' })).toBeVisible();
});
