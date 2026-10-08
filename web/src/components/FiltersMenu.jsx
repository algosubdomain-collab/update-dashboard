import { useEffect, useRef, useState } from 'react';

// Filtrlar: duty status (bo'sh — hammasi) va tezkor almashtirgichlar.
export const EMPTY_FILTERS = { duty: [], unchecked: false, errors: false, lowCycle: false };

const DUTY = [
  { id: 'driving', label: 'Driving' },
  { id: 'on_duty', label: 'On duty' },
  { id: 'sleeper', label: 'Sleeper' },
  { id: 'off_duty', label: 'Off duty' },
  { id: 'unknown', label: 'Unknown' },
];
const TOGGLES = [
  { id: 'unchecked', label: 'Not checked yet' },
  { id: 'errors', label: 'With errors' },
  { id: 'lowCycle', label: 'Cycle under 25 h' },
];

export function activeFilterCount(f) {
  return (f.duty?.length ? 1 : 0) + (f.unchecked ? 1 : 0) + (f.errors ? 1 : 0) + (f.lowCycle ? 1 : 0);
}

export function matchFilters(d, row, f) {
  if (f.duty?.length && !f.duty.includes(d.status)) return false;
  if (f.unchecked && row?.checkedAt) return false;
  if (f.errors) {
    const n = (d.issues?.errors?.length ?? 0) + (d.issues?.violations?.length ?? 0);
    if (!n) return false;
  }
  if (f.lowCycle && !(d.cycleRemainingMin !== null && d.cycleRemainingMin < 25 * 60)) return false;
  return true;
}

export default function FiltersMenu({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const btn = useRef(null);
  const n = activeFilterCount(value);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!wrap.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    wrap.current?.querySelector('.menu input')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleDuty = (id) => onChange({ ...value, duty: value.duty.includes(id) ? value.duty.filter((x) => x !== id) : [...value.duty, id] });

  return (
    <div className="split" ref={wrap}>
      <button ref={btn} type="button" className={`btn btn-sm ${n ? 'is-filtering' : ''}`} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        Filters{n > 0 && <span className="filter-count num">{n}</span>}
      </button>
      {open && (
        <div className="menu menu-anchored menu-left filters" role="group" aria-label="Filters">
          <div className="filters-title">Duty status</div>
          {DUTY.map((s) => (
            <label key={s.id} className="menu-item">
              <input type="checkbox" checked={value.duty.includes(s.id)} onChange={() => toggleDuty(s.id)} />
              <span className={`status-chip st-${s.id} grow`}>{s.label}</span>
            </label>
          ))}
          <div className="menu-sep" />
          {TOGGLES.map((t) => (
            <label key={t.id} className="menu-item">
              <input type="checkbox" checked={value[t.id]} onChange={() => onChange({ ...value, [t.id]: !value[t.id] })} />
              <span className="grow">{t.label}</span>
            </label>
          ))}
          {n > 0 && (
            <>
              <div className="menu-sep" />
              <button type="button" className="menu-item menu-aux" onClick={() => onChange(EMPTY_FILTERS)}>
                Clear filters
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
