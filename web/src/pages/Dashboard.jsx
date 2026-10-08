import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AssignMenu from '../components/AssignMenu.jsx';
import FiltersMenu, { activeFilterCount, EMPTY_FILTERS, matchFilters } from '../components/FiltersMenu.jsx';
import FleetTable from '../components/FleetTable.jsx';
import SelectionBar from '../components/SelectionBar.jsx';
import SyncStatus from '../components/SyncStatus.jsx';
import TopBar from '../components/TopBar.jsx';
import { ago, plural } from '../lib/format.js';
import { load, save } from '../lib/storage.js';
import { useToast } from '../lib/toast.jsx';
import { useCompanyNotes } from '../lib/useCompanyNotes.js';
import { useDashboard } from '../lib/useDashboard.js';
import { useProvider } from '../lib/useProvider.js';

const ARM_MS = 4000;
const CERTIFY_PARALLEL = 3;

// Guruh ichidagi tartib. null qiymatlar oxirida.
const SORTS = [
  { id: 'name', label: 'Name' },
  { id: 'cycle', label: 'Cycle' },
  { id: 'drive', label: 'Drive' },
];
const byNum = (f) => (a, b) => (f(a) ?? Infinity) - (f(b) ?? Infinity) || a.driverName.localeCompare(b.driverName);
const SORT_FN = {
  name: (a, b) => a.driverName.localeCompare(b.driverName),
  cycle: byNum((d) => d.cycleRemainingMin),
  drive: byNum((d) => d.driveRemainingMin),
};

export default function Dashboard({ user, onLogout }) {
  const navigate = useNavigate();
  const toast = useToast();
  const ns = (k) => `ud:${user.login}:${k}`;

  // ── Platforma va ma'lumot ───────────────────────────────────────────────
  const { connections, provider, setProvider } = useProvider(user);
  const { fleet, fleetError, rows, config, configLoaded, patchRow, bulk, saveConfig, certify, refreshNow, manualRefreshing } = useDashboard(provider, user);
  const { notes } = useCompanyNotes();

  // Toast faqat xatoda — muvaffaqiyat UI'ning o'zida ko'rinadi.
  const onLatest = useCallback(async () => {
    try {
      const r = await refreshNow();
      if (r?.error) toast.show(`Platform: ${r.error}`, { tone: 'error' });
    } catch (err) {
      toast.show(`Could not refresh: ${err.message}`, { tone: 'error' });
    }
  }, [refreshNow, toast]);

  // ── Ko'rinish holati ────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [board, setBoard] = useState(() => load(ns('board'), 'all'));
  const [collapsed, setCollapsed] = useState(() => new Set(load(ns('collapsed'), [])));
  const [sort, setSort] = useState(() => load(ns('sort'), 'name'));
  const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS, ...load(ns('filters'), {}) }));

  useEffect(() => save(ns('board'), board), [board]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => save(ns('collapsed'), [...collapsed]), [collapsed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => save(ns('sort'), sort), [sort]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => save(ns('filters'), filters), [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  // NOZIK JOY: sahifa ochilganda sozlama hali yuklanmagan, boardlar ro'yxati
  // bo'sh. Shu paytda "saqlangan board yo'q ekan" deb tozalasak, tanlov har
  // yangilanishda All ga tushib ketadi. Shuning uchun faqat yuklangandan keyin.
  useEffect(() => {
    if (!configLoaded) return;
    if (board !== 'all' && !config.boards.some((b) => b.id === board)) setBoard('all');
  }, [configLoaded, config, board]);

  // ── Haydovchilar → kalitlar, filtrlar, guruhlar ─────────────────────────
  const drivers = useMemo(() => (fleet?.drivers ?? []).map((d) => ({ ...d, key: `${fleet.provider}:${d.driverId}` })), [fleet]);

  const boardCompanies = useMemo(() => {
    if (!configLoaded || board === 'all') return null;
    const b = config.boards.find((x) => x.id === board);
    return b ? new Set(b.companies) : null;
  }, [configLoaded, config, board]);

  const q = search.trim().toLowerCase();
  const shown = useMemo(
    () =>
      drivers.filter(
        (d) =>
          (!boardCompanies || boardCompanies.has(d.companyId)) &&
          (!q || d.driverName.toLowerCase().includes(q) || d.truck.toLowerCase().includes(q) || d.company.toLowerCase().includes(q)) &&
          matchFilters(d, rows[d.key], filters),
      ),
    [drivers, boardCompanies, q, rows, filters],
  );
  const nFilters = activeFilterCount(filters);
  const filtered = Boolean(q) || Boolean(boardCompanies) || nFilters > 0;

  const groups = useMemo(() => {
    const m = new Map();
    for (const d of shown) {
      if (!m.has(d.companyId)) m.set(d.companyId, { companyId: d.companyId, company: d.company, drivers: [] });
      m.get(d.companyId).drivers.push(d);
    }
    const out = [...m.values()].sort((a, b) => a.company.localeCompare(b.company));
    for (const g of out) {
      g.drivers.sort(SORT_FN[sort] ?? SORT_FN.name);
      g.checked = g.drivers.filter((d) => rows[d.key]?.checkedAt).length;
    }
    return out;
  }, [shown, rows, sort]);

  // Ko'rinib turgan tartib (yig'ilgan guruhlarsiz) — Shift diapazoni va
  // sudrab belgilash shu bo'yicha.
  const visibleKeys = useMemo(() => groups.filter((g) => !collapsed.has(g.companyId)).flatMap((g) => g.drivers.map((d) => d.key)), [groups, collapsed]);
  const shownKeys = useMemo(() => shown.map((d) => d.key), [shown]);
  const checkedShown = shownKeys.filter((k) => rows[k]?.checkedAt).length;

  // ── Tekshirildi belgisi ─────────────────────────────────────────────────
  const anchor = useRef(null); // { key, state }
  const live = useRef({});
  live.current = { rows, visibleKeys, bulk, patchRow };

  const onCheckClick = useCallback((key, shift) => {
    const { rows: r, visibleKeys: vis, bulk: b, patchRow: p } = live.current;
    const isOn = (k) => Boolean(r[k]?.checkedAt);
    const a = anchor.current;
    if (shift && a && a.key !== key && vis.includes(a.key)) {
      const i = vis.indexOf(a.key);
      const j = vis.indexOf(key);
      const [lo, hi] = i < j ? [i, j] : [j, i];
      // Faqat holati farq qiladigan qatorlar — allaqachon belgilanganining
      // "qachon tekshirilgani" o'zgarmasin. Boshlanish nuqtasi saqlanadi.
      b(vis.slice(lo, hi + 1).filter((k) => isOn(k) !== a.state), { checked: a.state });
      return;
    }
    const next = !isOn(key);
    anchor.current = { key, state: next };
    p(key, { checked: next });
  }, []);

  // ── Tanlov (ommaviy amallar uchun) ──────────────────────────────────────
  // "Checked" dan alohida: tanlangan qatorlarga Status / Responsible qo'yish
  // yoki ularni birdan checked/unchecked qilish mumkin.
  const [selected, setSelected] = useState(() => new Set());
  const selAnchor = useRef(null);

  const onSelectClick = useCallback((key, shift) => {
    const vis = live.current.visibleKeys;
    setSelected((prev) => {
      const next = new Set(prev);
      const a = selAnchor.current;
      if (shift && a && a !== key && vis.includes(a)) {
        const i = vis.indexOf(a);
        const j = vis.indexOf(key);
        for (const k of vis.slice(Math.min(i, j), Math.max(i, j) + 1)) next.add(k);
        return next;
      }
      if (next.has(key)) next.delete(key);
      else next.add(key);
      selAnchor.current = key;
      return next;
    });
  }, []);

  // Sudrab tanlash: oraliq tanlovga aylanadi.
  const onDragCommit = useCallback((startKey, keys) => {
    selAnchor.current = startKey;
    setSelected(new Set(keys));
  }, []);

  // Ko'rinmay qolgan (filtrlangan) qatorlar tanlovdan chiqadi — amal faqat
  // ko'rib turgan qatorlarga qo'llanadi.
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const shownSet = new Set(shownKeys);
      const next = new Set([...prev].filter((k) => shownSet.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [shownKeys]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);
  const onBulkSet = useCallback(
    (field, value) => {
      const { rows: r } = live.current;
      const keys = [...selected].filter((k) => (r[k]?.[field] ?? '') !== value);
      if (keys.length) bulk(keys, { [field]: value });
    },
    [selected, bulk],
  );
  const onBulkCheck = useCallback(
    (state) => {
      const { rows: r } = live.current;
      // Faqat holati farq qiladiganlari — "qachon tekshirilgani" o'zgarmasin.
      const keys = [...selected].filter((k) => Boolean(r[k]?.checkedAt) !== state);
      if (keys.length) bulk(keys, { checked: state });
    },
    [selected, bulk],
  );

  // ── Assign ──────────────────────────────────────────────────────────────
  const onAssign = useCallback(
    (name, scope) => {
      const pool = scope === 'all' ? drivers.map((d) => d.key) : shownKeys;
      const keys = pool.filter((k) => (rows[k]?.responsible ?? '') !== name);
      if (keys.length) bulk(keys, { responsible: name });
    },
    [drivers, shownKeys, rows, bulk],
  );

  // ── Certify ─────────────────────────────────────────────────────────────
  const [certStates, setCertStates] = useState({});
  const [certAll, setCertAll] = useState({ phase: 'idle' });
  const stopAll = useRef(false);
  const setCert = (key, s) => setCertStates((p) => ({ ...p, [key]: s }));

  const runCertify = useCallback(
    async (d) => {
      setCert(d.key, { phase: 'running' });
      try {
        const r = await certify(d.driverId);
        setCert(d.key, { phase: 'done', warning: r.warning });
        return true;
      } catch (err) {
        setCert(d.key, { phase: 'error', error: err.message });
        return false;
      }
    },
    [certify],
  );

  const certStatesRef = useRef(certStates);
  certStatesRef.current = certStates;
  const onCertifyClick = useCallback(
    (d) => {
      const s = certStatesRef.current[d.key]?.phase;
      if (s === 'running') return;
      // Xatodan keyin "Retry" darhol bajaradi — tasdiq allaqachon olingan.
      if (s === 'confirm' || s === 'error') return runCertify(d);
      setCert(d.key, { phase: 'confirm' });
      setTimeout(() => setCertStates((p) => (p[d.key]?.phase === 'confirm' ? { ...p, [d.key]: undefined } : p)), ARM_MS);
    },
    [runCertify],
  );

  const certTargets = useMemo(
    () =>
      shown.filter((d) => {
        const s = certStates[d.key]?.phase;
        const recent = rows[d.key]?.certified && Date.now() - Date.parse(rows[d.key].certified) < 24 * 3600_000;
        return s !== 'done' && s !== 'running' && !recent;
      }),
    [shown, certStates, rows],
  );

  // Hammasini: avval tasdiq, keyin 3 tadan parallel — har qator o'z
  // jarayonini ko'rsatadi, tepada "Certifying 12/80…".
  async function onCertifyAll() {
    if (certAll.phase === 'running') {
      stopAll.current = true;
      return;
    }
    if (certAll.phase !== 'confirm') {
      setCertAll({ phase: 'confirm' });
      setTimeout(() => setCertAll((c) => (c.phase === 'confirm' ? { phase: 'idle' } : c)), ARM_MS);
      return;
    }
    const list = certTargets;
    stopAll.current = false;
    let next = 0;
    let done = 0;
    let failed = 0;
    setCertAll({ phase: 'running', done: 0, total: list.length });
    const worker = async () => {
      while (next < list.length && !stopAll.current) {
        const d = list[next++];
        if (!(await runCertify(d))) failed++;
        done++;
        setCertAll({ phase: 'running', done, total: list.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CERTIFY_PARALLEL, list.length) }, worker));
    setCertAll({ phase: 'idle' });
    if (failed) toast.show(`${plural(failed, 'driver')} could not be certified — see Retry in the rows`, { tone: 'error' });
  }

  const onCopyName = useCallback(
    (name) => {
      navigator.clipboard?.writeText(name).catch(() => toast.show('Could not copy the name', { tone: 'error' }));
    },
    [toast],
  );

  const onToggleGroup = useCallback((id) => {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const onOpenSettings = useCallback((tab, extra) => navigate(`/settings?${new URLSearchParams({ tab, ...extra })}`), [navigate]);

  // Kompaniya sarlavhasidan boardga qo'shish/olib tashlash — darhol saqlanadi.
  const configRef = useRef(config);
  configRef.current = config;
  const onToggleBoard = useCallback(
    async (companyId, _name, boardId) => {
      const cfg = configRef.current;
      const boards = cfg.boards.map((x) => (x.id === boardId ? { ...x, companies: x.companies.includes(companyId) ? x.companies.filter((c) => c !== companyId) : [...x.companies, companyId] } : x));
      try {
        await saveConfig({ ...cfg, boards });
      } catch (err) {
        toast.show(`Not saved: ${err.message}`, { tone: 'error' });
      }
    },
    [saveConfig, toast],
  );

  // ── Saqlangan ko'rinishlar (board) ──────────────────────────────────────
  const boardTabs = useMemo(() => {
    if (!configLoaded) return [];
    return config.boards.map((b) => {
      const set = new Set(b.companies);
      return { id: b.id, name: b.name, count: drivers.filter((d) => set.has(d.companyId)).length };
    });
  }, [configLoaded, config, drivers]);

  const supportsCertify = Boolean(fleet?.supportsCertify);
  const certify_ = useMemo(() => ({ supported: supportsCertify, states: certStates, onClick: onCertifyClick }), [supportsCertify, certStates, onCertifyClick]);
  const companiesShown = new Set(shown.map((d) => d.companyId)).size;

  return (
    <>
      <TopBar user={user} onLogout={onLogout}>
        {connections && connections.length > 1 && (
          <label className="provider-pick">
            <span className="sr-only">Platform</span>
            <select value={provider ?? ''} onChange={(e) => setProvider(e.target.value)}>
              {connections.map((c) => (
                <option key={c.provider} value={c.provider}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </TopBar>

      <main className="dash">
        <div className="bar">
          <h1 className="page-title">Drivers</h1>

          <nav className="views" aria-label="Saved views">
            <button type="button" className={`view ${board === 'all' ? 'is-on' : ''}`} aria-pressed={board === 'all'} onClick={() => setBoard('all')}>
              All <span className="view-count num">{drivers.length}</span>
            </button>
            {boardTabs.map((b) => (
              <button key={b.id} type="button" className={`view ${board === b.id ? 'is-on' : ''}`} aria-pressed={board === b.id} onClick={() => setBoard(b.id)}>
                {b.name} <span className="view-count num">{b.count}</span>
              </button>
            ))}
            {configLoaded && (
              <button type="button" className="view view-add" onClick={() => onOpenSettings('boards')} aria-label={boardTabs.length ? 'Edit boards' : 'Create a board'}>
                {boardTabs.length ? 'Edit' : '+ Board'}
              </button>
            )}
          </nav>

          <div className="search">
            <input type="search" placeholder="Search name, truck, company" aria-label="Search drivers" value={search} onChange={(e) => setSearch(e.target.value)} />
            {search && (
              <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setSearch('')}>
                ×
              </button>
            )}
          </div>

          <FiltersMenu value={filters} onChange={setFilters} />

          <div className="segmented" role="radiogroup" aria-label="Sort drivers by">
            {SORTS.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={sort === s.id} className={sort === s.id ? 'is-on' : ''} onClick={() => setSort(s.id)}>
                {s.label}
              </button>
            ))}
          </div>

          <span className="grow" />

          {configLoaded && <AssignMenu me={config.me} responsibles={config.responsibles} shownCount={shownKeys.length} allCount={drivers.length} filtered={filtered} onAssign={onAssign} onOpenSettings={onOpenSettings} />}
          <Link className="btn btn-sm btn-ghost" to="/settings">
            Settings
          </Link>
          {supportsCertify && (
            <button
              type="button"
              className={`btn btn-sm ${certAll.phase === 'confirm' ? 'btn-amber' : certAll.phase === 'running' ? '' : 'btn-primary'}`}
              onClick={onCertifyAll}
              disabled={certAll.phase !== 'running' && !certTargets.length}
              title={certAll.phase === 'running' ? 'Stop after the current rows' : 'Certify logs for every shown driver'}
            >
              {certAll.phase === 'running' ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Certifying <span className="num">{certAll.done}/{certAll.total}</span>… Stop
                </>
              ) : certAll.phase === 'confirm' ? (
                `Confirm? (${certTargets.length})`
              ) : (
                'Certify all'
              )}
            </button>
          )}
        </div>

        <div className="meta-line">
          <span className="num">
            {plural(shown.length, 'driver')} · {plural(companiesShown, 'company', 'companies')}
          </span>
          <span className="num" aria-label={`${checkedShown} of ${shown.length} checked`}>
            <span className={checkedShown && checkedShown === shown.length ? 'tone-lime' : ''}>{checkedShown}</span>/{shown.length} checked
          </span>
          {fleet?.hiddenInactive > 0 && <span title="No signal in the last 24 hours">{fleet.hiddenInactive} inactive hidden</span>}
          <span className="grow" />
          <SyncStatus fleet={fleet} busy={manualRefreshing} onLatest={onLatest} />
        </div>

        <Notices fleet={fleet} error={fleetError} />

        {!fleet && !fleetError && <p className="quiet">checking…</p>}
        {fleet && configLoaded && shown.length > 0 && (
          <FleetTable
            groups={groups}
            rows={rows}
            config={config}
            collapsed={collapsed}
            onToggleGroup={onToggleGroup}
            onCheckClick={onCheckClick}
            selected={selected}
            onSelectClick={onSelectClick}
            onPatch={patchRow}
            certify={certify_}
            onCopyName={onCopyName}
            onOpenSettings={onOpenSettings}
            visibleKeys={visibleKeys}
            onDragCommit={onDragCommit}
            notes={notes}
            provider={fleet.provider}
            boards={config.boards}
            onToggleBoard={onToggleBoard}
          />
        )}
        {fleet && configLoaded && shown.length === 0 && (
          <p className="quiet">
            {drivers.length === 0 ? (
              'No active drivers in the last 24 hours.'
            ) : (
              <>
                No drivers match{q ? ` “${search.trim()}”` : ''}
                {boardCompanies ? ' on this board' : ''}
                {nFilters ? ' with these filters' : ''}.{' '}
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setFilters(EMPTY_FILTERS);
                    setBoard('all');
                  }}
                >
                  Show all
                </button>
              </>
            )}
          </p>
        )}
        {selected.size > 0 && configLoaded && (
          <SelectionBar
            count={selected.size}
            shownCount={shownKeys.length}
            statuses={config.statuses}
            responsibles={config.responsibles}
            onSet={onBulkSet}
            onCheck={onBulkCheck}
            onSelectAll={() => setSelected(new Set(shownKeys))}
            onClear={clearSelection}
            onOpenSettings={onOpenSettings}
          />
        )}
      </main>
    </>
  );
}

function Notices({ fleet, error }) {
  if (error && !fleet) {
    return (
      <div className="banner banner-red" role="alert">
        {error.code === 'not_connected' ? (
          <>
            No platform connected. <Link to="/connect">Connect one</Link>
          </>
        ) : (
          `Could not load drivers: ${error.message}`
        )}
      </div>
    );
  }
  if (!fleet) return null;
  return (
    <>
      {fleet.authError && (
        <div className="banner banner-red" role="alert">
          {fleet.error} — <Link to="/connect">reconnect</Link>. Showing the last loaded data.
        </div>
      )}
      {!fleet.authError && fleet.error && (
        <div className="banner banner-amber" role="status">
          Last refresh failed: {fleet.error}. Showing data from {ago(fleet.fetchedAt)}.
        </div>
      )}
      {fleet.errors?.length > 0 && (
        <div className="banner banner-amber" role="status">
          {fleet.errors.length === 1 ? '1 company' : `${fleet.errors.length} companies`} did not load: {fleet.errors.slice(0, 3).map((e) => `${e.company} (${e.message})`).join(', ')}
          {fleet.errors.length > 3 ? '…' : ''}
        </div>
      )}
      {fleet.restricted?.length > 0 && (
        <p className="quiet">
          No access to {fleet.restricted.length === 1 ? '1 company' : `${fleet.restricted.length} companies`}: {fleet.restricted.slice(0, 5).join(', ')}
        </p>
      )}
    </>
  );
}
