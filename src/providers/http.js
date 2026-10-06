// Tashqi API ga so'rov: timeout, 429/5xx va tarmoq xatolarida eksponensial
// qayta urinish. fetch parametr sifatida beriladi — testlarda soxta fetch.

export class ProviderError extends Error {
  constructor(message, { status = null, auth = false, access = false, body = null } = {}) {
    super(message);
    this.status = status;
    // auth — token yaroqsiz/eskirgan: qayta urinishdan foyda yo'q, foydalanuvchi
    // yangi token olib kelishi kerak. Butun yig'ish to'xtaydi.
    this.auth = auth;
    // access — akkauntda shu kompaniyaga huquq yo'q: xato emas, holat.
    this.access = access;
    this.body = body;
  }
}

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));

// 400ms, 800ms, 1.6s … 5s gacha + tasodifiy siljish: bir vaqtda qulagan
// so'rovlar bir vaqtda qayta urinib, serverni yana bo'g'ib qo'ymasin.
// Yuqori chegara — bitta omadsiz kompaniya butun yangilanishni daqiqalab
// cho'zib yubormasin.
export function backoff(attempt, base = 400, max = 5000) {
  return Math.min(base * 2 ** attempt, max) + Math.floor(Math.random() * base);
}

// Javob: { status, body } (body — JSON yoki null). 401/403 va boshqa 4xx
// chaqiruvchiga qaytariladi — ularni talqin qilish manbaga xos.
export async function request(url, {
  method = 'GET',
  headers = {},
  body,
  fetch = globalThis.fetch,
  retries = 5,
  timeoutMs = 30000,
  sleep = sleepDefault,
} = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (attempt < retries) {
        await sleep(backoff(attempt));
        continue;
      }
      throw new ProviderError(err?.name === 'TimeoutError' ? 'javob kelmadi (timeout)' : `tarmoq xatosi: ${err.message}`);
    }

    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      // Server qancha kutishni aytgan bo'lsa — shunga amal qilamiz.
      const ra = Number(res.headers?.get?.('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30000) : backoff(attempt));
      continue;
    }

    const text = await res.text().catch(() => '');
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        /* JSON emas — status bo'yicha hal qilinadi */
      }
    }
    return { status: res.status, ok: res.ok, body: json, text };
  }
}
