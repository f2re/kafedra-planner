const rawFetch = window.fetch.bind(window);

window.fetch = function headerSafeFetch(input, init = {}) {
  if (!init?.headers) return rawFetch(input, init);
  const headers = new Headers(init.headers);
  const idempotencyKey = headers.get('idempotency-key');
  if (idempotencyKey && /[^\x20-\x7e]/u.test(idempotencyKey)) {
    headers.set('idempotency-key', encodeURIComponent(idempotencyKey));
  }
  return rawFetch(input, { ...init, headers });
};

await import('./plans-next.js');
await import('./ux-base.js');
