import { findRussianDates, firstRussianDate } from './russian-date.mjs';

const labels = ['СЛУШАЛИ', 'СЛУШАЛ', 'ВЫСТУПИЛИ', 'ВЫСТУПИЛ', 'ОБСУДИЛИ', 'РЕШИЛИ', 'ПОСТАНОВИЛИ'];
const labelPattern = new RegExp(`^\\s*(${labels.join('|')})\\s*[:.]?\\s*(.*)$`, 'iu');

function linesWithNumbers(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((raw, index) => ({
      no: index + 1,
      raw,
      text: raw.replace(/\s+/g, ' ').trim()
    }));
}

function findLabeledValue(lines, labelExpression, maxLines = 80) {
  const pattern = new RegExp(`^\\s*(?:${labelExpression})\\s*[:–—-]?\\s*(.*)$`, 'iu');
  for (const line of lines.slice(0, maxLines)) {
    const match = line.text.match(pattern);
    if (!match) continue;
    const value = match[1]?.trim();
    if (value) return { value, lineStart: line.no, lineEnd: line.no };
    const following = lines.find((candidate) => candidate.no === line.no + 1 && candidate.text);
    if (following) return { value: following.text, lineStart: line.no, lineEnd: following.no };
  }
  return null;
}

function detectProtocolNumber(lines) {
  const head = lines.slice(0, 40).map((line) => line.text).join('\n');
  const direct = head.match(/протокол(?:\s+заседания[^\n]*)?\s*№\s*([\p{L}\d./-]+)/iu);
  if (direct) return direct[1];
  const isolated = head.match(/^\s*№\s*([\p{L}\d./-]+)\s*$/imu);
  return isolated?.[1] ?? null;
}

function detectMeetingDate(lines) {
  const topText = lines.slice(0, 60).map((line) => line.text).join('\n');
  return firstRussianDate(topText)?.value ?? null;
}

function splitNumberedItems(lines) {
  const startIndex = lines.findIndex((line) => /повестк[аи]\s+дня/iu.test(line.text));
  const scan = startIndex >= 0 ? lines.slice(startIndex + 1) : lines;
  const starts = [];
  for (let index = 0; index < scan.length; index += 1) {
    const match = scan[index].text.match(/^\s*(\d{1,3})[.)]\s+(.+)/u);
    if (!match) continue;
    if (Number(match[1]) === 1 || starts.length > 0) {
      starts.push({ scanIndex: index, itemNo: Number(match[1]), heading: match[2].trim() });
    }
  }
  if (starts.length === 0) return [];
  return starts.map((start, index) => {
    const next = starts[index + 1];
    const segment = scan.slice(start.scanIndex, next?.scanIndex ?? scan.length);
    return parseAgendaSegment(start.itemNo, start.heading, segment);
  });
}

function appendField(fields, key, text) {
  if (!text) return;
  fields[key] = fields[key] ? `${fields[key]}\n${text}` : text;
}

function parseAgendaSegment(itemNo, heading, segment) {
  const fields = { heardText: '', discussedText: '', decisionText: '' };
  let current = 'title';
  const titleLines = [heading];
  for (let index = 1; index < segment.length; index += 1) {
    const line = segment[index];
    if (!line.text) continue;
    const labelMatch = line.text.match(labelPattern);
    if (labelMatch) {
      const label = labelMatch[1].toUpperCase();
      if (label.startsWith('СЛУШАЛ')) current = 'heardText';
      else if (label.startsWith('ВЫСТУП') || label.startsWith('ОБСУД')) current = 'discussedText';
      else current = 'decisionText';
      appendField(fields, current, labelMatch[2]?.trim());
      continue;
    }
    if (current === 'title' && titleLines.length < 4) titleLines.push(line.text);
    else if (current !== 'title') appendField(fields, current, line.text);
  }
  const decisionText = fields.decisionText.trim();
  const dates = findRussianDates(decisionText);
  const responsible = decisionText.match(/ответственн(?:ый|ая|ые|ого|ым|ыми)?\s*[:–—-]\s*([^\n]+)/iu)?.[1]?.trim().replace(/[;,]+$/u, '') ?? null;
  return {
    itemNo,
    title: titleLines.join(' ').replace(/\s+/g, ' ').trim(),
    heardText: fields.heardText.trim() || null,
    discussedText: fields.discussedText.trim() || null,
    decisionText: decisionText || null,
    responsibleRaw: responsible,
    dueDate: dates[0]?.value ?? null,
    evidence: {
      lineStart: segment[0]?.no ?? null,
      lineEnd: segment.at(-1)?.no ?? null
    }
  };
}

function fallbackSingleItem(lines) {
  const labelIndexes = lines
    .map((line, index) => ({ line, index, match: line.text.match(labelPattern) }))
    .filter((entry) => entry.match);
  if (labelIndexes.length === 0) return [];
  return [parseAgendaSegment(1, 'Вопрос заседания', lines.slice(Math.max(0, labelIndexes[0].index - 1)))];
}

function confidenceOf(result) {
  let score = 0.2;
  if (result.protocolNumber) score += 0.2;
  if (result.meetingDate) score += 0.25;
  if (result.agendaItems.length > 0) score += 0.2;
  if (result.agendaItems.some((item) => item.decisionText)) score += 0.1;
  if (result.chairperson || result.secretary) score += 0.05;
  return Math.min(1, Number(score.toFixed(2)));
}

export function looksLikeDepartmentProtocol(text) {
  const lines = linesWithNumbers(text).filter((line) => line.text);
  const heading = lines.slice(0, 12).map((line) => line.text).join('\n');
  const head = lines.slice(0, 80).map((line) => line.text).join('\n');
  const hasProtocolHeading = /(^|\n)\s*протокол(?:\s+заседания[^\n]*)?(?:\s*№\s*[\p{L}\d./-]+)?\s*(?:$|\n)/imu.test(heading);
  if (!hasProtocolHeading) return false;
  return /повестк[аи]\s+дня|слушали|решили|постановили|председатель|секретарь|присутствовали/iu.test(head)
    || /протокол\s+заседания\s+кафедр/iu.test(heading);
}

export function extractDepartmentProtocol(text) {
  const lines = linesWithNumbers(text);
  const agendaItems = splitNumberedItems(lines);
  const result = {
    protocolNumber: detectProtocolNumber(lines),
    meetingDate: detectMeetingDate(lines),
    title: 'Заседание кафедры',
    chairperson: findLabeledValue(lines, 'председатель(?:ствовал)?')?.value ?? null,
    secretary: findLabeledValue(lines, 'секретарь')?.value ?? null,
    attendees: findLabeledValue(lines, 'присутствовали')?.value ?? null,
    agendaItems: agendaItems.length > 0 ? agendaItems : fallbackSingleItem(lines),
    evidence: {
      lineStart: 1,
      lineEnd: lines.length
    }
  };
  return { ...result, confidence: confidenceOf(result) };
}
