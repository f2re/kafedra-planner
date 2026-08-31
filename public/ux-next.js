import { isUploadRequest, normalizeIdempotencyHeader } from './http-headers.js';

const rawFetch = window.fetch.bind(window);
const GENERATED_UPLOAD_KEY = /^kp-upload-v1-[a-f0-9]{64}$/u;

function rawHeaderEntries(headers) {
  if (!headers) return [];
  if (headers instanceof Headers) return [...headers.entries()];
  if (Array.isArray(headers)) return headers.map(([name, value]) => [name, value]);
  if (typeof headers === 'object') return Object.entries(headers);
  return [];
}

async function safeHeaders(input, init, headers) {
  const upload = isUploadRequest(input, init);
  const entries = [];
  for (const [rawName, rawValue] of rawHeaderEntries(headers)) {
    const name = String(rawName);
    let value = String(rawValue ?? '');
    if (name.toLowerCase() === 'idempotency-key' && !GENERATED_UPLOAD_KEY.test(value)) {
      value = await normalizeIdempotencyHeader(value, { upload });
    }
    entries.push([name, value]);
  }
  return new Headers(entries);
}

window.fetch = async function headerSafeFetch(input, init = {}) {
  if (!init?.headers) return rawFetch(input, init);
  const headers = await safeHeaders(input, init, init.headers);
  return rawFetch(input, { ...init, headers });
};

await import('./auth-next.js');
await import('./notification-delivery.js');
await import('./plans-next.js');
await import('./manual-plans-next.js');
await import('./manual-plans-bootstrap.js');
await import('./plan-source-rows-next.js');
await import('./lifecycle-safe.js');
await import('./meetings-next.js');
await import('./search-next.js');
await import('./view-bridge.js');
await import('./ux-base.js');
await import('./standalone-assignment-next.js');
await import('./work-automation-next.js');
await import('./supporting-documents-next.js');
await import('./organization-shell.js');
await import('./organization-next.js');
await import('./docomator-integration.js');
await import('./docomator-fields.js');
await import('./science-lifecycle-next.js');
await import('./science-import-next.js');
await import('./academic-performance-next.js');
await import('./science-reports-next.js');
await import('./directive-archive-next.js');
await import('./calendar-start-settings.js');
await window.kafedraCalendarStartReady;
await import('./ui-preferences.js');
await import('./manual-plan-preferences.js');
