import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { when } from '../lib/format.js';
import { CertifyCell, CycleRing, DriveLeft, DriverName, FormMeta, LocationCell } from './cells.jsx';
import Dropdown from './Dropdown.jsx';

// Jadval. Chapdagi uch ustun (#, ✓, Driver) va kompaniya sarlavhasi gorizontal
// siljitganda joyida qotadi — aks holda kimning qatori ekani bilinmay qoladi.

const COLS = ['num', 'check', 'driver', 'unit', 'resp', 'loc', 'status', 'form', 'drive', 'cert'];
const EDGE = 48; // avto-scroll zonasi (px) — jadval cheti yaqinida
const SPEED = 14;

export default function FleetTable({
  groups, // [{ companyId, company, drivers: [driver], checked }]
  rows,
  config,
  collapsed,
  onToggleGroup,
  onCheckClick,
  header, // { state: 'none'|'some'|'all', armed, onClick, count }
  onPatch,
  notices,
  onDismissNotice,
  certify, // { supported, states, onClick }
  onCopyName,
  onOpenSettings,
  visibleKeys,
  isChecked,
  onDragCommit,
  notes,
  provider,
  boards,
  onToggleBoard,
}) {
  const drag = useDragSelect({ visibleKeys, isChecked, onCommit: onDragCommit });

  return (
    <div className={`table-scroll ${drag.active ? 'is-dragging' : ''}`} ref={drag.scrollRef} onPointerDown={drag.onPointerDown}>
      <table className="fleet">
        <colgroup>
          {COLS.map((c) => (
            <col key={c} className={`w-${c}`} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="sticky c-num" scope="col">
              #
            </th>
            <th className="sticky c-check" scope="col">
              <HeaderCheck {...header} />
            </th>
            <th className="sticky c-driver" scope="col">
              Driver
            </th>
            <th scope="col">Unit</th>
            <th scope="col">Responsible</th>
            <th scope="col">Current location</th>
            <th scope="col">Status</th>
            <th scope="col">Profile Form</th>
            <th scope="col" className="c-right">
              Drive left
            </th>
            <th scope="col">Certify</th>
          </tr>
        </thead>
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.companyId);
          return (
            <tbody key={g.companyId}>
              <tr className="group-row">
                <th colSpan={10} scope="colgroup" className="group-cell">
                  <GroupHead
                    group={g}
                    collapsed={isCollapsed}
                    onToggle={onToggleGroup}
                    note={notes[`${provider}:${g.companyId}`]}
                    boards={boards}
                    onToggleBoard={onToggleBoard}
                    onOpenSettings={onOpenSettings}
                  />
                </th>
              </tr>
              {!isCollapsed &&
                g.drivers.map((d, i) => (
                  <Row
                    key={d.key}
                    index={i + 1}
                    d={d}
                    row={rows[d.key]}
                    preview={drag.preview && drag.preview.keys.has(d.key) ? drag.preview.state : undefined}
                    config={config}
                    onCheckClick={onCheckClick}
                    onPatch={onPatch}
                    notice={notices[d.key]}
                    onDismissNotice={onDismissNotice}
                    certSupported={certify.supported}
                    certState={certify.states[d.key]}
                    onCertify={certify.onClick}
                    onCopyName={onCopyName}
                    onOpenSettings={onOpenSettings}
                  />
                ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

// ── Sudrab belgilash (Asana kabi) ──────────────────────────────────────────
// # yoki ✓ ustunida sichqonchani bosib turib pastga/yuqoriga sudrang — oraliq
// qatorlar birinchi qatorning YANGI holatiga keltiriladi. Jadval chetiga
// yetganda o'zi siljiydi; bosib turgan holda g'ildirak bilan scroll qilsangiz
// ham tanlov kengayadi. Yig'ilgan guruhlardagi qatorlar tanlanmaydi (ular
// visibleKeys da yo'q). Oddiy bosish avvalgidek ishlaydi (Shift ham).
function useDragSelect({ visibleKeys, isChecked, onCommit }) {
  const scrollRef = useRef(null);
  const st = useRef(null);
  const [preview, setPreview] = useState(null); // { state, keys: Set }
  const keysRef = useRef(visibleKeys);
  keysRef.current = visibleKeys;

  const keyAt = useCallback((y) => {
    const s = st.current;
    const { top, bottom } = contentBox(scrollRef.current);
    const head = scrollRef.current.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    // Ko'rsatkich jadvaldan chiqib ketsa ham chekkadagi qatorni olamiz.
    const cy = Math.min(bottom - 2, Math.max(top + head + 2, y));
    const el = document.elementFromPoint(s.colX, cy);
    return el?.closest('tr[data-key]')?.dataset.key ?? null;
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
    setPreview({ state: s.state, keys: new Set(s.keys) });
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
        onCommit(s.startKey, s.keys, s.state);
      }
    },
    [onCommit],
  );

  const onPointerDown = useCallback(
    (e) => {
      if (e.button !== 0 || e.shiftKey || e.pointerType === 'touch') return;
      const cell = e.target.closest('td.c-check, td.c-num');
      const tr = cell?.closest('tr[data-key]');
      if (!tr) return;
      // Matn belgilanib ketmasin.
      e.preventDefault();
      const r = cell.getBoundingClientRect();
      const s = {
        startKey: tr.dataset.key,
        state: !isChecked(tr.dataset.key),
        colX: r.left + r.width / 2,
        y: e.clientY,
        active: false,
        keys: [],
        timer: 0,
      };
      // Jadval cheti yaqinida — avto-scroll.
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
    [isChecked, update, stop],
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

  return (
    <div className="group-head" ref={wrap}>
      <button type="button" className="group-toggle" aria-expanded={!collapsed} onClick={() => onToggle(g.companyId)}>
        <span className={`chev ${collapsed ? '' : 'chev-open'}`} aria-hidden="true" />
        <span className="group-name">{g.company}</span>
        <span className="group-count num">
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
    </div>
  );
}

// Sarlavhadagi uch holatli belgi. Ikkala yo'nalish ham ikki bosishli:
// birinchi bosish so'raydi, ikkinchisi bajaradi.
function HeaderCheck({ state, armed, onClick, count }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  const verb = state === 'all' ? 'Clear' : 'Check';
  return (
    <span className="hcheck">
      <input
        ref={ref}
        type="checkbox"
        checked={state === 'all'}
        onChange={() => {}}
        onClick={(e) => {
          e.preventDefault();
          onClick();
        }}
        aria-label={armed ? `Click again to ${verb.toLowerCase()} ${count}` : `${verb} all ${count} shown drivers`}
        aria-describedby={armed ? 'hcheck-tip' : undefined}
        disabled={!count}
      />
      {armed && (
        <span id="hcheck-tip" className={`hcheck-tip ${state === 'all' ? 'tip-amber' : ''}`} role="status">
          Click again to {verb.toLowerCase()} {count}
        </span>
      )}
    </span>
  );
}

const Row = memo(function Row({ index, d, row, preview, config, onCheckClick, onPatch, notice, onDismissNotice, certSupported, certState, onCertify, onCopyName, onOpenSettings }) {
  const real = Boolean(row?.checkedAt);
  // Sudrash paytida — oldindan ko'rinish (qo'yib yuborilganda saqlanadi).
  const checked = preview ?? real;
  const openResp = () => onOpenSettings('responsible');
  const openCols = () => onOpenSettings('columns');
  return (
    <tr data-key={d.key} className={`${checked ? 'is-checked' : ''} ${preview !== undefined ? 'is-preview' : ''}`}>
      <td className="sticky c-num num muted">{index}</td>
      <td className="sticky c-check">
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
          title={real ? `Checked by ${row.checkedBy} · ${when(row.checkedAt)}` : 'Mark as checked · Shift-click for a range · drag to select many'}
        />
      </td>
      <td className="sticky c-driver">
        <span className="driver-cell">
          <CycleRing min={d.cycleRemainingMin} notice={notice} onDismiss={() => onDismissNotice(d.key)} />
          <DriverName driver={d} requirement={row?.requirement} onCopy={onCopyName} />
        </span>
      </td>
      <td className="num ellipsis" title={d.truck}>
        {d.truck || <span className="dash">—</span>}
      </td>
      <td>
        <Dropdown label="Responsible" value={row?.responsible ?? ''} options={config.responsibles} onChange={(v) => onPatch(d.key, { responsible: v })} emptyHint="Add people in Settings" onEmptyAction={openResp} />
      </td>
      <td>
        <LocationCell driver={d} />
      </td>
      <td>
        <Dropdown label="Status" value={row?.status ?? ''} options={config.statuses} onChange={(v) => onPatch(d.key, { status: v })} emptyHint="Add statuses in Settings" onEmptyAction={openCols} />
      </td>
      <td>
        <span className="pf">
          <Dropdown compact label="Profile Form" value={row?.profileForm ?? ''} options={config.profileForms} onChange={(v) => onPatch(d.key, { profileForm: v })} emptyHint="Add options in Settings" onEmptyAction={openCols} />
          <FormMeta change={d.formChange} />
        </span>
      </td>
      <td className="c-right">
        <DriveLeft min={d.driveRemainingMin} />
      </td>
      <td>
        <CertifyCell supported={certSupported} state={certState} row={row} driverName={d.driverName} onClick={() => onCertify(d)} />
      </td>
    </tr>
  );
});
