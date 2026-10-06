// Manbalar reestri. Har bir manba bir xil interfeysni eksport qiladi:
//   id, name, site, snippet, tokenHint
//   fetchDrivers(ctx) → { drivers: [yagona ko'rinish], errors: [{companyId, company, message}], restricted?: [nom] }
//   certifyDriver(ctx, { driverId, companyId })   — ixtiyoriy
//   verifyToken(ctx)                              — ixtiyoriy (yo'q bo'lsa fetchDrivers bilan sinaladi)
// ctx = { token, refreshToken, meta, fetch, onTokens } — fetch tashqaridan
// beriladi (testda soxta), onTokens — manba tokenni o'zi yangilaganda chaqiriladi.
//
// Yangi platforma qo'shish = shu papkaga fayl + quyidagi ro'yxatga bitta qator.

import { factor, leader } from './drivehos.js';
import { five } from './five.js';
import sample from './sample.js';

const PROVIDERS = new Map([leader, factor, five, sample].map((p) => [p.id, p]));

export function getProvider(id) {
  return PROVIDERS.get(id) ?? null;
}

export function listProviders() {
  return [...PROVIDERS.values()].map((p) => ({
    id: p.id,
    name: p.name,
    site: p.site ?? null,
    snippet: p.snippet ?? null,
    tokenHint: p.tokenHint ?? '',
    supportsCertify: typeof p.certifyDriver === 'function',
  }));
}

// Maydonga ikki narsa qo'yilishi mumkin: konsol yordamchisi bergan JSON
// (access + refresh) yoki oddiy access token. Ikkalasini ham qabul qilamiz.
export function parseTokenInput(raw) {
  const text = String(raw ?? '').trim();
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object') {
      const access = obj.access_token ?? obj.accessToken ?? obj.token;
      if (access) return { token: clean(access), refreshToken: obj.refresh_token ?? obj.refreshToken ?? null };
    }
    // copy(localStorage.token) ba'zan JSON satr qaytaradi: "\"abc\"".
    if (typeof obj === 'string') return { token: clean(obj), refreshToken: null };
  } catch {
    /* oddiy token */
  }
  return { token: clean(text), refreshToken: null };
}

const clean = (s) => String(s).trim().replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '');
