import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDocumentXml, wordVisibleText } from '../../packages/plan-docx/src/ooxml-shared.mjs';

function nav(page) {
  return page.locator(Number(page.viewportSize()?.width || 0) <= 720 ? '.mobile-tab[data-view="plans"]' : '.nav-item[data-view="plans"]');
}
async function openPlans(page) {
  await page.goto('/');
  await expect(nav(page)).toBeVisible();
  await nav(page).click();
  await expect(page.locator('[data-view-panel="plans"]')).toBeVisible();
}
async function getJson(page, path) {
  const response = await page.request.get(path);
  expect(response.ok()).toBeTruthy();
  return response.json();
}
function fixture(name, title, rows) {
  return { name, mimeType: 'text/plain', buffer: Buffer.from(`${title}\nна 2026 год\n\n№ | Мероприятие | Срок проведения | Ответственный | Результат\n${rows.join('\n')}\n`) };
}
async function exportThroughUi(page) {
  const responsePromise = page.waitForResponse(response => /\/api\/monthly-plans\/[^/]+\/export$/.test(response.url()) && response.request().method() === 'POST');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-collection-action="export"]').click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  return { payload: await response.json(), download: await downloadPromise };
}

test('Планы: несколько источников → перечень → редактируемый месячный план → DOCX без дублей', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const suffix = `сводный-${testInfo.project.name}`;
  const firstTitle = `Методический семинар кафедры ${suffix}`;
  const secondTitle = `Научная конференция кафедры ${suffix}`;
  const firstFile = fixture(`План института ${suffix}.txt`, 'ПЛАН РАБОТЫ ИНСТИТУТА', [`1 | ${firstTitle} | 15 ноября 2026 | Кафедра метеорологии | Методические материалы`]);
  const secondFile = fixture(`План кафедры ${suffix}.txt`, 'ПЛАН РАБОТЫ КАФЕДРЫ', [`1 | ${secondTitle} | 20 ноября 2026 | Кафедра метеорологии | Доклад`]);
  await openPlans(page);
  await page.locator('#plans-upload-input').setInputFiles([firstFile, secondFile, { name: `Поврежденный ${suffix}.docx`, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('invalid ZIP test fixture') }]);
  await expect(page.locator('[data-plan-upload]')).toHaveCount(3);
  await expect(page.locator('[data-plan-upload]').filter({ hasText: firstFile.name }).getByRole('button', { name: 'Открыть план' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-plan-upload]').filter({ hasText: secondFile.name }).getByRole('button', { name: 'Открыть план' })).toBeVisible({ timeout: 30_000 });
  const failed = page.locator('[data-plan-upload]').filter({ hasText: `Поврежденный ${suffix}` });
  await expect(failed).toContainText('Ошибка обработки', { timeout: 30_000 });
  await expect(failed.getByRole('link', { name: 'Исходник' })).toBeVisible();
  const sourceBefore = await getJson(page, `/api/plan-events?q=${encodeURIComponent(suffix)}`);
  expect(sourceBefore.items).toHaveLength(2);
  const calendarBefore = await getJson(page, '/api/calendar?from=2026-11-01&to=2026-11-30&limit=2000');

  await page.locator('#plan-collection-open').click();
  await page.locator('#collection-month').fill('2026-11');
  await page.locator('#collection-q').fill(suffix);
  await expect(page.locator('[data-collection-event]')).toHaveCount(2);
  await page.locator('#collection-activity').selectOption('methodological');
  await expect(page.locator('[data-collection-event]')).toHaveCount(1);
  await expect(page.locator('[data-collection-event]')).toContainText(firstTitle);
  await page.locator('#collection-activity').selectOption('');
  await expect(page.locator('[data-collection-event]')).toHaveCount(2);
  await page.locator('#collection-department').fill('Кафедра метеорологии');
  await expect(page.locator('[data-collection-event]')).toHaveCount(2);
  await page.locator('#collection-title').fill(`План кафедры на ноябрь ${suffix}`);
  for (const checkbox of await page.locator('[data-collection-select]').all()) await checkbox.check();
  let interruptCreate = true;
  await page.route('**/api/monthly-plans', async route => {
    if (interruptCreate && route.request().method() === 'POST') {
      interruptCreate = false;
      const persisted = await route.fetch();
      expect(persisted.ok()).toBeTruthy();
      await route.abort('connectionreset');
    } else await route.continue();
  });
  await page.locator('[data-collection-action="add"]').click();
  await expect(page.locator('#collection-message')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#collection-selection-count')).toHaveText('Выбрано: 2');
  await page.locator('#collection-title').fill(`План кафедры после повтора ${suffix}`);
  const createResponse = page.waitForResponse(response => response.url().endsWith('/api/monthly-plans') && response.request().method() === 'POST');
  await page.locator('[data-collection-action="add"]').click();
  const created = await (await createResponse).json();
  await expect(page.locator('[data-collection-member]')).toHaveCount(2);
  const firstMember = page.locator('[data-collection-member]').filter({ hasText: firstTitle });
  await firstMember.locator('[name="titleOverride"]').fill(`Участие кафедры в семинаре ${suffix}`);
  await firstMember.locator('[name="note"]').fill('Обсудить новые учебные материалы');
  await firstMember.locator('button[type="submit"]').click();
  await expect(page.locator('#collection-message')).toHaveText('Формулировки сохранены.');
  const draft = await getJson(page, `/api/monthly-plans/${created.id}`);
  const foreignUpdate = await page.request.patch(`/api/monthly-plans/${created.id}`, { data: { expectedRevision: draft.revision, title: `Уточнённый месячный план ${suffix}` } });
  expect(foreignUpdate.ok()).toBeTruthy();
  const editedMember = page.locator('[data-collection-member]').filter({ hasText: `Участие кафедры в семинаре ${suffix}` });
  await editedMember.locator('[name="dateTextOverride"]').fill('Первая половина ноября');
  await editedMember.locator('button[type="submit"]').click();
  await expect(page.locator('#collection-message')).toContainText('План уже изменён');
  await expect(editedMember.locator('[name="dateTextOverride"]')).toHaveValue('Первая половина ноября');
  await page.locator('[data-collection-action="refresh"]').click();
  await expect(page.locator('#collection-message')).toContainText('Данные обновлены');
  await expect(editedMember.locator('[name="dateTextOverride"]')).toHaveValue('Первая половина ноября');
  await editedMember.locator('button[type="submit"]').click();
  await expect(page.locator('#collection-message')).toHaveText('Формулировки сохранены.');

  const dir = await mkdtemp(join(tmpdir(), 'monthly-ui-export-'));
  try {
    const firstExport = await exportThroughUi(page);
    const path = join(dir, 'month.docx');
    await firstExport.download.saveAs(path);
    const text = wordVisibleText(await readDocumentXml(path));
    expect(text).toContain(`Участие кафедры в семинаре ${suffix}`);
    expect(text).toContain('Первая половина ноября');
    const secondExport = await exportThroughUi(page);
    expect(secondExport.payload.documentId).toBe(firstExport.payload.documentId);
    expect(secondExport.payload.duplicateRequest).toBeTruthy();
    const after = await getJson(page, `/api/plan-events?q=${encodeURIComponent(suffix)}`);
    expect(after.items.map(item => [item.id, item.title])).toEqual(sourceBefore.items.map(item => [item.id, item.title]));
    const calendarAfter = await getJson(page, '/api/calendar?from=2026-11-01&to=2026-11-30&limit=2000');
    expect(calendarAfter.items.map(item => item.id).sort()).toEqual(calendarBefore.items.map(item => item.id).sort());

    await page.screenshot({ path: testInfo.outputPath('monthly-plan.png'), fullPage: true });
    await page.reload();
    await nav(page).click();
    await page.locator('#plan-collection-open').click();
    await page.locator('#collection-month').fill('2026-11');
    await expect(page.locator(`#collection-saved option[value="${created.id}"]`)).toHaveCount(1);
    await page.locator('#collection-saved').selectOption(created.id);
    await page.locator('#collection-members-tab').click();
    await expect(page.locator('[data-collection-member]')).toHaveCount(2);
    await expect(page.locator('[name="titleOverride"]').first()).toHaveValue(`Участие кафедры в семинаре ${suffix}`);
    await page.locator('[data-collection-action="remove"]').first().click();
    await expect(page.locator('[data-collection-member]')).toHaveCount(1);
    expect((await getJson(page, `/api/plan-events?q=${encodeURIComponent(suffix)}`)).items).toHaveLength(2);

    await page.locator('[data-collection-action="close"]').click();
    await page.locator('#plans-upload-input').setInputFiles(firstFile);
    await expect(page.locator('[data-plan-upload]').getByRole('button', { name: 'Открыть план' })).toBeVisible({ timeout: 30_000 });
    expect((await getJson(page, `/api/plan-events?q=${encodeURIComponent(suffix)}`)).items).toHaveLength(2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Планы: месячный DOCX-образец сохраняется и используется в следующем месяце', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const suffix = `образец-${testInfo.project.name}`;
  await openPlans(page);
  await page.locator('#plans-upload-input').setInputFiles(fixture(`План для образца ${suffix}.txt`, 'ПЛАН РАБОТЫ КАФЕДРЫ', [
    `1 | Занятие по метеорологии ${suffix} | 10 ноября 2026 | Петров Пётр Петрович | Занятие`,
    `2 | Практическое занятие ${suffix} | 10 декабря 2026 | Петров Пётр Петрович | Занятие`
  ]));
  await expect(page.locator('[data-plan-upload]').getByRole('button', { name: 'Открыть план' })).toBeVisible({ timeout: 30_000 });
  await page.locator('#plan-collection-open').click();
  await page.locator('#collection-month').fill('2026-11');
  await page.locator('#collection-q').fill(suffix);
  await expect(page.locator('[data-collection-event]')).toHaveCount(1);
  await page.locator('[data-collection-select]').check();
  await page.locator('[data-collection-action="add"]').click();
  await expect(page.locator('[data-collection-member]')).toHaveCount(1);
  const dir = await mkdtemp(join(tmpdir(), 'monthly-ui-template-'));
  try {
    const exported = await exportThroughUi(page);
    const path = join(dir, `Месячный образец ${suffix}.docx`);
    await exported.download.saveAs(path);
    await page.locator('#collection-template-file').setInputFiles(path);
    await expect(page.locator('#collection-message')).toContainText('Образец сохранён', { timeout: 30_000 });
    await expect(page.locator('#collection-template')).not.toHaveValue('');
    const templateId = await page.locator('#collection-template').inputValue();
    await page.locator('#collection-plan-form button[type="submit"]').click();
    await expect(page.locator('#collection-message')).toHaveText('Месячный план сохранён.');
    await page.locator('#collection-month').fill('2026-12');
    await page.locator('#collection-events-tab').click();
    await expect(page.locator('#collection-template')).toHaveValue(templateId);
    await expect(page.locator('[data-collection-event]')).toHaveCount(1);
    await expect(page.locator('[data-collection-event]')).toContainText(`Практическое занятие ${suffix}`);
    await page.locator('[data-collection-select]').check();
    await page.locator('[data-collection-action="add"]').click();
    await expect(page.locator('[data-collection-member]')).toHaveCount(1);
    const december = await exportThroughUi(page);
    const decemberPath = join(dir, 'december.docx');
    await december.download.saveAs(decemberPath);
    const text = wordVisibleText(await readDocumentXml(decemberPath));
    expect(text).toContain('на декабрь 2026 года');
    expect(text).toContain(`Практическое занятие ${suffix}`);
    expect(text).not.toContain(`Занятие по метеорологии ${suffix}`);
    const events = await getJson(page, `/api/plan-events?q=${encodeURIComponent(suffix)}`);
    expect(events.items).toHaveLength(2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
