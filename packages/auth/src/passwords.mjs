import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from 'node:crypto';

const KEY_LENGTH = 64;
const DEFAULT_N = 16_384;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const MAX_MEMORY = 64 * 1024 * 1024;
const DUMMY_SALT = Buffer.from('kafedra-auth-dummy-salt');
const PIN_PREFIX = 'pin$';
const DUMMY_HASH = encodePassword('not-a-real-password', DUMMY_SALT);
const DUMMY_PIN_HASH = `${PIN_PREFIX}${encodePassword('0000', DUMMY_SALT)}`;

function encodePassword(password, salt = randomBytes(16), {
  N = DEFAULT_N,
  r = DEFAULT_R,
  p = DEFAULT_P
} = {}) {
  const key = scryptSync(String(password), salt, KEY_LENGTH, {
    N,
    r,
    p,
    maxmem: MAX_MEMORY
  });
  return [
    'scrypt',
    N,
    r,
    p,
    salt.toString('base64url'),
    key.toString('base64url')
  ].join('$');
}

function parseEncoded(value) {
  const [kind, nText, rText, pText, saltText, hashText] = String(value || '').split('$');
  if (kind !== 'scrypt' || !saltText || !hashText) return null;
  const N = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (![N, r, p].every(Number.isInteger)) return null;
  try {
    return {
      N,
      r,
      p,
      salt: Buffer.from(saltText, 'base64url'),
      hash: Buffer.from(hashText, 'base64url')
    };
  } catch {
    return null;
  }
}

function verifyEncoded(secret, encoded, fallback = DUMMY_HASH) {
  const parsed = parseEncoded(encoded) || parseEncoded(fallback);
  const candidate = scryptSync(String(secret || ''), parsed.salt, parsed.hash.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: MAX_MEMORY
  });
  return candidate.length === parsed.hash.length && timingSafeEqual(candidate, parsed.hash);
}

export function validatePassword(password) {
  const text = String(password || '');
  if (text.length < 12) return 'Пароль должен содержать не менее 12 символов.';
  if (text.length > 256) return 'Пароль слишком длинный.';
  if (!/[A-Za-zА-Яа-яЁё]/u.test(text) || !/\d/u.test(text)) {
    return 'Пароль должен содержать буквы и цифры.';
  }
  return null;
}

export function hashPassword(password) {
  const error = validatePassword(password);
  if (error) throw new Error(`password_invalid:${error}`);
  return encodePassword(password);
}

export function verifyPassword(password, encoded = DUMMY_HASH) {
  return verifyEncoded(password, encoded, DUMMY_HASH);
}

export function validatePin(pin) {
  const text = String(pin ?? '').trim();
  if (!/^\d{4}$/.test(text)) return 'PIN-код должен состоять ровно из 4 цифр.';
  return null;
}

export function isPinHash(encoded) {
  return String(encoded || '').startsWith(PIN_PREFIX);
}

export function hashPin(pin) {
  const error = validatePin(pin);
  if (error) throw new Error(`pin_invalid:${error}`);
  return `${PIN_PREFIX}${encodePassword(String(pin).trim())}`;
}

export function verifyPin(pin, encoded = DUMMY_PIN_HASH) {
  const stored = isPinHash(encoded) ? String(encoded).slice(PIN_PREFIX.length) : '';
  const fallback = DUMMY_PIN_HASH.slice(PIN_PREFIX.length);
  return verifyEncoded(String(pin ?? '').trim(), stored, fallback);
}

export function hashSessionToken(token) {
  return createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

export function randomSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function opaqueNetworkHash(value) {
  if (!value) return null;
  return createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 32);
}
