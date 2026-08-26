import { createHash } from 'node:crypto';
import {
  DOCUMENT_XML,
  bodyChildren,
  replaceBodyChild,
  replaceVisibleText,
  wordVisibleText
} from '../../plan-docx/src/ooxml-shared.mjs';
import { readZipEntry, rewriteZipArchive } from '../../plan-docx/src/archive.mjs';
import { renderVisualMeetingTemplateXml } from './meeting-template-profile.mjs';

const GLOBAL_MARKERS = Object.freeze({
  '{{DOCUMENT_KIND}}': (model) => model.documentKind,
  '{{PROTOCOL_NUMBER}}': (model) => model.protocolNumber,
  '{{MEETING_DATE}}': (model) => model.meetingDate,
  '{{MEETING_TITLE}}': (model) => model.meetingTitle,
  '{{CHAIRPERSON}}': (model) => model.chairperson,
  '{{SECRETARY}}': (model) => model.secretary,
  '{{QUORUM}}': (model) => model.quorum
});

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function clean(value) {
  return String(value ?? '').replace(/\r\n?/gu, '\n').trim();
}

function russianDate(value) {
  const text = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) return text;
  const date = new Date(`${text}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  }).format(date);
}

function replaceEveryVisible(xml, marker, value) {
  let result = String(xml || '');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const replaced = replaceVisibleText(result, marker, value);
    result = replaced.xml;
    if (!replaced.changed) return result;
  }
  fail('meeting_template_marker_loop');
}

function agendaLines(item) {
  const lines = [`${item.item_no}. ${clean(item.title)}`];
  const sections = [
    ['СЛУШАЛИ:', item.heard_text],
    ['ОБСУДИЛИ:', item.discussed_text],
    ['РЕШИЛИ:', item.decision_text]
  ];
  for (const [label, value] of sections) {
    const text = clean(value);
    if (!text) continue;
    const parts = text.split('\n').map((part) => part.trim()).filter(Boolean);
    if (!parts.length) continue;
    lines.push(`${label} ${parts[0]}`);
    for (const part of parts.slice(1)) lines.push(part);
  }
  return lines;
}

export function meetingDocumentModel({ meeting, items, kind }) {
  const documentKind = kind === 'extract' ? 'ВЫПИСКА ИЗ ПРОТОКОЛА' : 'ПРОТОКОЛ';
  return {
    documentKind,
    protocolNumber: clean(meeting.protocol_number),
    meetingDate: russianDate(meeting.meeting_date),
    meetingTitle: clean(meeting.title),
    chairperson: clean(meeting.chairperson_raw),
    secretary: clean(meeting.secretary_raw),
    quorum: meeting.quorum_required ? String(meeting.quorum_required) : '',
    items: items.map((item) => ({
      id: item.id,
      item_no: Number(item.item_no),
      title: clean(item.title),
      heard_text: clean(item.heard_text),
      discussed_text: clean(item.discussed_text),
      decision_text: clean(item.decision_text)
    }))
  };
}

export function meetingDocumentText(model) {
  const header = [
    model.documentKind,
    `Протокол № ${model.protocolNumber || '—'} от ${model.meetingDate || '—'}`,
    model.meetingTitle,
    model.chairperson ? `Председатель: ${model.chairperson}` : null,
    model.secretary ? `Секретарь: ${model.secretary}` : null,
    model.quorum ? `Кворум: ${model.quorum}` : null
  ].filter(Boolean);
  return [...header, '', ...model.items.flatMap((item) => [...agendaLines(item), ''])].join('\n').trim();
}

function hashPayload(templateSha256, model, kind, profileSha256) {
  const meeting = {
    protocolNumber: model.protocolNumber,
    meetingDate: model.meetingDate,
    meetingTitle: model.meetingTitle,
    chairperson: model.chairperson,
    secretary: model.secretary,
    quorum: model.quorum
  };
  if (!profileSha256) {
    return { schema: 1, kind, templateSha256, meeting, items: model.items };
  }
  return { schema: 2, kind, templateSha256, profileSha256, meeting, items: model.items };
}

export function meetingDocumentHash({ templateSha256, profileSha256 = null, model, kind }) {
  return createHash('sha256')
    .update(JSON.stringify(hashPayload(templateSha256, model, kind, profileSha256)))
    .digest('hex');
}

export function validateMeetingTemplateXml(templateXml) {
  const agendaParagraph = bodyChildren(String(templateXml || '')).find((child) =>
    child.tag === 'p' && wordVisibleText(child.xml).trim() === '{{AGENDA}}'
  );
  if (!agendaParagraph) fail('meeting_template_agenda_marker_required');
  return true;
}

export async function validateMeetingTemplateFile(templatePath) {
  const templateXml = (await readZipEntry(templatePath, DOCUMENT_XML)).toString('utf8');
  validateMeetingTemplateXml(templateXml);
  return true;
}

function legacyMeetingDocumentXml(templateXml, model) {
  let xml = String(templateXml || '');
  for (const [marker, getter] of Object.entries(GLOBAL_MARKERS)) {
    xml = replaceEveryVisible(xml, marker, getter(model));
  }
  validateMeetingTemplateXml(xml);
  const agendaParagraph = bodyChildren(xml).find((child) =>
    child.tag === 'p' && wordVisibleText(child.xml).trim() === '{{AGENDA}}'
  );
  if (!model.items.length) fail('meeting_agenda_empty');

  const paragraphs = [];
  for (const item of model.items) {
    for (const line of agendaLines(item)) {
      const rendered = replaceVisibleText(agendaParagraph.xml, '{{AGENDA}}', line);
      if (!rendered.changed) fail('meeting_template_agenda_marker_required');
      paragraphs.push(rendered.xml);
    }
  }
  return replaceBodyChild(xml, agendaParagraph, paragraphs.join(''));
}

function profileGlobalValues(model) {
  return {
    document_kind: model.documentKind,
    protocol_number: model.protocolNumber,
    meeting_date: model.meetingDate,
    meeting_title: model.meetingTitle,
    chairperson: model.chairperson,
    secretary: model.secretary,
    quorum: model.quorum
  };
}

function profileAgendaValues(model) {
  return model.items.map((item) => ({
    item_no: String(item.item_no),
    title: item.title,
    heard: item.heard_text,
    discussed: item.discussed_text,
    decision: item.decision_text
  }));
}

export function renderMeetingDocumentXml(templateXml, model, profile = null) {
  if (profile) {
    return renderVisualMeetingTemplateXml(
      templateXml,
      profile,
      profileGlobalValues(model),
      profileAgendaValues(model)
    );
  }
  return legacyMeetingDocumentXml(templateXml, model);
}

export async function renderMeetingDocumentFile({ templatePath, outputPath, model, profile = null }) {
  const templateXml = (await readZipEntry(templatePath, DOCUMENT_XML)).toString('utf8');
  const renderedXml = renderMeetingDocumentXml(templateXml, model, profile);
  await rewriteZipArchive(templatePath, outputPath, { [DOCUMENT_XML]: renderedXml });
  return { xml: renderedXml, text: meetingDocumentText(model) };
}
