import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Ro'yxatdan tanlash (listbox). Jadvalda 100 qator × 3 ustun = 300 ta shunday
// element bor, shuning uchun yopiq holati — oddiy tugma, ro'yxat esa faqat
// ochilganda va portal orqali chiziladi (jadvalning gorizontal scroll
// konteyneri uni kesib qo'ymasligi uchun).
//
// options: [{ label, color }]; value: string ('' — bo'sh).
// Ro'yxatda yo'q qiymat jimgina yo'qolmaydi — punktir ramkali so'niq yorliq.
export default function Dropdown({ value, options, onChange, label, emptyHint, onEmptyAction, compact }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const list = useRef(null);
  const id = useId();

  const current = options.find((o) => o.label === value);
  const stale = Boolean(value) && !current;

  // Ro'yxat elementlari: tanlovlar + (qiymat bo'lsa) "Clear" + (ro'yxat bo'sh
  // bo'lsa) Settings'ga olib boradigan qator — bo'sh holat boshi berk bo'lmasin.
  const items = [
    ...options.map((o) => ({ kind: 'opt', ...o })),
    ...(value ? [{ kind: 'clear', label: 'Clear' }] : []),
    ...(!options.length && onEmptyAction ? [{ kind: 'empty', label: emptyHint ?? 'Add options in Settings' }] : []),
  ];

  function place() {
    const r = btn.current.getBoundingClientRect();
    const h = Math.min(320, items.length * 32 + 18);
    const below = window.innerHeight - r.bottom;
    // Pastda joy bo'lmasa — tugma ustiga ochiladi (pastki chetga qarab o'sadi).
    const above = below < h + 8 && r.top > h + 8;
    const width = Math.max(r.width, 190);
    const left = Math.min(r.left, window.innerWidth - width - 8);
    setPos(above ? { bottom: window.innerHeight - r.top + 4, left: Math.max(8, left), width, above } : { top: r.bottom + 4, left: Math.max(8, left), width, above });
  }

  function openList() {
    const i = items.findIndex((x) => x.kind === 'opt' && x.label === value);
    setActive(i >= 0 ? i : 0);
    place();
    setOpen(true);
  }

  function close(focusBack = true) {
    setOpen(false);
    if (focusBack) btn.current?.focus();
  }

  function choose(item) {
    close();
    if (item.kind === 'opt') {
      if (item.label !== value) onChange(item.label);
    } else if (item.kind === 'clear') onChange('');
    else if (item.kind === 'empty') onEmptyAction?.();
  }

  // Tashqariga bosish, scroll va o'lcham o'zgarishi — ro'yxatni yopadi
  // (fixed pozitsiya tugmadan ajralib qolmasin).
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!list.current?.contains(e.target) && !btn.current?.contains(e.target)) close(false);
    };
    const onScroll = (e) => {
      if (!list.current?.contains(e.target)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function onListKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(items.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (items[active]) choose(items[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      close(false);
    }
  }

  function onBtnKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openList();
    }
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`dd ${value ? 'dd-filled' : 'dd-empty'} ${compact ? 'dd-compact' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${value || 'not set'}`}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onBtnKey}
      >
        {value ? (
          <span className={`opt-pill ${stale ? 'is-stale' : `c-${current.color}`}`} title={stale ? `"${value}" is no longer in the list` : value}>
            <span className="opt-dot" aria-hidden="true" />
            <span>{value}</span>
          </span>
        ) : (
          <span className="dd-dash">—</span>
        )}
        <span className="dd-caret" aria-hidden="true" />
      </button>
      {open &&
        pos &&
        createPortal(
          <ul
            ref={list}
            className={`menu ${pos.above ? 'is-above' : ''}`}
            role="listbox"
            tabIndex={-1}
            aria-label={label}
            aria-activedescendant={`${id}-${active}`}
            style={{ top: pos.top, bottom: pos.bottom, left: pos.left, minWidth: pos.width }}
            onKeyDown={onListKey}
          >
            {items.map((it, i) => [
              // "Clear" dan oldin ajratgich chiziq.
              it.kind !== 'opt' && i > 0 && items[i - 1].kind === 'opt' ? <li key={`sep-${i}`} className="menu-sep" role="separator" /> : null,
              <li
                key={`${it.kind}-${it.label}`}
                id={`${id}-${i}`}
                data-i={i}
                role="option"
                aria-selected={it.kind === 'opt' && it.label === value}
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
                {it.kind === 'opt' && it.label === value && <span className="menu-tick" aria-hidden="true">✓</span>}
              </li>,
            ])}
          </ul>,
          document.body,
        )}
    </>
  );
}
