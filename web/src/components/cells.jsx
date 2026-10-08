import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { agoShort, hm, hours, when } from '../lib/format.js';

// ── Cycle halqasi ──────────────────────────────────────────────────────────
// 44px, 3.5px chiziq; rang: <15 soat qizil, <25 soat sariq, aks holda yashil.
// Yoy PASTDAN boshlanadi — ustidagi badge yoyning boshini yopib qo'ymasin.
const CYCLE_MAX = 70 * 60;
export const cycleLevel = (min) => (min === null || min === undefined ? null : min < 15 * 60 ? 'fast' : min < 25 * 60 ? 'need' : null);

const R = 20.25; // (44 - 3.5) / 2
const C = 2 * Math.PI * R;

export function CycleRing({ min }) {
  const level = cycleLevel(min);
  const none = min === null || min === undefined;
  const tone = none ? 'none' : level === 'fast' ? 'red' : level === 'need' ? 'amber' : 'lime';
  const frac = none ? 0 : Math.max(0, Math.min(1, min / CYCLE_MAX));
  return (
    <span className={`ring ring-${tone}`} title={`Cycle left: ${hm(min)} of 70:00`}>
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r={R} className="ring-track" />
        <circle cx="22" cy="22" r={R} className="ring-arc" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} transform="rotate(90 22 22)" />
      </svg>
      <span className="ring-num">{hours(min)}</span>
      {/* Faqat ma'lumot: bosilganda yopilmaydi (spec). */}
      {level && <span className="ring-badge">{level === 'fast' ? 'Open fast' : 'Need open'}</span>}
    </span>
  );
}

// ── Duty status chip ───────────────────────────────────────────────────────
const STATUS_LABEL = { driving: 'Driving', on_duty: 'On duty', sleeper: 'Sleeper', off_duty: 'Off duty', unknown: 'Unknown' };
export function StatusChip({ status }) {
  const s = STATUS_LABEL[status] ? status : 'unknown';
  return <span className={`status-chip st-${s}`}>{STATUS_LABEL[s]}</span>;
}

// ── Haydovchi: 1-qator ism + belgilar, 2-qator holat + eslatmalar ──────────
const PROFILE_WINDOW = 48 * 3600_000;

export function DriverInfo({ driver, requirement, onCopy }) {
  const changed = driver.profileUpdatedAt && Date.now() - Date.parse(driver.profileUpdatedAt) < PROFILE_WINDOW;
  const onContext = (e) => {
    e.preventDefault();
    onCopy(driver.driverName);
  };
  const tip = `${driver.driverName}\nRight-click to copy name`;
  return (
    <span className="driver-lines">
      <span className="driver-line">
        {driver.logUrl ? (
          <a className="driver-name" href={driver.logUrl} target="_blank" rel="noreferrer" title={tip} onContextMenu={onContext}>
            {driver.driverName}
          </a>
        ) : (
          <span className="driver-name" title={tip} onContextMenu={onContext}>
            {driver.driverName}
          </span>
        )}
        {/* Odatdagi holat belgisiz — faqat chetga chiqqani: o'chirilgan truck. */}
        {driver.truckActive === false && <span className="flag-dot" title="Truck is deactivated" aria-label="Truck is deactivated" />}
        <ErrorBadge issues={driver.issues} />
      </span>
      <span className="driver-line">
        <StatusChip status={driver.status} />
        {changed && (
          <span className="sub" title={`Profile updated ${when(driver.profileUpdatedAt)}`}>
            Profile changed
          </span>
        )}
        {/* Haydovchiga yozilgan talab. Kompaniyaniki faqat guruh sarlavhasida. */}
        {requirement && (
          <span className="note-chip" title={`Driver note: ${requirement}`}>
            ⚠ {requirement}
          </span>
        )}
      </span>
    </span>
  );
}

// ── Xatolar badge'i + popover ──────────────────────────────────────────────
// "3 errors" — hover yoki klaviatura fokusida tur bo'yicha guruhlangan ro'yxat.
const fmtDay = (d) => {
  const t = Date.parse(`${d}T12:00:00Z`);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : d;
};
const total = (list) => (list ?? []).reduce((n, g) => n + g.count, 0);

export function ErrorBadge({ issues }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const errors = total(issues?.errors);
  const violations = total(issues?.violations);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const w = 320;
    const below = window.innerHeight - r.bottom;
    const top = below < 200 && r.top > 200 ? undefined : r.bottom + 6;
    const bottom = top === undefined ? window.innerHeight - r.top + 6 : undefined;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top, bottom });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [open]);

  if (!errors && !violations) return null;
  const label = errors ? `${errors} ${errors === 1 ? 'error' : 'errors'}` : `${violations} ${violations === 1 ? 'violation' : 'violations'}`;

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="err-badge"
        aria-label={`${label}${errors && violations ? `, ${violations} violations` : ''}. Details`}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      >
        {label}
      </button>
      {open &&
        pos &&
        createPortal(
          <div className="err-pop" role="tooltip" style={pos}>
            {issues.errors?.length > 0 && <IssueList title="Errors" list={issues.errors} />}
            {issues.violations?.length > 0 && <IssueList title="Violations" list={issues.violations} />}
          </div>,
          document.body,
        )}
    </>
  );
}

function IssueList({ title, list }) {
  return (
    <>
      <h4>{title}</h4>
      <ul>
        {list.map((g) => (
          <li key={g.type}>
            <span className="cnt num">{g.count}×</span> {g.text}
            {g.dates?.length > 0 && <span className="dates"> — {g.dates.slice(0, 4).map(fmtDay).join(', ')}{g.dates.length > 4 ? '…' : ''}</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

// ── Current location ───────────────────────────────────────────────────────
// Manzil (bosilsa Google Maps). Yo'lda 5 km ichida tarozi bo'lsa — qizil.
export function LocationCell({ driver }) {
  if (driver.lat === null || driver.lon === null) {
    return driver.location ? (
      <span className="loc-text checking" title={driver.location}>
        {driver.location}
      </span>
    ) : (
      <span className="dash">—</span>
    );
  }
  const alert = driver.dot?.alert;
  const url = `https://www.google.com/maps/search/?api=1&query=${driver.lat},${driver.lon}`;
  const place = driver.location || `${driver.lat.toFixed(4)}, ${driver.lon.toFixed(4)}`;
  const tip = [place, alert ? `Weigh station ahead: ${alert.name} · ${alert.distanceKm} km` : '', 'Open in Google Maps'].filter(Boolean).join('\n');
  return (
    <a className={`loc ${alert ? 'loc-alert' : ''}`} href={url} target="_blank" rel="noreferrer" title={tip}>
      <span className="dot-core" aria-hidden="true" />
      {alert && <span className="loc-scale num">Scale {alert.distanceKm} km</span>}
      <span className="loc-text">{place}</span>
    </a>
  );
}

// ── Profile form ("Changed") ───────────────────────────────────────────────
// 1-qator: trailer · shipping docs · "3d ago" (aniq sana hover'da);
// 2-qator: forma o'zgargan joy — sky rangli Google Maps havolasi.
export function FormMeta({ change }) {
  // Manba formani bermaydi (masalan Five ELD).
  if (!change) return <span className="dash">—</span>;
  if (change.pending) return <span className="checking">checking…</span>;
  const recent = change.changedAt && Date.now() - Date.parse(change.changedAt) < 48 * 3600_000;
  const before = change.from ? `Before: ${change.from.trailer ?? '—'} / ${change.from.shipping ?? '—'}` : '';
  const maps = change.lat !== null && change.lat !== undefined && change.lon !== null ? `https://www.google.com/maps/search/?api=1&query=${change.lat},${change.lon}` : null;
  return (
    <span className="pf">
      <span className="pf-line" title={[`Trailer: ${change.trailer ?? '—'}`, `Shipping docs: ${change.shipping ?? '—'}`, before].filter(Boolean).join('\n')}>
        <span className="pf-val num">{change.trailer ?? '—'}</span>
        <span className="pf-sep">·</span>
        <span className="pf-val num">{change.shipping ?? '—'}</span>
        <span className="pf-sep">·</span>
        <span className={`pf-ago num ${recent ? 'is-recent' : ''}`} title={change.changedAt ? `Changed ${when(change.changedAt)}` : 'No change in the last 10 days'}>
          {change.changedAt ? agoShort(change.changedAt) : '10d+'}
        </span>
      </span>
      {maps && (
        <a className="pf-where" href={maps} target="_blank" rel="noreferrer" title={`Changed at ${change.location ?? 'this location'} — open in Google Maps`}>
          {change.location ?? `${change.lat.toFixed(3)}, ${change.lon.toFixed(3)}`}
        </a>
      )}
    </span>
  );
}

// ── Drive left ─────────────────────────────────────────────────────────────
export function DriveLeft({ min }) {
  if (min === null || min === undefined) return <span className="drive num is-none">—</span>;
  const tone = min < 60 ? 'tone-red' : min < 120 ? 'tone-amber' : '';
  return <span className={`drive num ${tone}`}>{hm(min)}</span>;
}

// ── Certify ────────────────────────────────────────────────────────────────
// Ikki bosqich: Certify → Confirm? (sariq, 4 s da qaytadi) → spinner →
// tugagach yashil nuqta yonadi. Xatoda Retry.
export function CertifyCell({ supported, state, row, onClick, driverName }) {
  if (!supported) return <span className="dash">—</span>;
  const s = state?.phase;
  const recent = row?.certified && Date.now() - Date.parse(row.certified) < 24 * 3600_000;
  const done = s === 'done' || (!s && recent);
  if (s === 'running') {
    return (
      <span className="cert-running" role="status">
        <span className="spinner" aria-hidden="true" />
        Certifying…
      </span>
    );
  }
  return (
    <span className="cert">
      <span className={`cert-dot ${done ? 'is-on' : ''}`} title={done ? `Certified ${when(row?.certified)}${state?.warning ? `\n${state.warning}` : ''}` : 'Not certified in the last 24 h'} />
      {s === 'error' ? (
        <button type="button" className="btn btn-xs btn-danger-ghost" title={state.error} onClick={onClick} aria-label={`Retry certify for ${driverName}: ${state.error}`}>
          Retry
        </button>
      ) : s === 'confirm' ? (
        <button type="button" className="btn btn-xs btn-amber" onClick={onClick} autoFocus>
          Confirm?
        </button>
      ) : (
        <button type="button" className="btn btn-xs btn-ghost" onClick={onClick} aria-label={`Certify logs for ${driverName}`}>
          {done ? 'Certified' : 'Certify'}
          {state?.warning ? ' ⚠' : ''}
        </button>
      )}
    </span>
  );
}
