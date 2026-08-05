import { firstRussianDate } from '../../protocols/src/russian-date.mjs';

const KIND_PATTERNS = [
  ['decree', /указ/iu],
  ['directive', /распоряжени[ея]/iu],
  ['order', /приказ/iu]
];

const COMMAND_MARKER = /^(?:приказываю|распоряжаюсь|поручаю|обязываю)\s*:?[\s]*$/iu;
const NUMBERED_ITEM = /^\s*(\d+(?:\.\d+)*)[.)]\s+(.+)$/u;

function normalize(value) {
  return String(value || '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
}

function normalized(value) {
  return normalize(value).toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');
}

function linesOf(text) {
  return normalize(text).split('\n').map((text, index) => ({ number: index + 1, text: text.trim() }));
}

function directiveKind(lines) {
  const header = lines.slice(0, 25).map((line) => line.text).join(' ');
  return KIND_PATTERNS.find(([, pattern]) => pattern.test(header))?.[0] || null;
}

function documentNumber(lines) {
  const header = lines.slice(0, 35).map((line) => line.text).join(' ');
  const match = /(?:№|N|No\.?|номер)\s*([А-ЯA-Z0-9][А-ЯA-Zа-яё0-9./_-]*)/iu.exec(header);
  return match?.[1] || null;
}

function issuer(lines) {
  const candidates = lines.filter((line) => /(?:ректор|директор|руководител|начальник|заведующ|председател)\w*/iu.test(line.text));
  if (!candidates.length) return null;
  const explicit = candidates.find((line) => /(?:подписал|издал|руководитель|ректор|директор)\s*[:—-]/iu.test(line.text));
  return (explicit || candidates.at(-1)).text.slice(0, 300);
}

function titleOf(lines, markerIndex) {
  const header = lines.slice(0, markerIndex < 0 ? 45 : markerIndex);
  const explicit = header.find((line) => /^о\s+.{5,}$/iu.test(line.text));
  if (explicit) return explicit.text;
  const excluded = /^(?:указ|приказ|распоряжение|№|от\s+\d|г\.|город|москва|санкт-петербург)/iu;
  const candidates = header
    .map((line) => line.text)
    .filter((text) => text.length >= 8 && !excluded.test(text) && !firstRussianDate(text));
  return candidates.at(-1) || 'Распорядительный документ';
}

function splitAssignmentItems(lines, markerIndex) {
  const source = lines.slice(markerIndex >= 0 ? markerIndex + 1 : 0);
  const items = [];
  let current = null;
  for (const line of source) {
    if (!line.text) continue;
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
    .filter((line) => line.text.length >= 12)
    .slice(0, 50)
    .map((line, index) => ({
      itemNo: String(index + 1),
      startLine: line.number,
      endLine: line.number,
      parts: [line.text]
    }));
}

function capture(text, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].trim().replace(/[.;]+$/u, '');
  }
  return null;
}

function executorRaw(text) {
  return capture(text, [
    /ответственн(?:ый|ая|ые|ым)\s*[:—-]\s*([^.;]+)/iu,
    /(?:поручить|возложить\s+исполнение\s+на|назначить\s+ответственн(?:ым|ой))\s+([^.;]+)/iu,
    /исполнител(?:ь|и)\s*[:—-]\s*([^.;]+)/iu
  ]);
}

function controllerRaw(text) {
  return capture(text, [
    /контроль(?:\s+за\s+исполнением)?[^.;]*?возложить\s+на\s+([^.;]+)/iu,
    /контролирующ(?:ий|ее)\s+лицо\s*[:—-]\s*([^.;]+)/iu
  ]);
}

function expectedResult(text) {
  const sentence = text.split(/(?<=[.!?])\s+/u).find((part) =>
    /(?:представить|подготовить|направить|обеспечить|разработать|сформировать|утвердить|разместить|организовать)/iu.test(part)
  );
  return sentence?.trim().slice(0, 700) || null;
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
  if (/(?:поручить|обеспечить|подготовить|представить|назначить|организовать)/iu.test(instruction)) score += 0.05;
  return Number(Math.min(1, score).toFixed(3));
}

export function looksLikeDirective(text) {
  const lines = linesOf(text);
  const kind = directiveKind(lines);
  if (!kind) return false;
  const marker = lines.findIndex((line) => COMMAND_MARKER.test(line.text));
  return marker >= 0 || /(?:поручить|контроль\s+за\s+исполнением|ответственн)\w*/iu.test(normalize(text));
}

export function extractDirective(text) {
  const lines = linesOf(text);
  const kind = directiveKind(lines) || 'directive';
  const markerIndex = lines.findIndex((line) => COMMAND_MARKER.test(line.text));
  const issued = firstRussianDate(lines.slice(0, 40).map((line) => line.text).join(' '));
  const assignments = splitAssignmentItems(lines, markerIndex).map((item) => {
    const instruction = item.parts.join(' ').replace(/\s+/g, ' ').trim();
    const due = firstRussianDate(instruction);
    const executor = executorRaw(instruction);
    const controller = controllerRaw(instruction);
    return {
      itemNo: item.itemNo,
      title: assignmentTitle(instruction),
      instructionText: instruction,
      dueDate: due?.value || null,
      executorRaw: executor,
      controllerRaw: controller,
      direction: classifyDirection(instruction),
      priority: /(?:срочно|незамедлительно|неотложно)/iu.test(instruction) ? 'high' : 'normal',
      expectedResult: expectedResult(instruction),
      reportRequired: /(?:отчет|доклад|справк|акт|представить|направить)\w*/iu.test(instruction),
      confidence: assignmentConfidence({ dueDate: due?.value, executor, instruction }),
      evidence: {
        locator: { startLine: item.startLine, endLine: item.endLine },
        raw: instruction
      }
    };
  });

  const title = titleOf(lines, markerIndex);
  const number = documentNumber(lines);
  let confidence = 0.35;
  if (kind) confidence += 0.15;
  if (number) confidence += 0.15;
  if (issued) confidence += 0.15;
  if (assignments.length) confidence += 0.2;

  return {
    kind,
    documentNumber: number,
    issuedAt: issued?.value || null,
    issuerRaw: issuer(lines),
    title,
    summary: title,
    direction: classifyDirection(`${title}\n${assignments.map((item) => item.instructionText).join('\n')}`),
    confidence: Number(Math.min(1, confidence).toFixed(3)),
    evidence: {
      kind: { locator: { startLine: 1, endLine: Math.min(25, lines.length) } },
      number: number ? { raw: number } : null,
      issuedAt: issued ? { raw: issued.raw } : null,
      title: { raw: title }
    },
    assignments
  };
}
