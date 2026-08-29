import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeZipArchive } from '../../packages/plan-docx/src/archive.mjs';

function cell(text) {
  return `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}

function row(values) {
  return `<w:tr>${values.map(cell).join('')}</w:tr>`;
}

async function createDocx(path, paragraphs, rows = []) {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')}
${rows.length ? `<w:tbl>${rows.map(row).join('')}</w:tbl>` : ''}
<w:sectPr/></w:body></w:document>`;
  await writeZipArchive(path, {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': documentXml
  });
}

function sourceDocumentId(item) {
  return item?.source_document_id
    || item?.sourceDocumentId
    || item?.origin_document_id
    || item?.originDocumentId
    || item?.source_document?.id
    || item?.sourceDocument?.id
    || item?.source_document_version?.document_id
    || item?.sourceDocumentVersion?.documentId
    || null;
}

function meetingHasDocument(item, documentId) {
  if (sourceDocumentId(item) === documentId) return true;
  if (item?.protocol_document_id === documentId || item?.protocolDocumentId === documentId) return true;
  return (item?.documents || item?.meeting_documents || []).some((document) =>
    (document.document_id || document.documentId || document.id) === documentId
  );
}

async function upload(page, path, name, documentType) {
  const response = await page.request.post('/api/documents', {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'x-file-name': encodeURIComponent(name),
      'x-document-type': documentType,
      'idempotency-key': `grace-real-intake-${documentType}-${name}`
    },
    data: await readFile(path)
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const payload = await response.json();
  return payload.documentId || payload.document_id || payload.document?.id || payload.id;
}

test('реальный DOCX-план материализуется сразу и повтор не создаёт второй план', async ({ page }, testInfo) => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-grace-plan-'));
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const path = join(dir, `План кафедры ${suffix}.docx`);
  try {
    await createDocx(path, [
      'ПЛАН РАБОТЫ КАФЕДРЫ',
      'на 2026 год'
    ], [
      ['№', 'Мероприятие', 'Срок', 'Ответственный', 'Результат'],
      ['1', `Подготовить материалы ${suffix}`, '15 сентября 2026', 'Иванов Иван Иванович', 'Материалы подготовлены'],
      ['2', `Неоднозначная строка ${suffix}`, 'в течение года', '', 'Комментарий']
    ]);

    const documentId = await upload(page, path, `План кафедры ${suffix}.docx`, 'department_plan');
    expect(documentId).toBeTruthy();

    let planId = null;
    await expect.poll(async () => {
      const response = await page.request.get('/api/plans?status=all&limit=1000');
      if (!response.ok()) return null;
      const payload = await response.json();
      const plan = (payload.items || payload.plans || []).find((item) => sourceDocumentId(item) === documentId);
      planId = plan?.id || null;
      return planId;
    }, { timeout: 45_000 }).not.toBeNull();

    const detail = await (await page.request.get(`/api/plans/${encodeURIComponent(planId)}`)).json();
    expect(detail.items?.some((item) => item.title.includes(`Подготовить материалы ${suffix}`))).toBeTruthy();
    expect(detail.items?.some((item) => item.title.includes(`Неоднозначная строка ${suffix}`))).toBeTruthy();

    await upload(page, path, `План кафедры ${suffix}.docx`, 'department_plan');
    const plans = await (await page.request.get('/api/plans?status=all&limit=1000')).json();
    expect((plans.items || plans.plans || []).filter((item) => sourceDocumentId(item) === documentId)).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('реальный DOCX-протокол создаёт заседание без подтверждения импорта', async ({ page }, testInfo) => {
  const dir = await mkdtemp(join(tmpdir(), 'kafedra-grace-meeting-'));
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const path = join(dir, `Протокол заседания ${suffix}.docx`);
  try {
    await createDocx(path, [
      'ПРОТОКОЛ ЗАСЕДАНИЯ КАФЕДРЫ № 7',
      'от 20 августа 2026 года',
      'ПРИСУТСТВОВАЛИ: Иванов И.И., Петров П.П.',
      'ПОВЕСТКА ДНЯ',
      `1. Обсуждение плана работы ${suffix}`,
      'СЛУШАЛИ: Иванова И.И.',
      'РЕШИЛИ: включить мероприятия в календарь.'
    ]);

    const documentId = await upload(page, path, `Протокол заседания ${suffix}.docx`, 'department_protocol');
    expect(documentId).toBeTruthy();

    let meeting = null;
    await expect.poll(async () => {
      const response = await page.request.get('/api/meetings?status=all&limit=1000');
      if (!response.ok()) return null;
      const payload = await response.json();
      meeting = (payload.items || payload.meetings || []).find((item) => meetingHasDocument(item, documentId)) || null;
      return meeting?.id || null;
    }, { timeout: 45_000 }).not.toBeNull();

    expect(String(meeting.number || meeting.meeting_number || '')).toContain('7');
    const detailResponse = await page.request.get(`/api/meetings/${encodeURIComponent(meeting.id)}`);
    expect(detailResponse.ok(), await detailResponse.text()).toBeTruthy();
    const detail = await detailResponse.json();
    const agenda = detail.agenda_items || detail.agendaItems || detail.items || [];
    expect(agenda.some((item) => String(item.title || item.topic || item.text || '').includes(suffix))).toBeTruthy();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
