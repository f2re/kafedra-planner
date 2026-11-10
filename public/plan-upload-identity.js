let disabledBrowserId;

export function newPlanOperationId() {
  return globalThis.crypto.randomUUID?.() || [...globalThis.crypto.getRandomValues(new Uint8Array(16))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// The fallback keeps local HTTP installations usable when SubtleCrypto is unavailable.
export function sha256Fallback(input) {
  const primes = [];
  for (let value = 2; primes.length < 64; value += 1) {
    if (!primes.some(prime => prime * prime <= value && value % prime === 0)) primes.push(value);
  }
  const constants = primes.map(prime => Math.floor((Math.cbrt(prime) % 1) * 0x100000000) >>> 0);
  const hash = primes.slice(0, 8).map(prime => Math.floor((Math.sqrt(prime) % 1) * 0x100000000) >>> 0);
  const bytes = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
  bytes.set(input); bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(bytes.length - 8, Math.floor(input.length / 0x20000000));
  view.setUint32(bytes.length - 4, (input.length * 8) >>> 0);
  const rotate = (value, count) => (value >>> count) | (value << (32 - count));
  const words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const a = words[i - 15], b = words[i - 2];
      words[i] = (words[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + words[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i += 1) {
      const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[i] + words[i]) >>> 0;
      const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [a, b, c, d, e, f, g, h] = [(first + second) >>> 0, a, b, c, (d + first) >>> 0, e, f, g];
    }
    [a, b, c, d, e, f, g, h].forEach((value, index) => { hash[index] = (hash[index] + value) >>> 0; });
  }
  return hash.map(value => value.toString(16).padStart(8, '0')).join('');
}

async function digest(bytes) {
  if (!globalThis.crypto.subtle) return sha256Fallback(bytes);
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function browserNamespace() {
  if (disabledBrowserId) return disabledBrowserId;
  try {
    disabledBrowserId = localStorage.getItem('kafedra-disabled-upload-browser');
    if (!disabledBrowserId) { disabledBrowserId = newPlanOperationId(); localStorage.setItem('kafedra-disabled-upload-browser', disabledBrowserId); }
  } catch { disabledBrowserId = newPlanOperationId(); }
  return disabledBrowserId;
}

export async function planUploadKey(file, purpose) {
  if (window.kafedraAuthReady) await window.kafedraAuthReady;
  let profile = window.kafedraAuthContext;
  if (!profile) {
    const response = await fetch('/api/auth/me');
    if (!response.ok) throw new Error('Не удалось проверить доступ перед загрузкой. Повторите попытку.');
    profile = await response.json();
  }
  let scope;
  if (profile.authEnabled) {
    if (!profile.authenticated || !profile.user?.workspaceId || !profile.user?.id) throw new Error('Войдите в систему перед загрузкой плана.');
    scope = ['authenticated', profile.user.workspaceId, profile.user.id, profile.user.personId || ''];
  } else {
    let workspaceId = profile.workspaceId || null;
    if (!workspaceId) {
      try {
        const response = await fetch('/api/workspaces');
        const data = response.ok ? await response.json() : null;
        if (data?.items?.length === 1) workspaceId = data.items[0].id;
      } catch {}
    }
    scope = ['auth-disabled', workspaceId || 'unspecified-workspace', browserNamespace()];
  }
  const hash = await digest(new Uint8Array(await file.arrayBuffer()));
  const scopedHash = await digest(new TextEncoder().encode(JSON.stringify({ scope, purpose, hash })));
  return `${purpose}:${scopedHash}`;
}
