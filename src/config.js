// Muhit sozlamalari bitta joyda o'qiladi — qolgan modullar process.env ga
// to'g'ridan-to'g'ri tegmasin, aks holda qaysi o'zgaruvchi qayerda
// ishlatilayotganini kuzatib bo'lmay qoladi.

// .env faqat lokal ishlash uchun. Render'da u yo'q va o'zgaruvchilar
// panel orqali beriladi, shuning uchun fayl topilmasa jim o'tamiz.
// --env-file-if-exists bayrog'i Node 20 ning hamma versiyasida yo'q,
// loadEnvFile esa 20.12 dan beri bor.
try {
  process.loadEnvFile();
} catch {
  /* .env yo'q — normal holat */
}

const env = process.env;

function int(name, fallback) {
  const n = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name, fallback) {
  const v = (env[name] ?? '').trim().toLowerCase();
  if (v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v);
}

// Render har bir xizmatga RENDER=true qo'yadi. NODE_ENV ni unutib qo'yish
// oson, shuning uchun "production"ni ikkalasidan biri bo'yicha aniqlaymiz.
const isProduction = env.NODE_ENV === 'production' || env.RENDER === 'true';

export const config = {
  isProduction,
  // Render PORT ni o'zi beradi; qattiq yozilgan port u yerda ishlamaydi.
  port: int('PORT', 3000),
  // Konteyner ichida 127.0.0.1 ga bog'lansa Render proksisi yetib bormaydi.
  host: env.HOST || '0.0.0.0',

  databaseUrl: env.DATABASE_URL || '',
  // DATABASE_URL bo'lmaganda lokal PGlite shu papkada yashaydi.
  dataDir: env.DATA_DIR || 'data',

  defaultAdminLogin: env.DEFAULT_ADMIN_LOGIN || 'admin',
  defaultAdminPassword: env.DEFAULT_ADMIN_PASSWORD || '',

  // HTTPS ortida cookie Secure bo'lishi shart, lokal http da esa Secure
  // cookie brauzer tomonidan saqlanmaydi va login "ishlamay" qoladi.
  cookieSecure: bool('COOKIE_SECURE', isProduction),
  sessionTtlDays: int('SESSION_TTL_DAYS', 14),

  // "Default user sifatida davom etish" — faqat lokal sinov uchun. Production'da
  // HECH QACHON yoqilmaydi (o'zgaruvchi berilsa ham): ochiq internetda bu
  // parolsiz kirish degani.
  devLogin: !isProduction && bool('DEV_LOGIN', true),

  refreshIntervalSec: Math.max(15, int('REFRESH_INTERVAL_SEC', 60)),
  // "Faol" haydovchi — shu oynada signal bergan.
  activeWindowHours: int('ACTIVE_WINDOW_HOURS', 24),

  // ELD tokenlarini bazada shifrlash kaliti. Baza zaxira nusxasi yoki ulanish
  // satri sizib chiqsa ham tokenlar ochiq matnda yotmasin.
  secretKey: env.SECRET_KEY || '',

  googleMapsApiKey: env.GOOGLE_MAPS_API_KEY || '',
  // Vergul bilan ajratilgan ro'yxat — ommaviy Overpass serverlari tez-tez
  // band bo'ladi, shuning uchun bir nechtasini ketma-ket sinaymiz.
  overpassUrls: (env.OVERPASS_URLS ||
    'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter,https://overpass.private.coffee/api/interpreter')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Render proksisi ortida haqiqiy IP X-Forwarded-For da keladi. Lokal
  // ishlaganda bu sarlavhaga ishonish rate-limit'ni aylanib o'tishga yo'l
  // ochadi, shuning uchun faqat proksi ortida yoqiladi.
  trustProxy: bool('TRUST_PROXY', isProduction),
};
