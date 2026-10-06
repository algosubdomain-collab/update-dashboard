import { createHash, randomBytes } from 'node:crypto';
import { getDb } from './db.js';

const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);

export async function countUsers() {
  const db = await getDb();
  const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
  return rows[0].n;
}

export async function getUser(login) {
  const db = await getDb();
  const { rows } = await db.query('SELECT login, role, password_hash FROM users WHERE login = $1', [login]);
  return rows[0] ? { login: rows[0].login, role: rows[0].role, passwordHash: rows[0].password_hash } : null;
}

export async function listUsers() {
  const db = await getDb();
  const { rows } = await db.query(`
    SELECT u.login, u.role, u.created_at,
           coalesce(array_agg(c.provider) FILTER (WHERE c.provider IS NOT NULL), '{}') AS providers
      FROM users u LEFT JOIN connections c ON c.login = u.login
     GROUP BY u.login ORDER BY u.role, u.login`);
  return rows.map((r) => ({ login: r.login, role: r.role, createdAt: iso(r.created_at), providers: r.providers }));
}

// Login band bo'lsa false — chaqiruvchi 409 qaytaradi.
export async function createUser({ login, role, passwordHash }) {
  const db = await getDb();
  const { rowCount } = await db.query(
    'INSERT INTO users (login, role, password_hash) VALUES ($1, $2, $3) ON CONFLICT (login) DO NOTHING',
    [login, role, passwordHash],
  );
  return rowCount === 1;
}

// Parol almashganda hamma eski sessiyalar ham o'chadi: parolni almashtirish
// ko'pincha "kimdir kirib olgan" degan shubha bilan qilinadi.
export async function setPassword(login, passwordHash) {
  const db = await getDb();
  return db.tx(async (t) => {
    const { rowCount } = await t.query(
      'UPDATE users SET password_hash = $2, updated_at = now() WHERE login = $1',
      [login, passwordHash],
    );
    await t.query('DELETE FROM sessions WHERE login = $1', [login]);
    return rowCount === 1;
  });
}

// CASCADE tufayli ulanishlar, board, sozlamalar, sessiyalar ham ketadi.
export async function deleteUser(login) {
  const db = await getDb();
  const { rowCount } = await db.query('DELETE FROM users WHERE login = $1', [login]);
  return rowCount === 1;
}

// ── Sessiyalar ─────────────────────────────────────────────────────────────
// Bazada tokenning o'zi emas, xeshi saqlanadi: baza nusxasi sizib chiqsa,
// undan tirik sessiyani tiklab bo'lmaydi.

const hashToken = (t) => createHash('sha256').update(t).digest('hex');

export async function createSession(login, ttlDays) {
  const db = await getDb();
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO sessions (token_hash, login, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
    [hashToken(token), login, ttlDays],
  );
  return token;
}

export async function getSessionUser(token) {
  if (!token) return null;
  const db = await getDb();
  const { rows } = await db.query(
    `SELECT u.login, u.role FROM sessions s JOIN users u ON u.login = s.login
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function deleteSession(token) {
  if (!token) return;
  const db = await getDb();
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function purgeExpiredSessions() {
  const db = await getDb();
  await db.query('DELETE FROM sessions WHERE expires_at <= now()');
}
