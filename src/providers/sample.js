// Namuna manba — tashqi API'siz, o'ylab topilgan, lekin "tirik" ma'lumot.
// Butun interfeysni (filtrlar, boardlar, DOT, certify) haqiqiy platformaga
// ulanmasdan sinash uchun. Ma'lumot urug'li tasodifiy generator bilan
// tuziladi: har yangilanishda bir xil haydovchilar, faqat joylashuvi va
// qoldiq vaqtlari vaqt o'tishi bilan o'zgaradi.

import { driverShape } from './normalize.js';

const COMPANIES = [
  ['c-101', 'Blue Ridge Freight'],
  ['c-102', 'Prairie Line Logistics'],
  ['c-103', 'Gulf Coast Carriers'],
  ['c-104', 'Summit Haulers'],
  ['c-105', 'Red Mesa Transport'],
  ['c-106', 'Lakeshore Express'],
  ['c-107', 'Ironwood Trucking'],
  ['c-108', 'Desert Star Lines'],
];

// Yirik shaharlar orasidagi yo'nalishlar (taxminan magistral bo'ylab).
const ROUTES = [
  [[41.88, -87.63], [39.77, -86.16], 'Chicago, IL', 'Indianapolis, IN'],
  [[32.78, -96.8], [29.76, -95.37], 'Dallas, TX', 'Houston, TX'],
  [[33.75, -84.39], [36.16, -86.78], 'Atlanta, GA', 'Nashville, TN'],
  [[34.05, -118.24], [36.17, -115.14], 'Los Angeles, CA', 'Las Vegas, NV'],
  [[39.74, -104.99], [40.76, -111.89], 'Denver, CO', 'Salt Lake City, UT'],
  [[35.15, -90.05], [34.75, -92.29], 'Memphis, TN', 'Little Rock, AR'],
  [[33.45, -112.07], [32.22, -110.97], 'Phoenix, AZ', 'Tucson, AZ'],
  [[39.96, -83.0], [40.44, -79.99], 'Columbus, OH', 'Pittsburgh, PA'],
  [[39.1, -94.58], [38.63, -90.2], 'Kansas City, MO', 'St. Louis, MO'],
  [[30.33, -81.66], [28.54, -81.38], 'Jacksonville, FL', 'Orlando, FL'],
];

const FIRST = ['James', 'Maria', 'Robert', 'Jose', 'Michael', 'Ana', 'David', 'Luis', 'Carlos', 'Daniel', 'Juan', 'Kevin', 'Brian', 'Angel', 'Eric', 'Sergio', 'Mark', 'Victor', 'Paul', 'Omar', 'Steven', 'Ivan', 'Tony', 'Hector', 'Ruslan', 'Aziz', 'Timur', 'Dmitri', 'Andre', 'Marcus'];
const LAST = ['Smith', 'Garcia', 'Johnson', 'Martinez', 'Brown', 'Lopez', 'Davis', 'Hernandez', 'Wilson', 'Gonzalez', 'Moore', 'Perez', 'Taylor', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Torres', 'Walker', 'Flores', 'Young', 'Rivera', 'Karimov', 'Petrov', 'Nguyen', 'Cruz', 'Reyes', 'Morales', 'Ortiz', 'Kim'];

const STATUSES = [
  ['driving', 'DS_D'],
  ['on_duty', 'DS_ON'],
  ['sleeper', 'DS_SB'],
  ['off_duty', 'DS_OFF'],
];

const TOTAL = 110; // 100 tasi faol, 10 tasi 24 soatdan beri jim — filtr sinovi uchun.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function haversineKm([la1, lo1], [la2, lo2]) {
  const R = 6371;
  const r = Math.PI / 180;
  const dLa = (la2 - la1) * r;
  const dLo = (lo2 - lo1) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function buildDriver(i, now) {
  const rand = rng(i * 7919 + 13);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const [companyId, company] = COMPANIES[i % COMPANIES.length];
  const route = ROUTES[Math.floor(rand() * ROUTES.length)];
  const [a, b, aName, bName] = route;
  const lenKm = haversineKm(a, b);

  // Holat: taxminan har 3-chi haydovchi yo'lda.
  const [status, statusCode] = rand() < 0.38 ? STATUSES[0] : pick(STATUSES.slice(1));
  const driving = status === 'driving';
  const speedMph = driving ? 52 + Math.floor(rand() * 14) : 0;

  // Harakatlanayotganlar yo'nalish bo'ylab borib-qaytadi (ping-pong),
  // shunda DOT yo'nalish hisobi haqiqiy harakatga o'xshab ishlaydi.
  const offset = rand() * lenKm * 2;
  let frac;
  if (driving) {
    const kmPerSec = (speedMph * 1.609) / 3600;
    const pos = (offset + (now / 1000) * kmPerSec) % (lenKm * 2);
    frac = pos <= lenKm ? pos / lenKm : 2 - pos / lenKm;
  } else {
    frac = offset / (lenKm * 2);
  }
  const lat = a[0] + (b[0] - a[0]) * frac;
  const lon = a[1] + (b[1] - a[1]) * frac;
  const near = frac < 0.5 ? aName : bName;
  const miles = Math.round(lenKm * Math.min(frac, 1 - frac) * 0.621);

  // Cycle'ni ataylab keng tarqatamiz: bir qismi 15 soatdan kam (qizil),
  // bir qismi 25 dan kam (sariq) — xabarnoma yorliqlarini ko'rish uchun.
  const cycleBase = rand() < 0.15 ? 120 + rand() * 700 : rand() < 0.2 ? 900 + rand() * 600 : 1500 + rand() * 2700;
  // Soatlik sekin kamayish — ma'lumot "tirik" ko'rinsin.
  const tick = driving ? Math.floor((now / 60000) % 60) : 0;
  const cycleRemainingMin = Math.max(0, Math.round(cycleBase - tick));
  const driveRemainingMin = Math.max(0, Math.round((rand() < 0.2 ? rand() * 90 : 90 + rand() * 570) - tick));
  const shiftRemainingMin = Math.max(driveRemainingMin, Math.round(driveRemainingMin + rand() * 180));
  const breakRemainingMin = driving ? Math.max(0, Math.round(rand() * 480 - tick)) : null;

  const violations = [];
  if (driveRemainingMin === 0 && driving) violations.push('11-hour driving limit');
  if (rand() < 0.04) violations.push('Missing certification');

  const inactive = i >= 100;
  const lastUpdate = inactive
    ? new Date(now - (26 + rand() * 72) * 3600_000).toISOString()
    : new Date(now - Math.floor(rand() * 15) * 60_000).toISOString();

  // Log formasi: trailer va shipping docs; ko'pchiligida so'nggi 10 kunda
  // o'zgargan, bir qismida o'zgarmagan.
  const trailer = `TR${4000 + Math.floor(rand() * 5000)}`;
  const shipping = `BOL-${100000 + Math.floor(rand() * 899999)}`;
  const changed = rand() < 0.85;
  const formChange = {
    changedAt: changed ? new Date(now - rand() * 9.5 * 86400_000).toISOString() : null,
    trailer,
    shipping: rand() < 0.1 ? null : shipping,
    from: changed ? { trailer: `TR${4000 + Math.floor(rand() * 5000)}`, shipping: `BOL-${100000 + Math.floor(rand() * 899999)}` } : null,
  };

  return driverShape({
    driverId: `s-${1000 + i}`,
    driverName: `${pick(FIRST)} ${pick(LAST)}`,
    truck: String(100 + Math.floor(rand() * 900)),
    company,
    companyId,
    vehicleId: `v-${2000 + i}`,
    // Truck o'chirilgani — kamdan-kam holat (faqat shunda nuqta ko'rsatiladi).
    truckActive: rand() < 0.05 ? false : true,
    status,
    statusCode,
    driveRemainingMin,
    shiftRemainingMin,
    cycleRemainingMin,
    breakRemainingMin,
    violations,
    location: miles < 3 ? near : `${miles} mi from ${near}`,
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    profileUpdatedAt: new Date(now - rand() * 6 * 86400_000).toISOString(),
    speedMph,
    online: !inactive,
    eldConnected: rand() < 0.95,
    lastUpdate,
    logUrl: null,
    formChange,
  });
}

export default {
  id: 'sample',
  name: 'Sample (demo data)',
  tokenHint: 'Namuna manba token talab qilmaydi — istalgan matn kiriting.',

  async fetchDrivers({ now = Date.now() } = {}) {
    const drivers = [];
    for (let i = 0; i < TOTAL; i++) drivers.push(buildDriver(i, now));
    const errors = [];
    // Kompaniya xatosini interfeysda ko'rish uchun: SAMPLE_FAIL_COMPANY=c-108
    const fail = process.env.SAMPLE_FAIL_COMPANY;
    if (fail) {
      const c = COMPANIES.find(([id]) => id === fail);
      if (c) {
        errors.push({ companyId: c[0], company: c[1], message: 'HTTP 503 (namuna xatosi)' });
        return { drivers: drivers.filter((d) => d.companyId !== fail), errors };
      }
    }
    return { drivers, errors };
  },

  async certifyDriver(_ctx, { driverId }) {
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 700));
    // Bir nechta haydovchida doimo xato — "Retry" holatini ko'rish uchun.
    const n = Number(String(driverId).replace(/\D/g, ''));
    if (n % 13 === 0) throw new Error('Log has unresolved edits (sample error)');
    return { ok: true };
  },
};
