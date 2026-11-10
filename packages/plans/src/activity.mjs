export const PLAN_ACTIVITY_KINDS = Object.freeze([
  'methodological', 'teaching', 'science', 'organizational', 'everyday'
]);

export const PLAN_ACTIVITY_LABELS = Object.freeze({
  methodological: 'Методическая работа', teaching: 'Занятия', science: 'Научная работа',
  organizational: 'Организационная работа', everyday: 'Повседневная работа'
});

// A presentation/filtering category, derived from source text. It does not rewrite
// the canonical direction, establish department membership, or confirm an AI fact.
export function classifyPlanActivity(item = {}) {
  let evidence = item.evidence;
  if (!evidence && typeof item.evidence_json === 'string') {
    try { evidence = JSON.parse(item.evidence_json); } catch { evidence = null; }
  }
  if (PLAN_ACTIVITY_KINDS.includes(evidence?.activityKind)) return evidence.activityKind;
  const text = [item.title, item.description, item.expected_result ?? item.expectedResult]
    .filter(Boolean).join(' ').toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
  if (/методическ|учебно[-\s]метод|рабоч[а-я]*\s+программ|учебн[а-я]*\s+пособ|фонд[а-я]*\s+оценоч/iu.test(text)) return 'methodological';
  if (/заняти[еяй]|лекци[яиюй]|практическ[а-я]*\s+(?:работ|занят)|лабораторн[а-я]*\s+(?:работ|занят)|экзамен|зачет|учебн[а-я]*\s+практик/iu.test(text)) return 'teaching';
  if (item.direction === 'science' || /научн|исследован|конференц|публикац|диссертац|\bнир\b/iu.test(text)) return 'science';
  if (item.direction === 'education') return 'teaching';
  if (item.direction === 'everyday') return 'everyday';
  return 'organizational';
}
