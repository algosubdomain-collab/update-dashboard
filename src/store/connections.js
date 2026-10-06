import { getDb } from './db.js';
import { open, seal } from './secret.js';

const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);

// Shifrlangan qism — JSON: { token, refreshToken }. Refresh token ham
// access token kabi maxfiy, shuning uchun ikkalasi birga shifrlanadi.
function unpack(sealed) {
  const plain = open(sealed);
  if (plain === null) return null;
  try {
    const obj = JSON.parse(plain);
    if (obj && typeof obj.token === 'string') return { token: obj.token, refreshToken: obj.refreshToken ?? null };
  } catch {
    /* eski format: faqat token */
  }
  return { token: plain, refreshToken: null };
}

// Brauzerga ketadigan ko'rinish — tokenning o'zi hech qachon qaytarilmaydi.
export async function listConnections(login) {
  const db = await getDb();
  const { rows } = await db.query(
    'SELECT provider, secret, meta, updated_at FROM connections WHERE login = $1 ORDER BY updated_at',
    [login],
  );
  return rows.map((r) => {
    const s = unpack(r.secret);
    return {
      provider: r.provider,
      meta: r.meta ?? {},
      updatedAt: iso(r.updated_at),
      // Kalit almashgan bo'lsa token ochilmaydi — foydalanuvchi qayta ulashi kerak.
      readable: s !== null,
      autoRefresh: Boolean(s?.refreshToken),
    };
  });
}

export async function getConnection(login, provider) {
  const db = await getDb();
  const { rows } = await db.query(
    'SELECT secret, meta FROM connections WHERE login = $1 AND provider = $2',
    [login, provider],
  );
  if (!rows[0]) return null;
  const s = unpack(rows[0].secret);
  return s ? { ...s, meta: rows[0].meta ?? {} } : null;
}

// Fon yangilanishi uchun: kim qaysi platformaga ulangan.
export async function listAllConnections() {
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT c.login, c.provider FROM connections c JOIN users u ON u.login = c.login WHERE u.role = 'user'`,
  );
  return rows;
}

export async function saveConnection(login, provider, { token, refreshToken = null }, meta = {}) {
  const db = await getDb();
  await db.query(
    `INSERT INTO connections (login, provider, secret, meta, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (login, provider) DO UPDATE SET secret = EXCLUDED.secret, meta = EXCLUDED.meta, updated_at = now()`,
    [login, provider, seal(JSON.stringify({ token, refreshToken })), JSON.stringify(meta)],
  );
}

// Manba tokenni o'zi yangilaganda (refresh) — faqat sir yangilanadi.
// Ulanish shu orada o'chirilgan bo'lsa qayta tiklanmaydi.
export async function updateConnectionTokens(login, provider, { token, refreshToken = null }) {
  const db = await getDb();
  await db.query(
    'UPDATE connections SET secret = $3, updated_at = now() WHERE login = $1 AND provider = $2',
    [login, provider, seal(JSON.stringify({ token, refreshToken }))],
  );
}

export async function deleteConnection(login, provider) {
  const db = await getDb();
  const { rowCount } = await db.query('DELETE FROM connections WHERE login = $1 AND provider = $2', [login, provider]);
  return rowCount === 1;
}
