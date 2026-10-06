// Ma'lumotlar bazasiga ulanish. Ikki xil "dvigatel" bitta interfeys ortida:
//   - DATABASE_URL berilsa — haqiqiy Postgres (`pg`), Render'da shu ishlaydi;
//   - berilmasa — PGlite (WASM'dagi haqiqiy Postgres), faqat lokal ishlash uchun.
// Ikkalasida ham AYNAN BIR XIL SQL ishlaydi, shuning uchun lokal sinov
// production'dagi so'rovlarni ham tekshirgan bo'ladi (pg-mem kabi soxta
// emulyatorlar SQL'ning bir qismini qo'llab-quvvatlamaydi).

import { config } from '../config.js';
import { MIGRATIONS } from './schema.js';

let dbPromise = null;

export function getDb() {
  if (!dbPromise) dbPromise = open();
  return dbPromise;
}

async function open() {
  let db;
  if (config.databaseUrl) {
    db = await openPg(config.databaseUrl);
  } else {
    // Production'da jimgina efemer bazaga tushib qolish — har deploy'da
    // hamma narsani yo'qotish degani. Bu yerda ochiq xato afzal.
    if (config.isProduction) {
      throw new Error('DATABASE_URL berilmagan. Production\'da lokal baza ishlatilmaydi.');
    }
    db = await openPglite(config.dataDir);
  }
  await migrate(db);
  return db;
}

async function openPg(url) {
  const { default: pg } = await import('pg');
  // Render'ning tashqi ulanish satri SSL talab qiladi, ichki (bir regiondagi)
  // satr esa SSL'siz ishlaydi. URL'da sslmode bo'lsa pg o'zi hal qiladi.
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  pool.on('error', (err) => console.error('[db] pool xatosi:', err.message));
  return {
    kind: 'postgres',
    query: (text, params) => pool.query(text, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (t, p) => client.query(t, p) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function openPglite(dir) {
  let PGlite;
  try {
    ({ PGlite } = await import('@electric-sql/pglite'));
  } catch {
    throw new Error('DATABASE_URL yo\'q va @electric-sql/pglite o\'rnatilmagan (npm install).');
  }
  // dir === ':memory:' testlarda ishlatiladi.
  const pg = dir === ':memory:' ? new PGlite() : new PGlite(dir);
  await pg.waitReady;
  // PGlite bitta ulanishli: parallel tranzaksiyalar bir-birining ichiga
  // tushib qolmasligi uchun ularni navbatga qo'yamiz.
  let chain = Promise.resolve();
  return {
    kind: 'pglite',
    query: (text, params) => pg.query(text, params),
    tx(fn) {
      const run = chain.then(() => pg.transaction((t) => fn({ query: (q, p) => t.query(q, p) })));
      chain = run.catch(() => {});
      return run;
    },
    close: () => pg.close(),
  };
}

// Oddiy versiyali migratsiya: har bir qadam bir marta, tranzaksiya ichida.
// "CREATE IF NOT EXISTS" ning o'zi yetmaydi — keyinroq ustun qo'shish yoki
// o'zgartirish kerak bo'lganda qaysi qadam bajarilganini bilish shart.
async function migrate(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await db.query('SELECT version FROM schema_migrations');
  const done = new Set(rows.map((r) => Number(r.version)));
  for (const [i, sql] of MIGRATIONS.entries()) {
    const version = i + 1;
    if (done.has(version)) continue;
    await db.tx(async (t) => {
      for (const stmt of splitSql(sql)) await t.query(stmt);
      await t.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    });
    console.log(`[db] migratsiya ${version} bajarildi`);
  }
}

// Parametrli so'rov protokoli bir nechta buyruqni bittada qabul qilmaydi,
// shuning uchun migratsiyani ";" bo'yicha bo'lamiz (sxemada ";" faqat
// buyruq oxirida keladi).
function splitSql(sql) {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.trim().replace(/;$/, ''))
    .filter(Boolean);
}

// Diagnostika buyruqlari uchun FAQAT O'QISH rejimi (scripts/dot-check.js).
// Server ishlab turganda uning bazasiga hech narsa yozilmasligi kafolatlanishi
// kerak, shuning uchun:
//   - Postgres: sessiya darajasida read-only — yozishga urinish xato beradi;
//   - PGlite: bitta jarayonli baza, ikkinchi jarayon ochsa shikastlashi
//     mumkin — papkaning vaqtinchalik nusxasini ochamiz.
// Migratsiya ishlatilmaydi (u yozish amali).
export async function openReadOnly() {
  if (config.databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1, options: '-c default_transaction_read_only=on' });
    return { kind: 'postgres (read-only)', query: (t, p) => pool.query(t, p), close: () => pool.end() };
  }
  const { cp, mkdtemp, rm, access } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  try {
    await access(config.dataDir);
  } catch {
    return null;
  }
  const dir = await mkdtemp(join(tmpdir(), 'ud-ro-'));
  await cp(config.dataDir, dir, { recursive: true });
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite(dir);
  await pg.waitReady;
  return {
    kind: `pglite (nusxa: ${dir})`,
    query: (t, p) => pg.query(t, p),
    close: async () => {
      await pg.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

// Testlar uchun: har test o'z toza bazasini ochadi.
export async function openTestDb() {
  const db = await openPglite(':memory:');
  await migrate(db);
  dbPromise = Promise.resolve(db);
  return db;
}
