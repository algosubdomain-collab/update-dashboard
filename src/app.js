// HTTP ilova: marshrutlar, autentifikatsiya, xavfsizlik sarlavhalari.
// Server (src/server.js) va testlar shu funksiyadan foydalanadi.

import { randomBytes } from 'node:crypto';
import { burnPasswordCheck, hashPassword, loginProblem, passwordProblem, verifyPassword } from './auth/password.js';
import { createRateLimiter } from './auth/rateLimit.js';
import { config } from './config.js';
import { createRouter } from './http/router.js';
import { createStatic } from './http/static.js';
import { clientIp, HttpError, parseCookies, readJson, sameOrigin, sendJson, serializeCookie } from './http/util.js';
import { getProvider, listProviders, parseTokenInput } from './providers/index.js';
import * as store from './store/index.js';

const COOKIE = 'sid';
const MAX_BULK = 5000;

export function createApp({ fleet, dot, schedule = () => ({ intervalSec: null, nextAt: null }), publicDir = 'public', fetch = globalThis.fetch }) {
  const router = createRouter();
  const serveStatic = createStatic(publicDir);
  const loginLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60_000 });
  setInterval(() => loginLimiter.sweep(), 60_000).unref();

  // auth: null — ochiq; 'any' — kirgan bo'lsa bas; 'owner' / 'user' — rol.
  const route = (method, path, auth, handler) => router.add(method, path, { auth, handler });

  const sessionCookie = (token) =>
    serializeCookie(COOKIE, token, { maxAge: config.sessionTtlDays * 86400, secure: config.cookieSecure });
  const clearCookie = () => serializeCookie(COOKIE, '', { maxAge: 0, secure: config.cookieSecure });

  // ── Auth ────────────────────────────────────────────────────────────────
  route('POST', '/api/auth/login', null, async ({ req, res }) => {
    const ip = clientIp(req, config.trustProxy);
    const limit = loginLimiter.hit(ip);
    if (!limit.ok) {
      throw new HttpError(429, `Juda ko'p urinish. ${Math.ceil(limit.retryAfterSec / 60)} daqiqadan keyin qayta urining.`, {
        headers: { 'Retry-After': String(limit.retryAfterSec) },
      });
    }
    const body = await readJson(req);
    const login = String(body.login ?? '').trim();
    const password = String(body.password ?? '');
    const user = login ? await store.getUser(login) : null;
    if (!user) {
      await burnPasswordCheck(password);
      throw new HttpError(401, 'Login yoki parol noto\'g\'ri');
    }
    if (!(await verifyPassword(password, user.passwordHash))) throw new HttpError(401, 'Login yoki parol noto\'g\'ri');
    const token = await store.createSession(user.login, config.sessionTtlDays);
    return [200, { user: { login: user.login, role: user.role } }, { 'Set-Cookie': sessionCookie(token) }];
  });

  route('POST', '/api/auth/logout', null, async ({ req }) => {
    await store.deleteSession(parseCookies(req)[COOKIE]);
    return [200, { ok: true }, { 'Set-Cookie': clearCookie() }];
  });

  route('GET', '/api/auth/status', null, async ({ user }) => ({
    user: user ? { login: user.login, role: user.role } : null,
    devLogin: config.devLogin,
  }));

  // Lokal sinov: parolsiz "demo" foydalanuvchi sifatida kirish. Akkaunt
  // birinchi marta yaratiladi (tasodifiy parol bilan — u bilan baribir hech
  // kim kira olmaydi) va sample manbaga ulanadi, shunda darhol dashboard ochiladi.
  route('POST', '/api/auth/dev-login', null, async () => {
    if (!config.devLogin) throw new HttpError(404, 'topilmadi');
    const login = 'demo';
    if (!(await store.getUser(login))) {
      await store.createUser({ login, role: 'user', passwordHash: await hashPassword(randomBytes(24).toString('base64url')) });
    }
    if (!(await store.listConnections(login)).length) await store.saveConnection(login, 'sample', { token: 'demo' });
    const token = await store.createSession(login, config.sessionTtlDays);
    return [200, { user: { login, role: 'user' } }, { 'Set-Cookie': sessionCookie(token) }];
  });

  // ── Foydalanuvchilar (faqat owner) ──────────────────────────────────────
  route('GET', '/api/users', 'owner', async () => ({ users: await store.listUsers() }));

  route('POST', '/api/users', 'owner', async ({ req }) => {
    const body = await readJson(req);
    const login = String(body.login ?? '').trim();
    const problem = loginProblem(login) ?? passwordProblem(body.password);
    if (problem) throw new HttpError(400, problem);
    // Owner faqat oddiy foydalanuvchi yaratadi — ikkinchi owner yaratish
    // imkoni bo'lsa, owner sessiyasi o'g'irlansa butun tizim boy beriladi.
    const ok = await store.createUser({ login, role: 'user', passwordHash: await hashPassword(body.password) });
    if (!ok) throw new HttpError(409, 'Bunday login bor');
    return [201, { user: { login, role: 'user' } }];
  });

  route('PATCH', '/api/users/:login', 'owner', async ({ req, params }) => {
    const body = await readJson(req);
    const problem = passwordProblem(body.password);
    if (problem) throw new HttpError(400, problem);
    if (!(await store.setPassword(params.login, await hashPassword(body.password)))) throw new HttpError(404, 'Foydalanuvchi topilmadi');
    return { ok: true };
  });

  route('DELETE', '/api/users/:login', 'owner', async ({ params, user }) => {
    if (params.login === user.login) throw new HttpError(400, 'O\'zingizni o\'chira olmaysiz');
    if (!(await store.deleteUser(params.login))) throw new HttpError(404, 'Foydalanuvchi topilmadi');
    // Bazada CASCADE hammasini o'chirdi; xotiradagi kesh va izlar ham ketsin.
    fleet.forget(params.login);
    dot?.forget(params.login);
    return { ok: true };
  });

  // ── Platforma ulanishlari ───────────────────────────────────────────────
  route('GET', '/api/connections', 'user', async ({ user }) => ({
    providers: listProviders(),
    connections: await store.listConnections(user.login),
  }));

  route('PUT', '/api/connections/:provider', 'user', async ({ req, params, user }) => {
    const provider = getProvider(params.provider);
    if (!provider) throw new HttpError(404, 'Bu platforma hali qo\'llab-quvvatlanmaydi');
    const body = await readJson(req);
    const { token, refreshToken } = parseTokenInput(body.token);
    if (!token) throw new HttpError(400, 'Token kerak');
    if (token.length > 8000 || (refreshToken?.length ?? 0) > 8000) throw new HttpError(400, 'Token juda uzun');
    const meta = typeof body.meta === 'object' && body.meta ? body.meta : {};

    // Saqlashdan oldin sinaymiz: yaroqsiz token saqlansa, fon jarayoni uni
    // har daqiqada platformaga yuborib, akkauntni bloklatib qo'yishi mumkin.
    let summary;
    // Sinov paytida manba tokenni yangilasa, yangisi saqlanadi — eski access
    // token bilan saqlab qo'ysak, u bir necha daqiqada yana eskiradi.
    const fresh = { token, refreshToken };
    try {
      const ctx = { token, refreshToken, meta, fetch, onTokens: (t) => Object.assign(fresh, t) };
      if (provider.verifyToken) summary = await provider.verifyToken(ctx);
      else {
        const r = await provider.fetchDrivers(ctx);
        if (!r.drivers.length && r.errors.length) throw new Error(r.errors[0].message);
        summary = { drivers: r.drivers.length, companies: new Set(r.drivers.map((d) => d.companyId)).size };
      }
    } catch (err) {
      throw new HttpError(400, `Token ishlamadi: ${err.message}`);
    }
    await store.saveConnection(user.login, provider.id, fresh, meta);
    fleet.forget(user.login, provider.id);
    fleet.refresh(user.login, provider.id).catch(() => {});
    return { ok: true, summary, autoRefresh: Boolean(fresh.refreshToken) };
  });

  route('DELETE', '/api/connections/:provider', 'user', async ({ params, user }) => {
    await store.deleteConnection(user.login, params.provider);
    fleet.forget(user.login, params.provider);
    return { ok: true };
  });

  // ── Haydovchilar va certify ─────────────────────────────────────────────
  async function resolveProvider(user, requested) {
    const conns = await store.listConnections(user.login);
    if (requested) {
      if (!conns.some((c) => c.provider === requested)) throw new HttpError(404, 'Bu platforma ulanmagan');
      return requested;
    }
    if (!conns.length) throw new HttpError(409, 'Platforma ulanmagan', { code: 'not_connected' });
    return conns[0].provider;
  }

  route('GET', '/api/drivers', 'user', async ({ url, user }) => {
    const provider = await resolveProvider(user, url.searchParams.get('provider'));
    const p = getProvider(provider);
    const view = await fleet.get(user.login, provider);
    return { provider, supportsCertify: Boolean(p?.certifyDriver), schedule: schedule(), ...view };
  });

  // "Latest" — platformadan hozir yig'ish (fon jadvalini kutmasdan).
  route('POST', '/api/drivers/refresh', 'user', async ({ req, user }) => {
    const body = await readJson(req);
    const provider = await resolveProvider(user, body.provider);
    const p = getProvider(provider);
    const view = await fleet.refreshNow(user.login, provider);
    return { provider, supportsCertify: Boolean(p?.certifyDriver), schedule: schedule(), ...view };
  });

  route('POST', '/api/certify', 'user', async ({ req, user }) => {
    const body = await readJson(req);
    const providerId = await resolveProvider(user, body.provider);
    const provider = getProvider(providerId);
    if (!provider?.certifyDriver) throw new HttpError(400, 'Bu platformada certify yo\'q');
    const driver = fleet.findDriver(user.login, providerId, String(body.driverId ?? ''));
    if (!driver) throw new HttpError(404, 'Haydovchi topilmadi');
    const conn = await store.getConnection(user.login, providerId);
    if (!conn) throw new HttpError(409, 'Token o\'qilmadi — qayta ulang');
    let result;
    try {
      result = await provider.certifyDriver(
        { token: conn.token, refreshToken: conn.refreshToken, meta: conn.meta, fetch, onTokens: (t) => store.updateConnectionTokens(user.login, providerId, t) },
        { driverId: driver.driverId, companyId: driver.companyId },
      );
    } catch (err) {
      throw new HttpError(502, err.message || 'Certify xatosi');
    }
    const key = `${providerId}:${driver.driverId}`;
    const row = await store.setCertified(user.login, key, new Date().toISOString());
    return { key, row, warning: result?.warning ?? null };
  });

  // ── Board ───────────────────────────────────────────────────────────────
  route('GET', '/api/board', 'user', async ({ user }) => ({ rows: await store.getRows(user.login) }));

  async function checkedBy(user) {
    const cfg = await store.getConfig(user.login);
    return cfg.me || user.login;
  }

  route('PUT', '/api/board', 'user', async ({ req, user }) => {
    const body = await readJson(req);
    if (!store.validRowKey(body.key)) throw new HttpError(400, 'key noto\'g\'ri');
    const rows = await store.patchRows(user.login, [body.key], body.patch, { now: new Date().toISOString(), by: await checkedBy(user) });
    return { key: body.key, row: rows[body.key] };
  });

  route('POST', '/api/board/bulk', 'user', async ({ req, user }) => {
    const body = await readJson(req);
    const keys = Array.isArray(body.keys) ? [...new Set(body.keys)] : null;
    if (!keys || !keys.length) throw new HttpError(400, 'keys bo\'sh');
    if (keys.length > MAX_BULK) throw new HttpError(400, `bir so'rovda ${MAX_BULK} tadan ko'p emas`);
    if (!keys.every(store.validRowKey)) throw new HttpError(400, 'key noto\'g\'ri');
    const rows = await store.patchRows(user.login, keys, body.patch, { now: new Date().toISOString(), by: await checkedBy(user) });
    return { rows };
  });

  route('GET', '/api/board-config', 'user', async ({ user }) => ({ config: await store.getConfig(user.login) }));

  route('PUT', '/api/board-config', 'user', async ({ req, user }) => {
    const body = await readJson(req);
    return { config: await store.saveConfig(user.login, body.config ?? body) };
  });

  // ── Kompaniya eslatmalari (requirements) ───────────────────────────────
  route('GET', '/api/company-notes', 'user', async ({ user }) => ({ notes: await store.getCompanyNotes(user.login) }));

  route('PUT', '/api/company-notes', 'user', async ({ req, user }) => {
    const body = await readJson(req);
    // Kalit board qatori kaliti bilan bir xil shaklda: "provider:companyId".
    if (!store.validRowKey(body.key)) throw new HttpError(400, 'key noto\'g\'ri');
    if (typeof body.note !== 'string' && body.note !== null) throw new HttpError(400, 'note matn bo\'lishi kerak');
    return { key: body.key, note: await store.setCompanyNote(user.login, body.key, body.note) };
  });

  // ── Health ──────────────────────────────────────────────────────────────
  route('GET', '/healthz', null, async () => {
    const db = await store.getDb();
    await db.query('SELECT 1');
    return { ok: true };
  });

  // ── Asosiy ishlovchi ────────────────────────────────────────────────────
  return async function handle(req, res) {
    setSecurityHeaders(res);
    const url = new URL(req.url, 'http://local');
    const { pathname } = url;

    if (!pathname.startsWith('/api/') && pathname !== '/healthz') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });
      return serveStatic(req, res, pathname);
    }

    try {
      const m = router.match(req.method, pathname);
      if (!m) throw new HttpError(404, 'topilmadi');
      if (m.methodNotAllowed) throw new HttpError(405, 'metod ruxsat etilmagan');

      // O'zgartiruvchi so'rovlar faqat o'z sahifamizdan (CSRF).
      if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) throw new HttpError(403, 'origin mos emas');

      const { auth, handler } = m.handler;
      const user = await store.getSessionUser(parseCookies(req)[COOKIE]);
      if (auth) {
        if (!user) throw new HttpError(401, 'Kirish kerak');
        // Owner dashboard'ni ko'rmaydi, user esa foydalanuvchilarni boshqarmaydi.
        if (auth !== 'any' && user.role !== auth) throw new HttpError(403, 'Ruxsat yo\'q');
      }

      const out = await handler({ req, res, url, params: m.params, user });
      if (Array.isArray(out)) sendJson(res, out[0], out[1], out[2]);
      else sendJson(res, 200, out);
    } catch (err) {
      if (err instanceof HttpError) {
        return sendJson(res, err.status, { error: err.message, ...(err.extra?.code ? { code: err.extra.code } : {}) }, err.extra?.headers);
      }
      if (err instanceof store.ValidationError) return sendJson(res, 400, { error: err.message });
      console.error('[http]', req.method, pathname, err);
      sendJson(res, 500, { error: 'Server xatosi' });
    }
  };
}

function setSecurityHeaders(res) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
