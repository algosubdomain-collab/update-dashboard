// Daqiqa → "8:30". Noma'lum — "—" (0 emas: "vaqt tugadi" bilan adashmasin).
export function hm(min) {
  if (min === null || min === undefined) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function hours(min) {
  if (min === null || min === undefined) return '—';
  return String(Math.floor(min / 60));
}

export function ago(iso, now = Date.now()) {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Qisqa: "35m ago", "5h ago", "2d ago".
export function agoShort(iso, now = Date.now()) {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
