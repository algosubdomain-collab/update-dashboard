// Juda kichik marshrutlovchi: "METHOD /path/:param". Ilovada o'ntacha yo'l
// bor, buning uchun framework olib kirishga arzimaydi.

export function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp(
      '^' +
        pattern.replace(/\/:([a-zA-Z]+)/g, (_, k) => {
          keys.push(k);
          return '/([^/]+)';
        }) +
        '/?$',
    );
    routes.push({ method, re, keys, handler });
  }

  function match(method, pathname) {
    let pathMatched = false;
    for (const r of routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1]);
      });
      return { handler: r.handler, params };
    }
    // Yo'l bor-u, metod noto'g'ri bo'lsa 405 — 404 chalg'itadi.
    return pathMatched ? { methodNotAllowed: true } : null;
  }

  return { add, match };
}
