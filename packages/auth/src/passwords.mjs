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
const DUMMY_HASH = encodePassword('not-a-real-password', DUMMY_SALT);

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
  const parsed = parseEncoded(encoded) || parseEncoded(DUMMY_HASH);
  const candidate = scryptSync(String(password || ''), parsed.salt, parsed.hash.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: MAX_MEMORY
  });
  return candidate.length === parsed.hash.length && timingSafeEqual(candidate, parsed.hash);
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
