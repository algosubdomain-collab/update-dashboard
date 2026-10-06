import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentHeading, evaluateAlert, HEADING_TTL_MS, updateTrack } from '../src/dot/alert.js';
import { createDotService } from '../src/dot/index.js';
import { angleDiff, bearingDeg, distanceKm } from '../src/dot/geo.js';
import { fetchOverpass, parseResponse } from '../src/dot/overpass.js';
import { createTileCache, mergeStations, tileBbox, tileId, tilesAround } from '../src/dot/tiles.js';
import { fakeFetch } from './helpers.js';

// Shimolga qarab ketayotgan haydovchi: 1 km ≈ 0.009° kenglik.
const KM = 1 / 111.2;
const BASE = { lat: 40, lon: -90 };
const north = (km) => ({ lat: BASE.lat + km * KM, lon: BASE.lon });
const STATION = { id: 'osm:node/1', name: 'Test Scale', lat: north(3).lat, lon: BASE.lon, source: 'osm' };

test('geo: masofa, azimut, burchak farqi', () => {
  assert.ok(Math.abs(distanceKm(40, -90, 41, -90) - 111.2) < 0.5);
  assert.ok(Math.abs(bearingDeg(40, -90, 41, -90) - 0) < 0.01);
  assert.ok(Math.abs(bearingDeg(40, -90, 40, -89) - 90) < 0.5);
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(angleDiff(10, 350), 20);
  assert.equal(angleDiff(0, 180), 180);
});

test('trek: 300 m dan kam siljish yo\'nalishni o\'zgartirmaydi, langar joyida', () => {
  const t0 = updateTrack(null, north(0), 0);
  assert.equal(t0.heading, null);
  const t1 = updateTrack(t0, north(0.2), 1000);
  assert.equal(t1, t0); // 200 m — yetarli emas
  const t2 = updateTrack(t1, north(0.5), 2000);
  assert.ok(Math.abs(t2.heading) < 1 || Math.abs(t2.heading - 360) < 1);
  // Katta sakrash (ma'lumot uzilishi) — yo'nalish noma'lum.
  assert.equal(updateTrack(t2, north(200), 3000).heading, null);
});

test('trek: eski yo\'nalish (to\'xtab turgan) — noma\'lum', () => {
  const t = { lat: 40, lon: -90, heading: 0, headingAt: 0 };
  assert.equal(currentHeading(t, HEADING_TTL_MS - 1), 0);
  assert.equal(currentHeading(t, HEADING_TTL_MS + 1), null);
});

test('ogohlantirish: oldinda — yonadi, orqada — yonmaydi, yo\'nalishsiz — yangisi yo\'q', () => {
  // Shimolga ketyapti, tarozi 3 km oldinda.
  assert.equal(evaluateAlert({ pos: north(0), heading: 0, prevAlert: null, stations: [STATION] })?.id, STATION.id);
  // Janubga ketyapti — tarozi orqada.
  assert.equal(evaluateAlert({ pos: north(0), heading: 180, prevAlert: null, stations: [STATION] }), null);
  // 80° burchak — 75° dan tashqari.
  assert.equal(evaluateAlert({ pos: north(0), heading: 80, prevAlert: null, stations: [STATION] }), null);
  // Yo'nalish noma'lum — yangi ogohlantirish yo'q.
  assert.equal(evaluateAlert({ pos: north(0), heading: null, prevAlert: null, stations: [STATION] }), null);
  // 6 km uzoqda — yo'q.
  assert.equal(evaluateAlert({ pos: north(-3), heading: 0, prevAlert: null, stations: [STATION] }), null);
});

test('ogohlantirish: gisterezis va o\'tib ketgach o\'chish', () => {
  const on = evaluateAlert({ pos: north(0), heading: 0, prevAlert: null, stations: [STATION] });
  // 90° — kirish uchun yetmasdi (75°), lekin yonib turgani o'chmaydi (100°).
  assert.ok(evaluateAlert({ pos: north(0), heading: 90, prevAlert: on, stations: [STATION] }));
  // Yo'nalish noma'lum — yonib turgani o'chmaydi.
  assert.ok(evaluateAlert({ pos: north(1), heading: null, prevAlert: on, stations: [STATION] }));
  // Tarozidan 1 km o'tib ketdi — o'chadi.
  assert.equal(evaluateAlert({ pos: north(4), heading: 0, prevAlert: on, stations: [STATION] }), null);
});

test('Overpass: 200 + bo\'sh + remark — muvaffaqiyat EMAS', () => {
  assert.throws(() => parseResponse({ elements: [], remark: 'runtime error: Query timed out in "query" at line 3 after 26 seconds.' }), /remark/);
  const ok = parseResponse({ elements: [{ type: 'way', id: 5, center: { lat: 40, lon: -90 }, tags: { highway: 'weigh_station', name: 'I-80 WS' } }] });
  assert.equal(ok[0].name, 'I-80 WS');
  assert.equal(ok[0].lat, 40);
});

test('Overpass: band mirror\'dan keyingisiga o\'tadi', async () => {
  const f = fakeFetch(({ url }) => {
    if (url.host === 'a.test') return { status: 504, body: '<html>busy</html>' };
    if (url.host === 'b.test') return { body: { elements: [], remark: 'runtime error: timeout' } };
    return { body: { elements: [{ type: 'node', id: 1, lat: 40, lon: -90, tags: { amenity: 'weighbridge' } }] } };
  });
  const r = await fetchOverpass({ south: 40, west: -90, north: 40.5, east: -89.5 }, { urls: ['https://a.test/i', 'https://b.test/i', 'https://c.test/i'], fetch: f });
  assert.equal(r.url, 'https://c.test/i');
  assert.equal(r.stations.length, 1);
  // So'rovda uchala teg ham bor.
  const q = decodeURIComponent(String(f.calls[0].body).replace(/^data=/, ''));
  assert.match(q, /highway"="weigh_station/);
  assert.match(q, /amenity"="weighbridge/);
  assert.match(q, /man_made"="weighbridge/);
});

test('kataklar: id, bbox, chetdagi qo\'shnilar', () => {
  assert.equal(tileId(40.2, -89.7), '80_-180');
  assert.deepEqual(tileBbox('80_-180'), { south: 40, west: -90, north: 40.5, east: -89.5 });
  assert.equal(tilesAround(40.25, -89.75, 5).length, 1);
  // Katak chetida — qo'shni katak ham kerak.
  assert.ok(tilesAround(40.49, -89.75, 5).length >= 2);
});

test('mergeStations: 200 m ichidagi takror birlashadi', () => {
  const osm = [{ id: 'o', lat: 40, lon: -90 }];
  const g = [{ id: 'g1', lat: 40.0005, lon: -90 }, { id: 'g2', lat: 40.1, lon: -90 }];
  assert.deepEqual(mergeStations(osm, g).map((s) => s.id), ['o', 'g2']);
});

function memStore() {
  const tiles = new Map();
  return {
    tiles,
    getTiles: async (ids) => new Map(ids.filter((i) => tiles.has(i)).map((i) => [i, tiles.get(i)])),
    saveTile: async (id, stations, sources) => tiles.set(id, { stations, sources, fetchedAt: new Date().toISOString() }),
  };
}

test('katak keshi: bir marta yuklanadi, davr byudjeti, xato keshlanmaydi', async () => {
  let t = 1_000_000;
  const store = memStore();
  const loads = [];
  let fail = true;
  const cache = createTileCache({
    store,
    now: () => t,
    maxNewPerRound: 2,
    roundMs: 60_000,
    failBackoffMs: 300_000,
    loadFromSources: async (bbox) => {
      loads.push(bbox);
      if (fail && bbox.south === 0) throw new Error('overpass down');
      return { stations: [], sources: ['osm'] };
    },
  });
  await cache.ensure(['0_0', '1_1', '2_2', '3_3']);
  await cache.whenIdle();
  assert.equal(loads.length, 2); // byudjet: 2 ta
  assert.ok(!store.tiles.has('0_0')); // xato — keshga yozilmadi
  assert.ok(store.tiles.has('1_1'));

  t += 61_000;
  await cache.ensure(['0_0', '1_1', '2_2', '3_3']);
  await cache.whenIdle();
  // 0_0 backoff'da, 1_1 keshda — faqat 2_2 va 3_3.
  assert.equal(loads.length, 4);

  t += 400_000;
  fail = false;
  await cache.ensure(['0_0', '1_1', '2_2', '3_3']);
  await cache.whenIdle();
  assert.equal(loads.length, 5);
  assert.ok(store.tiles.has('0_0'));
});

test('DOT xizmati: yaqinlashganda yonadi, o\'tganda o\'chadi', async () => {
  let t = 0;
  const id = tileId(BASE.lat, BASE.lon);
  const tiles = createTileCache({
    store: memStore(),
    now: () => t,
    loadFromSources: async () => ({ stations: [STATION], sources: ['osm'] }),
  });
  const saved = [];
  const dot = createDotService({ tiles, now: () => t, loadTracks: async () => new Map(), saveTracks: async (_l, _p, m) => saved.push(m.size) });
  const drv = (p) => [{ driverId: 'x', lat: p.lat, lon: p.lon, speedMph: 60 }];

  let [d] = await dot.annotate('u', 'sample', drv(north(-1)));
  assert.equal(d.dot.alert, null); // birinchi nuqta — yo'nalish yo'q
  await tiles.whenIdle();
  assert.ok(tilesAround(BASE.lat, BASE.lon, 5).includes(id));

  t += 60_000;
  [d] = await dot.annotate('u', 'sample', drv(north(0.5)));
  assert.equal(d.dot.alert?.id, STATION.id);
  assert.equal(d.dot.alert.distanceKm, 2.5);

  t += 60_000;
  [d] = await dot.annotate('u', 'sample', drv(north(2.9)));
  assert.equal(d.dot.alert?.id, STATION.id);

  t += 60_000;
  [d] = await dot.annotate('u', 'sample', drv(north(4.5)));
  assert.equal(d.dot.alert, null);
  assert.ok(saved.length > 0);
});
