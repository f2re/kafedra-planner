export const PREFERENCE_ORIGIN_PRIORITY = Object.freeze({
  static: 0,
  suggested: 10,
  domain: 30,
  explicit: 40,
  saved: 40
});

export function canPreferenceSuggestionReplace(origin) {
  return Number(PREFERENCE_ORIGIN_PRIORITY[String(origin || 'static')] || 0)
    <= PREFERENCE_ORIGIN_PRIORITY.suggested;
}

export function preferenceOrigin(element) {
  return element?.dataset?.uiPreferenceOrigin || 'static';
}

export function markPreferenceOrigin(element, origin) {
  if (!element?.dataset) return element;
  const normalized = String(origin || 'static');
  element.dataset.uiPreferenceOrigin = normalized;
  if (['saved', 'explicit', 'domain'].includes(normalized)) element.dataset.uiPreferenceDirty = '1';
  else if (normalized === 'suggested') delete element.dataset.uiPreferenceDirty;
  return element;
}

export function canPreferenceSuggestionApply(element) {
  return Boolean(element && !element.disabled && canPreferenceSuggestionReplace(preferenceOrigin(element)));
}

function markTrusted(event) {
  if (!event.isTrusted) return;
  const control = event.target?.closest?.('input,select,textarea');
  if (control) markPreferenceOrigin(control, 'explicit');
}

if (typeof document !== 'undefined') {
  document.addEventListener('input', markTrusted, true);
  document.addEventListener('change', markTrusted, true);
}

if (typeof window !== 'undefined') {
  window.kafedraPreferenceOrigin = {
    mark: markPreferenceOrigin,
    origin: preferenceOrigin,
    canApply: canPreferenceSuggestionApply,
    canReplace: canPreferenceSuggestionReplace,
    priority: PREFERENCE_ORIGIN_PRIORITY
  };
}
