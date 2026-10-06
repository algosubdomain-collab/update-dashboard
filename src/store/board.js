import { getDb } from './db.js';
import { applyRowPatch, DEFAULT_CONFIG, markCertified, validateConfig } from './boardModel.js';

export async function getRows(login) {
  const db = await getDb();
  const { rows } = await db.query('SELECT row_key, data FROM board_rows WHERE login = $1', [login]);
  return Object.fromEntries(rows.map((r) => [r.row_key, r.data]));
}

// Bitta patch ko'p qatorga — bitta tranzaksiyada. Qatorlar ro'yxati va
// natijalar jsonb orqali uzatiladi: massiv parametrlarini pg va PGlite har
// xil serializatsiya qiladi, jsonb esa ikkalasida bir xil.
export async function patchRows(login, keys, patch, ctx) {
  const db = await getDb();
  return db.tx(async (t) => {
    const { rows } = await t.query(
      `SELECT row_key, data FROM board_rows
        WHERE login = $1 AND row_key IN (SELECT jsonb_array_elements_text($2::jsonb))
        FOR UPDATE`,
      [login, JSON.stringify(keys)],
    );
    const current = new Map(rows.map((r) => [r.row_key, r.data]));

    const upserts = {};
    const deletes = [];
    const result = {};
    for (const k of keys) {
      const next = applyRowPatch(current.get(k), patch, ctx);
      result[k] = next;
      if (next) upserts[k] = next;
      // Butunlay bo'sh qator saqlanmaydi — jadval "axlat" qatorlar bilan to'lmasin.
      else if (current.has(k)) deletes.push(k);
    }

    if (Object.keys(upserts).length) {
      await t.query(
        `INSERT INTO board_rows (login, row_key, data, updated_at)
         SELECT $1, e.key, e.value, now() FROM jsonb_each($2::jsonb) e
         ON CONFLICT (login, row_key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [login, JSON.stringify(upserts)],
      );
    }
    if (deletes.length) {
      await t.query(
        `DELETE FROM board_rows WHERE login = $1 AND row_key IN (SELECT jsonb_array_elements_text($2::jsonb))`,
        [login, JSON.stringify(deletes)],
      );
    }
    return result;
  });
}

export async function setCertified(login, key, now) {
  const db = await getDb();
  return db.tx(async (t) => {
    const { rows } = await t.query(
      'SELECT data FROM board_rows WHERE login = $1 AND row_key = $2 FOR UPDATE',
      [login, key],
    );
    const next = markCertified(rows[0]?.data, now);
    await t.query(
      `INSERT INTO board_rows (login, row_key, data) VALUES ($1, $2, $3)
       ON CONFLICT (login, row_key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [login, key, JSON.stringify(next)],
    );
    return next;
  });
}

export async function getConfig(login) {
  const db = await getDb();
  const { rows } = await db.query('SELECT data FROM board_config WHERE login = $1', [login]);
  // Sozlama hali saqlanmagan bo'lsa standart variantlar — yangi foydalanuvchi
  // bo'sh ro'yxatlar bilan qolib ketmasin.
  return rows[0]?.data ?? structuredClone(DEFAULT_CONFIG);
}

export async function saveConfig(login, input) {
  const cfg = validateConfig(input);
  const db = await getDb();
  await db.query(
    `INSERT INTO board_config (login, data, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (login) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [login, JSON.stringify(cfg)],
  );
  return cfg;
}
