import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDriveHos } from '../src/providers/drivehos.js';
import { createFive, logDate } from '../src/providers/five.js';
import { parseTokenInput } from '../src/providers/index.js';
import sample from '../src/providers/sample.js';
import { fakeFetch, noSleep } from './helpers.js';

const dh = () => createDriveHos({ id: 'leader', name: 'Leader', site: 'app.example.test', tenantId: 'T1', base: 'https://api.test', sleep: noSleep });

function hosRow(i, extra = {}) {
  return {
    driver_id: `d${i}`,
    driver_name: `Driver ${i}`,
    vehicle_number: `${100 + i}`,
    vehicle_id: `v${i}`,
    current_status: 'DS_D',
    drive: 3_600_000,
    shift: 7_200_000,
    cycle: 36_000_000,
    break: 1_800_000,
    lat: 41.1,
    lon: -87.2,
    calculated_location: 'Somewhere, IL',
    last_sync: '2026-10-06 10:00:00',
    online: true,
    eld_status: true,
    ...extra,
  };
}

test('DriveHOS: kompaniyalar bo\'yicha yig\'adi, sahifalaydi, normallashtiradi', async () => {
  const f = fakeFetch(({ url, headers }) => {
    assert.equal(headers.tenant_id, 'T1');
    assert.equal(headers.Authorization, 'Bearer tok');
    const page = Number(url.searchParams.get('page'));
    switch (url.pathname) {
      case '/v1/companies':
        // paging.totalPages noto'g'ri (1) — lekin sahifa to'liq emas, demak tamom.
        return { body: { data: { companies: [
          { company_id: 'A', company_name: 'Alpha', active_driver: 150 },
          { company_id: 'B', company_name: 'Beta', active_driver: 0 },
          { company_id: 'C', company_name: 'Gamma', active_driver: 5, status: 'inactive' },
          { company_id: 'D', company_name: 'Delta', active_driver: 2 },
        ], paging: { totalPages: 1 } } } };
      case '/v1/hos/list':
        if (headers.company_id === 'A') {
          // totalPages YO'Q — eski "totalPages ga qarab" mantiq 50 tani yo'qotardi.
          const rows = Array.from({ length: 150 }, (_, i) => hosRow(i));
          return { body: { data: { drivers: rows.slice((page - 1) * 100, page * 100) } } };
        }
        if (headers.company_id === 'D') return { status: 500, body: { description: 'db down' } };
        throw new Error(`kutilmagan kompaniya ${headers.company_id}`);
      case '/v1/drivers':
        return { body: { data: { drivers: [{ driver_id: 'd1', updated_at: '2026-10-05 08:00:00' }] } } };
      case '/v1/vehicles':
        return { body: { data: { vehicles: [{ vehicle_id: 'v2', status: false }, { vehicle_id: 'v1', status: true }] } } };
      default:
        throw new Error(url.pathname);
    }
  });

  const { drivers, errors } = await dh().fetchDrivers({ token: 'tok', fetch: f });
  assert.equal(drivers.length, 150);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].company, 'Delta');
  // B (0 haydovchi) va C (inactive) so'ralmagan.
  assert.ok(!f.calls.some((c) => c.headers.company_id === 'B' || c.headers.company_id === 'C'));

  const d1 = drivers.find((d) => d.driverId === 'd1');
  assert.equal(d1.companyId, 'A');
  assert.equal(d1.driveRemainingMin, 60);
  assert.equal(d1.cycleRemainingMin, 600);
  assert.equal(d1.status, 'driving');
  assert.equal(d1.lat, 41.1);
  assert.equal(d1.truckActive, true);
  assert.equal(d1.profileUpdatedAt, '2026-10-05T08:00:00.000Z');
  assert.equal(d1.lastUpdate, '2026-10-06T10:00:00.000Z');
  assert.match(d1.logUrl, /^https:\/\/app\.example\.test\/system\/hos\/graphs\?driverId=d1/);
  assert.equal(drivers.find((d) => d.driverId === 'd2').truckActive, false);
});

test('DriveHOS: "access" 403 — xato emas, restricted', async () => {
  const f = fakeFetch(({ url, headers }) => {
    if (url.pathname === '/v1/companies') return { body: { data: { companies: [{ company_id: 'A', company_name: 'Alpha', active_driver: 1 }] } } };
    if (url.pathname === '/v1/hos/list') return { status: 403, body: { description: "You don't have access to this company" } };
    return { body: { data: {} } };
  });
  const r = await dh().fetchDrivers({ token: 'tok', fetch: f });
  assert.deepEqual(r.restricted, ['Alpha']);
  assert.equal(r.errors.length, 0);
});

test('DriveHOS: token eskirsa refresh token bilan BIR MARTA yangilanadi', async () => {
  let refreshes = 0;
  const f = fakeFetch(({ url, headers, body }) => {
    if (url.pathname === '/v1/auth/refresh') {
      refreshes++;
      assert.equal(body.refresh_token, 'r1');
      return { body: { data: { access_token: 'new', refresh_token: 'r2' } } };
    }
    if (headers.Authorization !== 'Bearer new') return { status: 401, body: { data: { error_code: 'TOKEN_EXPIRED' } } };
    if (url.pathname === '/v1/companies') {
      return { body: { data: { companies: ['A', 'B', 'C'].map((id) => ({ company_id: id, company_name: id, active_driver: 1 })) } } };
    }
    if (url.pathname === '/v1/hos/list') return { body: { data: { drivers: [hosRow(headers.company_id)] } } };
    return { body: { data: {} } };
  });
  const saved = [];
  const ctx = { token: 'old', refreshToken: 'r1', fetch: f, onTokens: (t) => saved.push(t) };
  const r = await dh().fetchDrivers(ctx);
  assert.equal(r.drivers.length, 3);
  assert.equal(refreshes, 1);
  assert.deepEqual(saved, [{ token: 'new', refreshToken: 'r2' }]);
});

test('DriveHOS: refresh ham o\'lgan bo\'lsa — auth xatosi (butun yig\'ish to\'xtaydi)', async () => {
  const f = fakeFetch(({ url }) => {
    if (url.pathname === '/v1/auth/refresh') return { status: 400, body: { description: 'invalid refresh' } };
    return { status: 401, body: { description: 'token expired' } };
  });
  await assert.rejects(dh().fetchDrivers({ token: 'old', refreshToken: 'r1', fetch: f }), (e) => e.auth === true);
});

test('DriveHOS certify: bulk-certification + sessiyani yopish', async () => {
  let open = false;
  const f = fakeFetch(({ url, body, headers }) => {
    assert.equal(headers.company_id, 'A');
    if (url.pathname === '/v1/events/bulk-certification') {
      assert.equal(body.driver_id, 'd1');
      open = true;
      return { body: { data: {} } };
    }
    if (url.pathname.startsWith('/v1/hos-sessions/info/')) return { body: { data: open ? { has_session: true, session_id: 's9' } : { has_session: false } } };
    if (url.pathname === '/v1/hos-sessions/close') {
      open = false;
      return { body: { data: {} } };
    }
    throw new Error(url.pathname);
  });
  const r = await dh().certifyDriver({ token: 'tok', fetch: f }, { driverId: 'd1', companyId: 'A' });
  assert.equal(r.ok, true);
  assert.equal(r.warning, null);
  assert.equal(open, false);
});

test('Five: -1 — null, o\'chirilgan kompaniyalar o\'tkaziladi, total noto\'g\'ri bo\'lsa ham to\'liq', async () => {
  const f = fakeFetch(({ url, headers }) => {
    assert.equal(headers.Authorization, 'raw-token');
    if (url.pathname === '/api/dashboards/v3/getcompanies') {
      return { body: { companies: [
        { uid: 'A', name: 'Alpha', is_active: 1 },
        { uid: 'B', name: 'Beta', is_active: 0 },
        { uid: 'C', name: 'Gamma', is_active: '0' },
        { uid: 'D', name: 'Delta', status: 'inactive' },
        { uid: 'E', name: 'Echo', active: 'false' },
      ] } };
    }
    if (url.pathname === '/api/logs/v3/logslist') {
      assert.equal(headers.companyuid, 'A');
      assert.equal(url.searchParams.get('date'), logDate());
      const page = Number(url.searchParams.get('page'));
      const all = Array.from({ length: 130 }, (_, i) => ({
        driverUid: `f${i}`,
        driver: { first_name: 'Ann', second_name: `No${i}` },
        vehicle: { truck_number: `T${i}` },
        status: { status: i % 2 ? 'sleep' : 'driving' },
        timers: { driving: i === 0 ? -1 : 300, shift: 600, cycle: 3000, break: -1 },
        tracking: { lat: 35, lng: -90, address: 'Memphis, TN', date: '2026-10-06T10:00:00Z', speed: 60 },
        isOnline: true,
      }));
      // total "sahifadagi soni" ma'nosida — ishonilsa 30 ta yo'qolardi.
      return { body: { data: all.slice((page - 1) * 100, page * 100), total: 100 } };
    }
    throw new Error(url.pathname);
  });
  const five = createFive({ base: 'https://five.test/api', sleep: noSleep });
  const r = await five.fetchDrivers({ token: 'raw-token', fetch: f });
  assert.equal(r.drivers.length, 130);
  assert.ok(!f.calls.some((c) => ['B', 'C', 'D', 'E'].includes(c.headers.companyuid)));
  const d0 = r.drivers[0];
  assert.equal(d0.driveRemainingMin, null);
  assert.equal(d0.breakRemainingMin, null);
  assert.equal(d0.cycleRemainingMin, 3000);
  assert.equal(d0.companyId, 'A');
  assert.equal(d0.lon, -90);
  assert.equal(d0.statusCode, 'DS_D');
  assert.equal(r.drivers[1].status, 'sleeper');
  assert.match(d0.logUrl, /#\/company\/A\/logs-edit\?id=f0/);
  assert.equal(five.certifyDriver, undefined);
});

test('sample: companyId va koordinata bor, 100 faol + 10 eski', async () => {
  const now = Date.parse('2026-10-06T12:00:00Z');
  const { drivers } = await sample.fetchDrivers({ now });
  assert.equal(drivers.length, 110);
  assert.ok(drivers.every((d) => d.companyId && d.lat !== null && d.lon !== null));
  const active = drivers.filter((d) => now - Date.parse(d.lastUpdate) < 24 * 3600_000);
  assert.equal(active.length, 100);
  assert.equal(new Set(active.map((d) => d.companyId)).size, 8);
  // Harakatdagi haydovchi vaqt o'tishi bilan siljiydi (DOT yo'nalishi uchun).
  const later = (await sample.fetchDrivers({ now: now + 120_000 })).drivers;
  const moving = drivers.find((d) => d.status === 'driving');
  const same = later.find((d) => d.driverId === moving.driverId);
  assert.notEqual(`${moving.lat},${moving.lon}`, `${same.lat},${same.lon}`);
});

test('parseTokenInput: JSON (access+refresh), xom token, "Bearer", qo\'shtirnoqli', () => {
  assert.deepEqual(parseTokenInput('{"access_token":"a","refresh_token":"r"}'), { token: 'a', refreshToken: 'r' });
  assert.deepEqual(parseTokenInput('  abc.def  '), { token: 'abc.def', refreshToken: null });
  assert.deepEqual(parseTokenInput('Bearer xyz'), { token: 'xyz', refreshToken: null });
  assert.deepEqual(parseTokenInput('"quoted"'), { token: 'quoted', refreshToken: null });
});

test('parseForm: oxirgi o\'zgarish, joriy qiymat, formasiz hodisalar hisobga olinmaydi', async () => {
  const { parseForm } = await import('../src/providers/drivehos.js');
  const ev = (t, trailers, shipping_docs, status = 'ACTIVE') => ({ event_start_time: t, trailers, shipping_docs, event_status: status, lat: 35.1, lon: -90.05, calculated_location: 'Memphis, TN' });
  const r = parseForm([
    { date: '2026-10-01', events: [ev('2026-10-01T08:00:00Z', 'T1', 'B1'), ev('2026-10-01T09:00:00Z', '', '')] },
    { date: '2026-10-03', events: [ev('2026-10-03T10:00:00Z', 'T2', 'B1'), ev('2026-10-03T11:00:00Z', 'T9', 'B9', 'INACTIVE')] },
    { date: '2026-10-04', events: [ev('2026-10-04T10:00:00Z', 'T2', 'B1')] },
  ]);
  assert.deepEqual(r, { changedAt: '2026-10-03T10:00:00.000Z', trailer: 'T2', shipping: 'B1', from: { trailer: 'T1', shipping: 'B1' }, location: 'Memphis, TN', lat: 35.1, lon: -90.05 });
  const none = { location: null, lat: null, lon: null };
  assert.deepEqual(parseForm([{ events: [ev('2026-10-01T08:00:00Z', 'T1', 'B1')] }]), { changedAt: null, trailer: 'T1', shipping: 'B1', from: null, ...none });
  assert.deepEqual(parseForm([]), { changedAt: null, trailer: null, shipping: null, from: null, ...none });
});

test('DriveHOS: forma fonda yig\'iladi — avval pending, keyin qiymat; faqat faol haydovchilar', async () => {
  const t = Date.parse('2026-10-06T12:00:00Z');
  const p = createDriveHos({ id: 'leader', name: 'L', site: 's.test', tenantId: 'T', base: 'https://api.test', sleep: noSleep, now: () => t });
  const asked = [];
  const f = fakeFetch(({ url, headers }) => {
    if (url.pathname === '/v1/companies') return { body: { data: { companies: [{ company_id: 'A', company_name: 'A', active_driver: 2 }] } } };
    if (url.pathname === '/v1/hos/list') {
      return { body: { data: { drivers: [hosRow(1, { last_sync: '2026-10-06 11:00:00' }), hosRow(2, { last_sync: '2026-10-01 11:00:00' })] } } };
    }
    if (url.pathname === '/v1/events') {
      asked.push(url.searchParams.get('driver_id'));
      assert.equal(headers.company_id, 'A');
      return { body: { data: { events: [{ events: [{ event_status: 'ACTIVE', event_start_time: '2026-10-04T10:00:00Z', trailers: 'TR9', shipping_docs: 'BOL1' }] }] } } };
    }
    return { body: { data: {} } };
  });
  const first = await p.fetchDrivers({ token: 'tok', fetch: f });
  assert.deepEqual(first.drivers.find((d) => d.driverId === 'd1').formChange, { pending: true });
  assert.equal(first.drivers.find((d) => d.driverId === 'd2').formChange, null); // nofaol
  await p.whenFormsIdle();
  assert.deepEqual(asked, ['d1']);
  const second = await p.fetchDrivers({ token: 'tok', fetch: f });
  assert.equal(second.drivers.find((d) => d.driverId === 'd1').formChange.trailer, 'TR9');
  await p.whenFormsIdle();
  assert.deepEqual(asked, ['d1']); // 15 daqiqa keshda — qayta so'ralmaydi
});

test("parseIssues: tur bo'yicha guruhlash, sanalar, 8 kundan eskisi tashlanadi", async () => {
  const { parseIssues } = await import('../src/providers/drivehos.js');
  const now = Date.parse('2026-10-06T12:00:00Z');
  const r = parseIssues(
    [
      { date: '2026-09-20', errors: [{ error_type: 'ODOMETER_JUMP', description: 'Odometer jump' }] },
      { date: '2026-09-30', errors: [{ error_type: 'ODOMETER_JUMP', description: 'Odometer jump' }], violations: [{ violation_type: 'DRIVING_11', description: '11h' }] },
      { date: '2026-10-02', errors: [{ error_type: 'ODOMETER_JUMP', description: 'Odometer jump', work_date: '2026-10-01' }, { error_type: 'NO_DOCS' }] },
    ],
    { now },
  );
  assert.deepEqual(r.errors[0], { type: 'ODOMETER_JUMP', text: 'Odometer jump', count: 2, dates: ['2026-10-01', '2026-09-30'] });
  assert.equal(r.errors[1].text, 'No docs');
  assert.equal(r.violations[0].count, 1);
});

test('issuesFromTexts: bir xil matn bitta guruhga', async () => {
  const { issuesFromTexts } = await import('../src/providers/normalize.js');
  const r = issuesFromTexts(['A', 'B', 'A', ''], [null]);
  assert.deepEqual(r.errors.map((g) => [g.text, g.count]), [['A', 2], ['B', 1]]);
  assert.deepEqual(r.violations, []);
});
