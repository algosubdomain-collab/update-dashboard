import { getDb } from './db.js';

const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);

// ── Tarozi kataklari keshi ─────────────────────────────────────────────────

export async function getTiles(tileIds) {
  if (!tileIds.length) return new Map();
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT tile, stations, sources, fetched_at FROM dot_tiles
      WHERE tile IN (SELECT jsonb_array_elements_text($1::jsonb))`,
    [JSON.stringify(tileIds)],
  );
  return new Map(rows.map((r) => [r.tile, { stations: r.stations, sources: r.sources, fetchedAt: iso(r.fetched_at) }]));
}

export async function saveTile(tile, stations, sources) {
  const db = await getDb();
  await db.query(
    `INSERT INTO dot_tiles (tile, stations, sources, fetched_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (tile) DO UPDATE SET stations = EXCLUDED.stations, sources = EXCLUDED.sources, fetched_at = now()`,
    [tile, JSON.stringify(stations), JSON.stringify(sources)],
  );
}

export async function tileStats() {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT count(*)::int AS tiles, coalesce(sum(jsonb_array_length(stations)), 0)::int AS stations,
            min(fetched_at) AS oldest, max(fetched_at) AS newest FROM dot_tiles`,
  );
  const r = rows[0];
  return { tiles: r.tiles, stations: r.stations, oldest: iso(r.oldest), newest: iso(r.newest) };
}

// ── Haydovchi izlari (oxirgi nuqta + yo'nalish + yonib turgan ogohlantirish) ─
// Restart'dan keyin ham yo'nalish va yonib turgan ogohlantirish yo'qolmasin —
// aks holda har deploy'dan keyin hamma tarozi ogohlantirishi bir zumga o'chib qoladi.

export async function loadTracks(login, provider) {
  const db = await getDb();
  const { rows } = await db.query(
    'SELECT driver_id, lat, lon, heading, heading_at, alert FROM dot_tracks WHERE login = $1 AND provider = $2',
    [login, provider],
  );
  return new Map(rows.map((r) => [r.driver_id, { lat: r.lat, lon: r.lon, heading: r.heading, headingAt: r.heading_at ? new Date(r.heading_at).getTime() : null, alert: r.alert }]));
}

export async function saveTracks(login, provider, tracks) {
  if (!tracks.size) return;
  const db = await getDb();
  await db.query(
    `INSERT INTO dot_tracks (login, provider, driver_id, lat, lon, heading, heading_at, alert, updated_at)
     SELECT $1, $2, e.key, (e.value->>'lat')::float8, (e.value->>'lon')::float8,
            (e.value->>'heading')::float8,
            to_timestamp((e.value->>'headingAt')::float8 / 1000), e.value->'alert', now()
       FROM jsonb_each($3::jsonb) e
     ON CONFLICT (login, provider, driver_id) DO UPDATE
       SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, heading = EXCLUDED.heading, heading_at = EXCLUDED.heading_at,
           alert = EXCLUDED.alert, updated_at = now()`,
    [login, provider, JSON.stringify(Object.fromEntries(tracks))],
  );
}
