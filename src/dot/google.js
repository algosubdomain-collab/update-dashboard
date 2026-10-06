// Google Places — IXTIYORIY to'ldiruvchi. Places'da "weigh station" degan
// alohida tur yo'q, faqat matn bo'yicha qidiriladi: natija to'liq ham,
// toza ham emas. Shuning uchun u asosiy manba emas, faqat OSM'da
// belgilanmagan joylarni qo'shadi.

import { SourceError } from './overpass.js';

const QUERIES = ['weigh station', 'truck scale'];

export async function fetchGoogle(bbox, { apiKey, fetch = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const out = [];
  for (const textQuery of QUERIES) {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        // Faqat kerakli maydonlar — Places narxi so'ralgan maydonlarga bog'liq.
        'X-Goog-FieldMask': 'places.id,places.displayName,places.location',
      },
      body: JSON.stringify({
        textQuery,
        pageSize: 20,
        locationRestriction: {
          rectangle: {
            low: { latitude: bbox.south, longitude: bbox.west },
            high: { latitude: bbox.north, longitude: bbox.east },
          },
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new SourceError(`Google HTTP ${res.status} ${t.slice(0, 160)}`);
    }
    const json = await res.json();
    for (const p of json.places ?? []) {
      const lat = p.location?.latitude;
      const lon = p.location?.longitude;
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      out.push({
        id: `google:${p.id}`,
        name: p.displayName?.text || 'Weigh station',
        lat,
        lon,
        kind: 'weigh_station',
        source: 'google',
      });
    }
  }
  return out;
}
