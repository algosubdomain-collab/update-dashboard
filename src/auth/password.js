import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

// Parametrlar xesh ichida saqlanadi — keyinroq kuchaytirilsa eski xeshlar
// ham tekshirilaveradi.
const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, rr, pp, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(rr),
    p: Number(pp),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Foydalanuvchi topilmaganda ham shuncha vaqt sarflaymiz — javob tezligiga
// qarab "bunday login bor/yo'q" ni bilib olib bo'lmasin.
let dummy = null;
export async function burnPasswordCheck(password) {
  dummy ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummy);
}

export function passwordProblem(pw) {
  if (typeof pw !== 'string') return 'parol kerak';
  if (pw.length < 8) return 'parol kamida 8 belgi bo\'lsin';
  if (pw.length > 200) return 'parol juda uzun';
  return null;
}

export function loginProblem(login) {
  if (typeof login !== 'string') return 'login kerak';
  if (!/^[a-z0-9._-]{3,32}$/i.test(login)) return 'login 3–32 belgi: harf, raqam, . _ -';
  return null;
}
