import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeZipArchive } from '../../packages/plan-docx/src/archive.mjs';

function cell(text) {
  return `<w:tc><w:tcPr><w:tcW w:w="1500" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}
function row(values) { return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${values.map(cell).join('')}</w:tr>`; }
function planXml(responsibleName) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>ПЛАН РАБОТЫ КАФЕДРЫ</w:t></w:r></w:p>
<w:p><w:r><w:t>на 2026 календарный год</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>
${row(['№', 'Мероприятие', 'Основание', 'Срок проведения', 'Ответственный', 'Результат'])}
${row(['1', 'Подготовить материалы и провести обсуждение', 'Решение учёного совета № 7', 'до 20 октября 2026', responsibleName, 'Комплект материалов'])}
</w:tbl><w:sectPr/></w:body></w:document>`;
}
async function createDocx(path, responsibleName) {
  await writeZipArchive(path, {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': planXml(responsibleName)
  });
}

function navigationButton(page, view) {
  const mobile = Number(page.viewportSize()?.width || 0) <= 720;
  return mobile ? page.locator(`.mobile-tab[data-view="${view}"]`) : page.locator(`.nav-item[data-view="${view}"]`);
}

async function openPlans(page) {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.kafedraSetView === 'function', null, { timeout: 12_000 });
  await navigationButton(page, 'plans').click();
  await expect(page.locator('[data-view-panel="plans"]')).toBeVisible();
}

async function createPerson(page, displayName) {
  const response = await page.request.post('/api/people', { data: { displayName } });
  expect(response.ok()).toBeTruthy();
  return await response.json();
}

test('DOCX с русским именем: строка плана → автополя → две задачи → несколько исполнителей', async ({ page }, testInfo) => {
  const dir = await mkdtemp(join(tmpdir(), `kafedra-source-row-ui-${testInfo.project.name}-`));
  const sourcePath = join(dir, 'План кафедры — рабочий 2026.docx');
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  try {
    const responsibleName = `Иванов Иван ${testInfo.project.name}`;
    await createDocx(sourcePath, responsibleName);
    const manager = await createPerson(page, `Руководитель ${testInfo.project.name}`);
    const ivanov = await createPerson(page, responsibleName);
    const petrov = await createPerson(page, `Петров Пётр ${testInfo.project.name}`);
    await openPlans(page);

    await expect(page.locator('.plan-more-filters > summary')).toContainText('Фильтры');
    const uploadResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/documents') && response.request().method() === 'POST',
      { timeout: 15_000 }
    );
    await page.locator('#plans-upload-input').setInputFiles(sourcePath);
    expect((await uploadResponse).ok()).toBeTruthy();
    await expect(page.locator('#plan-source-workbench')).toBeVisible({ timeout: 30_000 });
    expect(browserErrors.some((message) => message.includes('Headers constructor'))).toBeFalsy();

    const sourceRow = page.locator('[data-plan-source-row]').filter({ hasText: 'Подготовить материалы и провести обсуждение' }).first();
    await expect(sourceRow).toBeVisible();
    await sourceRow.click();
    const form = page.locator('#plan-source-form');
    await expect(form).toBeVisible();
    await expect(form.locator('[data-source-task="0"] [name="title"]')).toHaveValue('Подготовить материалы и провести обсуждение');
    await expect(form.locator('[data-source-task="0"] [name="dueDate"]')).toHaveValue('2026-10-20');
    await expect(form.locator('[data-source-task="0"] [name="responsibleRaw"]')).toHaveValue(responsibleName);

    const first = form.locator('[data-source-task="0"]');
    await first.locator('[name="executionMode"]').selectOption('assigned');
    await first.locator(`[name="executor"][value="${ivanov.id}"]`).check();
    await first.locator(`[name="executor"][value="${petrov.id}"]`).check();
    await first.locator('[name="controllerPersonId"]').selectOption(manager.id);

    await form.locator('[data-source-task-add]').click();
    const second = form.locator('[data-source-task="1"]');
    await expect(second).toBeVisible();
    await second.locator('[name="title"]').fill('Провести обсуждение материалов');
    await second.locator('[name="dueDate"]').fill('2026-10-25');
    await second.locator('[name="responsibleRaw"]').fill(petrov.display_name);
    await second.locator('[name="executionMode"]').selectOption('assigned');
    await second.locator(`[name="executor"][value="${petrov.id}"]`).check();
    await second.locator('[name="controllerPersonId"]').selectOption(manager.id);

    await form.locator('button[type="submit"]').click();
    await expect(page.locator('#plans-notice')).toContainText(/Сохранено задач: 2|Календарь и поручения обновлены/, { timeout: 15_000 });

    const activeId = await page.locator('.plan-card.active').getAttribute('data-plan-id');
    const planResponse = await page.request.get(`/api/plans/${encodeURIComponent(activeId)}`);
    expect(planResponse.ok()).toBeTruthy();
    const plan = await planResponse.json();
    const split = plan.items.filter((item) =>
      ['Подготовить материалы и провести обсуждение', 'Провести обсуждение материалов'].includes(item.title)
    );
    expect(split).toHaveLength(2);
    expect(split.every((item) => String(item.description || '').includes('Решение учёного совета № 7'))).toBeTruthy();
    const firstStored = split.find((item) => item.title === 'Подготовить материалы и провести обсуждение');
    expect(firstStored.assignment.executors.filter((item) => ['executor','coexecutor'].includes(item.role))).toHaveLength(2);

    const rowsResponse = await page.request.get(`/api/plans/${encodeURIComponent(activeId)}/source-rows`);
    expect(rowsResponse.ok()).toBeTruthy();
    const rows = await rowsResponse.json();
    const savedRow = rows.items.find((item) => item.rawText.includes('Подготовить материалы и провести обсуждение'));
    expect(savedRow.items).toHaveLength(2);

    const calendarResponse = await page.request.get('/api/calendar?from=2026-10-01&to=2026-10-31&limit=2000');
    const calendar = await calendarResponse.json();
    expect(calendar.items.some((item) => item.source_kind === 'plan_item' && item.starts_at === '2026-10-25')).toBeTruthy();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
