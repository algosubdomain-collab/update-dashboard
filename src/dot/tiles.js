// Tarozilar keshi 0.5° li kataklar bo'yicha.
//
// Nega kataklar: har haydovchi uchun har yangilanishda so'rov yuborsak,
// 100 haydovchi × har daqiqa = kuniga o'n minglab so'rov — Overpass bloklaydi,
// Google esa minglab dollar oladi. Tarozilar ko'chmaydi: katak BIR MARTA
// yuklanadi, 30 kun saqlanadi, masofa hisobi butunlay lokal.

import { distanceKm } from './geo.js';

export const TILE_DEG = 0.5;
const DAY = 86400_000;

export function tileId(lat, lon) {
  return `${Math.floor(lat / TILE_DEG)}_${Math.floor(lon / TILE_DEG)}`;
}

export function tileBbox(id) {
  const [y, x] = id.split('_').map(Number);
  return { south: y * TILE_DEG, west: x * TILE_DEG, north: (y + 1) * TILE_DEG, east: (x + 1) * TILE_DEG };
}

// Radius chegarasidagi qo'shni kataklar ham kerak: haydovchi katak chetida
// bo'lsa, tarozi qo'shni katakda turishi mumkin.
export function tilesAround(lat, lon, radiusKm) {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  const ids = new Set();
  for (const la of [lat - dLat, lat + dLat]) for (const lo of [lon - dLon, lon + dLon]) ids.add(tileId(la, lo));
  ids.add(tileId(lat, lon));
  return [...ids];
}

// OSM va Google bir joyni ikki marta bersa — bitta qoldiramiz (OSM ustun:
// uning teglari aniqroq).
export function mergeStations(primary, extra, dupKm = 0.2) {
  const out = [...primary];
  for (const s of extra) {
    if (!out.some((p) => distanceKm(p.lat, p.lon, s.lat, s.lon) < dupKm)) out.push(s);
  }
  return out;
}

export function createTileCache({
  store, // { getTiles(ids) → Map, saveTile(id, stations, sources) }
  loadFromSources, // async (bbox) → { stations, sources }
  ttlMs = 30 * DAY,
  maxNewPerRound = 4,
  roundMs = 60_000,
  failBackoffMs = 10 * 60_000,
  now = () => Date.now(),
  log = () => {},
}) {
  const mem = new Map(); // id → { stations, fetchedAt }
  const failedUntil = new Map();
  const queued = new Set();
  const queue = [];
  let fetchTimes = [];
  let running = null;

  const fresh = (e) => e && now() - Date.parse(e.fetchedAt) < ttlMs;

  // Bir davrada nechta YANGI katak yuklanishi mumkin. Bir nechta foydalanuvchi
  // bir vaqtda yangilansa ham chegara umumiy.
  function budgetLeft() {
    const t = now();
    fetchTimes = fetchTimes.filter((x) => t - x < roundMs);
    return maxNewPerRound - fetchTimes.length;
  }

  // Katakni manbadan yuklash fon navbatida ketma-ket bajariladi: yangilanish
  // tarozilar yuklanishini kutib qolmaydi, yangi katak keyingi davrada ishlaydi.
  function pump() {
    if (running) return running;
    running = (async () => {
      while (queue.length && budgetLeft() > 0) {
        const id = queue.shift();
        queued.delete(id);
        if (fresh(mem.get(id))) continue;
        fetchTimes.push(now());
        try {
          const { stations, sources } = await loadFromSources(tileBbox(id));
          const entry = { stations, sources, fetchedAt: new Date(now()).toISOString() };
          await store.saveTile(id, stations, sources);
          mem.set(id, entry);
          log(`[dot] katak ${id}: ${stations.length} ta tarozi (${sources.join('+')})`);
        } catch (err) {
          // Muvaffaqiyatsiz yuklash keshlanmaydi — aks holda tarozisi bor hudud
          // "bo'sh" deb qoladi. Lekin har davrada qayta urinib serverni ham
          // bo'g'maymiz.
          failedUntil.set(id, now() + failBackoffMs);
          log(`[dot] katak ${id} yuklanmadi: ${err.message}`);
        }
      }
    })().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    // ids — muhimlik tartibida (avval harakatlanayotgan haydovchilar).
    async ensure(ids) {
      const unknown = ids.filter((id) => !mem.has(id));
      if (unknown.length) {
        const fromDb = await store.getTiles(unknown);
        for (const [id, e] of fromDb) mem.set(id, e);
      }
      for (const id of ids) {
        const e = mem.get(id);
        if (fresh(e)) continue;
        if ((failedUntil.get(id) ?? 0) > now()) continue;
        if (queued.has(id)) continue;
        queued.add(id);
        queue.push(id);
      }
      pump();
    },

    // Eskirgan katak ham ishlatiladi (yangilanguncha) — tarozilar 30 kunda
    // deyarli o'zgarmaydi, bo'sh qoldirgandan ko'ra eski ma'lumot yaxshi.
    stationsNear(lat, lon, radiusKm) {
      const out = [];
      let missing = false;
      for (const id of tilesAround(lat, lon, radiusKm)) {
        const e = mem.get(id);
        if (!e) {
          missing = true;
          continue;
        }
        for (const s of e.stations) {
          const d = distanceKm(lat, lon, s.lat, s.lon);
          if (d <= radiusKm) out.push({ ...s, distanceKm: d });
        }
      }
      return { stations: out, complete: !missing };
    },

    whenIdle: () => running ?? Promise.resolve(),
    stats: () => ({ memTiles: mem.size, queued: queue.length, failing: [...failedUntil].filter(([, u]) => u > now()).length }),
  };
}
