import { useEffect, useRef, useState } from 'react';

// Tanlangan qatorlarga ommaviy amallar (Notion/Linear kabi pastda suzib
// turuvchi panel): Status, Responsible, Mark checked / Unmark. Har bir amal —
// bitta /api/board/bulk so'rovi. Tanlov amaldan keyin saqlanib qoladi —
// bir nechta xususiyatni ketma-ket qo'yish mumkin. Esc — tanlovni tozalaydi.
export default function SelectionBar({ count, shownCount, statuses, responsibles, onSet, onCheck, onSelectAll, onClear, onOpenSettings }) {
  const [menu, setMenu] = useState(null); // 'status' | 'responsible'
  const bar = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (menu) setMenu(null);
      else onClear();
    };
    const onDown = (e) => {
      if (menu && !bar.current?.contains(e.target)) setMenu(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [menu, onClear]);

  return (
    <div className="selbar" ref={bar} role="toolbar" aria-label={`${count} drivers selected`}>
      <span className="selbar-count">
        <span className="num">{count}</span> selected
      </span>
      {count < shownCount && (
        <button type="button" className="btn btn-xs btn-ghost" onClick={onSelectAll}>
          Select all <span className="num">{shownCount}</span>
        </button>
      )}
      <span className="selbar-sep" aria-hidden="true" />
      <BulkMenu
        label="Status"
        open={menu === 'status'}
        onToggle={() => setMenu(menu === 'status' ? null : 'status')}
        options={statuses}
        onPick={(v) => {
          setMenu(null);
          onSet('status', v);
        }}
        onEmpty={() => onOpenSettings('columns')}
      />
      <BulkMenu
        label="Responsible"
        open={menu === 'responsible'}
        onToggle={() => setMenu(menu === 'responsible' ? null : 'responsible')}
        options={responsibles}
        onPick={(v) => {
          setMenu(null);
          onSet('responsible', v);
        }}
        onEmpty={() => onOpenSettings('responsible')}
      />
      <button type="button" className="btn btn-sm" onClick={() => onCheck(true)}>
        Mark checked
      </button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => onCheck(false)}>
        Unmark
      </button>
      <span className="selbar-sep" aria-hidden="true" />
      <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label="Clear selection (Esc)" title="Clear selection (Esc)" onClick={onClear}>
        ×
      </button>
    </div>
  );
}

// Panel ustiga ochiladigan menyu: variantlar + ajratgich + "Clear".
function BulkMenu({ label, open, onToggle, options, onPick, onEmpty }) {
  const [active, setActive] = useState(0);
  const list = useRef(null);
  const items = options.length ? [...options.map((o) => ({ ...o, kind: 'opt' })), { kind: 'clear', label: 'Clear' }] : [{ kind: 'empty', label: `Add ${label.toLowerCase()} options in Settings` }];

  useEffect(() => {
    if (open) {
      setActive(0);
      list.current?.focus();
    }
  }, [open]);

  const choose = (it) => {
    if (it.kind === 'opt') onPick(it.label);
    else if (it.kind === 'clear') onPick('');
    else onEmpty();
  };

  return (
    <span className="bulk">
      <button type="button" className="btn btn-sm" aria-haspopup="listbox" aria-expanded={open} onClick={onToggle}>
        {label} <span className="dd-caret is-up" aria-hidden="true" />
      </button>
      {open && (
        <ul
          ref={list}
          className="menu bulk-menu"
          role="listbox"
          tabIndex={-1}
          aria-label={`Set ${label}`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(items[active]);
            }
          }}
        >
          {items.map((it, i) => [
            it.kind === 'clear' ? <li key="sep" className="menu-sep" role="separator" /> : null,
            <li
              key={`${it.kind}-${it.label}`}
              role="option"
              aria-selected={i === active}
              className={`menu-item ${i === active ? 'is-active' : ''} ${it.kind !== 'opt' ? 'menu-aux' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(it)}
            >
              {it.kind === 'opt' ? (
                <span className={`opt-pill c-${it.color}`}>
                  <span className="opt-dot" aria-hidden="true" />
                  <span>{it.label}</span>
                </span>
              ) : (
                it.label
              )}
            </li>,
          ])}
        </ul>
      )}
    </span>
  );
}
