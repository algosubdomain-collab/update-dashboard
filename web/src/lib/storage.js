// localStorage faqat qulayliklar uchun (tanlangan board, yig'ilgan guruhlar).
// Maxfiy rejim yoki bloklangan saytda u xato tashlashi mumkin — ilova bunga
// bog'liq bo'lmasligi kerak.

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    if (value === undefined || value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* saqlab bo'lmadi — muhim emas */
  }
}
