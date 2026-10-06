// Har xil manbalardan keladigan xom qiymatlarni yagona ko'rinishga keltirish.
// Hamma adapter shu funksiyalardan foydalanadi — bitta format xatosi bitta
// joyda tuzatiladi.

// ── Vaqt qoldiqlari ────────────────────────────────────────────────────────
// Manbalar qoldiq vaqtni millisekund, soniya, daqiqa, "8h 30m", "8:30" yoki
// "08:30:00" ko'rinishida beradi. Raqamning birligini qiymatning o'zidan
// bilib bo'lmaydi (510 — daqiqami, soniyami?), shuning uchun raqam uchun
// birlikni adapter aniq aytadi: { unit: 'ms' | 's' | 'min' }.
// `noData` — manba "ma'lumot yo'q" ma'nosida ishlatadigan qiymatlar
// (Five ELD: -1). Ular 0 emas, null bo'lishi kerak — aks holda interfeys
// "vaqt tugadi" deb qizil ko'rsatadi.
export function toMinutes(value, { unit = 'min', noData = [] } = {}) {
  if (value === null || value === undefined || value === '') return null;
  if (noData.includes(value) || noData.includes(Number(value))) return null;

  if (typeof value === 'number' || /^\s*-?\d+(\.\d+)?\s*$/.test(String(value))) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const div = unit === 'ms' ? 60000 : unit === 's' ? 60 : 1;
    return clampMinutes(n / div);
  }

  const s = String(value).trim().toLowerCase();

  // "8:30" yoki "08:30:00" — soat:daqiqa[:soniya]
  let m = /^(-)?(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (m) {
    const sign = m[1] ? -1 : 1;
    return clampMinutes(sign * (Number(m[2]) * 60 + Number(m[3]) + Number(m[4] ?? 0) / 60));
  }

  // "8h 30m", "8h", "45m", "1d 2h", "8 hrs 30 min"
  const re = /(\d+(?:\.\d+)?)\s*(d|days?|h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)\b/g;
  let total = 0;
  let found = false;
  while ((m = re.exec(s))) {
    found = true;
    const n = Number(m[1]);
    const u = m[2][0];
    total += u === 'd' ? n * 1440 : u === 'h' ? n * 60 : u === 'm' ? n : n / 60;
  }
  if (found) return clampMinutes(s.startsWith('-') ? -total : total);
  return null;
}

// Qoldiq manfiy bo'lishi mumkin emas — manfiy qiymat "limitdan oshgan"
// degani, u violations orqali ko'rsatiladi. Butun daqiqaga yaxlitlaymiz.
function clampMinutes(n) {
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n));
}

// ── Holat (duty status) ────────────────────────────────────────────────────
const STATUS_MAP = {
  ds_d: 'driving', d: 'driving', driving: 'driving', drive: 'driving',
  ds_on: 'on_duty', on: 'on_duty', on_duty: 'on_duty', onduty: 'on_duty', ds_ym: 'on_duty', ym: 'on_duty', yard_move: 'on_duty',
  ds_sb: 'sleeper', sb: 'sleeper', sleeper: 'sleeper', sleeper_berth: 'sleeper', sleeperberth: 'sleeper',
  ds_off: 'off_duty', off: 'off_duty', off_duty: 'off_duty', offduty: 'off_duty', ds_pc: 'off_duty', pc: 'off_duty', personal_conveyance: 'off_duty',
};

export function normStatus(code) {
  if (code === null || code === undefined) return 'unknown';
  const k = String(code).trim().toLowerCase().replace(/[\s-]+/g, '_');
  return STATUS_MAP[k] ?? STATUS_MAP[k.replace(/_/g, '')] ?? 'unknown';
}

// ── "Faol"lik bayrog'i ─────────────────────────────────────────────────────
// API bir xil ma'noni false, 0, "0", "false", "no", "inactive", "disabled"
// ko'rinishida qaytarishi mumkin. `x !== false` tekshiruvi 0 va "0" ni faol
// deb o'tkazib yuboradi — shuning uchun hammasini shu yerda talqin qilamiz.
// Noma'lum bo'lsa null (chaqiruvchi o'zi hal qiladi).
const FALSY = new Set(['false', '0', 'no', 'n', 'off', 'inactive', 'disabled', 'deactivated', 'archived', 'deleted', 'blocked', 'suspended']);
const TRUTHY = new Set(['true', '1', 'yes', 'y', 'on', 'active', 'enabled']);

export function flag(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (FALSY.has(s)) return false;
  if (TRUTHY.has(s)) return true;
  return null;
}

// Obyektdagi bir nechta mumkin bo'lgan maydonlardan birinchi aniq javob.
// `status: "inactive"` ham, `active: 0` ham, `is_active: "false"` ham tushadi.
export function isActive(obj, fields = ['active', 'is_active', 'isActive', 'enabled', 'status', 'state']) {
  if (!obj) return null;
  for (const f of fields) {
    const v = flag(obj[f]);
    if (v !== null) return v;
  }
  return null;
}

// ── Koordinata va vaqt ─────────────────────────────────────────────────────
export function coord(lat, lon) {
  const a = Number(lat);
  const b = Number(lon);
  if (lat === null || lat === undefined || lat === '' || lon === null || lon === undefined || lon === '') {
    return { lat: null, lon: null };
  }
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { lat: null, lon: null };
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return { lat: null, lon: null };
  // 0,0 — "GPS yo'q" ning odatdagi ko'rinishi (Gvineya ko'rfazida yuk mashinasi yo'q).
  if (a === 0 && b === 0) return { lat: null, lon: null };
  return { lat: a, lon: b };
}

// Epoch soniya, epoch ms yoki ISO satr → ISO satr.
export function toIso(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v))) {
    const n = Number(v);
    // 1e11 dan kichik — soniya (bu 5138-yilgacha to'g'ri ishlaydi).
    const d = new Date(n < 1e11 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  let s = String(v).trim();
  // "2026-10-06 14:30:00" — zonasiz. new Date() buni SERVERNING mahalliy
  // vaqti deb o'qiydi va natija server qaysi zonada turganiga bog'liq bo'lib
  // qoladi. DriveHOS bunday vaqtlarni UTC da beradi.
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = `${s.replace(' ', 'T')}Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function str(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

// Yagona ko'rinishning to'liq shabloni — adapter biror maydonni unutsa ham
// interfeys undefined bilan emas, aniq null bilan ishlaydi.
export function driverShape(d) {
  return {
    driverId: str(d.driverId),
    driverName: str(d.driverName) || '(no name)',
    truck: str(d.truck),
    company: str(d.company),
    companyId: str(d.companyId),
    vehicleId: d.vehicleId != null ? str(d.vehicleId) : null,
    truckActive: typeof d.truckActive === 'boolean' ? d.truckActive : null,
    status: d.status ?? 'unknown',
    statusCode: d.statusCode != null ? str(d.statusCode) : null,
    driveRemainingMin: d.driveRemainingMin ?? null,
    shiftRemainingMin: d.shiftRemainingMin ?? null,
    cycleRemainingMin: d.cycleRemainingMin ?? null,
    breakRemainingMin: d.breakRemainingMin ?? null,
    violations: Array.isArray(d.violations) ? d.violations.map(String).filter(Boolean) : [],
    location: str(d.location),
    lat: d.lat ?? null,
    lon: d.lon ?? null,
    profileUpdatedAt: d.profileUpdatedAt ?? null,
    speedMph: d.speedMph ?? null,
    online: typeof d.online === 'boolean' ? d.online : null,
    eldConnected: typeof d.eldConnected === 'boolean' ? d.eldConnected : null,
    lastUpdate: d.lastUpdate ?? null,
    logUrl: d.logUrl ?? null,
    // Log formasi (trailer / shipping docs) va oxirgi o'zgarish vaqti.
    // null — manba bermaydi; { pending: true } — hali olinmagan;
    // { changedAt, trailer, shipping, from } — tayyor (changedAt null bo'lsa
    // oxirgi 10 kunda o'zgarmagan).
    formChange: d.formChange ?? null,
  };
}
