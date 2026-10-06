// Cheklangan parallellik: kompaniyalar ko'p bo'lsa hammasini birdaniga
// so'rasak, platforma 429 bilan javob beradi; birma-bir so'rasak — sekin.

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        // Bitta element xatosi qolganlarini to'xtatmaydi.
        results[i] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
