export function calendarPlanContinuation(plans = []) {
  const items = (plans || []).filter((plan) => plan?.id);
  if (!items.length) return { mode: 'create', planId: null, plans: [] };
  if (items.length === 1) return { mode: 'direct', planId: items[0].id, plans: items };
  return { mode: 'choose', planId: items[0].id, plans: items };
}

export function calendarContextDate(value, fallback = new Date()) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/u.test(raw)) return raw;
  return `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}-${String(fallback.getDate()).padStart(2, '0')}`;
}
