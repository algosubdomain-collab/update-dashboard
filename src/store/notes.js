import { getDb } from './db.js';

const MAX = 280;

// Kompaniya eslatmalari: { "provider:companyId": matn } — shu foydalanuvchi uchun.
export async function getCompanyNotes(login) {
  const db = await getDb();
  const { rows } = await db.query('SELECT company_key, note FROM company_notes WHERE login = $1', [login]);
  return Object.fromEntries(rows.map((r) => [r.company_key, r.note]));
}

// Bo'sh matn eslatmani o'chiradi — "bo'sh eslatma" degan holat yo'q.
export async function setCompanyNote(login, key, note) {
  const db = await getDb();
  const text = String(note ?? '').trim().slice(0, MAX);
  if (!text) {
    await db.query('DELETE FROM company_notes WHERE login = $1 AND company_key = $2', [login, key]);
    return null;
  }
  await db.query(
    `INSERT INTO company_notes (login, company_key, note, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (login, company_key) DO UPDATE SET note = EXCLUDED.note, updated_at = now()`,
    [login, key, text],
  );
  return text;
}
