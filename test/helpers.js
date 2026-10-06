// Soxta fetch: marshrut → javob. Tashqi API'siz adapter mantig'ini sinash uchun.
export function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = new URL(url);
    const call = { url: u, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? safeJson(init.body) : undefined };
    calls.push(call);
    const out = await handler(call, calls.length);
    if (out instanceof Error) throw out;
    const { status = 200, body = null, headers = {} } = out ?? {};
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    };
  };
  fn.calls = calls;
  return fn;
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export const noSleep = async () => {};
