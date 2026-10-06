// DOT tarozilari diagnostikasi:  npm run dot:check -- <lat> <lon>
//
// Zanjirni ketma-ket ko'rsatadi — qaysi bo'g'in ishlamayotgani darrov bilinsin:
//   1) sozlama (mirror'lar, Google kaliti, radius);
//   2) kesh holati (bazadagi kataklar, yoshi, atrofdagi tarozilar);
//   3) manbaning JONLI javobi (har mirror alohida, remark bilan).
// Buyruq FAQAT O'QIYDI: bazaga hech narsa yozmaydi, server keshini bosmaydi.

import { config } from '../src/config.js';
import { RADIUS_KM } from '../src/dot/alert.js';
import { distanceKm } from '../src/dot/geo.js';
import { fetchGoogle } from '../src/dot/google.js';
import { buildQuery, parseResponse } from '../src/dot/overpass.js';
import { TILE_DEG, tileBbox, tileId, tilesAround } from '../src/dot/tiles.js';
import { openReadOnly } from '../src/store/db.js';

const [lat, lon] = process.argv.slice(2).map(Number);
if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
  console.error('Foydalanish: npm run dot:check -- <lat> <lon>\nMasalan:      npm run dot:check -- 41.53 -88.08');
  process.exit(2);
}

const h = (s) => console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 60 - s.length))}`);
const near = (list) =>
  list
    .map((s) => ({ ...s, d: distanceKm(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .map((s) => `   ${s.d.toFixed(1).padStart(6)} km  ${s.name}  [${s.source}] ${s.lat.toFixed(5)},${s.lon.toFixed(5)}`)
    .join('\n') || '   (yo\'q)';

h('1. Sozlama');
console.log(`   nuqta:        ${lat}, ${lon}`);
console.log(`   katak:        ${tileId(lat, lon)} (${TILE_DEG}°), radius ${RADIUS_KM} km`);
console.log(`   kerakli:      ${tilesAround(lat, lon, RADIUS_KM).join(', ')}`);
console.log(`   overpass:     ${config.overpassUrls.join(', ')}`);
console.log(`   google:       ${config.googleMapsApiKey ? 'kalit bor (to\'ldiruvchi yoqilgan)' : 'kalit yo\'q — faqat OSM'}`);
console.log(`   baza:         ${config.databaseUrl ? 'DATABASE_URL' : `PGlite (${config.dataDir}/)`}`);

h('2. Kesh (bazada)');
let db = null;
try {
  db = await openReadOnly();
  if (!db) console.log('   baza hali yaratilmagan (server bir marta ham ishga tushmagan)');
  else {
    console.log(`   ${db.kind}`);
    const ids = tilesAround(lat, lon, RADIUS_KM);
    const { rows } = await db.query(
      `SELECT tile, stations, sources, fetched_at FROM dot_tiles WHERE tile IN (SELECT jsonb_array_elements_text($1::jsonb))`,
      [JSON.stringify(ids)],
    );
    const byId = new Map(rows.map((r) => [r.tile, r]));
    const cached = [];
    for (const id of ids) {
      const r = byId.get(id);
      if (!r) {
        console.log(`   ${id}: KESHDA YO'Q — server hali yuklamagan yoki yuklash yiqilgan`);
        continue;
      }
      const age = (Date.now() - new Date(r.fetched_at).getTime()) / 86400_000;
      console.log(`   ${id}: ${r.stations.length} ta tarozi, ${age.toFixed(1)} kun oldin (${r.sources.join('+')})${age > 30 ? ' — ESKIRGAN' : ''}`);
      cached.push(...r.stations);
    }
    console.log(`   eng yaqinlari:\n${near(cached)}`);
  }
} catch (err) {
  console.log(`   o'qib bo'lmadi: ${err.message}`);
} finally {
  await db?.close().catch(() => {});
}

h('3. Jonli manba (keshga yozilmaydi)');
const bbox = tileBbox(tileId(lat, lon));
const query = buildQuery(bbox);
let live = null;
for (const url of config.overpassUrls) {
  const t = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'update-dashboard/0.1 (dot:check)' },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(40000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* HTML xato sahifasi */
    }
    const ms = Date.now() - t;
    if (!res.ok) {
      console.log(`   ✗ ${url}  HTTP ${res.status}, ${ms} ms`);
      continue;
    }
    if (!json) {
      console.log(`   ✗ ${url}  JSON emas, ${ms} ms`);
      continue;
    }
    if (json.remark) {
      console.log(`   ✗ ${url}  200, lekin remark: ${String(json.remark).slice(0, 140)} (${ms} ms) — bu muvaffaqiyat EMAS`);
      continue;
    }
    live = parseResponse(json);
    console.log(`   ✓ ${url}  ${live.length} ta tarozi, ${ms} ms`);
    break;
  } catch (err) {
    console.log(`   ✗ ${url}  ${err.name === 'TimeoutError' ? 'timeout' : err.message}, ${Date.now() - t} ms`);
  }
}
if (live) console.log(`   eng yaqinlari (shu katakda):\n${near(live)}`);
else console.log('   OSM: hech bir mirror javob bermadi — server ham hozir katak yuklay olmaydi (keyinroq qayta urinadi).');

if (config.googleMapsApiKey) {
  try {
    const g = await fetchGoogle(bbox, { apiKey: config.googleMapsApiKey });
    console.log(`   ✓ Google Places: ${g.length} ta\n${near(g)}`);
  } catch (err) {
    console.log(`   ✗ Google Places: ${err.message}`);
  }
}
console.log('');
