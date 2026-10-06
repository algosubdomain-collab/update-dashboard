// Board qatori va sozlamalarining qoidalari. Bazaga bog'liq emas — shuning
// uchun alohida sinovdan o'tkaziladi va keyin saqlash qatlami almashsa ham
// o'zgarmaydi.

export const COLORS = ['lime', 'amber', 'red', 'violet', 'sky', 'slate'];

export const DEFAULT_CONFIG = Object.freeze({
  statuses: [
    { label: 'All good', color: 'lime' },
    { label: 'Need to check', color: 'amber' },
    { label: 'Check profile form', color: 'violet' },
    { label: 'Offline', color: 'slate' },
  ],
  profileForms: [
    { label: 'Filled', color: 'lime' },
    { label: 'Needs update', color: 'amber' },
    { label: 'Sent to driver', color: 'sky' },
    { label: 'No response', color: 'red' },
  ],
  responsibles: [],
  me: '',
  boards: [],
});

export class ValidationError extends Error {}

const MAX_LABEL = 40;
const MAX_TEXT = 60;

function text(v, max = MAX_TEXT) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string') throw new ValidationError('matn kutilgan');
  const s = v.trim();
  if (s.length > max) throw new ValidationError(`matn ${max} belgidan uzun`);
  return s;
}

// ── Qator ──────────────────────────────────────────────────────────────────
// Oq ro'yxat: faqat shu maydonlar yoziladi. checkedAt/checkedBy ni mijoz
// to'g'ridan-to'g'ri bera olmaydi — u faqat `checked: true|false` yuboradi,
// vaqt va muallifni server qo'yadi (mijoz soatiga ishonib bo'lmaydi).
// maydon → maksimal uzunlik. requirement — haydovchiga yozilgan eslatma.
const TEXT_FIELDS = { status: MAX_TEXT, profileForm: MAX_TEXT, responsible: MAX_TEXT, requirement: 280 };

export function applyRowPatch(row, patch, { now, by }) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ValidationError('patch obyekt bo\'lishi kerak');
  }
  const next = { ...(row ?? {}) };

  for (const [f, max] of Object.entries(TEXT_FIELDS)) {
    if (!(f in patch)) continue;
    const v = text(patch[f], max);
    // Bo'sh qiymat — "tozalash": maydon butunlay o'chadi, "" bo'lib qolmaydi.
    if (v) next[f] = v;
    else delete next[f];
  }

  if ('checked' in patch) {
    if (patch.checked === true) {
      // Allaqachon belgilangan qatorning vaqti saqlanib qoladi: diapazon
      // cho'zilganda yoki ikki kishi bir vaqtda bosganda "qachon tekshirildi"
      // yozuvi qayta yozilmasin.
      if (!next.checkedAt) {
        next.checkedAt = now;
        next.checkedBy = by;
      }
    } else if (patch.checked === false || patch.checked === null) {
      delete next.checkedAt;
      delete next.checkedBy;
    } else {
      throw new ValidationError('checked true/false bo\'lishi kerak');
    }
  }

  if ('suggFixed' in patch) {
    if (patch.suggFixed === true) next.suggFixed = true;
    else if (patch.suggFixed === false || patch.suggFixed === null) delete next.suggFixed;
    else throw new ValidationError('suggFixed true/false bo\'lishi kerak');
  }

  if ('certified' in patch) {
    // Mijoz faqat tozalay oladi; qo'yish /api/certify orqali, platforma
    // haqiqatan tasdiqlagandan keyin serverning o'zida bo'ladi.
    if (patch.certified === null || patch.certified === false) delete next.certified;
    else throw new ValidationError('certified faqat tozalanadi');
  }

  return Object.keys(next).length ? next : null;
}

// Serverning o'zi ishlatadi (certify muvaffaqiyatli bo'lganda).
export function markCertified(row, now) {
  return { ...(row ?? {}), certified: now };
}

export function validRowKey(k) {
  return typeof k === 'string' && k.length > 0 && k.length <= 200 && /^[a-z0-9_-]+:.+$/i.test(k);
}

// ── Sozlamalar ─────────────────────────────────────────────────────────────

function options(list, name) {
  if (!Array.isArray(list)) throw new ValidationError(`${name} ro'yxat bo'lishi kerak`);
  if (list.length > 50) throw new ValidationError(`${name}: 50 tadan ko'p bo'lmasin`);
  const seen = new Set();
  return list.map((o) => {
    const label = text(o?.label, MAX_LABEL);
    if (!label) throw new ValidationError(`${name}: nom bo'sh`);
    const k = label.toLowerCase();
    if (seen.has(k)) throw new ValidationError(`${name}: "${label}" takrorlangan`);
    seen.add(k);
    const color = COLORS.includes(o?.color) ? o.color : 'slate';
    return { label, color };
  });
}

export function validateConfig(input) {
  if (!input || typeof input !== 'object') throw new ValidationError('sozlama obyekt bo\'lishi kerak');
  const statuses = options(input.statuses ?? [], 'Status');
  const profileForms = options(input.profileForms ?? [], 'Profile Form');
  const responsibles = options(input.responsibles ?? [], 'Responsible');

  let me = text(input.me, MAX_LABEL);
  // "Sizning ismingiz" faqat mas'ullar ro'yxatidan — aks holda "Assign to all"
  // ro'yxatda yo'q qiymatni qo'yib chiqadi.
  if (me && !responsibles.some((r) => r.label === me)) me = '';

  if (!Array.isArray(input.boards ?? [])) throw new ValidationError('boards ro\'yxat bo\'lishi kerak');
  if ((input.boards ?? []).length > 30) throw new ValidationError('30 tadan ko\'p board bo\'lmasin');
  const ids = new Set();
  const boards = (input.boards ?? []).map((b) => {
    const id = text(b?.id, 40);
    if (!/^[a-z0-9_-]+$/i.test(id) || ids.has(id)) throw new ValidationError('board id noto\'g\'ri');
    ids.add(id);
    const name = text(b?.name, MAX_LABEL);
    if (!name) throw new ValidationError('board nomi bo\'sh');
    if (!Array.isArray(b?.companies)) throw new ValidationError('board companies ro\'yxat bo\'lishi kerak');
    const companies = [...new Set(b.companies.map((c) => text(String(c ?? ''), 200)).filter(Boolean))];
    return { id, name, companies };
  });

  return { statuses, profileForms, responsibles, me, boards };
}
