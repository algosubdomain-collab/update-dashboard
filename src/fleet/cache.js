// Fleet keshi: "login:provider" bo'yicha oxirgi yig'ilgan haydovchilar.
// Brauzer so'rovlari tashqi API'ga to'g'ridan-to'g'ri ketmaydi — fon
// jarayoni yig'adi, brauzer keshdan oladi. Shunda 5 ta ochiq tab 5 barobar
// so'rov degani emas, brauzer yopiq bo'lsa ham ma'lumot (va DOT izlari)
// yangilanib turadi.

export function createFleetCache({
  getConnection, // async (login, provider) → { token, meta } | null
  getProvider, // (id) → provider | null
  saveTokens = async () => {}, // manba tokenni yangilaganda bazaga yozish
  annotate = async (_l, _p, drivers) => drivers, // DOT
  fetch = globalThis.fetch,
  now = () => Date.now(),
  activeWindowMs = 24 * 3600_000,
  log = () => {},
}) {
  const entries = new Map();

  function entry(key) {
    if (!entries.has(key)) entries.set(key, { drivers: null, errors: [], restricted: [], fetchedAt: null, error: null, authError: false, inflight: null });
    return entries.get(key);
  }

  // Bir vaqtda kelgan so'rovlar bitta yig'ishga qo'shiladi: ikkinchi
  // chaqiruvchi yangi yig'ish boshlamaydi, birinchisining natijasini kutadi.
  function refresh(login, providerId) {
    const key = `${login}:${providerId}`;
    const e = entry(key);
    if (e.inflight) return e.inflight;
    e.inflight = (async () => {
      const provider = getProvider(providerId);
      if (!provider) throw new Error(`noma'lum manba: ${providerId}`);
      const conn = await getConnection(login, providerId);
      if (!conn) {
        e.error = 'ulanish yo\'q yoki token o\'qilmadi — qayta ulang';
        e.authError = true;
        return e;
      }
      const started = now();
      try {
        const { drivers, errors, restricted } = await provider.fetchDrivers({
          token: conn.token,
          refreshToken: conn.refreshToken,
          meta: conn.meta,
          fetch,
          now: started,
          onTokens: (t) => saveTokens(login, providerId, t),
        });
        await annotate(login, providerId, drivers);
        e.drivers = drivers;
        e.errors = errors ?? [];
        e.restricted = restricted ?? [];
        e.fetchedAt = new Date(now()).toISOString();
        e.error = null;
        e.authError = false;
        log(`[fleet] ${key}: ${drivers.length} haydovchi, ${e.errors.length} xato, ${now() - started} ms`);
      } catch (err) {
        // Oxirgi muvaffaqiyatli ro'yxat saqlanib qoladi — bitta yiqilgan
        // yig'ish ekrandagi hamma narsani o'chirib yubormasin.
        e.error = err.message;
        e.authError = Boolean(err.auth);
        log(`[fleet] ${key} xato: ${err.message}`);
      }
      return e;
    })().finally(() => {
      e.inflight = null;
    });
    return e.inflight;
  }

  function view(e) {
    const cutoff = now() - activeWindowMs;
    const all = e.drivers ?? [];
    // Faqat faol haydovchilar: so'nggi oynada signal bergan. lastUpdate
    // noma'lum bo'lsa ko'rsatamiz — bilmaslik "faol emas" degani emas.
    const drivers = all.filter((d) => !d.lastUpdate || Date.parse(d.lastUpdate) >= cutoff);
    return {
      drivers,
      hiddenInactive: all.length - drivers.length,
      errors: e.errors,
      restricted: e.restricted,
      fetchedAt: e.fetchedAt,
      error: e.error,
      authError: e.authError,
      loading: Boolean(e.inflight) && !e.drivers,
    };
  }

  return {
    refresh,
    async get(login, providerId) {
      const e = entry(`${login}:${providerId}`);
      // Hali hech narsa yig'ilmagan bo'lsa — kutamiz; aks holda keshdan.
      if (!e.drivers && !e.error) await refresh(login, providerId);
      return view(e);
    },
    // Haydovchini fleet'dan topish (certify uchun — mijoz yuborgan
    // companyId ga ishonmaymiz, serverdagi ma'lumotdan olamiz).
    findDriver(login, providerId, driverId) {
      const e = entries.get(`${login}:${providerId}`);
      return e?.drivers?.find((d) => d.driverId === driverId) ?? null;
    },
    forget(login, providerId) {
      for (const k of [...entries.keys()]) {
        if (k === `${login}:${providerId}` || (!providerId && k.startsWith(`${login}:`))) entries.delete(k);
      }
    },
    keys: () => [...entries.keys()],
  };
}
