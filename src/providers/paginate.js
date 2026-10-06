// Sahifalab yig'ish.
//
// `total` ga qarab sahifalash xavfli: ba'zi API `total` ni umuman bermaydi,
// ba'zilari unda "shu sahifadagi soni"ni yoki boshqa narsani qaytaradi —
// natijada sikl birinchi sahifadan keyin to'xtaydi va qolgan haydovchilar
// JIMGINA yo'qoladi. Shuning uchun asosiy belgi: sahifa to'liq kelmadi →
// bu oxirgi sahifa. Ustiga sahifalar soniga chegara qo'yamiz.
//
// API'ning o'z "yana bor" ishorasi (totalPages va h.k.) faqat DAVOM ettirish
// uchun ishlatiladi, hech qachon to'xtatish uchun emas: server so'ralgan
// limitdan kichik sahifa qaytarsa (o'z chegarasi bo'lsa), "to'liq emas"
// qoidasi yolg'iz o'zi ham ma'lumot yo'qotardi.
//
// Yana bir tuzoq: API sahifa parametrini e'tiborsiz qoldirib, har safar
// birinchi sahifani qaytarishi mumkin. To'liq sahifa kelaversa, chegara
// tugaguncha bir xil yozuvlar ko'payib ketadi. Buni id takrorlanishi orqali
// aniqlab to'xtaymiz.

export class PaginationError extends Error {}

// fetchPage(pageIndex: 0,1,2…) → massiv YOKI { items, more } (more — API ishorasi).
export async function fetchAllPages(fetchPage, { pageSize, maxPages = 100, idOf = (x) => x?.id }) {
  if (!(pageSize > 0)) throw new Error('pageSize kerak');
  const all = [];
  const seen = new Set();
  for (let page = 0; page < maxPages; page++) {
    const got = await fetchPage(page);
    const items = Array.isArray(got) ? got : got?.items;
    const more = Array.isArray(got) ? false : got?.more === true;
    if (!Array.isArray(items)) throw new PaginationError(`sahifa ${page + 1}: ro'yxat kelmadi`);

    let fresh = 0;
    for (const it of items) {
      const id = idOf(it);
      if (id !== undefined && id !== null && id !== '') {
        if (seen.has(String(id))) continue;
        seen.add(String(id));
      }
      all.push(it);
      fresh++;
    }

    if (items.length === 0) return { items: all, pages: page + 1, truncated: false };
    // Sahifada bitta ham yangi yozuv yo'q — API sahifalamayapti.
    if (fresh === 0) return { items: all, pages: page + 1, truncated: false, repeated: true };
    if (items.length < pageSize && !more) return { items: all, pages: page + 1, truncated: false };
  }
  // Chegaraga yetdik — ma'lumot to'liq bo'lmasligi mumkin. Buni yashirmaymiz.
  return { items: all, pages: maxPages, truncated: true };
}
