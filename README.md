# Update Dashboard

ELD platformalaridagi (Leader ELD, Factor ELD, Five ELD) haydovchilarni
kuzatib, support xodimi har bir haydovchi uchun holat to'ldirib boradigan
ichki ish paneli. `eld-monitoring` ilovasidan ajratib olingan.

- Backend: Node.js 20+, `node:http` (frameworksiz), ESM. Yagona runtime
  bog'liqlik — `pg`.
- Frontend: React 19 + Vite + react-router-dom (`web/` → build `public/`).
- Baza: **PostgreSQL** (Render managed). Lokalda `DATABASE_URL` bo'lmasa
  xuddi shu SQL **PGlite** da (WASM'dagi Postgres, `data/` papkasi) ishlaydi.

## Nega Postgres (Persistent Disk emas)

Render'ning oddiy diski har deploy/restartda tozalanadi — JSON fayllar bilan
har deploy'da foydalanuvchi, token va board ma'lumoti yo'qoladi. Persistent
Disk buni hal qiladi, lekin xizmatni bitta instance'ga bog'laydi, zero-downtime
deploy'ni o'chiradi va zaxira nusxa sizning zimmangizda qoladi. Managed
Postgres deploy'ga bog'liq emas, zaxira nusxani o'zi oladi. Saqlash qatlami
`src/store/` da alohida — boshqa joyda SQL yo'q.

## Lokal ishga tushirish

```bash
npm install
cp .env.example .env      # DEFAULT_ADMIN_PASSWORD ni o'zgartiring
npm run build
npm start                 # http://localhost:3000 (PORT bilan o'zgartiriladi)
```

Frontend'ni qayta yuklanish bilan ishlab chiqish uchun ikkita terminal:
`npm run dev` (server, `--watch`) va `npm run dev:web` (Vite, 5173-port,
`/api` serverga proksilanadi).

Birinchi ishga tushishda `DEFAULT_ADMIN_LOGIN` / `DEFAULT_ADMIN_PASSWORD`
bilan **owner** yaratiladi (faqat bazada hech kim bo'lmaganda — keyin parol
panel orqali o'zgartiriladi). Owner foydalanuvchilarni yaratadi; **user**
platformasini ulaydi va dashboard bilan ishlaydi.

**Lokal sinov:** login sahifasida "Continue as default user" tugmasi bor —
parolsiz `demo` foydalanuvchi sifatida kiradi (u `sample` manbaga avtomatik
ulanadi). Bu faqat production bo'lmagan rejimda ishlaydi (`DEV_LOGIN=0` bilan
o'chiriladi); `NODE_ENV=production` yoki Render'da u server tomonida qat'iy o'chiq.

### Platformani ulash

Platforma login sahifalari reCAPTCHA bilan himoyalangan, shuning uchun token
brauzerdan olinadi: **Connections** → platforma → ko'rsatilgan buyruqni
platforma sahifasidagi konsolda (F12) ishga tushirib, natijani joylang.
Token saqlashdan oldin sinab ko'riladi, serverda AES-GCM bilan shifrlanib
saqlanadi (`SECRET_KEY`). Leader/Factor uchun refresh token ham olinadi va
access token muddati tugaganda avtomatik yangilanadi.

`Sample (demo data)` — tashqi API'siz namuna manba (8 kompaniya, 100 faol +
10 nofaol haydovchi, harakatlanuvchi koordinatalar). Istalgan matn token
sifatida qabul qilinadi.

## Testlar

```bash
npm test
```

Tashqi API'ga tayanadigan mantiq soxta `fetch` bilan sinaladi: sahifalash
(`total` noto'g'ri/yo'q, server limitni kichraytirgan, sahifa parametrini
e'tiborsiz qoldiradigan API), kompaniya faolligi (`0`, `"0"`, `"inactive"`),
`-1` → null, token refresh (bitta yangilash), access-xatolar, 429/5xx qayta
urinish, Overpass `remark` tuzog'i va mirror almashinuvi, tarozi
ogohlantirishi gisterezisi, katak keshi byudjeti. Saqlash qatlami haqiqiy
Postgres SQL'i bilan (PGlite) sinaladi: bulk, CASCADE o'chirish, shifrlash.

## DOT tarozilari

Asosiy manba — OpenStreetMap Overpass (`highway=weigh_station`,
`amenity=weighbridge`, `man_made=weighbridge`). Dunyo 0.5° kataklarga
bo'lingan; katak bir marta yuklanib 30 kun bazada saqlanadi, bir davrda
ko'pi bilan 4 ta yangi katak. Yiqilgan yuklash keshlanmaydi (10 daqiqadan
keyin qayta). `GOOGLE_MAPS_API_KEY` berilsa Google Places natijalari
qo'shiladi (ixtiyoriy).

Diagnostika (faqat o'qiydi, server keshini bosmaydi):

```bash
npm run dot:check -- 41.53 -88.08
```

Ommaviy Overpass serverlari tez-tez band bo'ladi (504 / "server is probably
too busy"). Mirror ro'yxati `OVERPASS_URLS` (vergul bilan) orqali
almashtiriladi.

## Render'ga deploy

1. Kodni GitHub/GitLab repoga joylang (`.env`, `node_modules/`, `public/`,
   `data/` — `.gitignore` da).
2. Render → **New → Blueprint** → repo'ni tanlang. `render.yaml` dan:
   - `update-dashboard-db` — managed Postgres;
   - `update-dashboard` — web service (**Starter**; bepul tarif uxlab qoladi
     va fon yangilanishi to'xtaydi).
3. Render so'raganda maxfiy qiymatlarni kiriting:
   - `DEFAULT_ADMIN_PASSWORD` — birinchi owner paroli (kamida 8 belgi);
   - `GOOGLE_MAPS_API_KEY` — ixtiyoriy, bo'sh qoldirsa bo'ladi.
   `DATABASE_URL` bazadan avtomatik, `SECRET_KEY` avtomatik generatsiya
   qilinadi. **`SECRET_KEY` ni keyin almashtirmang** — saqlangan ELD tokenlari
   o'qilmay qoladi (qayta ulash kerak bo'ladi).
4. Deploy tugagach `https://<service>.onrender.com` ni oching, owner bilan
   kiring, foydalanuvchi yarating.

Build: `npm ci && npm run build`, start: `npm start`, health check: `/healthz`
(DB'ga `SELECT 1`). Server `PORT` ni Render'dan o'qiydi va `0.0.0.0` ga
bog'lanadi. Production'da (`NODE_ENV=production` yoki `RENDER=true`):

- `DATABASE_URL` / `SECRET_KEY` / `DEFAULT_ADMIN_PASSWORD` bo'lmasa server
  ishga tushmaydi (jimgina xavfli rejimga o'tmaydi);
- sessiya cookie'si `HttpOnly; Secure; SameSite=Lax`, HSTS yoqiladi;
- `X-Forwarded-For` (Render proksisi) dan haqiqiy IP olinadi.

### Ochiq internet uchun himoya

- Parollar `scrypt`, sessiya tokeni bazada sha256 xesh ko'rinishida.
- Login: bitta IP'dan 15 daqiqada 10 urinish (xotirada — bir nechta instance
  bo'lsa har biri alohida hisoblaydi).
- O'zgartiruvchi so'rovlar: faqat `application/json` + `Origin` tekshiruvi
  (CSRF).
- CSP, `X-Frame-Options: DENY`, `nosniff`.
- Board API faqat oq ro'yxatdagi maydonlarni yozadi.

## Muhit o'zgaruvchilari

| O'zgaruvchi | Standart | Izoh |
|---|---|---|
| `PORT` | 3000 | Render beradi |
| `DATABASE_URL` | — | bo'lmasa lokal PGlite (`DATA_DIR`, `data/`) |
| `SECRET_KEY` | — | ELD tokenlarini shifrlash (production'da majburiy) |
| `DEFAULT_ADMIN_LOGIN` / `DEFAULT_ADMIN_PASSWORD` | `admin` / — | birinchi owner |
| `REFRESH_INTERVAL_SEC` | 60 | fon yangilanishi (min 15) |
| `ACTIVE_WINDOW_HOURS` | 24 | "faol" haydovchi oynasi |
| `GOOGLE_MAPS_API_KEY` | — | ixtiyoriy tarozi to'ldiruvchisi |
| `OVERPASS_URLS` | 3 ta ommaviy mirror | vergul bilan |
| `COOKIE_SECURE` / `TRUST_PROXY` | production'da `true` | |
| `DEV_LOGIN` | lokalda `true` | "Continue as default user"; production'da har doim o'chiq |
| `SAMPLE_FAIL_COMPANY` | — | masalan `c-108` — namuna manbada kompaniya xatosini ko'rish |

## Tuzilma

```
src/
  server.js, app.js, config.js
  http/        router, cookie/JSON yordamchilari, statik fayllar
  auth/        scrypt, login rate-limit
  store/       ← saqlash qatlami (Postgres/PGlite, migratsiyalar, shifrlash)
  providers/   sample, drivehos (Leader/Factor), five; normalize, paginate, retry
  fleet/       kesh "login:platforma", bir vaqtdagi so'rovlarni birlashtirish, fon yangilanishi
  dot/         geo, 0.5° kataklar, Overpass/Google, ogohlantirish mantig'i
web/src/       React ilova
scripts/       dot-check.js
test/          node:test
```

Yangi platforma: `src/providers/<nom>.js` — `fetchDrivers(ctx)` (va ixtiyoriy
`certifyDriver`, `verifyToken`) eksport qilsin va natijani `driverShape()`
orqali yagona ko'rinishga keltirsin; `src/providers/index.js` ga bitta qator.
