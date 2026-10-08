// DriveHOS platformasi. Leader ELD ham, Factor ELD ham shu API'da ishlaydi —
// farqi faqat `tenant_id` sarlavhasida va sayt manzilida.
//
// Yig'ish:
//   /v1/companies   — tenant ichidagi kompaniyalar (sahifalab);
//   /v1/hos/list    — har kompaniya uchun ALOHIDA, `company_id` sarlavhasi
//                     bilan (API butun tenant bo'yicha bermaydi);
//   /v1/drivers     — profil kartochkalari (faqat "profil qachon o'zgargan");
//   /v1/vehicles    — truck faol yoki o'chirilganligi.
// Endpoint'lar asl eld-monitoring ilovasidagi ishlab turgan adapterdan olingan.

import { mapLimit } from './pool.js';
import { fetchAllPages } from './paginate.js';
import { ProviderError, backoff, request } from './http.js';
import { coord, driverShape, flag, isActive, issuesFromTexts, normStatus, num, str, toIso, toMinutes } from './normalize.js';

const BASE = process.env.DRIVEHOS_BASE_URL || 'https://api.drivehos.app/api';
const PAGE = 100;
const CONCURRENCY = 3;
const CERTIFY_DAYS = 8;
const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));

// Log formasi (trailer / shipping docs). Platformada "forma o'zgardi" degan
// hodisa yo'q va /v1/drivers dagi updated_at — bu haydovchi kartochkasi, log
// formasi emas. Shuning uchun so'nggi 10 kunlik log hodisalarida forma
// qiymati o'zgargan oxirgi nuqta topiladi. Har haydovchiga BITTA so'rov —
// shuning uchun fonda, 2 oqimda yig'iladi va 15 daqiqa keshlanadi;
// dashboard kutib qolmaydi (hali kelmagan bo'lsa "pending").
const FORM_LOOKBACK_MS = 10 * 86400_000;
const FORM_TTL_MS = 15 * 60_000;
const FORM_CONCURRENCY = 2;

const isActiveEvent = (ev) => String(ev?.event_status ?? '').toUpperCase() === 'ACTIVE';

// /v1/events javobi (kunlar ro'yxati) → { changedAt, trailer, shipping, from,
// location, lat, lon }. location — forma o'zgargan paytdagi joy.
export function parseForm(days) {
  const events = (days ?? [])
    .flatMap((day) => day?.events ?? [])
    .filter(isActiveEvent)
    .map((ev) => ({ ev, t: Date.parse(ev.event_start_time) }))
    .filter((e) => Number.isFinite(e.t))
    .sort((a, b) => a.t - b.t);
  let prev = null;
  let change = null;
  for (const { ev, t } of events) {
    const form = [str(ev.trailers), str(ev.shipping_docs)];
    // Forma ma'lumoti yo'q hodisalar (certify va h.k.) solishtirishga kirmaydi.
    if (!form[0] && !form[1]) continue;
    if (prev && (form[0] !== prev[0] || form[1] !== prev[1])) change = { t, ev, from: prev };
    prev = form;
  }
  const where = change ? coord(change.ev.lat, change.ev.lon) : { lat: null, lon: null };
  return {
    changedAt: change ? new Date(change.t).toISOString() : null,
    trailer: prev?.[0] || null,
    shipping: prev?.[1] || null,
    from: change ? { trailer: change.from[0] || null, shipping: change.from[1] || null } : null,
    location: change ? str(change.ev.manual_location || change.ev.calculated_location) || null : null,
    lat: where.lat,
    lon: where.lon,
  };
}

// Log sahifasidagi error va violation'lar (so'nggi 8 kun), turi bo'yicha
// guruhlangan — xatolar popover'i uchun ("2× Odometer jump — 30 Sep, 28 Sep").
const ISSUES_LOOKBACK_MS = 8 * 86400_000;

export function parseIssues(days, { now = Date.now() } = {}) {
  const from = new Date(now - ISSUES_LOOKBACK_MS).toISOString().slice(0, 10);
  const out = { errors: new Map(), violations: new Map() };
  for (const day of days ?? []) {
    if (day?.date && day.date < from) continue;
    for (const [kind, list, typeKey] of [
      ['errors', day?.errors, 'error_type'],
      ['violations', day?.violations, 'violation_type'],
    ]) {
      for (const it of list ?? []) {
        const type = str(it?.[typeKey]) || 'UNKNOWN';
        const g = out[kind].get(type) ?? { type, text: str(it?.description) || humanize(type), count: 0, dates: [] };
        g.count += 1;
        const date = str(it?.work_date || day?.date);
        if (date && !g.dates.includes(date)) g.dates.push(date);
        out[kind].set(type, g);
      }
    }
  }
  const sorted = (m) => [...m.values()].map((g) => ({ ...g, dates: g.dates.sort().reverse() })).sort((a, b) => b.count - a.count);
  return { errors: sorted(out.errors), violations: sorted(out.violations) };
}

const humanize = (t) => t.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

// Token egasi (JWT user_id/sub) — token yangilansa ham o'zgarmaydi; keshni
// akkaunt bo'yicha ajratish uchun (bir serverda bir nechta foydalanuvchi).
function accountId(token) {
  try {
    const p = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString());
    if (p?.user_id ?? p?.sub) return String(p.user_id ?? p.sub);
  } catch {
    /* JWT emas */
  }
  return String(token).slice(-24);
}

export const SNIPPET = 'copy(JSON.stringify({access_token:localStorage.access_token,refresh_token:localStorage.refresh_token}))';

export function createDriveHos({ id, name, site, tenantId, base = BASE, sleep = sleepDefault, now = () => Date.now() }) {
  const forms = new Map(); // "akkaunt:driverId" → { at, value }
  const formQueue = new Map(); // kalit → { ctx, driverId, companyId }
  let formFilling = null;

  // Bitta so'rovdan ikki narsa: log formasi va guruhlangan xatolar.
  async function lookupForm(ctx, driverId, companyId) {
    const end = new Date(now());
    const start = new Date(end.getTime() - FORM_LOOKBACK_MS);
    const data = await api(ctx, `/v1/events?driver_id=${encodeURIComponent(driverId)}&start_date=${start.toISOString()}&end_date=${end.toISOString()}`, { companyId });
    return { form: parseForm(data?.events), issues: parseIssues(data?.events, { now: end.getTime() }) };
  }

  function fillForms() {
    formFilling ??= (async () => {
      while (formQueue.size) {
        const batch = [...formQueue].slice(0, 100);
        batch.forEach(([k]) => formQueue.delete(k));
        await mapLimit(batch, FORM_CONCURRENCY, async ([key, { ctx, driverId, companyId }]) => {
          const cached = forms.get(key);
          if (cached && now() - cached.at < FORM_TTL_MS) return;
          try {
            forms.set(key, { at: now(), value: await lookupForm(ctx, driverId, companyId) });
          } catch (err) {
            // Token muammosi — keshlamaymiz (yangi token bilan qayta uriniladi).
            // Boshqa xato — eski qiymat qoladi, lekin 15 daqiqa qayta so'ralmaydi.
            if (!err.auth) forms.set(key, { at: now(), value: cached?.value ?? null });
          }
        });
      }
    })().finally(() => {
      formFilling = null;
    });
    return formFilling;
  }

  // ── So'rov ─────────────────────────────────────────────────────────────
  // 401/403 har doim "token o'lgan" degani emas: gateway yuk ostida ham shunday
  // qaytaradi, "bu kompaniyaga huquq yo'q" ham 403. Sababini o'qib ajratamiz,
  // aks holda foydalanuvchi bekorga "tokenni yangilang" deb chiqarib yuboriladi.
  async function api(ctx, path, { companyId, payload } = {}) {
    for (let attempt = 0; ; attempt++) {
      const usedToken = ctx.token;
      const res = await request(base + path, {
        method: payload === undefined ? 'GET' : 'POST',
        body: payload,
        fetch: ctx.fetch,
        sleep,
        headers: {
          Authorization: `Bearer ${usedToken}`,
          tenant_id: tenantId,
          ...(companyId ? { company_id: companyId } : {}),
        },
      });
      if (res.ok) return res.body?.data ?? {};

      const reason = `${res.body?.data?.error_code ?? ''} ${res.body?.description ?? ''}`.trim();
      if (res.status === 401 || res.status === 403) {
        if (/token|session|expired|unauthor/i.test(reason)) {
          // Parallel so'rov tokenni allaqachon yangilagan bo'lsa — shunchaki qaytaramiz.
          if (ctx.token !== usedToken) continue;
          if (await refreshToken(ctx)) continue;
          throw new ProviderError(ctx.refreshReason ? `Sessiya tugadi (${ctx.refreshReason}) — yangi token kiriting` : 'Token rad etildi — yangi token kiriting', { status: res.status, auth: true });
        }
        if (/access/i.test(reason)) throw new ProviderError(reason, { status: res.status, access: true });
        if (attempt < 4) {
          await sleep(backoff(attempt));
          continue;
        }
      }
      throw new ProviderError(`${res.status} ${path.split('?')[0]} — ${reason || res.text?.slice(0, 120) || 'xato'}`, { status: res.status, body: res.body });
    }
  }

  // Access token ~24 soatda tugaydi. Refresh token bo'lsa uni jimgina
  // yangilaymiz va bazaga yozamiz (ctx.onTokens) — foydalanuvchi har kuni
  // token olib kelmasin. Bir vaqtda o'nlab so'rov 401 olsa ham yangilash
  // BITTA bo'ladi: qolganlari shu va'daga qo'shiladi.
  function refreshToken(ctx) {
    if (!ctx.refreshToken || ctx.refreshFailed) return Promise.resolve(false);
    ctx.refreshing ??= (async () => {
      const res = await request(`${base}/v1/auth/refresh`, {
        method: 'POST',
        body: { refresh_token: ctx.refreshToken },
        headers: { tenant_id: tenantId },
        fetch: ctx.fetch,
        sleep,
        retries: 2,
      });
      const data = res.body?.data ?? {};
      const access = data.access_token ?? data.accessToken ?? data.token;
      if (!res.ok || !access) {
        if (res.status === 429 || res.status >= 500) throw new ProviderError(`token yangilash vaqtincha ishlamadi (${res.status})`);
        ctx.refreshFailed = true;
        ctx.refreshReason = `${data.error_code ?? ''} ${res.body?.description ?? ''}`.trim() || String(res.status);
        return false;
      }
      ctx.token = access;
      ctx.refreshToken = data.refresh_token ?? data.refreshToken ?? ctx.refreshToken;
      await ctx.onTokens?.({ token: ctx.token, refreshToken: ctx.refreshToken });
      return true;
    })().finally(() => {
      ctx.refreshing = null;
    });
    return ctx.refreshing;
  }

  async function pages(ctx, path, listKey, idKey, companyId) {
    const sep = path.includes('?') ? '&' : '?';
    const r = await fetchAllPages(
      async (i) => {
        const data = await api(ctx, `${path}${sep}page=${i + 1}&limit=${PAGE}`, { companyId });
        const totalPages = num(data?.paging?.totalPages);
        return { items: data?.[listKey] ?? [], more: totalPages !== null && i + 1 < totalPages };
      },
      { pageSize: PAGE, maxPages: 200, idOf: (x) => x?.[idKey] },
    );
    if (r.truncated) console.warn(`[${id}] ${path}: sahifalar chegarasiga yetildi, ro'yxat to'liq bo'lmasligi mumkin`);
    return r.items;
  }

  async function companies(ctx) {
    const rows = await pages(ctx, '/v1/companies', 'companies', 'company_id');
    return rows
      .filter((c) => c.company_id && isActive(c) !== false)
      .map((c) => ({ id: str(c.company_id), name: str(c.company_name) || '—', drivers: num(c.active_driver) }));
  }

  function logUrl(d) {
    if (!d.driverId) return null;
    const pad = (n) => String(n).padStart(2, '0');
    const ymd = (x) => `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
    const now = new Date();
    const start = new Date(now.getTime() - 8 * 86400_000);
    const end = new Date(now.getTime() + 86400_000);
    // Bu parametrlar to'plami platformada sinovdan o'tgan: vehicleId — UUID
    // (truck raqami emas), vehicleNumber esa JSON satri (qo'shtirnoq bilan).
    const qs = new URLSearchParams({ driverId: d.driverId, tab: 'list' });
    if (d.driverName) qs.set('driverName', d.driverName);
    if (d.vehicleId) qs.set('vehicleId', d.vehicleId);
    qs.set('startDate', `${ymd(start)}T04:00:00Z`);
    qs.set('endDate', `${ymd(end)}T03:59:59Z`);
    if (d.truck) qs.set('vehicleNumber', JSON.stringify(d.truck));
    return `https://${site}/system/hos/graphs?${qs}`;
  }

  function toDriver(row, company, profile, vehicleActive) {
    const p = coord(row.lat, row.lon);
    const d = driverShape({
      driverId: row.driver_id,
      driverName: row.driver_name,
      truck: row.vehicle_number,
      company: company.name,
      companyId: company.id,
      vehicleId: row.vehicle_id || null,
      truckActive: row.vehicle_id ? (vehicleActive ?? null) : null,
      status: normStatus(row.current_status),
      statusCode: row.current_status ?? null,
      // DriveHOS qoldiq vaqtni millisekundda beradi.
      driveRemainingMin: toMinutes(row.drive, { unit: 'ms' }),
      shiftRemainingMin: toMinutes(row.shift, { unit: 'ms' }),
      cycleRemainingMin: toMinutes(row.cycle, { unit: 'ms' }),
      breakRemainingMin: toMinutes(row.break, { unit: 'ms' }),
      violations: [...(row.violations ?? []), ...(row.errors ?? [])].map(text).filter(Boolean),
      location: row.calculated_location || (p.lat !== null ? `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}` : ''),
      lat: p.lat,
      lon: p.lon,
      profileUpdatedAt: toIso(profile?.updated_at),
      speedMph: num(row.speed),
      online: flag(row.online),
      eldConnected: flag(row.eld_status),
      lastUpdate: toIso(row.last_sync),
    });
    d.logUrl = logUrl(d);
    return d;
  }

  return {
    id,
    name,
    site,
    snippet: SNIPPET,
    tokenHint: `${site} ga kiring, F12 → Console, quyidagini qo'yib Enter bosing va natijani shu yerga joylang.`,

    async verifyToken(ctx) {
      const list = await companies(ctx);
      return { companies: list.length };
    },

    async fetchDrivers(ctx) {
      const [list, profiles, vehicles] = await Promise.all([
        companies(ctx),
        // Profil va mashina ro'yxatlari — qo'shimcha. Ular yiqilsa haydovchilar
        // baribir ko'rinadi (faqat "Profile changed"/truck belgisi bo'lmaydi).
        pages(ctx, '/v1/drivers?status=all', 'drivers', 'driver_id').then(
          (rows) => new Map(rows.map((r) => [r.driver_id, r])),
          (err) => soft(err, 'profillar'),
        ),
        pages(ctx, '/v1/vehicles?status=all', 'vehicles', 'vehicle_id').then(
          (rows) => new Map(rows.map((r) => [r.vehicle_id, flag(r.status)])),
          (err) => soft(err, 'mashinalar'),
        ),
      ]);

      // Haydovchisi yo'qligi aniq bo'lgan kompaniyalar so'ralmaydi; son
      // noma'lum bo'lsa so'raymiz — bilmay turib tashlab ketmaymiz.
      const wanted = list.filter((c) => c.drivers === null || c.drivers > 0);
      const errors = [];
      const restricted = [];
      const results = await mapLimit(wanted, CONCURRENCY, (c) => pages(ctx, '/v1/hos/list', 'drivers', 'driver_id', c.id));

      const drivers = [];
      const acct = accountId(ctx.token);
      const activeCutoff = now() - 24 * 3600_000;
      results.forEach((r, i) => {
        const c = wanted[i];
        if (r.ok) {
          for (const row of r.value) {
            if (!row?.driver_id) continue;
            const d = toDriver(row, c, profiles.get(row.driver_id), vehicles.get(row.vehicle_id));
            // Forma faqat faol haydovchilar uchun so'raladi — dashboard faqat
            // shularni ko'rsatadi, qolganlari uchun so'rov bekorga ketadi.
            const active = !d.lastUpdate || Date.parse(d.lastUpdate) >= activeCutoff;
            const key = `${acct}:${d.driverId}`;
            const cached = forms.get(key);
            d.formChange = cached ? cached.value?.form ?? { changedAt: null, trailer: null, shipping: null, from: null, error: true } : active ? { pending: true } : null;
            // Guruhlangan xatolar (sanalari bilan) log'dan kelguncha — hos/list
            // dagi joriy ro'yxat (sanasiz) ko'rsatiladi, katak bo'sh qolmasin.
            d.issues = cached?.value?.issues ?? issuesFromTexts(row.errors?.map(text), row.violations?.map(text));
            if (active && (!cached || now() - cached.at >= FORM_TTL_MS)) formQueue.set(key, { ctx, driverId: d.driverId, companyId: c.id });
            drivers.push(d);
          }
          return;
        }
        // Token o'lgan bo'lsa qisman natija ma'nosiz — hammasi to'xtaydi.
        if (r.error?.auth) throw r.error;
        if (r.error?.access) restricted.push(c.name);
        // Bitta kompaniya javob bermasa butun ro'yxat yo'qolmaydi, lekin xato
        // jimgina tashlab ketilmaydi — interfeysga chiqadi.
        else errors.push({ companyId: c.id, company: c.name, message: r.error?.message ?? 'xato' });
      });
      if (formQueue.size) fillForms().catch(() => {});
      return { drivers, errors, restricted };
    },

    // Testlar uchun: fondagi forma yig'ish tugashini kutish.
    whenFormsIdle: () => formFilling ?? Promise.resolve(),

    // DIQQAT: haqiqiy compliance amali — platformada loglar "certified" bo'ladi.
    async certifyDriver(ctx, { driverId, companyId }) {
      const end = new Date();
      const start = new Date(end.getTime() - CERTIFY_DAYS * 86400_000);
      // Certify'dan oldin ochiq bo'lgan sessiya boshqa xodimniki — uni yopmaymiz.
      const before = await sessionInfo(ctx, driverId, companyId);
      await api(ctx, '/v1/events/bulk-certification', {
        companyId,
        payload: { driver_id: driverId, start_date: start.toISOString(), end_date: end.toISOString(), tenant_id: tenantId },
      });
      // Certify haydovchida tahrirlash sessiyasini ochib qoldiradi ("owned by…").
      // Yopilmasa boshqa xodimlar u haydovchini tahrirlay olmaydi.
      const sessionClosed = await closeSession(ctx, driverId, companyId, before);
      return { ok: true, warning: sessionClosed ? null : 'Tahrirlash sessiyasi yopilmay qoldi — platformada "Finish" bosing' };
    },
  };

  async function sessionInfo(ctx, driverId, companyId) {
    try {
      return await api(ctx, `/v1/hos-sessions/info/${encodeURIComponent(driverId)}`, { companyId });
    } catch (err) {
      if (err.auth) throw err;
      // Factor sessiya yo'q bo'lsa 500 "no rows" qaytaradi.
      if (/no rows/i.test(err.message)) return { has_session: false };
      return null;
    }
  }

  async function closeSession(ctx, driverId, companyId, before) {
    const foreign = before?.has_session ? before.session_id || null : null;
    const settled = (info) => info && (!info.has_session || (foreign && info.session_id === foreign));
    for (let attempt = 0; attempt < 3; attempt++) {
      if (settled(await sessionInfo(ctx, driverId, companyId))) return true;
      await api(ctx, '/v1/hos-sessions/close', { companyId, payload: { driver_id: driverId, tenant_id: tenantId } }).catch((err) => {
        if (err.auth) throw err;
      });
      await sleep(400 * (attempt + 1));
    }
    return Boolean(settled(await sessionInfo(ctx, driverId, companyId)));
  }
}

function soft(err, what) {
  if (err?.auth) throw err;
  console.warn(`[drivehos] ${what} olinmadi: ${err.message}`);
  return new Map();
}

// Buzilishlar matn yoki obyekt bo'lib keladi.
function text(item) {
  if (!item) return null;
  if (typeof item === 'string') return item;
  return item.description ?? item.message ?? item.name ?? item.type ?? null;
}

export const leader = createDriveHos({
  id: 'leader',
  name: 'Leader ELD',
  site: 'app.leadereld.com',
  tenantId: 'd0e24f31-1242-416c-a6d6-57a30bdff44d',
});

export const factor = createDriveHos({
  id: 'factor',
  name: 'Factor ELD',
  site: 'app.factoreld.com',
  tenantId: '96335ac3-5a93-4a29-af8b-08d874801325',
});
