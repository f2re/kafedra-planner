import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeZipArchive } from '../../packages/plan-docx/src/archive.mjs';
import { navigateCalendarToDate } from './calendar-fixture-navigation.mjs';

test.beforeEach(async ({ page }, testInfo) => {
  page.on('pageerror', (error) => console.log(`[plans:${testInfo.project.name}:pageerror] ${error.stack || error.message}`));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      console.log(`[plans:${testInfo.project.name}:console:${message.type()}] ${message.text()}`);
    }
  });
  page.on('requestfailed', (request) => {
    console.log(`[plans:${testInfo.project.name}:requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
  });
});

function cell(text) {
  return `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}

function row(values) {
  return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${values.map(cell).join('')}</w:tr>`;
}

function planXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>ПЛАН РАБОТЫ КАФЕДРЫ</w:t></w:r></w:p>
<w:p><w:r><w:t>на </w:t></w:r><w:r><w:t>2025</w:t></w:r><w:r><w:t> год</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>
${row(['№', 'Мероприятие', 'Срок проведения', 'Ответственный', 'Результат'])}
${row(['1', 'Браузерное заседание кафедры', '15 августа 2025', 'Иванов Иван Иванович', 'Протокол'])}
</w:tbl><w:sectPr/></w:body></w:document>`;
}

async function createPlanDocx(path) {
  await writeZipArchive(path, {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': planXml()
  });
}

function navigationButton(page, view) {
  const mobile = Number(page.viewportSize()?.width || 0) <= 720;
  return mobile
    ? page.locator(`.mobile-tab[data-view="${view}"]`)
    : page.locator(`.nav-item[data-view="${view}"]`);
}

async function openPlans(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraSetView === 'function', null, { timeout: 12_000 });
  const panel = page.locator('[data-view-panel="plans"]');
  const trigger = navigationButton(page, 'plans');
  await expect(trigger).toBeVisible();
  await expect(panel).toHaveCount(1);
  await trigger.click();
  await expect(panel).toBeVisible();
}

async function uploadThroughPlans(page, path) {
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/documents') && response.request().method() === 'POST',
    { timeout: 15_000 }
  );
  await page.locator('#plans-upload-input').setInputFiles(path);
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  await expect(page.locator('#plans-notice')).toContainText(/План загружен|Документ обработан|Обработка продолжается/, { timeout: 30_000 });
}

test('Планы: DOCX → новый период → календарь → источник', async ({ page }, testInfo) => {
  const dir = await mkdtemp(join(tmpdir(), `kafedra-plans-ui-${testInfo.project.name}-`));
  const sourcePath = join(dir, `План кафедры ${testInfo.project.name}.docx`);
  try {
    await createPlanDocx(sourcePath);
    await openPlans(page);
    await uploadThroughPlans(page, sourcePath);

    const selected = page.locator('.plan-card.active');
    await expect(selected).toContainText('2025', { timeout: 20_000 });
    await expect(page.locator('#plan-detail')).toContainText('Браузерное заседание кафедры');

    await page.locator('[data-plan-generate-current]').click();
    await expect(page.locator('#plan-generate-modal')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#plan-generation-period')).toHaveValue('2026');
    await expect(page.locator('[data-generation-row]').first().locator('[name="startsAt"]')).toHaveValue('2026-08-15');
    await page.locator('#plan-generation-form button[type="submit"]').click();

    await expect(page.locator('#plan-detail')).toContainText('2026', { timeout: 30_000 });
    await page.locator('#plans-period').selectOption('2026');
    await expect(page.locator('.plan-card').first()).toContainText('2026');
    const generatedRow = page.locator('[data-plan-item-row]').filter({ hasText: 'Браузерное заседание кафедры' }).first();
    await expect(generatedRow).toContainText(/15.*авг.*2026/i);

    const calendarResponse = await page.request.get('/api/calendar?from=2026-08-01&to=2026-08-31&limit=2000');
    expect(calendarResponse.ok()).toBeTruthy();
    const calendarPayload = await calendarResponse.json();
    expect((calendarPayload.items || []).some((item) =>
      item.source_kind === 'plan_item'
      && item.title === 'Браузерное заседание кафедры'
      && String(item.starts_at).slice(0, 10) === '2026-08-15'
    )).toBeTruthy();

    await navigationButton(page, 'calendar').click();
    await expect(page.locator('[data-view-panel="calendar"]')).toBeVisible();
    await navigateCalendarToDate(page, '2026-08-15');
    const event = page.getByRole('button', { name: 'Браузерное заседание кафедры', exact: true }).first();
    await expect(event).toBeVisible({ timeout: 15_000 });
    await event.click();
    await expect(page.locator('#ux-inspector')).toBeVisible();
    await expect(page.locator('#ux-inspector-body')).toContainText('15 августа 2026');
    await expect(page.locator('#ux-inspector-body')).toContainText('План кафедры · 2026');
    await expect(page.locator('#ux-inspector-actions')).toContainText('Исходный документ');
    await page.locator('[data-open-plan-source]').click();
    await expect(page.locator('[data-view-panel="plans"]')).toBeVisible();
    await expect(page.locator('#plan-detail')).toContainText('2026');
    await expect(page.locator('#plan-detail')).toContainText('Браузерное заседание кафедры');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Планы: неоднозначный срок исправляется на месте и отменяется', async ({ page }) => {
  await openPlans(page);
  await uploadThroughPlans(page, resolve('tests/fixtures/plan.txt'));

  await page.locator('#plans-period').selectOption('2026/27');
  const row = page.locator('[data-plan-item-row]').filter({ hasText: 'Подготовить предложения по практике' }).first();
  await expect(row).toContainText('Срок требует уточнения');
  await row.locator('[data-plan-edit-item]').click();
  await expect(page.locator('#plan-item-modal')).toBeVisible();
  await page.locator('#plan-item-form [name="dueDate"]').fill('2026-12-20');
  await page.locator('#plan-item-form [name="reason"]').fill('Уточнено по исходному документу');
  await page.locator('#plan-item-form button[type="submit"]').click();

  const corrected = page.locator('[data-plan-item-row]').filter({ hasText: 'Подготовить предложения по практике' }).first();
  await expect(corrected).toContainText(/20.*дек/i);
  await expect(page.locator('#plans-notice')).toContainText('Исходные данные и доказательство оставлены в истории');
  await page.locator('#plans-notice button').click();
  const restored = page.locator('[data-plan-item-row]').filter({ hasText: 'Подготовить предложения по практике' }).first();
  await expect(restored).toContainText('Срок требует уточнения');
  await expect(page.locator('#plans-notice')).toContainText('Исправление отменено');
});
