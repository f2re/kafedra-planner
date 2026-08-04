export function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function stableJson(value) {
  return JSON.stringify(value, Object.keys(value ?? {}).sort());
}
