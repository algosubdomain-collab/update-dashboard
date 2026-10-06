import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coord, flag, isActive, normStatus, toIso, toMinutes } from '../src/providers/normalize.js';

test('toMinutes: har xil formatlar daqiqaga keladi', () => {
  assert.equal(toMinutes(30_600_000, { unit: 'ms' }), 510);
  assert.equal(toMinutes(30600, { unit: 's' }), 510);
  assert.equal(toMinutes(510), 510);
  assert.equal(toMinutes('510'), 510);
  assert.equal(toMinutes('8h 30m'), 510);
  assert.equal(toMinutes('8h'), 480);
  assert.equal(toMinutes('45m'), 45);
  assert.equal(toMinutes('8 hrs 30 min'), 510);
  assert.equal(toMinutes('1d 2h'), 1560);
  assert.equal(toMinutes('8:30'), 510);
  assert.equal(toMinutes('08:30:00'), 510);
  assert.equal(toMinutes('70:00'), 4200);
});

test('toMinutes: "ma\'lumot yo\'q" — null, 0 emas', () => {
  assert.equal(toMinutes(-1, { noData: [-1] }), null);
  assert.equal(toMinutes('-1', { noData: [-1] }), null);
  assert.equal(toMinutes(null), null);
  assert.equal(toMinutes(''), null);
  assert.equal(toMinutes('abc'), null);
  // Haqiqiy 0 — 0 bo'lib qoladi.
  assert.equal(toMinutes(0, { noData: [-1] }), 0);
  // Manfiy qoldiq (limitdan oshgan) — 0.
  assert.equal(toMinutes(-30), 0);
});

test('flag: false/0/"0"/"false"/"inactive" — hammasi false', () => {
  for (const v of [false, 0, '0', 'false', 'FALSE', 'no', 'inactive', 'Disabled', 'deactivated']) assert.equal(flag(v), false, String(v));
  for (const v of [true, 1, '1', 'true', 'yes', 'active', 'enabled']) assert.equal(flag(v), true, String(v));
  for (const v of [null, undefined, '', 'weird']) assert.equal(flag(v), null, String(v));
});

test('isActive: bir nechta maydondan birinchi aniq javob', () => {
  assert.equal(isActive({ active: 0 }), false);
  assert.equal(isActive({ is_active: '0' }), false);
  assert.equal(isActive({ status: 'inactive' }), false);
  assert.equal(isActive({ isActive: 'false' }), false);
  assert.equal(isActive({ active: true }), true);
  assert.equal(isActive({ name: 'x' }), null);
});

test('normStatus', () => {
  assert.equal(normStatus('DS_D'), 'driving');
  assert.equal(normStatus('DS_SB'), 'sleeper');
  assert.equal(normStatus('DS_PC'), 'off_duty');
  assert.equal(normStatus('DS_YM'), 'on_duty');
  assert.equal(normStatus('off-duty'), 'off_duty');
  assert.equal(normStatus('XYZ'), 'unknown');
  assert.equal(normStatus(null), 'unknown');
});

test('coord: 0,0 va chegaradan tashqari — null', () => {
  assert.deepEqual(coord(0, 0), { lat: null, lon: null });
  assert.deepEqual(coord(91, 10), { lat: null, lon: null });
  assert.deepEqual(coord('', 10), { lat: null, lon: null });
  assert.deepEqual(coord('41.5', '-87.2'), { lat: 41.5, lon: -87.2 });
});

test('toIso: zonasiz vaqt UTC deb olinadi (server zonasiga bog\'liq emas)', () => {
  assert.equal(toIso('2026-10-06 14:30:00'), '2026-10-06T14:30:00.000Z');
  assert.equal(toIso(1_760_000_000), new Date(1_760_000_000_000).toISOString());
  assert.equal(toIso(1_760_000_000_000), new Date(1_760_000_000_000).toISOString());
  assert.equal(toIso('garbage'), null);
});
