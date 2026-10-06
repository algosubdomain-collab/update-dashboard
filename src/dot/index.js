// DOT xizmati: fleet yangilanganda har haydovchiga tarozi ogohlantirishini
// qo'shadi. Haydovchilar izi (langar nuqta + yo'nalish + yonib turgan
// ogohlantirish) xotirada va bazada saqlanadi.

import { config } from '../config.js';
import * as store from '../store/index.js';
import { currentHeading, evaluateAlert, RADIUS_KM, updateTrack } from './alert.js';
import { fetchGoogle } from './google.js';
import { fetchOverpass } from './overpass.js';
import { createTileCache, mergeStations, tilesAround } from './tiles.js';

export async function loadFromSources(bbox, { fetch = globalThis.fetch, onAttempt } = {}) {
  const { stations: osm } = await fetchOverpass(bbox, { urls: config.overpassUrls, fetch, onAttempt });
  const sources = ['osm'];
  let stations = osm;
  if (config.googleMapsApiKey) {
    try {
      const g = await fetchGoogle(bbox, { apiKey: config.googleMapsApiKey, fetch });
      stations = mergeStations(osm, g);
      sources.push('google');
    } catch (err) {
      // Google — qo'shimcha. U yiqilsa OSM natijasi baribir to'g'ri, lekin
      // katakni "google bilan to'ldirilgan" deb belgilamaymiz.
      console.warn('[dot] Google Places xatosi:', err.message);
    }
  }
  return { stations, sources };
}

export function createDotService({ tiles, loadTracks = store.loadTracks, saveTracks = store.saveTracks, now = () => Date.now() }) {
  const tracks = new Map(); // "login:provider" → Map(driverId → track)

  async function tracksFor(login, provider) {
    const key = `${login}:${provider}`;
    if (!tracks.has(key)) tracks.set(key, await loadTracks(login, provider));
    return tracks.get(key);
  }

  return {
    // drivers — yagona ko'rinishdagi ro'yxat. Har biriga `dot` maydoni qo'shiladi.
    async annotate(login, provider, drivers) {
      const t = now();
      const map = await tracksFor(login, provider);
      const withPos = drivers.filter((d) => d.lat !== null && d.lon !== null);

      // Avval harakatdagilar kataklari — byudjet cheklangan, yo'lda
      // ketayotganlar uchun ogohlantirish muhimroq.
      const ordered = [...withPos].sort((a, b) => (b.speedMph ?? 0) - (a.speedMph ?? 0));
      const ids = [];
      const seen = new Set();
      for (const d of ordered) {
        for (const id of tilesAround(d.lat, d.lon, RADIUS_KM)) {
          if (!seen.has(id)) {
            seen.add(id);
            ids.push(id);
          }
        }
      }
      await tiles.ensure(ids);

      const changed = new Map();
      for (const d of drivers) {
        if (d.lat === null || d.lon === null) {
          d.dot = { alert: null, heading: null, ready: false };
          continue;
        }
        const prev = map.get(d.driverId);
        const pos = { lat: d.lat, lon: d.lon };
        const track = updateTrack(prev, pos, t);
        const heading = currentHeading(track, t);
        const near = tiles.stationsNear(d.lat, d.lon, RADIUS_KM + 1);
        let alert = evaluateAlert({ pos, heading, prevAlert: prev?.alert ?? null, stations: near.stations });
        // Katak hali yuklanmagan bo'lsa yonib turgan ogohlantirishni
        // o'chirmaymiz — bu "tarozi yo'q" emas, "hali bilmaymiz" degani.
        if (!alert && prev?.alert && !near.complete) alert = prev.alert;

        const next = { ...track, alert };
        if (!prev || prev.lat !== next.lat || prev.lon !== next.lon || prev.heading !== next.heading || JSON.stringify(prev.alert) !== JSON.stringify(alert)) {
          changed.set(d.driverId, next);
        }
        map.set(d.driverId, next);
        d.dot = { alert, heading: heading === null ? null : Math.round(heading), ready: near.complete };
      }
      if (changed.size) {
        await saveTracks(login, provider, changed).catch((err) => console.error('[dot] izlarni saqlab bo\'lmadi:', err.message));
      }
      return drivers;
    },

    forget(login) {
      for (const k of tracks.keys()) if (k.startsWith(`${login}:`)) tracks.delete(k);
    },
  };
}

// Server uchun yagona nusxa.
let service = null;
export function dotService() {
  if (!service) {
    const tiles = createTileCache({
      store: { getTiles: store.getTiles, saveTile: store.saveTile },
      loadFromSources: (bbox) => loadFromSources(bbox),
      roundMs: config.refreshIntervalSec * 1000,
      log: (m) => console.log(m),
    });
    service = createDotService({ tiles });
    service.tiles = tiles;
  }
  return service;
}
