// Five ELD — DriveHOS'dan butunlay boshqa API:
//   • token `Authorization` sarlavhasida XOM holda (Bearer'siz);
//   • kompaniya har so'rovda `companyuid` sarlavhasi bilan tanlanadi;
//   • qoldiq vaqtlar DAQIQADA, "-1" — ma'lumot yo'q;
//   • /dashboards/v3/getcompanies → /logs/v3/logslist (har kompaniyaga).
// Certify bu platformada yo'q (interfeysda "—").

import { fetchAllPages } from './paginate.js';
import { ProviderError, request } from './http.js';
import { mapLimit } from './pool.js';
import { coord, driverShape, flag, isActive, issuesFromTexts, normStatus, num, str, toIso, toMinutes } from './normalize.js';

const BASE = process.env.FIVE_BASE_URL || 'https://api.fiveeld.com/api';
const PAGE = 100;
const CONCURRENCY = 3;
const SITE = 'app.fiveeld.com';

// Platformaning o'z holat nomlari → umumiy kod (DS_*), shunda statusCode
// ustuni manbadan qat'i nazar bir xil ko'rinadi.
const CODES = { driving: 'DS_D', on: 'DS_ON', sleep: 'DS_SB', off: 'DS_OFF', pc: 'DS_PC', ym: 'DS_YM' };

// Platforma "kun"ni UTC yarim tunidan 11 soat keyin boshlaydi (ularning
// frontend'i ham shunday so'raydi) — boshqa vaqt yuborilsa bo'sh ro'yxat keladi.
export function logDate(at = new Date()) {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 11));
  return d.toISOString();
}

export function createFive({ base = BASE, sleep } = {}) {
  async function api(ctx, path, companyUid) {
    const res = await request(base + path, {
      fetch: ctx.fetch,
      sleep,
      headers: { Authorization: ctx.token, ...(companyUid ? { companyuid: companyUid } : {}) },
    });
    if (res.ok) return res.body;
    const message = String(res.body?.error?.message ?? res.body?.message ?? '');
    if (res.status === 401) throw new ProviderError('Token rad etildi — yangi token kiriting', { status: 401, auth: true });
    if (res.status === 403 || /access|permission/i.test(message)) {
      throw new ProviderError(message || 'Bu kompaniyaga huquq yo\'q', { status: res.status, access: true });
    }
    throw new ProviderError(`${res.status} ${path.split('?')[0]} — ${message || 'xato'}`, { status: res.status });
  }

  async function companies(ctx) {
    const body = await api(ctx, '/dashboards/v3/getcompanies');
    return (body?.companies ?? [])
      // `is_active: 0` ham, `status: "inactive"` ham o'chirilgan kompaniya.
      .filter((c) => c?.uid && isActive(c, ['is_active', 'isActive', 'active', 'enabled', 'status', 'company_status']) !== false)
      .map((c) => ({
        id: str(c.uid),
        name: str(c.name) || '—',
        drivers: num(c.active_driver ?? c.active_drivers ?? c.drivers_count ?? c.driverCount),
      }));
  }

  async function companyRows(ctx, companyUid) {
    const date = encodeURIComponent(logDate());
    const r = await fetchAllPages(
      async (i) => {
        const body = await api(ctx, `/logs/v3/logslist?page=${i + 1}&perPage=${PAGE}&date=${date}`, companyUid);
        // `total` ning ma'nosi kafolatlanmagan — u faqat "yana bor" ishorasi
        // sifatida ishlatiladi, to'xtatish uchun emas.
        const total = num(body?.total);
        return { items: body?.data ?? [], more: total !== null && (i + 1) * PAGE < total };
      },
      { pageSize: PAGE, maxPages: 200, idOf: (row) => row?.driverUid ?? row?.driver?.uid },
    );
    return r.items;
  }

  function logUrl(d) {
    if (!d.driverId || !d.companyId) return null;
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    // Bu platforma sanasiz "Data not found" beradi.
    const qs = new URLSearchParams({ id: d.driverId, date: `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`, page: 'logs' });
    return `https://${SITE}/#/company/${d.companyId}/logs-edit?${qs}`;
  }

  function toDriver(row, company) {
    const code = CODES[row.status?.status] ?? null;
    const t = row.tracking ?? {};
    const p = coord(t.lat ?? t.latitude ?? row.status?.lat, t.lon ?? t.lng ?? t.longitude ?? row.status?.lon);
    const name = [row.driver?.first_name, row.driver?.second_name].map(str).filter(Boolean).join(' ');
    const opts = { unit: 'min', noData: [-1] };
    const d = driverShape({
      driverId: row.driverUid ?? row.driver?.uid,
      driverName: name,
      truck: row.vehicle?.truck_number,
      company: company.name,
      companyId: company.id,
      vehicleId: row.vehicle?.uid ?? null,
      // Bu API truck faolligini bermaydi (asl adapterda ham yo'q) — taxmin qilmaymiz.
      truckActive: null,
      status: normStatus(code),
      statusCode: code,
      driveRemainingMin: toMinutes(row.timers?.driving, opts),
      shiftRemainingMin: toMinutes(row.timers?.shift, opts),
      cycleRemainingMin: toMinutes(row.timers?.cycle, opts),
      breakRemainingMin: toMinutes(row.timers?.break, opts),
      violations: [...(row.violations ?? []), ...(row.warnings ?? [])]
        .map((v) => (typeof v === 'string' ? v : v?.value ?? v?.message ?? v?.type ?? v?.key ?? null))
        .filter(Boolean),
      location: t.address || row.status?.address || '',
      lat: p.lat,
      lon: p.lon,
      // Platforma profil o'zgarish vaqtini bermaydi.
      profileUpdatedAt: null,
      speedMph: num(t.speed),
      online: flag(row.isOnline),
      eldConnected: flag(t.eld_connection),
      lastUpdate: toIso(t.date || row.timers?.date),
    });
    // Five sana bermaydi: warnings → "errors", violations → "violations".
    const txt = (v) => (typeof v === 'string' ? v : v?.value ?? v?.message ?? v?.type ?? v?.key ?? null);
    d.issues = issuesFromTexts((row.warnings ?? []).map(txt), (row.violations ?? []).map(txt));
    d.logUrl = logUrl(d);
    return d;
  }

  return {
    id: 'five',
    name: 'Five ELD',
    site: SITE,
    snippet: 'copy(localStorage.token)',
    tokenHint: `${SITE} ga kiring, F12 → Console, quyidagini qo'yib Enter bosing va natijani shu yerga joylang.`,

    async verifyToken(ctx) {
      return { companies: (await companies(ctx)).length };
    },

    async fetchDrivers(ctx) {
      const list = (await companies(ctx)).filter((c) => c.drivers === null || c.drivers > 0);
      const results = await mapLimit(list, CONCURRENCY, (c) => companyRows(ctx, c.id));
      const drivers = [];
      const errors = [];
      const restricted = [];
      results.forEach((r, i) => {
        const c = list[i];
        if (r.ok) {
          for (const row of r.value) {
            const d = toDriver(row, c);
            if (d.driverId) drivers.push(d);
          }
        } else if (r.error?.auth) throw r.error;
        else if (r.error?.access) restricted.push(c.name);
        else errors.push({ companyId: c.id, company: c.name, message: r.error?.message ?? 'xato' });
      });
      return { drivers, errors, restricted };
    },
  };
}

export const five = createFive();
