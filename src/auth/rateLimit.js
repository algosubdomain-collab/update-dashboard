// Login urinishlarini IP bo'yicha cheklash: sirpanuvchi oyna.
// Xotirada saqlanadi — bitta instance uchun yetarli. Bir nechta instance
// bo'lsa, har biri o'z hisobini yuritadi (chegara amalda N barobar
// yumshaydi) — README da yozilgan.
//
// Muvaffaqiyatli kirish hisobni tozalamaydi: aks holda o'z akkaunti bor
// odam har 9 urinishda bir marta kirib, boshqalarning parolini cheksiz
// tanlashi mumkin bo'lardi.

export function createRateLimiter({ max, windowMs, now = () => Date.now() }) {
  const hits = new Map();

  function prune(key, t) {
    const list = hits.get(key);
    if (!list) return [];
    const fresh = list.filter((x) => t - x < windowMs);
    if (fresh.length) hits.set(key, fresh);
    else hits.delete(key);
    return fresh;
  }

  return {
    // Ruxsat bo'lsa urinishni yozib qo'yadi va {ok:true} qaytaradi.
    hit(key) {
      const t = now();
      const list = prune(key, t);
      if (list.length >= max) {
        return { ok: false, retryAfterSec: Math.ceil((windowMs - (t - list[0])) / 1000) };
      }
      list.push(t);
      hits.set(key, list);
      return { ok: true };
    },
    // Xotira cheksiz o'smasin.
    sweep() {
      const t = now();
      for (const key of hits.keys()) prune(key, t);
    },
  };
}
