import { test, expect } from '@playwright/test';
import { createZip } from '../../packages/plans/src/docx-generator.mjs';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function templateDocx(token = '2025') {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>План работы кафедры на ${token} год</w:t></w:r></w:p>
<w:tbl>
<w:tr><w:tc><w:p><w:r><w:t>№ п/п</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Мероприятие</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Дата проведения</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Контрольный срок</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Ответственный</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Ожидаемый результат</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Направление</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Строка-образец</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>01.01.${token}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>02.01.${token}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Иванов И.И.</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Результат</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Организация</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl><w:p/></w:body></w:document>`;
  const contentTypes = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>';
  return createZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes) },
    { name: 'word/document.xml', data: Buffer.from(documentXml) }
  ]);
}

async function openView(page, view) {
  const mobile = page.locator(`.mobile-tab[data-view="${view}"]:visible`);
  if (await mobile.count()) await mobile.click();
  else await page.locator(`.nav-item[data-view="${view}"]:visible`).click();
  await expect(page.locator(`[data-view-panel="${view}"]`)).toBeVisible();
}

async function browserToday(page) {
  return page.evaluate(() => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return { year, iso: `${year}-${month}-${day}` };
  });
}

async function addTemplate(page, suffix) {
  await page.getByRole('button', { name: 'Добавить DOCX' }).click();
  await page.locator('#plan-template-file').setInputFiles({
    name: `plan-template-${suffix}.docx`,
    mimeType: DOCX_TYPE,
    buffer: templateDocx('2025')
  });
  await page.getByRole('button', { name: 'Проанализировать' }).click();
  await expect(page.getByRole('heading', { name: 'Проверить шаблон' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[name="yearToken"]')).toHaveValue('2025');
  await expect(page.locator('[name="tableIndex"]')).toHaveValue('1');
  await page.locator('[name="name"]').fill(`План кафедры ${suffix}`);
  await page.getByRole('button', { name: 'Сохранить шаблон' }).click();
  await expect(page.getByText(`План кафедры ${suffix}`, { exact: true })).toBeVisible();
}

async function generatePlan(page, suffix) {
  const today = await browserToday(page);
  const card = page.locator('.plan-template-card', { hasText: `План кафедры ${suffix}` });
  await card.getByRole('button', { name: 'Использовать' }).click();
  await expect(page.getByRole('heading', { name: 'Сформировать план' })).toBeVisible();
  await page.locator('#gen-period').fill(String(today.year));
  const row = page.locator('[data-plan-row]').first();
  await row.locator('[name="title"]').fill(`Заседание кафедры ${suffix}`);
  await row.locator('[name="startsAt"]').fill(today.iso);
  await row.locator('[name="responsible"]').fill('Иванов Иван Иванович');
  await row.locator('[name="result"]').fill('Протокол заседания');
  await page.getByRole('button', { name: 'Сформировать DOCX' }).click();
  await expect(page.locator('#plans-dialog')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('.plan-card', { hasText: `Заседание кафедры ${suffix}` })).toBeVisible({ timeout: 20_000 });
  return today;
}

test('план из DOCX-шаблона формируется и показывает источник в календаре', async ({ page }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  await page.goto('/');
  await openView(page, 'plans');
  await expect(page.locator('[data-view-panel="plans"] h2')).toHaveText('Планы');
  await addTemplate(page, suffix);
  const today = await generatePlan(page, suffix);

  const plansResponse = await page.request.get(`/api/plans?period=${today.year}`);
  expect(plansResponse.ok()).toBeTruthy();
  const plans = await plansResponse.json();
  const generated = plans.items.find((item) => item.title.includes(String(today.year)));
  expect(generated).toBeTruthy();
  expect(generated.plan_scope).toBe('department');

  const sourceResponse = await page.request.get('/api/plans/calendar-sources');
  const sources = (await sourceResponse.json()).items;
  const source = sources.find((item) => item.plan_id === generated.id);
  expect(source).toBeTruthy();
  expect(source.scopeLabel).toBe('План кафедры');
  expect(source.source_document_id).toBeTruthy();

  await openView(page, 'calendar');
  const event = page.locator(`[data-calendar-item="${source.calendar_item_id}"]`);
  await expect(event).toBeVisible({ timeout: 15_000 });
  await expect(event).toHaveClass(/from-plan/);
  if (testInfo.project.name === 'desktop') await expect(event).toHaveAttribute('data-plan-origin', 'кафедры');
  await event.click();
  await expect(page.locator('#ux-inspector')).toBeVisible();
  await expect(page.locator('#ux-inspector-body')).toContainText('План кафедры');
  await expect(page.getByRole('button', { name: 'Открыть план' })).toBeVisible();
});
