import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeZipArchive } from '../../packages/plan-docx/src/archive.mjs';

function navigationButton(page, view) {
  const mobile = Number(page.viewportSize()?.width || 0) <= 720;
  return mobile ? page.locator(`.mobile-tab[data-view="${view}"]`) : page.locator(`.nav-item[data-view="${view}"]`);
}

async function createBadTemplate(path) {
  await writeZipArchive(path, {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Образец без поля таблицы</w:t></w:r></w:p><w:sectPr/></w:body></w:document>'
  });
}

async function uploadScience(page, suffix, year) {
  await navigationButton(page, 'documents').click();
  await page.locator('#file-input').setInputFiles({
    name: `science-report-source-${suffix}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from(`УДК 551.509\nИванов И.И.\nНаучный отчётный материал ${suffix}\nЖурнал Метеорология, ${year}\nDOI: 10.2000/${suffix}\nПубликация входит в ВАК и РИНЦ.`, 'utf8')
  });
  await expect.poll(async () => {
    const payload = await (await page.request.get(`/api/science?q=${encodeURIComponent(`Научный отчётный материал ${suffix}`)}`)).json();
    return payload.items?.length || 0;
  }, { timeout: 30_000 }).toBeGreaterThan(0);
}

async function uploadTemplate(page, path, name) {
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/documents') && response.request().method() === 'POST'
  );
  await navigationButton(page, 'documents').click();
  await page.locator('#file-input').setInputFiles(path);
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  await expect.poll(async () => {
    const payload = await (await page.request.get('/api/documents?limit=500')).json();
    return payload.items?.find((item) => item.original_name === name)?.processing_status;
  }, { timeout: 30_000 }).toMatch(/processed|needs_review/);
}

test.beforeEach(async ({ page }, testInfo) => {
  page.on('pageerror', (error) => console.log(`[science-reports:${testInfo.project.name}:pageerror] ${error.stack || error.message}`));
  page.on('console', (message) => {
    if (['error','warning'].includes(message.type())) console.log(`[science-reports:${testInfo.project.name}:${message.type()}] ${message.text()}`);
  });
});

test('Наука: фильтры → поля → ошибка образца без потери ввода → CSV', async ({ page }, testInfo) => {
  const dir = await mkdtemp(join(tmpdir(), `kafedra-science-report-${testInfo.project.name}-`));
  const templateName = `bad-science-template-${testInfo.project.name}.docx`;
  const templatePath = join(dir, templateName);
  const reportYear = testInfo.project.name.includes('mobile') ? '2028' : '2027';
  try {
    await createBadTemplate(templatePath);
    await page.goto('/');
    await page.waitForFunction(() => typeof window.kafedraSetView === 'function', null, { timeout: 12_000 });
    await uploadScience(page, testInfo.project.name, reportYear);
    await uploadTemplate(page, templatePath, templateName);

    await navigationButton(page, 'science').click();
    await expect(page.locator('[data-science-report-open]')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-science-report-open]').click();
    const form = page.locator('[data-science-report-form]');
    await expect(form).toBeVisible();
    await form.locator('[name="title"]').fill(`Научный отчёт ${testInfo.project.name}`);
    await form.locator('[name="yearFrom"]').fill(reportYear);
    await form.locator('[name="yearTo"]').fill(reportYear);
    await form.locator('[name="classification"]').fill('ВАК');
    await form.locator('[data-science-report-preview-button]').click();
    await expect(form.locator('[data-science-report-preview]')).toContainText('1', { timeout: 15_000 });
    await expect(form.locator('[data-science-report-preview]')).toContainText(`Научный отчётный материал ${testInfo.project.name}`);

    const templateSelect = form.locator('[name="templateDocumentId"]');
    const templateOption = templateSelect.locator('option').filter({ hasText: 'bad-science-template' }).first();
    const templateValue = await templateOption.getAttribute('value');
    expect(templateValue).toBeTruthy();
    await templateSelect.selectOption(templateValue);
    await form.locator('button[type="submit"]').click();
    await expect(form.locator('[data-science-report-error]')).toContainText('{{SCIENCE_TABLE}}', { timeout: 20_000 });
    await expect(form.locator('[name="title"]')).toHaveValue(`Научный отчёт ${testInfo.project.name}`);

    await form.locator('[name="format"]').selectOption('csv');
    await expect(form.locator('[data-science-template-field]')).toHaveClass(/hidden/);
    const responsePromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/science-reports') && response.request().method() === 'POST',
      { timeout: 30_000 }
    );
    await form.locator('button[type="submit"]').click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    const run = await response.json();
    expect(run.row_count).toBe(1);
    await expect(page.locator('#science-report-modal')).toContainText('1');
    await expect(page.locator('#science-report-modal')).toContainText('строк в отчёте');

    const content = await page.request.get(`/api/documents/${encodeURIComponent(run.generated_document_id)}/content?variant=original`);
    expect(content.ok()).toBeTruthy();
    const csv = (await content.body()).toString('utf8');
    expect(csv).toContain(`Научный отчётный материал ${testInfo.project.name}`);
    expect(csv).toContain('Доказательства');

    const repeated = await page.request.post('/api/science-reports', {
      data: {
        title: run.title,
        format: run.format,
        filters: run.filters,
        fields: run.fields,
        templateDocumentId: templateValue,
        idempotencyKey: run.idempotency_key
      }
    });
    expect(repeated.ok()).toBeTruthy();
    expect((await repeated.json()).generated_document_id).toBe(run.generated_document_id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
