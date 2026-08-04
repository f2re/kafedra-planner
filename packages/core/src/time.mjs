export function nowIso(clock = Date) {
  return new clock().toISOString();
}

export function addSeconds(iso, seconds) {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}
