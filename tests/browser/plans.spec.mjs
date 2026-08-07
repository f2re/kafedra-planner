import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeZipArchive } from '../../packages/plan-docx/src/archive.mjs';

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
<w:p><w:r><w:t>на </w:t></w:r><w:r><w:t>2026</w:t></w:r><w:r><w:t>/</w:t></w:r><w:r><w:t>2027</w:t></w:r><w:r><w:t> учебный год</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>
${row(['№', 'Мероприятие', 'Срок проведения', 'Ответственный', 'Результат'])}
${row(['1', 'Браузерное заседание кафедры', '15 сентября 2026', 'Иванов Иван Иванович', 'Протокол'])}
</w:tbl><w:sectPr/></w:body></w:document>`;
}

async function createPlanDocx(path) {
  await writeZipArchive(path, {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': planXml()
  });
}

async function openPlans(page) {
  await page.goto('/');
  const trigger = page.locator('[data-view="plans"]:visible').first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.locator('[data-view-panel="plans"]')).toBeVisible();
}

async function uploadThroughPlans(page, path) {
  await page.locator('#plans-upload-input').setInputFiles(path);
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
    await expect(selected).toContainText('2026/27', { timeout: 20_000 });
    await expect(page.locator('#plan-detail')).toContainText('Браузерное заседание кафедры');

    await page.locator('[data-plan-generate-current]').click();
    await expect(page.locator('#plan-generate-modal')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#plan-generation-period')).toHaveValue('2027/28');
    await expect(page.locator('[data-generation-row]').first().locator('[name="startsAt"]')).toHaveValue('2027-09-15');
    await page.locator('#plan-generation-form button[type="submit"]').click();

    await expect(page.locator('#plan-detail')).toContainText('2027/28', { timeout: 30_000 });
    await page.locator('#plans-period').selectOption('2027/28');
    await expect(page.locator('.plan-card').first()).toContainText('2027/28');

    const calendarTrigger = page.locator('[data-view="calendar"]:visible').first();
    await calendarTrigger.click();
    await expect(page.locator('[data-view-panel="calendar"]')).toBeVisible();
    for (let index = 0; index < 13; index += 1) await page.locator('#next-period').click();
    await expect(page.locator('#calendar-title')).toContainText(/сентябр/i);
    const event = page.getByRole('button', { name: 'Браузерное заседание кафедры', exact: true }).first();
    await expect(event).toBeVisible();
    await event.click();
    await expect(page.locator('#ux-inspector')).toBeVisible();
    await expect(page.locator('#ux-inspector-body')).toContainText('План кафедры · 2027/28');
    await page.locator('[data-open-plan-source]').click();
    await expect(page.locator('[data-view-panel="plans"]')).toBeVisible();
    await expect(page.locator('#plan-detail')).toContainText('2027/28');
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
