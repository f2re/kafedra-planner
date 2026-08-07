export function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function normalizeName(value) {
  return String(value || '')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^а-яa-z0-9\s-]/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function categoryFor(direction) {
  if (direction === 'science') return 'science';
  if (direction === 'education') return 'education';
  if (direction === 'everyday') return 'everyday';
  return 'organizational';
}

export function planKindLabel(kind) {
  return {
    department: 'План кафедры',
    faculty: 'План факультета',
    personal: 'Личный план',
    unit: 'План подразделения',
    organization: 'План организации'
  }[kind] || 'План';
}

export function planLabel(plan) {
  return [planKindLabel(plan.plan_kind || plan.kind), plan.period_key || plan.periodKey].filter(Boolean).join(' · ');
}
