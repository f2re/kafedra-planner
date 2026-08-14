import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeZipArchive } from '../../packages/plan-docx/src/archive.mjs';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function templateXml(kind) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>${kind}</w:t></w:r></w:p>
<w:p><w:r><w:t>Протокол №</w:t></w:r><w:r><w:t>{{PROTOCOL_NUMBER}}</w:t></w:r></w:p>
<w:p><w:r><w:t>{{MEETING_DATE}}</w:t></w:r></w:p>
<w:p><w:r><w:t>Председатель: </w:t></w:r><w:r><w:t>{{CHAIRPERSON}}</w:t></w:r></w:p>
<w:p><w:r><w:t>Секретарь: </w:t></w:r><w:r><w:t>{{SECRETARY}}</w:t></w:r></w:p>
<w:p><w:r><w:t>{{AGENDA}}</w:t></w:r></w:p>
<w:sectPr/></w:body></w:document>`;
}

async function createTemplate(path, kind) {
  await writeZipArchive(path, {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': templateXml(kind)
  });
}

function navigationButton(page) {
  const mobile = Number(page.viewportSize()?.width || 0) <= 720;
  return mobile
    ? page.locator('.mobile-tab[data-view="meetings"]')
    : page.locator('.nav-item[data-view="meetings"]');
}

async function createPerson(page, displayName, position) {
  const response = await page.request.post('/api/people', { data: { displayName, position } });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function addQuestion(page, number) {
  await page.locator('[data-add-manual-question]').click();
  const modal = page.locator('#meeting-modal');
  await expect(modal).toBeVisible();
  await modal.locator('[name="title"]').fill(`Вопрос ${number}`);
  if (number === 4 || number === 8) {
    await modal.locator('[name="heardText"]').fill(`Заслушали доклад по вопросу ${number}`);
    await modal.locator('[name="decisionText"]').fill(`Одобрить решение по вопросу ${number}`);
  }
  await modal.locator('button[type="submit"]').click();
  await expect(page.locator('[data-agenda-item]')).toHaveCount(number);
}

test('Заседания: настройки → 8 вопросов → выписка по №4 и №8 → протокол', async ({ page }, testInfo) => {
  const dir = await mkdtemp(join(tmpdir(), `kafedra-meetings-ui-${testInfo.project.name}-`));
  const protocolPath = join(dir, 'Шаблон протокола.docx');
  const extractPath = join(dir, 'Шаблон выписки.docx');
  try {
    await createTemplate(protocolPath, 'ПРОТОКОЛ');
    await createTemplate(extractPath, 'ВЫПИСКА ИЗ ПРОТОКОЛА');

    const chair = await createPerson(page, 'Иванов Иван Иванович', 'заведующий кафедрой');
    const secretary = await createPerson(page, 'Петрова Анна Сергеевна', 'секретарь кафедры');

    await page.goto('/');
    await page.waitForFunction(() => document.querySelector('[data-view="meetings"]'), null, { timeout: 12_000 });
    const trigger = navigationButton(page);
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.locator('[data-view-panel="meetings"]')).toBeVisible();

    await page.locator('#meeting-settings-button').click();
    await expect(page.locator('#meeting-settings-form')).toBeVisible();

    await page.locator('[data-meeting-template-upload="protocol"]').setInputFiles({
      name: 'Шаблон протокола.docx', mimeType: DOCX_TYPE, buffer: await readFile(protocolPath)
    });
    await expect(page.locator('[name="protocolTemplateVersionId"] option')).toHaveCount(2);
    await expect(page.locator('[name="protocolTemplateVersionId"]')).not.toHaveValue('');

    await page.locator('[data-meeting-template-upload="extract"]').setInputFiles({
      name: 'Шаблон выписки.docx', mimeType: DOCX_TYPE, buffer: await readFile(extractPath)
    });
    await expect(page.locator('[name="extractTemplateVersionId"] option')).toHaveCount(3);
    await expect(page.locator('[name="extractTemplateVersionId"]')).not.toHaveValue('');

    await page.locator('[name="quorum"]').fill('5');
    await page.locator('[name="chairpersonPersonId"]').selectOption(chair.id);
    await page.locator('[name="secretaryPersonId"]').selectOption(secretary.id);
    await page.locator('#meeting-settings-form button[type="submit"]').click();
    await expect(page.locator('#meeting-modal')).toBeHidden();
    await expect(page.locator('#meeting-settings-summary')).toContainText('Кворум 5');
    await expect(page.locator('#meeting-settings-summary')).toContainText('Петрова Анна Сергеевна');

    await page.locator('#meeting-create-button').click();
    await page.locator('#meeting-create-form [name="meetingDate"]').fill('2026-09-15');
    await page.locator('#meeting-create-form [name="protocolNumber"]').fill('7');
    await page.locator('#meeting-create-form button[type="submit"]').click();
    await expect(page.locator('#meeting-detail')).toContainText('Протокол №7');
    await expect(page.locator('#meeting-detail')).toContainText('Петрова Анна Сергеевна');

    for (let number = 1; number <= 8; number += 1) await addQuestion(page, number);
    const agenda = page.locator('[data-agenda-item]');
    await expect(agenda).toHaveCount(8);

    await agenda.nth(3).locator('[data-extract-item]').check();
    await agenda.nth(7).locator('[data-extract-item]').check();
    await expect(page.locator('[data-generate-extract]')).toContainText('Выписка · 2');
    await page.locator('[data-generate-extract]').click();
    await expect(page.locator('.meeting-document').filter({ hasText: 'Выписка · вопросы 4,8' })).toHaveCount(1);

    await page.locator('[data-generate-protocol]').click();
    await expect(page.locator('.meeting-document').filter({ hasText: 'Протокол' })).toHaveCount(1);

    const meetingResponse = await page.request.get('/api/meetings');
    expect(meetingResponse.ok()).toBeTruthy();
    const meetings = await meetingResponse.json();
    expect(meetings.items).toHaveLength(1);
    const detailResponse = await page.request.get(`/api/meetings/${encodeURIComponent(meetings.items[0].id)}`);
    expect(detailResponse.ok()).toBeTruthy();
    const detail = await detailResponse.json();
    expect(detail.agenda.map((item) => item.item_no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(detail.documents.some((document) => document.document_kind === 'extract' && document.question_numbers === '4,8')).toBeTruthy();
    expect(detail.documents.some((document) => document.document_kind === 'protocol')).toBeTruthy();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
