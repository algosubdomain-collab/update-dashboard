import { useEffect, useRef, useState } from 'react';

// "Assign <ism> to all" — bitta bosishda (qaytarib bo'ladigan amal, tasdiq
// so'ramaydi; bildirishnomada Undo bor). Strelka — boshqa mas'ulni tanlash.
// Filtr faol bo'lsa menyuda qamrov tanlagichi: Shown N / All drivers M.
export default function AssignMenu({ me, responsibles, shownCount, allCount, filtered, onAssign, onOpenSettings }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState('shown');
  const [active, setActive] = useState(0);
  const wrap = useRef(null);
  const menu = useRef(null);
  const arrow = useRef(null);

  // Menyu har safar "Shown" dan boshlanadi — oldingi "All" tanlovi
  // kutilmaganda 100 kishiga tegib ketmasin.
  function toggle() {
    if (!open) {
      setScope('shown');
      setActive(0);
    }
    setOpen(!open);
  }

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!wrap.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    menu.current?.querySelector('[data-focus="true"]')?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) menu.current?.querySelectorAll('[data-item]')[active]?.focus();
  }, [active, open]);

  const count = scope === 'all' ? allCount : shownCount;

  function pick(name) {
    setOpen(false);
    arrow.current?.focus();
    onAssign(name, scope);
  }

  function onKey(e) {
    const n = menu.current?.querySelectorAll('[data-item]').length ?? 0;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(n - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      arrow.current?.focus();
    }
  }

  const mainLabel = me ? `Assign ${me} to all` : 'Assign to all…';

  return (
    <div className="split" ref={wrap}>
      <button
        type="button"
        className="btn btn-sm split-main"
        onClick={() => (me ? onAssign(me, 'shown') : toggle())}
        disabled={!shownCount}
        title={me ? `Set Responsible = ${me} for ${shownCount} shown drivers` : 'Choose who to assign'}
      >
        {mainLabel}
      </button>
      <button ref={arrow} type="button" className="btn btn-sm split-arrow" aria-haspopup="menu" aria-expanded={open} aria-label="Assign someone else" onClick={toggle} disabled={!allCount}>
        <span className="dd-caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="menu menu-anchored" ref={menu} role="menu" onKeyDown={onKey}>
          {filtered && (
            <div className="seg" role="radiogroup" aria-label="Apply to">
              <button type="button" role="radio" aria-checked={scope === 'shown'} className={scope === 'shown' ? 'is-on' : ''} onClick={() => setScope('shown')}>
                Shown {shownCount}
              </button>
              <button type="button" role="radio" aria-checked={scope === 'all'} className={scope === 'all' ? 'is-on' : ''} onClick={() => setScope('all')}>
                All drivers {allCount}
              </button>
            </div>
          )}
          {responsibles.length === 0 ? (
            <button
              type="button"
              role="menuitem"
              data-item
              data-focus="true"
              className="menu-item menu-aux"
              onClick={() => {
                setOpen(false);
                onOpenSettings('responsible');
              }}
            >
              Add people in Settings
            </button>
          ) : (
            responsibles.map((r, i) => (
              <button key={r.label} type="button" role="menuitem" data-item data-focus={i === 0 ? 'true' : undefined} className={`menu-item ${i === active ? 'is-active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => pick(r.label)}>
                <span className={`pill pill-${r.color}`}>{r.label}</span>
                <span className="muted small">→ {count}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
