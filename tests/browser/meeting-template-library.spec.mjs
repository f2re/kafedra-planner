import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeZipArchive } from '../../packages/plan-docx/src/archive.mjs';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function paragraph(text, runProperties = '', paragraphProperties = '') {
  return `<w:p>${paragraphProperties ? `<w:pPr>${paragraphProperties}</w:pPr>` : ''}<w:r>${runProperties ? `<w:rPr>${runProperties}</w:rPr>` : ''}<w:t>${text}</w:t></w:r></w:p>`;
}

function templateXml(kind, variant) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${[
    paragraph(`${kind} · ${variant}`, '<w:b/>'),
    paragraph('Протокол № 00'),
    paragraph('Дата: 15 сентября 2026 года'),
    paragraph('Заседание кафедры', '<w:b/><w:sz w:val="28"/>', '<w:jc w:val="center"/>'),
    paragraph('Председатель: Иванов И.И.'),
    paragraph('Секретарь: Петрова А.А.'),
    paragraph('Кворум: 5 человек'),
    paragraph('1. Вопрос повестки', '<w:b/>', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr>'),
    paragraph('СЛУШАЛИ: Текст слушали', '<w:i/>'),
    paragraph('ОБСУДИЛИ: Текст обсуждения'),
    paragraph('РЕШИЛИ: Текст решения', '<w:u w:val="single"/>')
  ].join('')}<w:sectPr/></w:body></w:document>`;
}

async function createTemplate(path, kind, variant) {
  await writeZipArchive(path, {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': templateXml(kind, variant)
  });
}

function navigationButton(page) {
  return Number(page.viewportSize()?.width || 0) <= 720
    ? page.locator('.mobile-tab[data-view="meetings"]')
    : page.locator('.nav-item[data-view="meetings"]');
}

async function createPerson(page, displayName, position) {
  const response = await page.request.post('/api/people', { data: { displayName, position } });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function uploadConfigure(page, kind, name, buffer) {
  const upload = page.locator(`[data-meeting-template-upload="${kind}"]`);
  await upload.setInputFiles({ name, mimeType: DOCX_TYPE, buffer });
  const configure = page.locator(`[data-configure-meeting-template="${kind}"]`);
  await expect(configure).toBeEnabled();
  await configure.click();
  await expect(page.locator('#meeting-template-status')).toContainText('Шаблон готов');
  await page.locator('#meeting-template-save-profile').click();
  await expect(page.locator('#meeting-notice')).toContainText('Профиль сохранён');
  await page.locator('[data-template-editor-back]').click();
  await expect(page.locator('#meeting-settings-form')).toBeVisible();
}

function protocolSeriesCards(page, variant) {
  return page.locator('.meeting-template-library-card').filter({ hasText: `Протокол ${variant} v1.docx` });
}

function libraryCard(page, variant, version) {
  return protocolSeriesCards(page, variant).filter({ hasText: `Версия ${version}` }).first();
}

test('Шаблоны заседаний: версии, тест двумя вопросами, основной, impact, архив и восстановление', async ({ page }, testInfo) => {
  const variant = testInfo.project.name === 'mobile' ? 'Мобильный' : 'Настольный';
  const root = await mkdtemp(join(tmpdir(), `kafedra-meeting-template-library-ui-${testInfo.project.name}-`));
  const protocolOne = join(root, `Протокол ${variant} v1.docx`);
  const protocolTwo = join(root, `Протокол ${variant} v2.docx`);
  const extract = join(root, `Выписка ${variant}.docx`);
  try {
    await createTemplate(protocolOne, 'ПРОТОКОЛ', `${variant} первая форма`);
    await createTemplate(protocolTwo, 'ПРОТОКОЛ', `${variant} новая форма`);
    await createTemplate(extract, 'ВЫПИСКА', variant);
    const chair = await createPerson(page, `${variant} Председатель`, 'заведующий кафедрой');
    const secretary = await createPerson(page, `${variant} Секретарь`, 'секретарь кафедры');

    await page.goto('/');
    await page.waitForFunction(() => document.querySelector('[data-view="meetings"]'), null, { timeout: 12_000 });
    await navigationButton(page).click();
    await page.locator('#meeting-settings-button').click();
    await uploadConfigure(page, 'protocol', `Протокол ${variant} v1.docx`, await readFile(protocolOne));
    await uploadConfigure(page, 'extract', `Выписка ${variant}.docx`, await readFile(extract));
    await page.locator('[name="quorum"]').fill('5');
    await page.locator('[name="chairpersonPersonId"]').selectOption(chair.id);
    await page.locator('[name="secretaryPersonId"]').selectOption(secretary.id);
    await page.locator('#meeting-settings-form button[type="submit"]').click();
    await expect(page.locator('#meeting-modal')).toBeHidden();

    const number = variant === 'Мобильный' ? '612' : '611';
    const created = await page.request.post('/api/meetings', {
      data: { meetingDate: '2026-11-20', protocolNumber: number, title: `Заседание ${variant}` }
    });
    expect(created.ok()).toBeTruthy();
    const meeting = await created.json();
    const agenda = await page.request.post(`/api/meetings/${encodeURIComponent(meeting.id)}/agenda`, {
      data: { title: 'Вопрос до смены шаблона', heardText: 'Доклад', decisionText: 'Решение' }
    });
    expect(agenda.ok()).toBeTruthy();

    await page.locator('#meeting-settings-button').click();
    await expect(page.locator('[data-open-template-library]')).toBeVisible();
    await page.locator('[data-open-template-library]').click();
    await expect(page.locator('#meeting-template-library-list')).toBeVisible();
    await expect(protocolSeriesCards(page, variant)).toHaveCount(1);
    await expect(page.locator('.meeting-template-library-card').filter({ hasText: `Выписка ${variant}.docx` })).toHaveCount(1);
    const first = libraryCard(page, variant, 1);
    await expect(first).toContainText('Основной');
    await expect(first).toContainText('Готов');

    await first.locator('[data-template-library-test]').click();
    await expect(page.locator('.meeting-template-test-body')).toContainText('Первый проверочный вопрос');
    await expect(page.locator('.meeting-template-test-body')).toContainText('Второй проверочный вопрос');
    await expect(page.locator('.meeting-template-test-body a').filter({ hasText: 'Скачать тестовый DOCX' })).toBeVisible();
    await expect(page.locator('.meeting-template-test-body')).toContainText(/PDF-preview|Открыть PDF-preview/u);
    await page.locator('[data-return-template-library]').click();
    await expect(page.locator('#meeting-template-library-list')).toBeVisible();

    await libraryCard(page, variant, 1).locator('[data-template-library-version]').click();
    await page.locator('#meeting-template-library-version-file').setInputFiles({
      name: `Протокол ${variant} v2.docx`, mimeType: DOCX_TYPE, buffer: await readFile(protocolTwo)
    });
    await expect(page.locator('#meeting-template-status')).toContainText('Шаблон готов');
    await page.locator('#meeting-template-save-profile').click();
    await expect(page.locator('#meeting-notice')).toContainText('Профиль сохранён');
    await page.locator('[data-template-editor-back]').click();
    await expect(page.locator('#meeting-template-library-list')).toBeVisible();
    await expect(protocolSeriesCards(page, variant)).toHaveCount(2);
    const second = libraryCard(page, variant, 2);
    await expect(second).toContainText('Готов');
    await second.locator('[data-template-library-default]').click();
    await expect(libraryCard(page, variant, 2)).toContainText('Основной');

    const generated = await page.request.post(`/api/meetings/${encodeURIComponent(meeting.id)}/documents`, { data: { kind: 'protocol' } });
    expect(generated.ok()).toBeTruthy();
    const detail = await page.request.get(`/api/meetings/${encodeURIComponent(meeting.id)}`);
    const meetingDetail = await detail.json();
    expect(meetingDetail.documents[0].template_version_no).toBe(1);

    await libraryCard(page, variant, 1).locator('[data-template-library-archive]').click();
    await expect(page.locator('.meeting-template-impact')).toContainText('1');
    await page.locator('#meeting-template-archive-form [name="reason"]').fill('Заменён новой утверждённой формой');
    await page.locator('#meeting-template-archive-form button[type="submit"]').click();
    await expect(page.locator('#meeting-template-library-list')).toBeVisible();
    await expect(libraryCard(page, variant, 1)).toHaveCount(0);
    await page.locator('[data-template-library-filter="archived"]').click();
    const archived = libraryCard(page, variant, 1);
    await expect(archived).toContainText('Архив');
    await expect(archived).toContainText('Заменён новой утверждённой формой');
    await archived.locator('[data-template-library-restore]').click();
    await expect(page.locator('#meeting-template-library-list')).toBeVisible();
    await page.locator('[data-template-library-filter="active"]').click();
    await expect(libraryCard(page, variant, 1)).toBeVisible();

    await page.locator('[data-close-meeting-modal]').click();
    await page.reload();
    await navigationButton(page).click();
    await page.locator(`[data-meeting-id="${meeting.id}"]`).click();
    await expect(page.locator('#meeting-detail')).toContainText('Шаблон:');
    await expect(page.locator('#meeting-detail')).toContainText('версия 1');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
