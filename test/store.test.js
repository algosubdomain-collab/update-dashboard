// Saqlash qatlami haqiqiy Postgres SQL'i bilan (PGlite, xotirada) sinaladi.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { openTestDb } from '../src/store/db.js';
import * as store from '../src/store/index.js';
import { applyRowPatch, validateConfig } from '../src/store/boardModel.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { createRateLimiter } from '../src/auth/rateLimit.js';

before(async () => {
  await openTestDb();
  await store.createUser({ login: 'u1', role: 'user', passwordHash: 'x' });
  await store.createUser({ login: 'u2', role: 'user', passwordHash: 'x' });
});

const ctx = (now) => ({ now, by: 'Aziz' });

test('qator patch: oq ro\'yxat, bo\'sh qiymat maydonni o\'chiradi, bo\'sh qator saqlanmaydi', () => {
  const r1 = applyRowPatch(null, { status: 'All good', hacker: 'x', checkedAt: 'fake' }, ctx('T1'));
  assert.deepEqual(r1, { status: 'All good' });
  const r2 = applyRowPatch(r1, { status: '', responsible: '  Bekzod ' }, ctx('T1'));
  assert.deepEqual(r2, { responsible: 'Bekzod' });
  assert.equal(applyRowPatch(r2, { responsible: null }, ctx('T1')), null);
  assert.throws(() => applyRowPatch(null, { certified: '2026' }, ctx('T1')));
});

test('checked: allaqachon belgilangan qatorning vaqti o\'zgarmaydi', () => {
  const a = applyRowPatch(null, { checked: true }, ctx('T1'));
  assert.deepEqual(a, { checkedAt: 'T1', checkedBy: 'Aziz' });
  const b = applyRowPatch(a, { checked: true }, { now: 'T2', by: 'Other' });
  assert.deepEqual(b, a);
  assert.equal(applyRowPatch(b, { checked: false }, ctx('T3')), null);
});

test('bulk: bitta tranzaksiya, mavjud checkedAt saqlanadi, bo\'sh qatorlar o\'chadi', async () => {
  await store.patchRows('u1', ['sample:1'], { checked: true }, ctx('2026-01-01T00:00:00.000Z'));
  const res = await store.patchRows('u1', ['sample:1', 'sample:2', 'sample:3'], { checked: true }, ctx('2026-02-02T00:00:00.000Z'));
  assert.equal(res['sample:1'].checkedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(res['sample:2'].checkedAt, '2026-02-02T00:00:00.000Z');
  let rows = await store.getRows('u1');
  assert.equal(Object.keys(rows).length, 3);

  await store.patchRows('u1', ['sample:1', 'sample:2', 'sample:3'], { checked: false }, ctx('x'));
  rows = await store.getRows('u1');
  assert.equal(Object.keys(rows).length, 0);
});

test('board foydalanuvchi bo\'yicha alohida', async () => {
  await store.patchRows('u1', ['sample:9'], { status: 'Offline' }, ctx('t'));
  assert.equal((await store.getRows('u2'))['sample:9'], undefined);
  assert.equal((await store.getRows('u1'))['sample:9'].status, 'Offline');
});

test('sozlama: standart qiymatlar, validatsiya, "me" faqat ro\'yxatdan', async () => {
  const def = await store.getConfig('u2');
  assert.deepEqual(def.statuses.map((s) => s.label), ['All good', 'Need to check', 'Check profile form', 'Offline']);
  assert.deepEqual(def.profileForms.map((s) => s.label), ['Filled', 'Needs update', 'Sent to driver', 'No response']);

  const saved = await store.saveConfig('u2', {
    ...def,
    responsibles: [{ label: 'Aziz', color: 'sky' }, { label: 'Bekzod', color: 'neon' }],
    me: 'Aziz',
    boards: [{ id: 'b1', name: 'East', companies: ['c-101', 'c-101', 'c-102'] }],
  });
  assert.equal(saved.responsibles[1].color, 'slate'); // noma'lum rang
  assert.deepEqual(saved.boards[0].companies, ['c-101', 'c-102']);
  assert.equal((await store.getConfig('u2')).me, 'Aziz');

  assert.equal(validateConfig({ ...def, responsibles: [], me: 'Ghost' }).me, '');
  assert.throws(() => validateConfig({ ...def, statuses: [{ label: 'A' }, { label: 'a' }] }), /takrorlangan/);
});

test('ulanish: token shifrlanadi, ro\'yxatda token qaytmaydi', async () => {
  await store.saveConnection('u1', 'leader', { token: 'secret-token', refreshToken: 'r' });
  const db = await store.getDb();
  const { rows } = await db.query('SELECT secret FROM connections WHERE login = $1', ['u1']);
  assert.ok(!rows[0].secret.includes('secret-token'));
  const list = await store.listConnections('u1');
  assert.equal(JSON.stringify(list).includes('secret-token'), false);
  assert.equal(list[0].autoRefresh, true);
  assert.deepEqual(await store.getConnection('u1', 'leader'), { token: 'secret-token', refreshToken: 'r', meta: {} });
  await store.updateConnectionTokens('u1', 'leader', { token: 'new', refreshToken: 'r2' });
  assert.equal((await store.getConnection('u1', 'leader')).token, 'new');
});

test('foydalanuvchi o\'chirilsa hamma ma\'lumoti ketadi (CASCADE)', async () => {
  await store.createUser({ login: 'gone', role: 'user', passwordHash: 'x' });
  await store.saveConnection('gone', 'sample', { token: 't' });
  await store.patchRows('gone', ['sample:1'], { status: 'x' }, ctx('t'));
  await store.saveConfig('gone', { statuses: [], profileForms: [], responsibles: [], boards: [] });
  await store.saveTracks('gone', 'sample', new Map([['d', { lat: 1, lon: 2, heading: null, headingAt: null, alert: null }]]));
  const token = await store.createSession('gone', 1);
  assert.equal((await store.getSessionUser(token)).login, 'gone');

  assert.equal(await store.deleteUser('gone'), true);
  const db = await store.getDb();
  for (const table of ['connections', 'board_rows', 'board_config', 'dot_tracks', 'sessions']) {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE login = $1`, ['gone']);
    assert.equal(rows[0].n, 0, table);
  }
  assert.equal(await store.getSessionUser(token), null);
});

test('parol almashsa eski sessiyalar o\'chadi', async () => {
  const t = await store.createSession('u2', 1);
  await store.setPassword('u2', 'y');
  assert.equal(await store.getSessionUser(t), null);
});

test('dot izlari: saqlanadi va qayta o\'qiladi', async () => {
  const alert = { id: 'osm:node/1', name: 'S', lat: 1, lon: 2, distanceKm: 1.2 };
  await store.saveTracks('u1', 'sample', new Map([['d1', { lat: 40, lon: -90, heading: 12.5, headingAt: 1_700_000_000_000, alert }]]));
  const m = await store.loadTracks('u1', 'sample');
  assert.deepEqual(m.get('d1'), { lat: 40, lon: -90, heading: 12.5, headingAt: 1_700_000_000_000, alert });
});

test('scrypt va rate-limit', async () => {
  const h = await hashPassword('correct horse');
  assert.equal(await verifyPassword('correct horse', h), true);
  assert.equal(await verifyPassword('wrong', h), false);

  let t = 0;
  const rl = createRateLimiter({ max: 10, windowMs: 15 * 60_000, now: () => t });
  for (let i = 0; i < 10; i++) assert.equal(rl.hit('1.2.3.4').ok, true);
  assert.equal(rl.hit('1.2.3.4').ok, false);
  assert.equal(rl.hit('5.6.7.8').ok, true);
  t += 15 * 60_000;
  assert.equal(rl.hit('1.2.3.4').ok, true);
});

test('requirement: haydovchi eslatmasi 280 belgigacha, kompaniya eslatmasi alohida va CASCADE', async () => {
  const r = applyRowPatch(null, { requirement: '  Call dispatch first ' }, ctx('t'));
  assert.deepEqual(r, { requirement: 'Call dispatch first' });
  assert.throws(() => applyRowPatch(null, { requirement: 'x'.repeat(281) }, ctx('t')));

  await store.createUser({ login: 'notes', role: 'user', passwordHash: 'x' });
  assert.equal(await store.setCompanyNote('notes', 'sample:c-101', '  Needs BOL photo '), 'Needs BOL photo');
  assert.deepEqual(await store.getCompanyNotes('notes'), { 'sample:c-101': 'Needs BOL photo' });
  assert.equal(await store.setCompanyNote('notes', 'sample:c-101', ''), null);
  assert.deepEqual(await store.getCompanyNotes('notes'), {});
  await store.setCompanyNote('notes', 'sample:c-102', 'x');
  await store.deleteUser('notes');
  const db = await store.getDb();
  const { rows } = await db.query('SELECT count(*)::int AS n FROM company_notes WHERE login = $1', ['notes']);
  assert.equal(rows[0].n, 0);
});
