import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeZipArchive } from '../../packages/plan-docx/src/archive.mjs';

function cell(text) {
  return `<w:tc><w:tcPr><w:tcW w:w="1700" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}
function row(values) { return `<w:tr>${values.map(cell).join('')}</w:tr>`; }
function planXml(responsibleName) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>ПЛАН РАБОТЫ КАФЕДРЫ</w:t></w:r></w:p>
<w:p><w:r><w:t>на 2026 календарный год</w:t></w:r></w:p>
<w:tbl>
${row(['№', 'Мероприятие', 'Срок проведения', 'Ответственный', 'Результат'])}
${row(['1', 'Подготовить автоматический отчёт кафедры', 'до 20 декабря 2026', responsibleName, 'Отчёт'])}
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

test('Автоматическое назначение: сотрудник из плана сразу получает поручение, а форма периодической задачи не занимает экран', async ({ page }, testInfo) => {
  const dir = await mkdtemp(join(tmpdir(), `kafedra-auto-assignment-${testInfo.project.name}-`));
  const fixtureVariant = testInfo.project.name === 'mobile' ? 'Мобильный' : 'Настольный';
  const file = join(dir, `Автоплан ${fixtureVariant}.docx`);
  try {
    // Суффикс должен участвовать в нормализации ФИО. Латинские desktop/mobile
    // отбрасываются предметным matcher и делают второй проект зависимым от первого.
    const responsibleName = `Авто Исполнитель ${fixtureVariant}`;
    await createDocx(file, responsibleName);
    const personResponse = await page.request.post('/api/people', { data: { displayName: responsibleName } });
    expect(personResponse.ok()).toBeTruthy();
    const person = await personResponse.json();

    await page.goto('/');
    await page.waitForFunction(() => typeof window.kafedraSetView === 'function', null, { timeout: 12_000 });
    await navigationButton(page, 'plans').click();
    await expect(page.locator('[data-view-panel="plans"]')).toBeVisible();
    await page.locator('#plans-upload-input').setInputFiles(file);
    await expect(page.locator('#plan-source-workbench')).toBeVisible({ timeout: 30_000 });

    const planId = await page.locator('.plan-card.active').getAttribute('data-plan-id');
    const planResponse = await page.request.get(`/api/plans/${encodeURIComponent(planId)}`);
    expect(planResponse.ok()).toBeTruthy();
    const plan = await planResponse.json();
    const item = plan.items.find((entry) => entry.title === 'Подготовить автоматический отчёт кафедры');
    expect(item).toBeTruthy();
    expect(item.responsible_person_id).toBe(person.id);
    expect(item.execution_mode).toBe('assigned');
    expect(item.assignment).toBeTruthy();
    expect(item.assignment.executors.some((entry) => entry.role === 'executor' && entry.person_id === person.id)).toBeTruthy();

    const planRow = page.locator(`[data-plan-item-row="${item.id}"]`);
    await expect(planRow.locator('[data-auto-assignment-status]')).toHaveText('Назначен', { timeout: 12_000 });

    await navigationButton(page, 'work').click();
    await expect(page.locator('[data-view-panel="work"]')).toBeVisible();
    const workCard = page.locator('.work-card[data-work-kind="assignment"]').filter({ hasText: 'Подготовить автоматический отчёт кафедры' }).first();
    await expect(workCard).toBeVisible({ timeout: 15_000 });
    await expect(workCard.locator('.work-pill')).toHaveText('поручение из плана', { timeout: 12_000 });

    const periodicForm = page.locator('#periodic-task-form');
    await expect(periodicForm).not.toBeVisible();
    const createPeriodic = page.locator('#work-create-periodic');
    await expect(createPeriodic).toBeVisible();
    await createPeriodic.click();
    await expect(periodicForm).toBeVisible();
    await expect(periodicForm.locator('select[name="managerPersonId"] option[value=""]')).toHaveText('Определить по структуре');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
