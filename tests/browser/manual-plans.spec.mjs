import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeZipArchive } from '../../packages/plan-docx/src/archive.mjs';

function cell(text) {
  return `<w:tc><w:tcPr><w:tcW w:w="1800" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}

function row(values) {
  return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${values.map(cell).join('')}</w:tr>`;
}

async function createPlanDocx(path) {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>ПЛАН РАБОТЫ КАФЕДРЫ</w:t></w:r></w:p>
<w:p><w:r><w:t>на </w:t></w:r><w:r><w:t>2025</w:t></w:r><w:r><w:t> год</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>
${row(['№', 'Мероприятие', 'Срок проведения', 'Ответственный', 'Результат'])}
${row(['1', 'Мероприятие образца', '15 августа 2025', 'Иванов Иван Иванович', 'Протокол'])}
</w:tbl><w:sectPr/></w:body></w:document>`;
  await writeZipArchive(path, {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': documentXml
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
  await navigationButton(page, 'plans').click();
  await expect(page.locator('[data-view-panel="plans"]')).toBeVisible();
}

async function uploadTemplateSource(page, path) {
  const upload = page.waitForResponse(
    (response) => response.url().endsWith('/api/documents') && response.request().method() === 'POST',
    { timeout: 15_000 }
  );
  await page.locator('#plans-upload-input').setInputFiles(path);
  expect((await upload).ok()).toBeTruthy();
  await expect(page.locator('#plan-detail')).toContainText('Мероприятие образца', { timeout: 30_000 });
  await page.locator('[data-plan-make-template]').click();
  await expect(page.locator('#plans-notice')).toContainText(/Образец готов|Образец сохранён/, { timeout: 20_000 });
}

async function createPerson(page, displayName) {
  const response = await page.request.post('/api/people', { data: { displayName } });
  expect(response.ok()).toBeTruthy();
  return await response.json();
}

test.beforeEach(async ({ page }, testInfo) => {
  page.on('pageerror', (error) => console.log(`[manual-plans:${testInfo.project.name}:pageerror] ${error.stack || error.message}`));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      console.log(`[manual-plans:${testInfo.project.name}:${message.type()}] ${message.text()}`);
    }
  });
});

test('Планы: ручной план → календарь → поручение → документ → DOCX', async ({ page }, testInfo) => {
  const dir = await mkdtemp(join(tmpdir(), `kafedra-manual-plan-ui-${testInfo.project.name}-`));
  const sourcePath = join(dir, `План кафедры образец ${testInfo.project.name}.docx`);
  try {
    await createPlanDocx(sourcePath);
    const executor = await createPerson(page, `Исполнитель ${testInfo.project.name}`);
    await openPlans(page);
    await uploadTemplateSource(page, sourcePath);

    await page.locator('[data-manual-create-plan]').click();
    await expect(page.locator('#manual-plan-modal')).toBeVisible();
    await page.locator('#manual-plan-create-form [name="title"]').fill(`Ручной план ${testInfo.project.name}`);
    await page.locator('#manual-plan-create-form [name="yearStart"]').fill('2026');
    await page.locator('#manual-plan-create-form button[type="submit"]').click();
    await expect(page.locator('#plan-detail')).toContainText(`Ручной план ${testInfo.project.name}`, { timeout: 15_000 });
    await expect(page.locator('#plan-detail .plan-link-button')).toHaveCount(0);
    await expect(page.locator('[data-manual-add-item]')).toBeVisible();

    await navigationButton(page, 'calendar').click();
    await expect(page.locator('[data-view-panel="calendar"]')).toBeVisible();
    await expect(page.locator('[data-manual-calendar-add]')).toBeVisible();
    await page.locator('[data-manual-calendar-add]').click();
    const planOption = page.locator('#manual-calendar-plan-select option')
      .filter({ hasText: `Ручной план ${testInfo.project.name}` }).first();
    const planValue = await planOption.getAttribute('value');
    expect(planValue).toBeTruthy();
    await page.locator('#manual-calendar-plan-select').selectOption(planValue);
    await page.locator('[data-manual-calendar-plan-next]').click();
    await page.locator('#manual-plan-item-form [name="title"]').fill('Подготовить годовой отчёт');
    await page.locator('#manual-plan-item-form [name="startsAt"]').fill('2026-09-10');
    await page.locator('#manual-plan-item-form [name="dueDate"]').fill('2026-09-20');
    await page.locator('#manual-plan-item-form [name="executionMode"]').selectOption('assigned');
    await page.locator(`#manual-plan-item-form input[name="executorPersonIds"][value="${executor.id}"]`).check();
    await page.locator('#manual-plan-item-form [name="expectedResult"]').fill('Годовой отчёт');
    await page.locator('#manual-plan-item-form button[type="submit"]').click();

    await navigationButton(page, 'plans').click();
    await expect(page.locator('#plan-detail')).toContainText('Подготовить годовой отчёт', { timeout: 15_000 });
    const itemRow = page.locator('[data-plan-item-row]').filter({ hasText: 'Подготовить годовой отчёт' }).first();
    await expect(itemRow).toContainText('Режим: Поручение');
    await expect(itemRow).toContainText(`Исполнители: Исполнитель ${testInfo.project.name}`);

    await itemRow.locator('[data-manual-support]').click();
    await expect(page.locator('#manual-support-form')).toBeVisible();
    await page.locator('#manual-support-form [name="documentNumber"]').fill('12-03/26');
    await page.locator('#manual-support-form [name="documentDate"]').fill('2026-09-19');
    await page.locator('#manual-support-form [name="title"]').fill('Подтверждение выполнения');
    await page.locator('#manual-support-form button[type="submit"]').click();
    await expect(page.locator('#plan-detail')).toContainText('Документы · 1', { timeout: 15_000 });

    const generate = page.locator('[data-manual-plan-generate]').first();
    await expect(generate).toBeVisible();
    await generate.click();
    await expect(page.locator('#manual-plan-generate-form')).toBeVisible();
    const generationResponse = page.waitForResponse(
      (response) => /\/api\/plans\/[^/]+\/generate$/.test(new URL(response.url()).pathname)
        && response.request().method() === 'POST',
      { timeout: 30_000 }
    );
    await page.locator('#manual-plan-generate-form button[type="submit"]').click();
    const generated = await generationResponse;
    expect(generated.ok()).toBeTruthy();
    const generation = await generated.json();
    expect(generation.generated_document_id).toBeTruthy();

    const calendarResponse = await page.request.get('/api/calendar?from=2026-09-01&to=2026-09-30&limit=2000');
    expect(calendarResponse.ok()).toBeTruthy();
    const calendar = await calendarResponse.json();
    expect((calendar.items || []).some((item) =>
      item.source_kind === 'plan_item'
      && item.title === 'Подготовить годовой отчёт'
      && item.origin_document_id === null
      && item.starts_at === '2026-09-10'
    )).toBeTruthy();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
