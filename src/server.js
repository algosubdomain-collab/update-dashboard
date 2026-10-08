import { createServer } from 'node:http';
import { createApp } from './app.js';
import { hashPassword } from './auth/password.js';
import { config } from './config.js';
import { dotService } from './dot/index.js';
import { fleet, schedule, startBackgroundRefresh, stopBackgroundRefresh } from './fleet/index.js';
import * as store from './store/index.js';

async function main() {
  // Ochiq internetdagi ilova uchun xavfli sozlamalarda ishga tushmaymiz —
  // keyin "nega tokenlar ochiq yotibdi" deb topgandan ko'ra hozir to'xtagan yaxshi.
  if (config.isProduction && !config.secretKey) {
    throw new Error('SECRET_KEY berilmagan — ELD tokenlari shifrlanmay qoladi.');
  }

  const db = await store.getDb();
  console.log(`[db] ${db.kind}${db.kind === 'pglite' ? ` (${config.dataDir}/)` : ''}`);

  await ensureAdmin();

  const handle = createApp({ fleet, dot: dotService(), schedule });
  const server = createServer(handle);
  // Render proksisi ulanishlarni qayta ishlatadi; Node'ning standart 5 s
  // keep-alive'i proksinikidan qisqa bo'lsa, vaqti-vaqti bilan 502 chiqadi.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  server.listen(config.port, config.host, () => {
    console.log(`[http] http://${config.host}:${config.port} (cookie Secure: ${config.cookieSecure})`);
  });

  startBackgroundRefresh();
  setInterval(() => store.purgeExpiredSessions().catch(() => {}), 3600_000).unref();

  // Render deploy'da SIGTERM yuboradi — ochiq so'rovlarni tugatib, bazani
  // yopib chiqamiz (PGlite uchun bu ma'lumot butunligi uchun muhim).
  const shutdown = async (sig) => {
    console.log(`[server] ${sig}, to'xtatilmoqda`);
    stopBackgroundRefresh();
    server.close();
    setTimeout(() => process.exit(0), 8000).unref();
    await db.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Birinchi ishga tushishda owner akkaunti. Faqat foydalanuvchi umuman
// yo'q bo'lganda — aks holda .env dagi parol har restart'da owner parolini
// qayta yozib, panelda o'zgartirilganini bekor qilardi.
async function ensureAdmin() {
  if ((await store.countUsers()) > 0) return;
  let password = config.defaultAdminPassword;
  if (!password) {
    if (config.isProduction) throw new Error('DEFAULT_ADMIN_PASSWORD berilmagan — birinchi admin yaratilmaydi.');
    password = 'admin12345';
    console.warn('[auth] DEFAULT_ADMIN_PASSWORD yo\'q — lokal uchun vaqtinchalik parol: admin12345');
  }
  if (password.length < 8) throw new Error('DEFAULT_ADMIN_PASSWORD kamida 8 belgi bo\'lsin.');
  await store.createUser({ login: config.defaultAdminLogin, role: 'owner', passwordHash: await hashPassword(password) });
  console.log(`[auth] owner yaratildi: ${config.defaultAdminLogin}`);
}

main().catch((err) => {
  console.error('[server] ishga tushmadi:', err.message);
  process.exit(1);
});
