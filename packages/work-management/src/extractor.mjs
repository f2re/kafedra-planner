import { firstRussianDate } from '../../protocols/src/russian-date.mjs';

const ALLOWED_KINDS = new Set(['decree', 'directive', 'order']);
const KIND_PATTERNS = [
  ['decree', /\bуказ\b/iu],
  ['directive', /\bраспоряжени[ея]\b/iu],
  ['order', /\bприказ\b/iu]
];
const COMMAND_MARKER = /^(?:приказываю|распоряжаюсь|поручаю|обязываю|постановляю)\s*:?[\s]*(.*)$/iu;
const NUMBERED_ITEM = /^\s*(\d+(?:\.\d+)*)[.)]\s+(.+)$/u;
const ACTION_PATTERN = /(?:поручить|обязать|обеспечить|подготовить|представить|направить|организовать|разработать|сформировать|утвердить|разместить|назначить|провести|выполнить|предоставить|доложить|осуществить|установить|принять|создать)\w*/iu;
const FOOTER_PATTERN = /^(?:с\s+(?:приказом|распоряжением|указом)\s+ознакомлен|основание\s*:)/iu;
const SIGNATURE_ROLE_PATTERN = /^(?:ректор|директор|начальник|заведующ(?:ий|ая)|председатель)\b/iu;
const INITIALS_NAME_PATTERN = /(?:(?:[А-ЯЁ]\.){1,2}\s*[А-ЯЁ][а-яё-]+|[А-ЯЁ][а-яё-]+\s+(?:[А-ЯЁ]\.){1,2})/u;

function normalize(value) {
  return String(value || '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
}

function normalized(value) {
  return normalize(value).toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
}

function normalizePersonName(value) {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^а-яa-z0-9\s-]/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanPersonRaw(value) {
  return String(value || '')
    .trim()
    .replace(/^[–—-]+|[;,]+$/gu, '')
    .replace(/(?<=[а-яё])\.$/u, '')
    .trim();
}

function linesOf(text) {
  return normalize(text).split('\n').map((text, index) => ({ number: index + 1, text: text.trim() }));
}

function lineEvidence(line, raw = line?.text || null) {
  if (!line) return null;
  return { raw, locator: { startLine: line.number, endLine: line.number } };
}

function directiveKind(lines, requestedType = null) {
  const requested = ALLOWED_KINDS.has(requestedType) ? requestedType : null;
  for (const line of lines.slice(0, 25)) {
    const found = KIND_PATTERNS.find(([, pattern]) => pattern.test(line.text));
    if (found) return { value: requested || found[0], evidence: lineEvidence(line, line.text), detected: found[0] };
  }
  return requested ? { value: requested, evidence: { source: 'operator_request', requestedType: requested }, detected: null } : null;
}

function documentNumber(lines) {
  for (const line of lines.slice(0, 35)) {
    const match = /(?:№|N|No\.?|номер)\s*([А-ЯA-Z0-9][А-ЯA-Zа-яё0-9./_-]*)/iu.exec(line.text);
    if (match?.[1]) return { value: match[1], evidence: lineEvidence(line, match[0]) };
  }
  return null;
}

function issuedAt(lines) {
  for (const line of lines.slice(0, 40)) {
    const parsed = firstRussianDate(line.text);
    if (parsed) return { value: parsed.value, evidence: lineEvidence(line, parsed.raw) };
  }
  return null;
}

function issuer(lines) {
  const candidates = lines.filter((line) => /(?:ректор|директор|руководител|начальник|заведующ|председател)\w*/iu.test(line.text));
  if (!candidates.length) return null;
  const explicit = candidates.find((line) => /(?:подписал|издал|руководитель|ректор|директор)\s*[:—-]/iu.test(line.text));
  const selected = explicit || candidates.at(-1);
  return { value: selected.text.slice(0, 300), evidence: lineEvidence(selected, selected.text.slice(0, 300)) };
}

function titleOf(lines, markerIndex) {
  const header = lines.slice(0, markerIndex < 0 ? 45 : markerIndex);
  const explicit = header.find((line) => /^о\s+.{5,}$/iu.test(line.text));
  if (explicit) return { value: explicit.text, evidence: lineEvidence(explicit) };
  const excluded = /^(?:указ|приказ|распоряжение|№|от\s+\d|г\.|город|москва|санкт-петербург)/iu;
  const candidates = header
    .filter((line) => line.text.length >= 8 && !excluded.test(line.text) && !firstRussianDate(line.text));
  const selected = candidates.at(-1);
  return selected
    ? { value: selected.text, evidence: lineEvidence(selected) }
    : { value: 'Распорядительный документ', evidence: null };
}

function isSignatureOrFooter(text) {
  if (FOOTER_PATTERN.test(text)) return true;
  return SIGNATURE_ROLE_PATTERN.test(text) && INITIALS_NAME_PATTERN.test(text) && !ACTION_PATTERN.test(text);
}

function sourceLines(lines, markerIndex) {
  if (markerIndex < 0) return lines;
  const marker = lines[markerIndex];
  const remainder = COMMAND_MARKER.exec(marker.text)?.[1]?.trim();
  const source = lines.slice(markerIndex + 1);
  return remainder ? [{ ...marker, text: remainder }, ...source] : source;
}

function splitAssignmentItems(lines, markerIndex) {
  const source = sourceLines(lines, markerIndex);
  const items = [];
  let current = null;
  for (const line of source) {
    if (!line.text) continue;
    if (isSignatureOrFooter(line.text)) {
      if (current) {
        items.push(current);
        current = null;
      }
      break;
    }
    const match = NUMBERED_ITEM.exec(line.text);
    if (match) {
      if (current) items.push(current);
      current = {
        itemNo: match[1],
        startLine: line.number,
        endLine: line.number,
        parts: [match[2]]
      };
      continue;
    }
    if (current) {
      current.parts.push(line.text);
      current.endLine = line.number;
    }
  }
  if (current) items.push(current);
  if (items.length) return items;

  return source
    .filter((line) => line.text.length >= 12 && ACTION_PATTERN.test(line.text) && !isSignatureOrFooter(line.text))
    .slice(0, 50)
    .map((line, index) => ({
      itemNo: String(index + 1),
      startLine: line.number,
      endLine: line.number,
      parts: [line.text]
    }));
}

function captureSegment(text, labelPattern) {
  const pattern = new RegExp(`(?:${labelPattern})\\s*[:—-]\\s*(.+?)(?=(?:\\.\\s+(?:контроль|срок|результат|ожидаем|соисполнител|ответственн|исполнител)\\w*\\b)|$)`, 'iu');
  const match = pattern.exec(text);
  return match?.[1]?.trim().replace(/[;,]+$/u, '') || null;
}

function splitPeople(value) {
  if (!value) return [];
  return [...new Set(String(value)
    .split(/\s*;\s*|\s*,\s*|\s+и\s+/iu)
    .map(cleanPersonRaw)
    .filter((item) => item.length >= 2))];
}

function responsibilitySet(text) {
  const primarySegment = captureSegment(text, 'ответственн(?:ый|ая|ые|ыми)|исполнител(?:ь|и)');
  const primaryList = splitPeople(primarySegment);
  const explicitCo = splitPeople(captureSegment(text, 'соисполнител(?:ь|и|я|ей)'));
  const joint = splitPeople(captureSegment(text, 'совместно\\s+с'));
  return {
    executorRaw: primaryList[0] || null,
    coexecutorRaws: [...new Set([...primaryList.slice(1), ...explicitCo, ...joint])]
      .filter((raw) => raw !== primaryList[0])
  };
}

function controllerRaw(text) {
  const labeled = captureSegment(text, 'контролирующ(?:ий|ее)\\s+лицо');
  if (labeled) return cleanPersonRaw(labeled);
  const match = /контроль(?:\s+за\s+исполнением)?[^.]*?возложить\s+на\s+(.+?)(?=\.\s|$)/iu.exec(text);
  return match?.[1] ? cleanPersonRaw(match[1]) : null;
}

function expectedResult(text) {
  const label = captureSegment(text, 'ожидаем(?:ый|ые)\\s+результат(?:ы)?|результат');
  if (label) return label.slice(0, 700);
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const action = ACTION_PATTERN.exec(clean);
  if (!action) return null;
  const tail = clean.slice(action.index);
  const boundary = /\.\s+(?:ответственн|исполнител|соисполнител|контроль|срок)\w*/iu.exec(tail);
  return (boundary ? tail.slice(0, boundary.index) : tail).trim().slice(0, 700) || null;
}

export function classifyDirection(text) {
  const value = normalized(text);
  const rules = [
    ['science', /(?:научн|нир|публикац|стать|конференц|грант|патент|исследован)\w*/u],
    ['education', /(?:учебн|образоват|дисциплин|практик|гиа|студент|методическ)\w*/u],
    ['personnel', /(?:кадр|прием|увольнен|назначен|отпуск|штат|должност)\w*/u],
    ['safety', /(?:безопасност|охран[аы]\s+труда|пожарн|антитеррор|инструктаж)\w*/u],
    ['finance', /(?:финанс|бюджет|закупк|оплат|смет|договор)\w*/u],
    ['digital', /(?:информационн|цифров|систем|сайт|программ|баз[аы]\s+данных)\w*/u]
  ];
  return rules.find(([, pattern]) => pattern.test(value))?.[0] || 'organizational';
}

function assignmentTitle(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= 140 ? clean : `${clean.slice(0, 137).trim()}…`;
}

function assignmentConfidence({ dueDate, executor, instruction }) {
  let score = 0.35;
  if (instruction.length >= 20) score += 0.2;
  if (dueDate) score += 0.2;
  if (executor) score += 0.2;
  if (ACTION_PATTERN.test(instruction)) score += 0.05;
  return Number(Math.min(1, score).toFixed(3));
}

export function looksLikeDirective(text) {
  const lines = linesOf(text);
  const kind = directiveKind(lines);
  if (!kind) return false;
  const marker = lines.findIndex((line) => COMMAND_MARKER.test(line.text));
  return marker >= 0 || /(?:поручить|контроль\s+за\s+исполнением|ответственн)\w*/iu.test(normalize(text));
}

export function extractDirective(text, { requestedType = null } = {}) {
  const lines = linesOf(text);
  const kind = directiveKind(lines, requestedType) || { value: 'directive', evidence: null };
  const markerIndex = lines.findIndex((line) => COMMAND_MARKER.test(line.text));
  const issued = issuedAt(lines);
  const assignments = splitAssignmentItems(lines, markerIndex).map((item) => {
    const instruction = item.parts.join(' ').replace(/\s+/g, ' ').trim();
    const due = firstRussianDate(instruction);
    const responsibility = responsibilitySet(instruction);
    const controller = controllerRaw(instruction);
    const locator = { startLine: item.startLine, endLine: item.endLine };
    const coexecutors = responsibility.coexecutorRaws.map((raw) => ({ raw, normalized: normalizePersonName(raw) }));
    return {
      itemNo: item.itemNo,
      title: assignmentTitle(instruction),
      instructionText: instruction,
      dueDate: due?.value || null,
      executorRaw: responsibility.executorRaw,
      coexecutorRaws: responsibility.coexecutorRaws,
      controllerRaw: controller,
      direction: classifyDirection(instruction),
      priority: /(?:срочно|незамедлительно|неотложно)/iu.test(instruction) ? 'high' : 'normal',
      expectedResult: expectedResult(instruction),
      reportRequired: /(?:отчет|отчёт|доклад|справк|акт|представить|направить)\w*/iu.test(instruction),
      confidence: assignmentConfidence({ dueDate: due?.value, executor: responsibility.executorRaw, instruction }),
      evidence: {
        locator,
        raw: instruction,
        coexecutors,
        fields: {
          dueDate: due ? { raw: due.raw, locator } : null,
          executor: responsibility.executorRaw ? { raw: responsibility.executorRaw, locator } : null,
          coexecutors: coexecutors.map((entry) => ({ raw: entry.raw, locator })),
          controller: controller ? { raw: controller, locator } : null
        }
      }
    };
  });

  const title = titleOf(lines, markerIndex);
  const number = documentNumber(lines);
  const issuerResult = issuer(lines);
  let confidence = 0.35;
  if (kind.value) confidence += 0.15;
  if (number) confidence += 0.15;
  if (issued) confidence += 0.15;
  if (assignments.length) confidence += 0.2;

  return {
    kind: kind.value,
    documentNumber: number?.value || null,
    issuedAt: issued?.value || null,
    issuerRaw: issuerResult?.value || null,
    title: title.value,
    summary: title.value,
    direction: classifyDirection(`${title.value}\n${assignments.map((item) => item.instructionText).join('\n')}`),
    confidence: Number(Math.min(1, confidence).toFixed(3)),
    evidence: {
      kind: kind.evidence,
      number: number?.evidence || null,
      issuedAt: issued?.evidence || null,
      issuer: issuerResult?.evidence || null,
      title: title.evidence
    },
    assignments
  };
}
