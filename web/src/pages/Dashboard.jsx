import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AssignMenu from '../components/AssignMenu.jsx';
import { cycleLevel } from '../components/cells.jsx';
import FleetTable from '../components/FleetTable.jsx';
import TopBar from '../components/TopBar.jsx';
import { ago, plural } from '../lib/format.js';
import { load, save } from '../lib/storage.js';
import { useToast } from '../lib/toast.jsx';
import { useCompanyNotes } from '../lib/useCompanyNotes.js';
import { useDashboard } from '../lib/useDashboard.js';
import { useProvider } from '../lib/useProvider.js';

const ARM_MS = 4000;

export default function Dashboard({ user, onLogout }) {
  const navigate = useNavigate();
  const toast = useToast();
  const ns = (k) => `ud:${user.login}:${k}`;

  // ── Platforma tanlovi ───────────────────────────────────────────────────
  const { connections, provider, setProvider } = useProvider(user);
  const { fleet, fleetError, rows, config, configLoaded, patchRow, bulk, saveConfig, certify } = useDashboard(provider, user);
  const { notes } = useCompanyNotes();

  // ── Ko'rinish holati ────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [board, setBoard] = useState(() => load(ns('board'), 'all'));
  const [collapsed, setCollapsed] = useState(() => new Set(load(ns('collapsed'), [])));

  useEffect(() => save(ns('board'), board), [board]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => save(ns('collapsed'), [...collapsed]), [collapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  // NOZIK JOY: sahifa ochilganda sozlama hali yuklanmagan, boardlar ro'yxati
  // bo'sh. Shu paytda "saqlangan board yo'q ekan" deb tozalasak, tanlov har
  // yangilanishda All ga tushib ketadi. Shuning uchun faqat yuklangandan keyin.
  useEffect(() => {
    if (!configLoaded) return;
    if (board !== 'all' && !config.boards.some((b) => b.id === board)) setBoard('all');
  }, [configLoaded, config, board]);

  // ── Haydovchilar → kalitlar, filtrlar, guruhlar ─────────────────────────
  const drivers = useMemo(
    () => (fleet?.drivers ?? []).map((d) => ({ ...d, key: `${fleet.provider}:${d.driverId}` })),
    [fleet],
  );

  const companies = useMemo(() => {
    const m = new Map();
    for (const d of drivers) {
      const c = m.get(d.companyId) ?? { id: d.companyId, name: d.company, drivers: 0 };
      c.drivers++;
      m.set(d.companyId, c);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [drivers]);

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
          (!q || d.driverName.toLowerCase().includes(q) || d.truck.toLowerCase().includes(q) || d.company.toLowerCase().includes(q)),
      ),
    [drivers, boardCompanies, q],
  );
  const filtered = shown.length !== drivers.length || Boolean(q) || Boolean(boardCompanies);

  const groups = useMemo(() => {
    const m = new Map();
    for (const d of shown) {
      if (!m.has(d.companyId)) m.set(d.companyId, { companyId: d.companyId, company: d.company, drivers: [] });
      m.get(d.companyId).drivers.push(d);
    }
    const out = [...m.values()].sort((a, b) => a.company.localeCompare(b.company));
    for (const g of out) {
      g.drivers.sort((a, b) => a.driverName.localeCompare(b.driverName));
      g.checked = g.drivers.filter((d) => rows[d.key]?.checkedAt).length;
    }
    return out;
  }, [shown, rows]);

  // Ko'rinib turgan tartib (yig'ilgan guruhlarsiz) — Shift diapazoni shu
  // bo'yicha: kompaniyalar chegarasidan o'tadi, lekin yig'ilgan guruhdagi
  // ko'rinmayotgan qatorlarga tegmaydi.
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
      const keys = vis.slice(lo, hi + 1).filter((k) => isOn(k) !== a.state);
      b(keys, { checked: a.state });
      return;
    }
    const next = !isOn(key);
    anchor.current = { key, state: next };
    p(key, { checked: next });
  }, []);

  // Sichqoncha bilan sudrab belgilash (Asana kabi). FleetTable diapazonni
  // hisoblaydi, bu yerda faqat holati farq qiladiganlari bitta so'rovda ketadi.
  // Boshlanish nuqtasi Shift-diapazon uchun ham anchor bo'lib qoladi.
  const onDragCommit = useCallback((startKey, keys, state) => {
    const { rows: r, bulk: b } = live.current;
    anchor.current = { key: startKey, state };
    const changed = keys.filter((k) => Boolean(r[k]?.checkedAt) !== state);
    if (changed.length) b(changed, { checked: state });
  }, []);
  const isChecked = useCallback((k) => Boolean(live.current.rows[k]?.checkedAt), []);

  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), ARM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  useEffect(() => setArmed(false), [board, q]);

  const headerState = !shownKeys.length || checkedShown === 0 ? 'none' : checkedShown === shownKeys.length ? 'all' : 'some';
  const onHeaderClick = useCallback(async () => {
    if (!armed) return setArmed(true);
    setArmed(false);
    const { rows: r } = live.current;
    if (headerState === 'all') {
      const ok = await bulk(shownKeys, { checked: false });
      if (ok) toast.show(`Cleared ${plural(shownKeys.length, 'check')}`);
    } else {
      const keys = shownKeys.filter((k) => !r[k]?.checkedAt);
      const ok = await bulk(keys, { checked: true });
      if (ok) toast.show(`Checked ${plural(keys.length, 'driver')}`);
    }
  }, [armed, headerState, shownKeys, bulk, toast]);

  // ── Assign ──────────────────────────────────────────────────────────────
  const onAssign = useCallback(
    async (name, scope) => {
      const pool = scope === 'all' ? drivers.map((d) => d.key) : shownKeys;
      const before = new Map(pool.map((k) => [k, rows[k]?.responsible ?? '']));
      const keys = pool.filter((k) => before.get(k) !== name);
      if (!keys.length) return toast.show(`${name} is already assigned to all ${pool.length}`);
      const ok = await bulk(keys, { responsible: name });
      if (!ok) return;
      toast.show(`Assigned ${name} to ${plural(keys.length, 'driver')}`, {
        action: {
          label: 'Undo',
          run: async () => {
            // Oldingi qiymat bo'yicha guruhlab qaytaramiz — har guruh bitta so'rov.
            const byPrev = new Map();
            for (const k of keys) {
              const v = before.get(k);
              byPrev.set(v, [...(byPrev.get(v) ?? []), k]);
            }
            for (const [v, ks] of byPrev) await bulk(ks, { responsible: v });
            toast.show('Assignment undone');
          },
        },
      });
    },
    [drivers, shownKeys, rows, bulk, toast],
  );

  // ── Cycle xabarnomalari ─────────────────────────────────────────────────
  // Yopilgan yorliq qaysi darajada yopilganini eslaydi. Daraja o'zgarsa
  // (ko'tarilib yana tushsa ham) — yozuv o'chadi va yorliq qayta chiqadi.
  const [dismissed, setDismissed] = useState(() => load(ns('notices'), {}));
  useEffect(() => {
    if (!fleet) return;
    const lvl = new Map(drivers.map((d) => [d.key, cycleLevel(d.cycleRemainingMin)]));
    setDismissed((prev) => {
      const next = {};
      for (const [k, v] of Object.entries(prev)) if (lvl.get(k) === v) next[k] = v;
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
  }, [fleet, drivers]);
  useEffect(() => save(ns('notices'), dismissed), [dismissed]); // eslint-disable-line react-hooks/exhaustive-deps
  const notices = useMemo(() => {
    const out = {};
    for (const d of drivers) {
      const l = cycleLevel(d.cycleRemainingMin);
      if (l && dismissed[d.key] !== l) out[d.key] = true;
    }
    return out;
  }, [drivers, dismissed]);
  const levels = useRef({});
  levels.current = Object.fromEntries(drivers.map((d) => [d.key, cycleLevel(d.cycleRemainingMin)]));
  const onDismissNotice = useCallback((key) => setDismissed((p) => ({ ...p, [key]: levels.current[key] })), []);

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
    () => shown.filter((d) => {
      const s = certStates[d.key]?.phase;
      const recent = rows[d.key]?.certified && Date.now() - Date.parse(rows[d.key].certified) < 24 * 3600_000;
      return s !== 'done' && !recent;
    }),
    [shown, certStates, rows],
  );

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
    // Birma-bir: platforma kvotasini bo'g'masin va jarayon ko'rinib tursin.
    const list = certTargets;
    stopAll.current = false;
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      if (stopAll.current) break;
      setCertAll({ phase: 'running', done: i, total: list.length });
      if (await runCertify(list[i])) ok++;
      else failed++;
    }
    setCertAll({ phase: 'idle' });
    toast.show(`Certified ${ok}${failed ? ` · ${failed} failed` : ''}${stopAll.current ? ' · stopped' : ''}`, { tone: failed ? 'error' : 'info' });
  }

  const onCopyName = useCallback(
    (name) => {
      navigator.clipboard?.writeText(name).then(
        () => toast.show(`Copied “${name}”`),
        () => toast.show('Could not copy', { tone: 'error' }),
      );
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
    async (companyId, companyName, boardId) => {
      const cfg = configRef.current;
      const b = cfg.boards.find((x) => x.id === boardId);
      const has = b.companies.includes(companyId);
      const boards = cfg.boards.map((x) => (x.id === boardId ? { ...x, companies: has ? x.companies.filter((c) => c !== companyId) : [...x.companies, companyId] } : x));
      try {
        await saveConfig({ ...cfg, boards });
        toast.show(has ? `Removed ${companyName} from ${b.name}` : `Added ${companyName} to ${b.name}`);
      } catch (err) {
        toast.show(`Not saved: ${err.message}`, { tone: 'error' });
      }
    },
    [saveConfig, toast],
  );

  // ── Board tablari ───────────────────────────────────────────────────────
  const boardTabs = useMemo(() => {
    if (!configLoaded) return [];
    return config.boards.map((b) => {
      const set = new Set(b.companies);
      return { id: b.id, name: b.name, count: drivers.filter((d) => set.has(d.companyId)).length };
    });
  }, [configLoaded, config, drivers]);

  const supportsCertify = Boolean(fleet?.supportsCertify);
  const certify_ = useMemo(() => ({ supported: supportsCertify, states: certStates, onClick: onCertifyClick }), [supportsCertify, certStates, onCertifyClick]);
  const header = { state: headerState, armed, onClick: onHeaderClick, count: headerState === 'all' ? shownKeys.length : shownKeys.length - checkedShown };

  const loading = !fleet && !fleetError;

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
        <div className="toolbar">
          <div className="search">
            <input type="search" placeholder="Search name, truck, company" aria-label="Search drivers" value={search} onChange={(e) => setSearch(e.target.value)} />
            {search && (
              <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setSearch('')}>
                ×
              </button>
            )}
          </div>
          <span className="counts num">
            {plural(shown.length, 'driver')} · {plural(new Set(shown.map((d) => d.companyId)).size, 'company', 'companies')}
          </span>
          <span className="counts num" aria-label={`${checkedShown} of ${shown.length} checked`}>
            <span className={checkedShown && checkedShown === shown.length ? 'tone-lime' : ''}>{checkedShown}</span>/{shown.length} checked
          </span>
          <span className="grow" />
          {configLoaded && (
            <AssignMenu me={config.me} responsibles={config.responsibles} shownCount={shownKeys.length} allCount={drivers.length} filtered={filtered} onAssign={onAssign} onOpenSettings={onOpenSettings} />
          )}
          {supportsCertify && (
            <button
              type="button"
              className={`btn btn-sm ${certAll.phase === 'confirm' ? 'btn-amber' : ''}`}
              onClick={onCertifyAll}
              disabled={certAll.phase !== 'running' && !certTargets.length}
              title="Certify logs for every shown driver, one by one"
            >
              {certAll.phase === 'running' ? `Certifying ${certAll.done + 1}/${certAll.total} · Stop` : certAll.phase === 'confirm' ? `Certify ${certTargets.length}?` : 'Certify all'}
            </button>
          )}
          <Link className="btn btn-sm btn-ghost" to="/settings">
            Settings
          </Link>
        </div>

        <nav className="board-tabs" aria-label="Boards">
          <button type="button" className={`btab ${board === 'all' ? 'is-on' : ''}`} aria-pressed={board === 'all'} onClick={() => setBoard('all')}>
            All <span className="num muted">{drivers.length}</span>
          </button>
          {boardTabs.map((b) => (
            <button key={b.id} type="button" className={`btab ${board === b.id ? 'is-on' : ''}`} aria-pressed={board === b.id} onClick={() => setBoard(b.id)}>
              {b.name} <span className="num muted">{b.count}</span>
            </button>
          ))}
          {configLoaded && (
            <button type="button" className="btab btab-add" onClick={() => onOpenSettings('boards')}>
              {boardTabs.length ? 'Edit boards' : '+ Board'}
            </button>
          )}
        </nav>

        <Notices fleet={fleet} error={fleetError} />

        {loading && <p className="muted pad">Loading drivers…</p>}
        {fleet && configLoaded && (
          shown.length ? (
            <FleetTable
              groups={groups}
              rows={rows}
              config={config}
              collapsed={collapsed}
              onToggleGroup={onToggleGroup}
              onCheckClick={onCheckClick}
              header={header}
              onPatch={patchRow}
              notices={notices}
              onDismissNotice={onDismissNotice}
              certify={certify_}
              onCopyName={onCopyName}
              onOpenSettings={onOpenSettings}
              visibleKeys={visibleKeys}
              isChecked={isChecked}
              onDragCommit={onDragCommit}
              notes={notes}
              provider={fleet.provider}
              boards={config.boards}
              onToggleBoard={onToggleBoard}
            />
          ) : (
            <div className="empty card">
              {drivers.length === 0 ? (
                <p>No active drivers in the last 24 hours.</p>
              ) : (
                <>
                  <p>No drivers match{q ? ` “${search.trim()}”` : ''}{boardCompanies ? ' on this board' : ''}.</p>
                  <div className="actions">
                    {q && (
                      <button type="button" className="btn btn-sm" onClick={() => setSearch('')}>
                        Clear search
                      </button>
                    )}
                    {boardCompanies && (
                      <button type="button" className="btn btn-sm" onClick={() => setBoard('all')}>
                        Show all
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        )}
        {fleet?.fetchedAt && <p className="foot muted small">Updated {ago(fleet.fetchedAt)}{fleet.hiddenInactive ? ` · ${fleet.hiddenInactive} inactive hidden (no signal in 24 h)` : ''}</p>}
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
        <p className="muted small pad-x">
          No access to {fleet.restricted.length === 1 ? '1 company' : `${fleet.restricted.length} companies`}: {fleet.restricted.slice(0, 5).join(', ')}
        </p>
      )}
    </>
  );
}
