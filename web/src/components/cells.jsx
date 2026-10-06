import { agoShort, hm, hours, when } from '../lib/format.js';

// ── Cycle halqasi ──────────────────────────────────────────────────────────
const CYCLE_MAX = 70 * 60;
export const cycleLevel = (min) => (min === null || min === undefined ? null : min < 15 * 60 ? 'fast' : min < 25 * 60 ? 'need' : null);

export function CycleRing({ min, notice, onDismiss }) {
  const level = cycleLevel(min);
  const tone = min === null || min === undefined ? 'none' : level === 'fast' ? 'red' : level === 'need' ? 'amber' : 'lime';
  const r = 12;
  const c = 2 * Math.PI * r;
  const frac = min === null || min === undefined ? 0 : Math.max(0, Math.min(1, min / CYCLE_MAX));
  return (
    <span className={`ring ring-${tone}`} title={`Cycle left: ${hm(min)} of 70:00`}>
      {/* Yoy PASTDAN boshlanadi (rotate 90°): yorliq halqaning tepasini yopadi,
          cycle kam qolganda (aynan yorliq chiqqanda) qisqa yoy tepadan
          boshlansa, u yorliq ostida qolib ketardi. */}
      <svg viewBox="0 0 30 30" aria-hidden="true">
        <circle cx="15" cy="15" r={r} className="ring-track" />
        {frac > 0 && <circle cx="15" cy="15" r={r} className="ring-arc" strokeDasharray={`${c * frac} ${c}`} transform="rotate(90 15 15)" />}
      </svg>
      <span className="ring-num">{hours(min)}</span>
      {notice && (
        <button type="button" className={`ring-notice ring-notice-${level}`} onClick={onDismiss} title="Dismiss">
          {level === 'fast' ? 'Open fast' : 'Need open'}
        </button>
      )}
    </span>
  );
}

// ── Haydovchi ──────────────────────────────────────────────────────────────
const PROFILE_WINDOW = 48 * 3600_000;

export function DriverName({ driver, requirement, onCopy }) {
  const changed = driver.profileUpdatedAt && Date.now() - Date.parse(driver.profileUpdatedAt) < PROFILE_WINDOW;
  const tip = [driver.driverName, driver.violations.length ? `Violations: ${driver.violations.join('; ')}` : '', 'Right-click to copy name'].filter(Boolean).join('\n');
  const onContext = (e) => {
    e.preventDefault();
    onCopy(driver.driverName);
  };
  return (
    <span className="driver">
      {driver.logUrl ? (
        <a className="driver-name" href={driver.logUrl} target="_blank" rel="noreferrer" title={tip} onContextMenu={onContext}>
          {driver.driverName}
        </a>
      ) : (
        <span className="driver-name" title={tip} onContextMenu={onContext}>
          {driver.driverName}
        </span>
      )}
      {/* Odatdagi holat belgisiz — faqat chetga chiqqani ko'rsatiladi. */}
      {driver.truckActive === false && <span className="flag-dot flag-red" title="Truck is deactivated" aria-label="Truck is deactivated" />}
      {driver.violations.length > 0 && (
        <span className="flag-text flag-red" title={driver.violations.join('\n')}>
          {driver.violations.length === 1 ? '1 violation' : `${driver.violations.length} violations`}
        </span>
      )}
      {changed && (
        <span className="flag-text" title={`Profile updated ${when(driver.profileUpdatedAt)}`}>
          Profile changed
        </span>
      )}
      {/* Haydovchiga yozilgan eslatma — faqat shu qatorda (kompaniyaniki sarlavhada). */}
      {requirement && (
        <span className="flag-note" title={`Driver note: ${requirement}`}>
          ⚠ {requirement}
        </span>
      )}
    </span>
  );
}

// ── Current location ───────────────────────────────────────────────────
// Manzil matni (bosilsa Google Maps). Yo'lda 5 km ichida tarozi bo'lsa nuqta
// qizil yonadi va masofa yoziladi; o'tib ketgach o'chadi.
export function LocationCell({ driver }) {
  if (driver.lat === null || driver.lon === null) {
    return driver.location ? <span className="loc-text muted" title={driver.location}>{driver.location}</span> : <span className="dash">—</span>;
  }
  const alert = driver.dot?.alert;
  const url = `https://www.google.com/maps/search/?api=1&query=${driver.lat},${driver.lon}`;
  const place = driver.location || `${driver.lat.toFixed(4)}, ${driver.lon.toFixed(4)}`;
  const tip = [place, alert ? `Weigh station ahead: ${alert.name} · ${alert.distanceKm} km` : '', 'Open in Google Maps'].filter(Boolean).join('\n');
  return (
    <a className={`loc ${alert ? 'loc-alert' : ''}`} href={url} target="_blank" rel="noreferrer" title={tip}>
      <span className="dot-core" aria-hidden="true" />
      {alert && <span className="loc-scale">Scale {alert.distanceKm} km ·</span>}
      <span className="loc-text">{place}</span>
    </a>
  );
}

// ── Profile Form: trailer, shipping docs, oxirgi o'zgarish ─────────────────
export function FormMeta({ change }) {
  if (!change) return null;
  if (change.pending) return <span className="pf-meta muted" title="Loading trailer and shipping docs from the logs…">…</span>;
  const tip = [
    `Trailer: ${change.trailer ?? '—'}`,
    `Shipping docs: ${change.shipping ?? '—'}`,
    change.changedAt ? `Changed ${when(change.changedAt)}` : 'No change in the last 10 days',
    change.from ? `Before: ${change.from.trailer ?? '—'} / ${change.from.shipping ?? '—'}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const recent = change.changedAt && Date.now() - Date.parse(change.changedAt) < 48 * 3600_000;
  return (
    <span className="pf-meta" title={tip}>
      <span className="pf-val">{change.trailer ?? '—'}</span>
      <span className="pf-sep">·</span>
      <span className="pf-val">{change.shipping ?? '—'}</span>
      <span className="pf-sep">·</span>
      <span className={`pf-ago ${recent ? 'is-recent' : ''}`}>{change.changedAt ? agoShort(change.changedAt) : '10d+'}</span>
    </span>
  );
}

// ── Drive left ─────────────────────────────────────────────────────────────
export function DriveLeft({ min }) {
  const tone = min === null || min === undefined ? '' : min < 60 ? 'tone-red' : min < 120 ? 'tone-amber' : '';
  return <span className={`num ${tone}`}>{hm(min)}</span>;
}

// ── Certify ────────────────────────────────────────────────────────────────
// Jarayon: Certify → Confirm? → Certifying… → Certified; xatoda Retry.
export function CertifyCell({ supported, state, row, onClick, driverName }) {
  if (!supported) return <span className="dash">—</span>;
  const s = state?.phase;
  const recent = row?.certified && Date.now() - Date.parse(row.certified) < 24 * 3600_000;
  if (s === 'running') return <span className="cert cert-running">Certifying…</span>;
  if (s === 'done' || (!s && recent)) {
    return (
      <span className="cert cert-done" title={`Certified ${when(row?.certified)}${state?.warning ? `\n${state.warning}` : ''}`}>
        Certified{state?.warning ? ' ⚠' : ''}
      </span>
    );
  }
  if (s === 'error') {
    return (
      <button type="button" className="btn btn-xs btn-danger-ghost" title={state.error} onClick={onClick} aria-label={`Retry certify for ${driverName}: ${state.error}`}>
        Retry
      </button>
    );
  }
  if (s === 'confirm') {
    return (
      <button type="button" className="btn btn-xs btn-amber" onClick={onClick} autoFocus>
        Confirm?
      </button>
    );
  }
  return (
    <button type="button" className="btn btn-xs btn-ghost cert-idle" onClick={onClick} aria-label={`Certify logs for ${driverName}`}>
      Certify
    </button>
  );
}
