// Tarozi ogohlantirishi: haydovchining YO'LIDA 5 km ichida tarozi bo'lsa
// yonadi, o'tib ketgach o'chadi. Platforma yo'nalish bermaydi — uni ketma-ket
// ikki nuqtadan hisoblaymiz.

import { angleDiff, bearingDeg, distanceKm } from './geo.js';

export const RADIUS_KM = 5;
// Chiqish radiusi va burchagi kirishnikidan kengroq (gisterezis): chegarada
// turgan haydovchida ogohlantirish har yangilanishda o'chib-yonib turmasin.
export const EXIT_RADIUS_KM = 5.5;
export const ENTER_ANGLE = 75;
export const EXIT_ANGLE = 100;
// GPS shovqini 300 m dan kam siljishda yo'nalishni tasodifiy qiladi.
export const MIN_MOVE_KM = 0.3;
// Bundan katta sakrash — ma'lumot uzilishi (masalan bir kun yangilanmagan);
// bunday ikki nuqta orasidagi azimut hozirgi yo'nalishni bildirmaydi.
export const MAX_JUMP_KM = 80;
// Yo'nalish shu vaqtdan eski bo'lsa — haydovchi to'xtab turibdi, uning
// "oldi" noma'lum. Aks holda tarozi yonidagi to'xtash joyida turgan
// haydovchida ogohlantirish tun bo'yi yonib turardi.
export const HEADING_TTL_MS = 15 * 60_000;
// Tarozining o'ziga juda yaqin bo'lganda azimut ma'nosiz (bir necha metr
// xatolik burchakni butunlay o'zgartiradi) — bu yerda burchakka qaramaymiz.
const AT_STATION_KM = 0.15;

// Izni yangilash. Saqlanadigan nuqta — "langar": haydovchi undan 300 m
// uzoqlashganda yo'nalish hisoblanadi va langar ko'chadi. Kichik siljishlar
// yig'ilib borishi uchun langar har safar emas, faqat shunda ko'chadi.
export function updateTrack(prev, pos, now) {
  if (!prev) return { lat: pos.lat, lon: pos.lon, heading: null, headingAt: null };
  const d = distanceKm(prev.lat, prev.lon, pos.lat, pos.lon);
  if (d < MIN_MOVE_KM) return prev;
  if (d > MAX_JUMP_KM) return { lat: pos.lat, lon: pos.lon, heading: null, headingAt: null };
  return { lat: pos.lat, lon: pos.lon, heading: bearingDeg(prev.lat, prev.lon, pos.lat, pos.lon), headingAt: now };
}

export function currentHeading(track, now) {
  if (!track || track.heading === null || track.heading === undefined) return null;
  if (track.headingAt === null || track.headingAt === undefined || now - track.headingAt > HEADING_TTL_MS) return null;
  return track.heading;
}

// prevAlert — avvalgi yonib turgan ogohlantirish (yoki null).
// stations — atrofdagi tarozilar ({id, name, lat, lon, ...}).
export function evaluateAlert({ pos, heading, prevAlert, stations }) {
  if (prevAlert) {
    const s = stations.find((x) => x.id === prevAlert.id) ?? prevAlert;
    const d = distanceKm(pos.lat, pos.lon, s.lat, s.lon);
    let keep = d <= EXIT_RADIUS_KM;
    if (keep && heading !== null && d > AT_STATION_KM) {
      // Tarozi orqada qoldi — o'tib ketdi.
      keep = angleDiff(bearingDeg(pos.lat, pos.lon, s.lat, s.lon), heading) <= EXIT_ANGLE;
    }
    // Yo'nalish noma'lum bo'lsa yonib turganini O'CHIRMAYMIZ: haydovchi
    // tarozi oldida to'xtagan bo'lishi mumkin, u hali o'tmagan.
    if (keep) return { id: s.id, name: s.name, lat: s.lat, lon: s.lon, source: s.source, distanceKm: round1(d) };
  }

  // Yangi ogohlantirish faqat yo'nalish ma'lum bo'lganda.
  if (heading === null) return null;
  let best = null;
  for (const s of stations) {
    const d = distanceKm(pos.lat, pos.lon, s.lat, s.lon);
    if (d > RADIUS_KM) continue;
    if (d > AT_STATION_KM && angleDiff(bearingDeg(pos.lat, pos.lon, s.lat, s.lon), heading) > ENTER_ANGLE) continue;
    if (!best || d < best.d) best = { s, d };
  }
  if (!best) return null;
  const { s, d } = best;
  return { id: s.id, name: s.name, lat: s.lat, lon: s.lon, source: s.source, distanceKm: round1(d) };
}

const round1 = (n) => Math.round(n * 10) / 10;
