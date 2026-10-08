import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { when } from '../lib/format.js';
import { CertifyCell, CycleRing, DriveLeft, DriverInfo, FormMeta, LocationCell } from './cells.jsx';
import Dropdown from './Dropdown.jsx';

// Board — har bir qator CSS grid (ustunlar board.css dagi --cols da).
// Chapdagi uch ustun (#, ✓, Driver) va kompaniya sarlavhasi gorizontal
// siljitganda joyida qotadi — aks holda kimning qatori ekani bilinmay qoladi.
// Sarlavha yorliqlari qisqa va to'liq: sarlavhada "…" bo'lmaydi.

const EDGE = 48; // avto-scroll zonasi (px) — board cheti yaqinida
const SPEED = 14;

export default function FleetTable({
  groups, // [{ companyId, company, drivers: [driver], checked }]
  rows,
  config,
  collapsed,
  onToggleGroup,
  onCheckClick,
  selected, // Set — tanlangan qatorlar (ommaviy amallar uchun)
  onSelectClick, // (key, shift) — # ustunini bosish
  onPatch,
  certify, // { supported, states, onClick }
  onCopyName,
  onOpenSettings,
  visibleKeys,
  onDragCommit,
  notes,
  provider,
  boards,
  onToggleBoard,
}) {
  const drag = useDragSelect({ visibleKeys, onCommit: onDragCommit });
  const hasSel = selected.size > 0 || drag.active;

  return (
    <div className={`board ${drag.active ? 'is-dragging' : ''} ${hasSel ? 'has-sel' : ''}`} ref={drag.scrollRef} onPointerDown={drag.onPointerDown}>
      <div className="board-inner" role="table" aria-label="Drivers" aria-rowcount={visibleKeys.length + 1}>
        <div className="b-row b-head" role="row">
          <span className="b-cell b-sticky c-num" role="columnheader">
            #
          </span>
          {/* "Hammasini belgilash" ataylab yo'q — bitta tasodifiy bosish bilan
              yuzlab qator belgilanib ketmasin. Ko'p qatorga amal — tanlov orqali. */}
          <span className="b-cell b-sticky c-check" role="columnheader" aria-label="Checked" />
          <span className="b-cell b-sticky c-driver" role="columnheader">
            Driver
          </span>
          <span className="b-cell" role="columnheader">
            Unit
          </span>
          <span className="b-cell" role="columnheader">
            Responsible
          </span>
          <span className="b-cell" role="columnheader">
            Status
          </span>
          <span className="b-cell" role="columnheader">
            Current location
          </span>
          <span className="b-cell" role="columnheader">
            Profile form
          </span>
          <span className="b-cell right" role="columnheader">
            Drive left
          </span>
          <span className="b-cell" role="columnheader">
            Certify
          </span>
        </div>

        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.companyId);
          return (
            <div key={g.companyId} role="rowgroup">
              <GroupHead
                group={g}
                collapsed={isCollapsed}
                onToggle={onToggleGroup}
                note={notes[`${provider}:${g.companyId}`]}
                boards={boards}
                onToggleBoard={onToggleBoard}
                onOpenSettings={onOpenSettings}
              />
              {!isCollapsed &&
                g.drivers.map((d, i) => (
                  <Row
                    key={d.key}
                    index={i + 1}
                    d={d}
                    row={rows[d.key]}
                    selected={drag.preview ? drag.preview.has(d.key) : selected.has(d.key)}
                    onSelectClick={onSelectClick}
                    config={config}
                    onCheckClick={onCheckClick}
                    onPatch={onPatch}
                    certSupported={certify.supported}
                    certState={certify.states[d.key]}
                    onCertify={certify.onClick}
                    onCopyName={onCopyName}
                    onOpenSettings={onOpenSettings}
                  />
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Sudrab tanlash (Asana kabi) ────────────────────────────────────────────
// # yoki ✓ ustunida sichqonchani bosib turib pastga/yuqoriga sudrang — oraliq
// qatorlar TANLANADI (ommaviy amallar paneli chiqadi). Board cheti
// yaqinida o'zi siljiydi; bosib turgan holda g'ildirak bilan scroll qilsangiz
// ham tanlov kengayadi. Yig'ilgan guruhlardagi qatorlar tanlanmaydi (ular
// visibleKeys da yo'q). Oddiy bosish avvalgidek ishlaydi (Shift ham).
function useDragSelect({ visibleKeys, onCommit }) {
  const scrollRef = useRef(null);
  const st = useRef(null);
  const [preview, setPreview] = useState(null); // Set — sudrash paytidagi tanlov
  const keysRef = useRef(visibleKeys);
  keysRef.current = visibleKeys;

  const keyAt = useCallback((y) => {
    const s = st.current;
    const { top, bottom } = contentBox(scrollRef.current);
    const head = scrollRef.current.querySelector('.b-head')?.getBoundingClientRect().height ?? 0;
    // Ko'rsatkich board'dan chiqib ketsa ham chekkadagi qatorni olamiz.
    const cy = Math.min(bottom - 2, Math.max(top + head + 2, y));
    const el = document.elementFromPoint(s.colX, cy);
    return el?.closest('[data-key]')?.dataset.key ?? null;
  }, []);

  const update = useCallback(() => {
    const s = st.current;
    if (!s) return;
    const k = keyAt(s.y);
    if (!k) return;
    if (!s.active && k === s.startKey) return;
    const vis = keysRef.current;
    const i = vis.indexOf(s.startKey);
    const j = vis.indexOf(k);
    if (i < 0 || j < 0) return;
    s.active = true;
    s.keys = vis.slice(Math.min(i, j), Math.max(i, j) + 1);
    setPreview(new Set(s.keys));
  }, [keyAt]);

  const stop = useCallback(
    (commit) => {
      const s = st.current;
      if (!s) return;
      st.current = null;
      clearInterval(s.timer);
      window.removeEventListener('pointermove', s.onMove);
      window.removeEventListener('pointerup', s.onUp);
      window.removeEventListener('pointercancel', s.onCancel);
      scrollRef.current?.removeEventListener('scroll', s.onScroll);
      setPreview(null);
      if (s.active && commit) {
        // Sudrash tugagan joydagi "click" belgini qayta almashtirmasin.
        const swallow = (e) => {
          e.stopPropagation();
          e.preventDefault();
        };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
        onCommit(s.startKey, s.keys);
      }
    },
    [onCommit],
  );

  const onPointerDown = useCallback(
    (e) => {
      if (e.button !== 0 || e.shiftKey || e.pointerType === 'touch') return;
      const cell = e.target.closest('.b-cell.c-check, .b-cell.c-num');
      const rowEl = cell?.closest('[data-key]');
      if (!rowEl) return;
      // Matn belgilanib ketmasin.
      e.preventDefault();
      const r = cell.getBoundingClientRect();
      const s = {
        startKey: rowEl.dataset.key,
        colX: r.left + r.width / 2,
        y: e.clientY,
        active: false,
        keys: [],
        timer: 0,
      };
      // Board cheti yaqinida — avto-scroll.
      const tick = () => {
        const box = contentBox(scrollRef.current);
        let dy = 0;
        if (s.y < box.top + EDGE) dy = -SPEED * Math.min(3, (box.top + EDGE - s.y) / EDGE + 0.5);
        else if (s.y > box.bottom - EDGE) dy = SPEED * Math.min(3, (s.y - (box.bottom - EDGE)) / EDGE + 0.5);
        if (dy && s.active) {
          scrollRef.current.scrollTop += dy;
          update();
        }
      };
      s.onMove = (ev) => {
        s.y = ev.clientY;
        update();
      };
      s.onUp = () => stop(true);
      s.onCancel = () => stop(false);
      s.onScroll = () => update();
      st.current = s;
      window.addEventListener('pointermove', s.onMove);
      window.addEventListener('pointerup', s.onUp);
      window.addEventListener('pointercancel', s.onCancel);
      scrollRef.current.addEventListener('scroll', s.onScroll, { passive: true });
      // Taymer (rAF emas): rAF fon/yashirin oynada to'xtaydi.
      s.timer = setInterval(tick, 16);
    },
    [update, stop],
  );

  useEffect(() => () => stop(false), [stop]);

  return { scrollRef, onPointerDown, preview, active: Boolean(preview) };
}

// Scroll konteynerining ko'rinadigan KONTENT maydoni. Pastdagi gorizontal
// scrollbar ustida elementFromPoint qatorni topmaydi — u hisobga olinmasa,
// chetda avto-scroll ishlaganda tanlov kengaymay qoladi.
function contentBox(el) {
  const r = el.getBoundingClientRect();
  const top = r.top + el.clientTop;
  return { top, bottom: top + el.clientHeight };
}

// ── Kompaniya sarlavhasi ───────────────────────────────────────────────────
// ▸ (ochilganda 90° buriladi) + nom + "3/12" (hammasi bajarilsa yashil).
// Kompaniya eslatmasi FAQAT shu yerda ko'rinadi (har haydovchi ostida emas).
function GroupHead({ group: g, collapsed, onToggle, note, boards, onToggleBoard, onOpenSettings }) {
  const [menu, setMenu] = useState(false);
  const wrap = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => {
      if (!wrap.current?.contains(e.target)) setMenu(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);
  const onBoards = boards.filter((b) => b.companies.includes(g.companyId));
  const all = g.drivers.length > 0 && g.checked === g.drivers.length;

  return (
    <div className="b-group" role="row">
      <span className="b-group-label" role="rowheader" ref={wrap}>
        <button type="button" className="b-group-toggle" aria-expanded={!collapsed} onClick={() => onToggle(g.companyId)}>
          <span className={`b-caret ${collapsed ? '' : 'is-open'}`} aria-hidden="true">
            ▸
          </span>
          <span className="group-name">{g.company}</span>
          <span className={`b-count num ${all ? 'is-all' : ''}`}>
            {g.checked}/{g.drivers.length}
          </span>
        </button>
        {note && (
          <button type="button" className="group-note" title={`${note}\n\nClick to edit`} onClick={() => onOpenSettings('requirements', { company: g.companyId })}>
            ⚠ {note}
          </button>
        )}
        <span className="group-actions">
          {!note && (
            <button type="button" className="btn btn-xs btn-ghost" onClick={() => onOpenSettings('requirements', { company: g.companyId })}>
              + Note
            </button>
          )}
          <button type="button" className="btn btn-xs btn-ghost" aria-haspopup="true" aria-expanded={menu} onClick={() => setMenu(!menu)} title="Add this company to boards">
            {onBoards.length ? `Boards: ${onBoards.map((b) => b.name).join(', ')}` : '+ Board'}
          </button>
          {menu && (
            <div className="menu menu-anchored menu-left board-menu" role="group" aria-label={`Boards for ${g.company}`}>
              {boards.map((b) => (
                <label key={b.id} className="menu-item">
                  <input type="checkbox" checked={b.companies.includes(g.companyId)} onChange={() => onToggleBoard(g.companyId, g.company, b.id)} />
                  <span className="grow">{b.name}</span>
                  <span className="muted small num">{b.companies.length}</span>
                </label>
              ))}
              <button
                type="button"
                className="menu-item menu-aux"
                onClick={() => {
                  setMenu(false);
                  onOpenSettings('boards');
                }}
              >
                {boards.length ? 'Manage boards…' : 'Create a board…'}
              </button>
            </div>
          )}
        </span>
      </span>
    </div>
  );
}

const Row = memo(function Row({ index, d, row, selected, onSelectClick, config, onCheckClick, onPatch, certSupported, certState, onCertify, onCopyName, onOpenSettings }) {
  // "Checked" qator rangini o'zgartirmaydi — faqat checkbox to'ladi.
  const checked = Boolean(row?.checkedAt);
  const openResp = () => onOpenSettings('responsible');
  const openCols = () => onOpenSettings('columns');
  return (
    <div data-key={d.key} role="row" aria-selected={selected} className={`b-row ${selected ? 'is-selected' : ''}`}>
      {/* # — raqam; ustiga kelinganda/tanlovda kvadrat tanlash belgisi. */}
      <span className="b-cell b-sticky c-num" role="cell" onClick={(e) => onSelectClick(d.key, e.shiftKey)}>
        <span className="idx num">{index}</span>
        <span
          className={`selbox ${selected ? 'is-on' : ''}`}
          role="checkbox"
          aria-checked={selected}
          aria-label={`Select ${d.driverName}`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              onSelectClick(d.key, e.shiftKey);
            }
          }}
        />
      </span>
      <span className="b-cell b-sticky c-check" role="cell">
        <input
          type="checkbox"
          className="rowcheck"
          checked={checked}
          onChange={() => {}}
          onClick={(e) => {
            e.preventDefault();
            onCheckClick(d.key, e.shiftKey);
          }}
          aria-label={`Checked: ${d.driverName}`}
          title={checked ? `Checked by ${row.checkedBy} · ${when(row.checkedAt)}` : 'Mark as checked · Shift-click for a range'}
        />
      </span>
      <span className="b-cell b-sticky c-driver" role="cell">
        <span className="driver-cell">
          <CycleRing min={d.cycleRemainingMin} />
          <DriverInfo driver={d} requirement={row?.requirement} onCopy={onCopyName} />
        </span>
      </span>
      <span className="b-cell num" role="cell" title={d.truck}>
        {d.truck || <span className="dash">—</span>}
      </span>
      <span className="b-cell" role="cell">
        <Dropdown label="Responsible" value={row?.responsible ?? ''} options={config.responsibles} onChange={(v) => onPatch(d.key, { responsible: v })} emptyHint="Add people in Settings" onEmptyAction={openResp} />
      </span>
      <span className="b-cell" role="cell">
        <Dropdown label="Status" value={row?.status ?? ''} options={config.statuses} onChange={(v) => onPatch(d.key, { status: v })} emptyHint="Add statuses in Settings" onEmptyAction={openCols} />
      </span>
      <span className="b-cell" role="cell">
        <LocationCell driver={d} />
      </span>
      <span className="b-cell" role="cell">
        <FormMeta change={d.formChange} />
      </span>
      <span className="b-cell right" role="cell">
        <DriveLeft min={d.driveRemainingMin} />
      </span>
      <span className="b-cell" role="cell">
        <CertifyCell supported={certSupported} state={certState} row={row} driverName={d.driverName} onClick={() => onCertify(d)} />
      </span>
    </div>
  );
});
