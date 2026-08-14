const rawFetch = window.fetch.bind(window);

function safeIdempotencyValue(value) {
  const text = String(value ?? '');
  return /[^\x20-\x7e]/u.test(text) ? encodeURIComponent(text) : text;
}

function safeHeaders(headers) {
  if (!headers) return headers;
  if (headers instanceof Headers) {
    const copy = new Headers(headers);
    const value = copy.get('idempotency-key');
    if (value) copy.set('idempotency-key', safeIdempotencyValue(value));
    return copy;
  }
  if (Array.isArray(headers)) {
    return headers.map(([name, value]) => [
      name,
      String(name).toLowerCase() === 'idempotency-key' ? safeIdempotencyValue(value) : value
    ]);
  }
  if (typeof headers === 'object') {
    return Object.fromEntries(Object.entries(headers).map(([name, value]) => [
      name,
      name.toLowerCase() === 'idempotency-key' ? safeIdempotencyValue(value) : value
    ]));
  }
  return headers;
}

window.fetch = function headerSafeFetch(input, init = {}) {
  if (!init?.headers) return rawFetch(input, init);
  return rawFetch(input, { ...init, headers: safeHeaders(init.headers) });
};

await import('./notification-delivery.js');
await import('./plans-next.js');
await import('./meetings-next.js');
await import('./search-next.js');
await import('./view-bridge.js');
await import('./ux-base.js');
