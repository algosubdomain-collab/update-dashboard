import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchAllPages } from '../src/providers/paginate.js';
import { mapLimit } from '../src/providers/pool.js';
import { request } from '../src/providers/http.js';
import { fakeFetch, noSleep } from './helpers.js';

const make = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: from + i }));

test('to\'liq bo\'lmagan sahifa — oxiri; total ga qaralmaydi', async () => {
  // API "total" ni noto'g'ri beradi (sahifadagi son) — total ga ishonsak
  // birinchi sahifadan keyin to'xtab, 150 tani yo'qotardik.
  const data = make(250);
  const r = await fetchAllPages(async (p) => ({ items: data.slice(p * 100, p * 100 + 100), total: 100 }), { pageSize: 100 });
  assert.equal(r.items.length, 250);
  assert.equal(r.pages, 3);
});

test('aniq 100 ta bo\'lsa, bo\'sh sahifa bilan tugaydi', async () => {
  const data = make(200);
  const r = await fetchAllPages(async (p) => data.slice(p * 100, p * 100 + 100), { pageSize: 100 });
  assert.equal(r.items.length, 200);
  assert.equal(r.pages, 3);
});

test('server limitni kichraytirsa (50), "yana bor" ishorasi bilan davom etadi', async () => {
  const data = make(120);
  const r = await fetchAllPages(
    async (p) => ({ items: data.slice(p * 50, p * 50 + 50), more: (p + 1) * 50 < 120 }),
    { pageSize: 100 },
  );
  assert.equal(r.items.length, 120);
});

test('sahifa parametrini e\'tiborsiz qoldiradigan API — cheksiz takrorlanmaydi', async () => {
  let calls = 0;
  const r = await fetchAllPages(async () => {
    calls++;
    return make(100);
  }, { pageSize: 100, maxPages: 50 });
  assert.equal(r.items.length, 100);
  assert.equal(r.repeated, true);
  assert.equal(calls, 2);
});

test('sahifalar chegarasi — truncated belgisi', async () => {
  let n = 0;
  const r = await fetchAllPages(async () => make(10, (n++) * 10), { pageSize: 10, maxPages: 3 });
  assert.equal(r.items.length, 30);
  assert.equal(r.truncated, true);
});

test('mapLimit: parallellik chegarasi va xato izolyatsiyasi', async () => {
  let active = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    if (x === 4) throw new Error('boom');
    return x * 2;
  });
  assert.equal(peak, 3);
  assert.equal(out[3].ok, false);
  assert.equal(out[6].value, 14);
});

test('request: 429 va 5xx da qayta urinadi, keyin javob beradi', async () => {
  const f = fakeFetch((_c, n) => (n === 1 ? { status: 429 } : n === 2 ? { status: 503 } : { body: { ok: 1 } }));
  const r = await request('https://x.test/a', { fetch: f, sleep: noSleep });
  assert.equal(f.calls.length, 3);
  assert.deepEqual(r.body, { ok: 1 });
});

test('request: tarmoq xatosida ham qayta urinadi, chegaradan keyin xato', async () => {
  const f = fakeFetch(() => new Error('ECONNRESET'));
  await assert.rejects(request('https://x.test/a', { fetch: f, sleep: noSleep, retries: 2 }), /tarmoq xatosi/);
  assert.equal(f.calls.length, 3);
});
