import { useEffect, useState } from 'react';

// Platformadan ma'lumot qanchalik yangi: fon yangilanishi oralig'i, oxirgi
// yangilanish, keyingisigacha qolgan vaqt va qo'lda "Latest". O'zining
// sekundlik taymeri bor — butun jadval har sekundda qayta chizilmasin.
export default function SyncStatus({ fleet, busy, onLatest }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!fleet) return null;

  const interval = fleet.schedule?.intervalSec;
  const refreshing = busy || fleet.refreshing;
  const since = fleet.fetchedAt ? Math.max(0, Math.round((now - Date.parse(fleet.fetchedAt)) / 1000)) : null;
  const left = fleet.schedule?.nextAt ? Math.round((Date.parse(fleet.schedule.nextAt) - now) / 1000) : null;
  const took = fleet.durationMs ? `Last fetch took ${(fleet.durationMs / 1000).toFixed(1)} s` : '';
  // Oxirgi yangilanish oraliqdan ancha eski bo'lsa — sariq: nimadir to'xtab qolgan.
  const stale = since !== null && interval && since > interval * 3;

  return (
    <div className="sync" role="status" aria-live="off">
      <span className={`sync-dot ${refreshing ? 'is-busy' : stale ? 'is-stale' : ''}`} aria-hidden="true" />
      <span className="sync-text" title={[interval ? `The server asks the platform for new data every ${fmt(interval)}, even when nobody has the page open.` : '', took].filter(Boolean).join('\n')}>
        {interval && <span>Every {fmt(interval)}</span>}
        <span className={stale ? 'tone-amber' : ''}>{refreshing ? 'Fetching from platform…' : since === null ? 'Not fetched yet' : `Updated ${fmt(since)} ago`}</span>
        {!refreshing && left !== null && <span className="muted">{left > 0 ? `next in ${fmt(left)}` : 'next: now'}</span>}
      </span>
      <button type="button" className="btn btn-xs" onClick={onLatest} disabled={refreshing} title="Ask the platform for the latest data now">
        <span className={`sync-icon ${refreshing ? 'is-spinning' : ''}`} aria-hidden="true">↻</span>
        {refreshing ? 'Fetching…' : 'Latest'}
      </button>
    </div>
  );
}

function fmt(sec) {
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}
