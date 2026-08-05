const stopWords = new Set([
  'и','в','во','на','по','для','от','до','за','с','со','к','ко','о','об','при','из','а','но','или',
  'что','это','как','не','под','над','перед','после','поручить','подготовить','представить','отчет','отчёт'
]);

export function normalizeSearchText(value) {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^а-яa-z0-9]+/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function significantTokens(value) {
  return [...new Set(normalizeSearchText(value).split(' ')
    .filter((token) => token.length >= 3 && !stopWords.has(token)))];
}

function overlap(left, right) {
  const a = significantTokens(left);
  const b = new Set(significantTokens(right));
  if (!a.length || !b.size) return 0;
  const matches = a.filter((token) => b.has(token)).length;
  return matches / Math.max(3, Math.min(a.length, b.size));
}

function dateDistanceDays(left, right) {
  if (!left || !right) return null;
  const a = new Date(`${String(left).slice(0, 10)}T12:00:00Z`);
  const b = new Date(`${String(right).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

export function scoreReportCandidate({ document, assignment }) {
  const text = String(document?.text || '');
  const title = String(document?.title || '');
  const haystack = `${title}\n${text}`;
  let score = 0;
  const reasons = [];

  const semanticOverlap = overlap(
    `${assignment?.title || ''} ${assignment?.instructionText || ''} ${assignment?.expectedResult || ''}`,
    haystack
  );
  if (semanticOverlap > 0) {
    const contribution = Math.min(0.42, semanticOverlap * 0.52);
    score += contribution;
    reasons.push({ code: 'text_overlap', value: Number(semanticOverlap.toFixed(3)), contribution });
  }

  const directiveNumber = normalizeSearchText(assignment?.documentNumber || '');
  if (directiveNumber && normalizeSearchText(haystack).includes(directiveNumber)) {
    score += 0.22;
    reasons.push({ code: 'directive_number', value: assignment.documentNumber, contribution: 0.22 });
  }

  const executors = Array.isArray(assignment?.executors) ? assignment.executors : [];
  const matchedExecutors = executors
    .map((item) => item.displayName || item.raw || item.executor_raw)
    .filter((name) => name && normalizeSearchText(haystack).includes(normalizeSearchText(name)));
  if (matchedExecutors.length) {
    const contribution = Math.min(0.24, 0.16 + 0.04 * (matchedExecutors.length - 1));
    score += contribution;
    reasons.push({ code: 'executor', value: matchedExecutors, contribution });
  }

  const distance = dateDistanceDays(document?.date, assignment?.dueDate);
  if (distance !== null && distance <= 120) {
    const contribution = distance <= 14 ? 0.12 : distance <= 45 ? 0.08 : 0.04;
    score += contribution;
    reasons.push({ code: 'date_proximity', value: Math.round(distance), contribution });
  }

  if (/(?:отчет|отчёт|справка|акт|выполнен|исполнен|результат)/iu.test(haystack)) {
    score += 0.06;
    reasons.push({ code: 'report_language', contribution: 0.06 });
  }

  if (assignment?.direction && normalizeSearchText(haystack).includes(normalizeSearchText(assignment.direction))) {
    score += 0.03;
    reasons.push({ code: 'direction', value: assignment.direction, contribution: 0.03 });
  }

  return { score: Math.max(0, Math.min(1, Number(score.toFixed(4)))), reasons };
}
