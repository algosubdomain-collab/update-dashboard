// Migratsiyalar ro'yxati. Mavjud qadamni HECH QACHON o'zgartirmang —
// u allaqachon production bazasida bajarilgan. Yangi o'zgarish = yangi element.
//
// Foydalanuvchiga tegishli hamma jadval users(login) ga ON DELETE CASCADE
// bilan bog'langan: foydalanuvchi o'chirilganda uning ulanishlari, board'i
// va sozlamalari bitta DELETE bilan, unutilib qolmasdan ketadi.

export const MIGRATIONS = [
  `
  CREATE TABLE users (
    login         text PRIMARY KEY,
    role          text NOT NULL CHECK (role IN ('owner', 'user')),
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE sessions (
    token_hash text PRIMARY KEY,
    login      text NOT NULL REFERENCES users(login) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  );
  CREATE INDEX sessions_login_idx ON sessions (login);

  CREATE TABLE connections (
    login      text NOT NULL REFERENCES users(login) ON DELETE CASCADE,
    provider   text NOT NULL,
    secret     text NOT NULL,
    meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (login, provider)
  );

  CREATE TABLE board_rows (
    login      text NOT NULL REFERENCES users(login) ON DELETE CASCADE,
    row_key    text NOT NULL,
    data       jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (login, row_key)
  );

  CREATE TABLE board_config (
    login      text PRIMARY KEY REFERENCES users(login) ON DELETE CASCADE,
    data       jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE dot_tiles (
    tile       text PRIMARY KEY,
    stations   jsonb NOT NULL,
    sources    jsonb NOT NULL DEFAULT '[]'::jsonb,
    fetched_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE dot_tracks (
    login      text NOT NULL REFERENCES users(login) ON DELETE CASCADE,
    provider   text NOT NULL,
    driver_id  text NOT NULL,
    lat        double precision NOT NULL,
    lon        double precision NOT NULL,
    heading    double precision,
    heading_at timestamptz,
    alert      jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (login, provider, driver_id)
  );
  `,
  // 2: kompaniya eslatmalari (requirements). Kalit — "provider:companyId":
  // kompaniya nomi o'zgarsa ham eslatma yo'qolmaydi.
  `
  CREATE TABLE company_notes (
    login       text NOT NULL REFERENCES users(login) ON DELETE CASCADE,
    company_key text NOT NULL,
    note        text NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (login, company_key)
  );
  `,
];
