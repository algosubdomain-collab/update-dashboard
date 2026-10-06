import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFleetCache } from '../src/fleet/cache.js';

const NOW = Date.parse('2026-10-06T12:00:00Z');

function provider(impl) {
  return { id: 'p', fetchDrivers: impl };
}

test('fleet: bir vaqtdagi so\'rovlar bitta yig\'ishga qo\'shiladi', async () => {
  let calls = 0;
  const fleet = createFleetCache({
    getConnection: async () => ({ token: 't', meta: {} }),
    getProvider: () => provider(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return { drivers: [{ driverId: '1', lastUpdate: new Date(NOW).toISOString() }], errors: [] };
    }),
    now: () => NOW,
  });
  const [a, b, c] = await Promise.all([fleet.get('u', 'p'), fleet.get('u', 'p'), fleet.refresh('u', 'p')]);
  assert.equal(calls, 1);
  assert.equal(a.drivers.length, 1);
  assert.equal(b.drivers.length, 1);
  assert.ok(c);
});

test('fleet: faqat 24 soatda signal berganlar; yiqilgan yig\'ish eski ro\'yxatni o\'chirmaydi', async () => {
  let fail = false;
  const fleet = createFleetCache({
    getConnection: async () => ({ token: 't', meta: {} }),
    getProvider: () => provider(async () => {
      if (fail) throw Object.assign(new Error('token rad etildi'), { auth: true });
      return {
        drivers: [
          { driverId: 'fresh', lastUpdate: new Date(NOW - 3600_000).toISOString() },
          { driverId: 'old', lastUpdate: new Date(NOW - 30 * 3600_000).toISOString() },
          { driverId: 'unknown', lastUpdate: null },
        ],
        errors: [{ companyId: 'c', company: 'C', message: '503' }],
      };
    }),
    now: () => NOW,
  });
  let v = await fleet.get('u', 'p');
  assert.deepEqual(v.drivers.map((d) => d.driverId), ['fresh', 'unknown']);
  assert.equal(v.hiddenInactive, 1);
  assert.equal(v.errors[0].company, 'C');

  fail = true;
  await fleet.refresh('u', 'p');
  v = await fleet.get('u', 'p');
  assert.equal(v.drivers.length, 2); // eski ro'yxat turibdi
  assert.equal(v.authError, true);
  assert.match(v.error, /token/);
});

test('fleet: kesh foydalanuvchi:platforma bo\'yicha alohida', async () => {
  const fleet = createFleetCache({
    getConnection: async (login) => ({ token: login, meta: {} }),
    getProvider: () => provider(async ({ token }) => ({ drivers: [{ driverId: token, lastUpdate: null }], errors: [] })),
    now: () => NOW,
  });
  assert.equal((await fleet.get('a', 'p')).drivers[0].driverId, 'a');
  assert.equal((await fleet.get('b', 'p')).drivers[0].driverId, 'b');
  fleet.forget('a');
  assert.deepEqual(fleet.keys(), ['b:p']);
});
