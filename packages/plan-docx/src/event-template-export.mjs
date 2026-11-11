import { AppError } from '../../core/src/errors.mjs';
import { PLAN_ACTIVITY_LABELS } from '../../plans/src/activity.mjs';
import { formatRussianDate } from './generator.mjs';
import { bodyChildren, replaceBodyChild, escapeXmlText } from './ooxml-shared.mjs';
import { monthlyPeriod, monthLabel } from './monthly-period.mjs';

export function eventTerm(item) {
  if (item.dateText !== null && item.dateText !== undefined) return String(item.dateText);
  const dates = [];
  if (item.startsAt) dates.push(item.endsAt && item.endsAt !== item.startsAt
    ? `${formatRussianDate(item.startsAt)} — ${formatRussianDate(item.endsAt)}` : formatRussianDate(item.startsAt));
  if (item.dueDate) dates.push(`до ${formatRussianDate(item.dueDate)}`);
  return dates.join('; ');
}

/** The same effective values feed preview validation and the generated document. */
export function eventFieldText(field, item) {
  const values = {
    title: item.title, date: eventTerm(item), responsible: item.responsibleRaw,
    location: item.location, activity: PLAN_ACTIVITY_LABELS[item.activityKind] || '',
    result: item.expectedResult, note: item.note
  };
  const raw = field.source === 'custom' ? item.customValues?.[field.key] : values[field.source];
  if (raw === null || raw === undefined) return '';
  const value = String(raw);
  return field.source === 'custom' && field.type === 'date' && value ? formatRussianDate(value) : value;
}

export function requiredEventFields(snapshot) {
  const fields = snapshot.eventTemplate?.definition?.fields?.filter(field => field.visible !== false && field.required) || [];
  const missing = [];
  snapshot.items.forEach((entry, index) => {
    for (const field of fields) {
      if (!eventFieldText(field, entry.effective).trim()) missing.push({
        itemId: entry.membershipId, planItemId: entry.source?.id, position: index + 1,
        title: entry.effective.title, fieldKey: field.key, label: field.label
      });
    }
  });
  return missing;
}

export function assertEventTemplateComplete(snapshot) {
  const missing = requiredEventFields(snapshot);
  if (missing.length) {
    const examples = missing.slice(0, 4).map(item => `строка ${item.position} — ${item.label}`).join('; ');
    throw new AppError('event_template_required_fields',
      `Заполните обязательные поля: ${examples}${missing.length > 4 ? `; ещё ${missing.length - 4}` : ''}.`, 422, { missing });
  }
}

function xmlText(value) {
  // XML 1.0 forbids control characters even when the source text is valid JSON.
  return escapeXmlText(String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/gu, ''));
}

function paragraph(value, { bold = false, center = false, heading = false } = {}) {
  const runs = String(value ?? '').split(/\r?\n/u).map((line, index) =>
    `${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlText(line)}</w:t>`).join('');
  return `<w:p><w:pPr><w:spacing w:after="80"/>${center ? '<w:jc w:val="center"/>' : ''}</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${bold ? '<w:b/>' : ''}<w:sz w:val="${heading ? 28 : 22}"/></w:rPr>${runs}</w:r></w:p>`;
}

function dimensions(definition) {
  const landscape = definition.layout?.orientation === 'landscape';
  const pageWidth = landscape ? 16838 : 11906;
  const pageHeight = landscape ? 11906 : 16838;
  return { landscape, pageWidth, pageHeight, textWidth: pageWidth - 2268 };
}

function pageSize(definition) {
  const size = dimensions(definition);
  return `<w:pgSz w:w="${size.pageWidth}" w:h="${size.pageHeight}"${size.landscape ? ' w:orient="landscape"' : ''}/>`;
}

function pageMargins() {
  return '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/>';
}

export function eventTemplateTableXml(snapshot) {
  const definition = snapshot.eventTemplate.definition;
  const fields = definition.fields.filter(field => field.visible !== false);
  const numbered = definition.layout?.showRowNumbers !== false;
  const { textWidth } = dimensions(definition);
  const numberWidth = numbered ? 440 : 0;
  const totalWeight = fields.reduce((sum, field) => sum + (Number(field.width) || 20), 0);
  let used = numberWidth;
  const widths = fields.map((field, index) => {
    const width = index === fields.length - 1 ? textWidth - used
      : Math.round((textWidth - numberWidth) * (Number(field.width) || 20) / totalWeight);
    used += width;
    return width;
  });
  if (numbered) widths.unshift(numberWidth);
  const row = (values, header = false) => `<w:tr><w:trPr><w:cantSplit/>${header ? '<w:tblHeader/>' : ''}</w:trPr>${values.map((text, index) =>
    `<w:tc><w:tcPr><w:tcW w:w="${widths[index]}" w:type="dxa"/>${header ? '<w:shd w:fill="F1F3F5"/>' : ''}<w:vAlign w:val="top"/></w:tcPr>${paragraph(text, { bold: header })}</w:tc>`
  ).join('')}</w:tr>`;
  const heading = fields.map(field => field.label);
  if (numbered) heading.unshift('№');
  const rows = snapshot.items.map((item, index) => {
    const values = fields.map(field => eventFieldText(field, item.effective));
    if (numbered) values.unshift(String(index + 1));
    return row(values);
  }).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${textWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => `<w:${side} w:val="single" w:sz="4" w:color="808080"/>`).join('')}</w:tblBorders></w:tblPr><w:tblGrid>${widths.map(width => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${row(heading, true)}${rows}</w:tbl>`;
}

export function renderEventTemplateXml(snapshot) {
  const period = monthlyPeriod(snapshot.month);
  const definition = snapshot.eventTemplate.definition;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${paragraph(snapshot.title, { center: true, bold: true, heading: true })}
${paragraph(`на ${monthLabel(period.month)} ${period.yearStart} года`, { center: true })}
${eventTemplateTableXml(snapshot)}<w:sectPr>${pageSize(definition)}${pageMargins()}</w:sectPr>
</w:body></w:document>`;
}

/** Keep the sample's surrounding text, signatures and package; replace its selected table. */
export function applyEventTemplateToSample(xml, tableIndex, snapshot) {
  const table = bodyChildren(xml).find(child => child.tag === 'tbl' && child.tableIndex === tableIndex);
  if (!table) throw new AppError('event_template_sample_table_changed', 'Таблица образца изменилась. Проверьте настройку образца.', 409);
  let output = replaceBodyChild(xml, table, eventTemplateTableXml(snapshot));
  const updatedTable = bodyChildren(output).find(child => child.tag === 'tbl' && child.tableIndex === tableIndex);
  // A section describes the preceding content. Change the first section following this table only.
  const suffix = output.slice(updatedTable.end);
  const section = /<w:sectPr\b[^>]*\/>|<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/u.exec(suffix);
  if (section) {
    let replacement = section[0].replace(/\/>$/u, '></w:sectPr>');
    const size = pageSize(snapshot.eventTemplate.definition);
    replacement = /<w:pgSz\b[^>]*\/>/u.test(replacement)
      ? replacement.replace(/<w:pgSz\b[^>]*\/>/u, size) : replacement.replace('</w:sectPr>', `${size}</w:sectPr>`);
    replacement = /<w:pgMar\b[^>]*\/>/u.test(replacement)
      ? replacement.replace(/<w:pgMar\b[^>]*\/>/u, pageMargins()) : replacement.replace('</w:sectPr>', `${pageMargins()}</w:sectPr>`);
    const at = updatedTable.end + section.index;
    output = output.slice(0, at) + replacement + output.slice(at + section[0].length);
  } else {
    output = output.replace('</w:body>', `<w:sectPr>${pageSize(snapshot.eventTemplate.definition)}${pageMargins()}</w:sectPr></w:body>`);
  }
  return output;
}
