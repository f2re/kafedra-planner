import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeZipArchive } from '../../packages/plan-docx/src/archive.mjs';

function cell(text) {
  return `<w:tc><w:tcPr><w:tcW w:w="1700" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}
function row(values) { return `<w:tr>${values.map(cell).join('')}</w:tr>`; }
function planXml(responsibleName, taskTitle) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>ПЛАН РАБОТЫ КАФЕДРЫ</w:t></w:r></w:p>
<w:p><w:r><w:t>на 2026 календарный год</w:t></w:r></w:p>
<w:tbl>
${row(['№', 'Мероприятие', 'Срок проведения', 'Ответственный', 'Результат'])}
${row(['1', taskTitle, 'до 20 декабря 2026', responsibleName, 'Отчёт'])}
</w:tbl><w:sectPr/></w:body></w:document>`;
}
async function createDocx(path, responsibleName, taskTitle) {
  await writeZipArchive(path, {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': planXml(responsibleName, taskTitle)
  });
}

function navigationButton(page, view) {
  const mobile = Number(page.viewportSize()?.width || 0) <= 720;
  return mobile ? page.locator(`.mobile-tab[data-view="${view}"]`) : page.locator(`.nav-item[data-view="${view}"]`);
}

async function waitForUploadedDocument(page, originalName) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await page.request.get(`/api/documents?lifecycle=all&limit=1000&q=${encodeURIComponent(originalName)}`);
    if (response.ok()) {
      const payload = await response.json();
      const document = (payload.items || []).find((entry) => entry.original_name === originalName);
      if (document) return document;
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`Загруженный документ «${originalName}» не появился за 30 секунд.`);
}

async function waitForImportedPlan(page, documentId, taskTitle) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const listResponse = await page.request.get('/api/plans?limit=1000');
    if (listResponse.ok()) {
      const list = await listResponse.json();
      const summary = (list.items || []).find((entry) => entry.source_document_id === documentId);
      if (summary) {
        const detailResponse = await page.request.get(`/api/plans/${encodeURIComponent(summary.id)}`);
        if (detailResponse.ok()) {
          const plan = await detailResponse.json();
          const item = (plan.items || []).find((entry) => entry.title === taskTitle);
          if (item) return { plan, item };
        }
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`План для загруженного документа ${documentId} не появился за 30 секунд.`);
}

test('Автоматическое назначение: сотрудник из плана сразу получает поручение, а форма периодической задачи не занимает экран', async ({ page }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const dir = await mkdtemp(join(tmpdir(), `kafedra-auto-assignment-${suffix}-`));
  const fileName = `Автоплан ${suffix}.docx`;
  const file = join(dir, fileName);
  try {
    const responsibleName = `Авто Исполнитель ${suffix}`;
    const taskTitle = `Подготовить автоматический отчёт кафедры ${suffix}`;
    await createDocx(file, responsibleName, taskTitle);
    const personResponse = await page.request.post('/api/people', { data: { displayName: responsibleName } });
    expect(personResponse.ok()).toBeTruthy();
    const person = await personResponse.json();

    await page.goto('/');
    await page.waitForFunction(() => typeof window.kafedraSetView === 'function', null, { timeout: 12_000 });
    await navigationButton(page, 'plans').click();
    await expect(page.locator('[data-view-panel="plans"]')).toBeVisible();

    await page.locator('#plans-upload-input').setInputFiles(file);
    const uploaded = await waitForUploadedDocument(page, fileName);
    expect(uploaded.id).toBeTruthy();

    const { plan, item } = await waitForImportedPlan(page, uploaded.id, taskTitle);
    await expect(page.locator(`.plan-card.active[data-plan-id="${plan.id}"]`)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#plan-source-workbench')).toBeVisible({ timeout: 30_000 });

    expect(item.responsible_person_id).toBe(person.id);
    expect(item.execution_mode).toBe('assigned');
    expect(item.assignment).toBeTruthy();
    expect(item.assignment.executors.some((entry) => entry.role === 'executor' && entry.person_id === person.id)).toBeTruthy();

    const planRow = page.locator(`[data-plan-item-row="${item.id}"]`);
    await expect(planRow.locator('[data-auto-assignment-status]')).toHaveText('Назначен', { timeout: 12_000 });

    const openAssignment = planRow.locator('[data-plan-open-assignment]');
    await expect(openAssignment).toBeVisible({ timeout: 15_000 });
    await openAssignment.click();
    await expect(page.locator('#standalone-assignment-inspector')).toContainText(taskTitle, { timeout: 15_000 });
    await expect(page.locator('#standalone-assignment-inspector')).toContainText('Задача из плана');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
