// OpenStreetMap / Overpass orqali tarozilarni olish. Bepul, kalit kerak emas,
// lekin ommaviy serverlar: tez-tez band bo'ladi va suiiste'molni bloklaydi —
// shuning uchun bu modul faqat katak keshi to'lmaganda chaqiriladi.

export class SourceError extends Error {}

// Uchala teg ham amalda ishlatiladi: CAT Scale tarmog'i asosan
// amenity=weighbridge, shtat tarozilari highway=weigh_station.
export function buildQuery({ south, west, north, east }) {
  const bbox = `${south},${west},${north},${east}`;
  return `[out:json][timeout:25];
(
  nwr["highway"="weigh_station"](${bbox});
  nwr["amenity"="weighbridge"](${bbox});
  nwr["man_made"="weighbridge"](${bbox});
);
out center tags;`;
}

export function parseResponse(json) {
  if (!json || !Array.isArray(json.elements)) throw new SourceError('Overpass javobi tushunarsiz');
  // TUZOQ: server tomonida timeout/xotira tugashi HTTP 200 va BO'SH
  // elements bilan qaytadi, sababi esa `remark` da yoziladi. Buni
  // muvaffaqiyat deb olsak, tarozisi bor hudud 30 kunga "bo'sh" deb
  // keshlanib qoladi. Muvaffaqiyatli javobda remark bo'lmaydi.
  if (json.remark) throw new SourceError(`Overpass remark: ${String(json.remark).slice(0, 200)}`);

  const out = [];
  for (const el of json.elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const t = el.tags ?? {};
    out.push({
      id: `osm:${el.type}/${el.id}`,
      name: t.name || t.operator || t.brand || (t.highway === 'weigh_station' ? 'Weigh station' : 'Truck scale'),
      lat,
      lon,
      kind: t.highway === 'weigh_station' ? 'weigh_station' : 'scale',
      source: 'osm',
    });
  }
  return out;
}

// Mirror'larni ketma-ket sinaydi; birinchi muvaffaqiyatli javob qaytadi.
// Hammasi yiqilsa — xato (kesh yozilmaydi).
export async function fetchOverpass(bbox, { urls, fetch = globalThis.fetch, timeoutMs = 35000, onAttempt } = {}) {
  const query = buildQuery(bbox);
  const errors = [];
  for (const url of urls) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          // Overpass operatorlari o'zini tanitgan mijozlarni so'raydi.
          'User-Agent': 'update-dashboard/0.1 (weigh-station tile cache)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new SourceError(`HTTP ${res.status}`);
      const json = await res.json().catch(() => {
        throw new SourceError('JSON emas (server band bo\'lsa HTML qaytaradi)');
      });
      const stations = parseResponse(json);
      onAttempt?.({ url, ok: true, ms: Date.now() - started, count: stations.length });
      return { stations, url };
    } catch (err) {
      const msg = err?.name === 'TimeoutError' ? 'timeout' : err.message;
      onAttempt?.({ url, ok: false, ms: Date.now() - started, error: msg });
      errors.push(`${new URL(url).host}: ${msg}`);
    }
  }
  throw new SourceError(`Overpass mirror'larining hammasi yiqildi — ${errors.join('; ')}`);
}
