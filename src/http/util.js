// node:http ustidagi kichik yordamchilar. Framework ishlatmaganimiz uchun
// tana o'qish, cookie va xatolarni bir joyda to'g'ri qilib qo'yamiz.

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const MAX_BODY = 1024 * 1024;

export async function readJson(req) {
  // Faqat JSON qabul qilinadi. Bu CSRF himoyasining bir qismi: oddiy HTML
  // forma application/json yubora olmaydi, fetch esa boshqa domendan
  // yuborsa preflight'dan o'tolmaydi.
  const type = String(req.headers['content-type'] ?? '');
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type application/json bo\'lishi kerak');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'so\'rov juda katta');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON noto\'g\'ri');
  }
}

export function sendJson(res, status, body, headers = {}) {
  const data = JSON.stringify(body ?? null);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    // API javoblarida shaxsiy ma'lumot bor — hech qayerda keshlanmasin.
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* buzilgan cookie — e'tiborsiz */
    }
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, secure }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    // Render proksisi haqiqiy IP ni ro'yxat boshiga qo'yadi.
    const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

// Brauzer o'zgartiruvchi so'rovga Origin qo'yadi. U bizning hostimizga mos
// kelmasa — bu boshqa saytdan yuborilgan so'rov. SameSite=Lax va JSON talabi
// bilan birga uchinchi qatlam himoya.
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
