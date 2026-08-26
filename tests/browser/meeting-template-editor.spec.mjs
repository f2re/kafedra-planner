import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeZipArchive } from '../../packages/plan-docx/src/archive.mjs';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function paragraph(text, runProperties = '', paragraphProperties = '') {
  return `<w:p>${paragraphProperties ? `<w:pPr>${paragraphProperties}</w:pPr>` : ''}<w:r>${runProperties ? `<w:rPr>${runProperties}</w:rPr>` : ''}<w:t>${text}</w:t></w:r></w:p>`;
}

function templateXml(kind) {
  const body = [
    paragraph(kind, '<w:b/>'),
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
  ].join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
}

async function createTemplate(path, kind) {
  await writeZipArchive(path, {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': templateXml(kind)
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

async function uploadAndConfigure(page, kind, fileName, buffer) {
  await page.locator(`[data-meeting-template-upload="${kind}"]`).setInputFiles({
    name: fileName,
    mimeType: DOCX_TYPE,
    buffer
  });
  const selectName = kind === 'protocol' ? 'protocolTemplateVersionId' : 'extractTemplateVersionId';
  await expect(page.locator(`[name="${selectName}"]`)).not.toHaveValue('');
  const field = page.locator(`[data-meeting-template-upload="${kind}"]`).locator('xpath=..');
  const configure = field.locator('[data-configure-meeting-template]');
  await expect(configure).toBeVisible();
  await configure.click();
  await expect(page.locator('.meeting-template-page')).toBeVisible();
  await expect(page.locator('.meeting-template-page')).toContainText('Протокол № 00');
  await expect(page.locator('.meeting-template-element').filter({ hasText: 'Заседание кафедры' })).toHaveCSS('text-align', 'center');
  await expect(page.locator('.meeting-template-run.is-bold').filter({ hasText: 'Заседание кафедры' })).toBeVisible();
  await expect(page.locator('#meeting-template-status')).toContainText('Шаблон готов');
  await expect(page.locator('.meeting-template-binding')).toHaveCount(11);
  await page.locator('#meeting-template-save-profile').click();
  await expect(page.locator('#meeting-notice')).toContainText('Профиль сохранён');
  await page.locator('[data-template-editor-back]').click();
  await expect(page.locator('#meeting-settings-form')).toBeVisible();
  await expect(page.locator(`[name="${selectName}"]`)).not.toHaveValue('');
}

async function addQuestion(page, title, heard, decision) {
  await page.locator('[data-add-manual-question]').click();
  const modal = page.locator('#meeting-modal');
  await modal.locator('[name="title"]').fill(title);
  await modal.locator('[name="heardText"]').fill(heard);
  await modal.locator('[name="decisionText"]').fill(decision);
  await modal.locator('button[type="submit"]').click();
}

test('Заседания: обычный DOCX без маркеров → визуальный профиль → повторяемый протокол', async ({ page }, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), `kafedra-meeting-template-ui-${testInfo.project.name}-`));
  const protocolPath = join(root, 'Обычный протокол.docx');
  const extractPath = join(root, 'Обычная выписка.docx');
  try {
    await createTemplate(protocolPath, 'ПРОТОКОЛ');
    await createTemplate(extractPath, 'ВЫПИСКА ИЗ ПРОТОКОЛА');
    const chair = await createPerson(page, `Иванов Иван ${testInfo.project.name}`, 'заведующий кафедрой');
    const secretary = await createPerson(page, `Петрова Анна ${testInfo.project.name}`, 'секретарь кафедры');

    await page.goto('/');
    await page.waitForFunction(() => document.querySelector('[data-view="meetings"]'), null, { timeout: 12_000 });
    await navigationButton(page).click();
    await page.locator('#meeting-settings-button').click();
    await expect(page.locator('#meeting-settings-form')).toBeVisible();
    await expect(page.locator('#meeting-settings-form .meeting-helper')).toContainText('обычный DOCX');

    await uploadAndConfigure(page, 'protocol', 'Обычный протокол.docx', await readFile(protocolPath));
    await uploadAndConfigure(page, 'extract', 'Обычная выписка.docx', await readFile(extractPath));

    await page.locator('[name="quorum"]').fill('5');
    await page.locator('[name="chairpersonPersonId"]').selectOption(chair.id);
    await page.locator('[name="secretaryPersonId"]').selectOption(secretary.id);
    await page.locator('#meeting-settings-form button[type="submit"]').click();
    await expect(page.locator('#meeting-modal')).toBeHidden();

    await page.locator('#meeting-create-button').click();
    const number = testInfo.project.name === 'mobile' ? '502' : '501';
    await page.locator('#meeting-create-form [name="meetingDate"]').fill('2026-10-15');
    await page.locator('#meeting-create-form [name="protocolNumber"]').fill(number);
    await page.locator('#meeting-create-form button[type="submit"]').click();

    await addQuestion(page, 'Об утверждении плана кафедры', 'Заслушали заведующего кафедрой', 'Утвердить план кафедры');
    await addQuestion(page, 'О научной работе', 'Заслушали секретаря кафедры', 'Принять информацию к сведению');
    await expect(page.locator('[data-agenda-item]')).toHaveCount(2);

    await page.locator('[data-generate-protocol]').click();
    await expect(page.locator('.meeting-document strong').filter({ hasText: /^Протокол$/ })).toHaveCount(1);
    await page.locator('[data-generate-protocol]').click();
    await expect(page.locator('.meeting-document strong').filter({ hasText: /^Протокол$/ })).toHaveCount(1);

    const meetingsResponse = await page.request.get('/api/meetings');
    const meetings = await meetingsResponse.json();
    const meeting = meetings.items.find((item) => item.protocol_number === number);
    expect(meeting).toBeTruthy();
    const detailResponse = await page.request.get(`/api/meetings/${encodeURIComponent(meeting.id)}`);
    const detail = await detailResponse.json();
    const evidence = JSON.parse(detail.evidence_json);
    expect(evidence.templateProfiles.protocol.profileSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(evidence.templateProfiles.extract.profileSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(detail.documents.filter((document) => document.document_kind === 'protocol')).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
