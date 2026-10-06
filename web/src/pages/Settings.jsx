import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useSearchParams } from 'react-router-dom';
import BoardsEditor from '../components/BoardsEditor.jsx';
import OptionList from '../components/OptionList.jsx';
import RequirementsEditor from '../components/RequirementsEditor.jsx';
import TopBar from '../components/TopBar.jsx';
import { useToast } from '../lib/toast.jsx';
import { useCompanyNotes } from '../lib/useCompanyNotes.js';
import { useDashboard } from '../lib/useDashboard.js';
import { useProvider } from '../lib/useProvider.js';

const SECTIONS = [
  { id: 'columns', label: 'Columns', hint: 'Status and Profile Form options' },
  { id: 'responsible', label: 'Responsible', hint: 'People and your name' },
  { id: 'boards', label: 'Boards', hint: 'Group companies into views' },
  { id: 'requirements', label: 'Requirements', hint: 'Notes for companies and drivers' },
];

// Sozlamalar — alohida sahifa (kichik modal emas). Columns / Responsible /
// Boards bitta qoralama bilan ishlaydi va "Save changes" bilan saqlanadi;
// saqlanmagan o'zgarish bilan sahifadan chiqishdan oldin so'raladi.
// Requirements darhol saqlanadi (har eslatma alohida).
export default function Settings({ user, onLogout }) {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = SECTIONS.some((s) => s.id === params.get('tab')) ? params.get('tab') : 'columns';
  const { provider } = useProvider(user);
  const { fleet, rows, config, configLoaded, saveConfig, patchRow } = useDashboard(provider, user);
  const { notes, save: saveNote } = useCompanyNotes();

  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const tabRefs = useRef({});

  useEffect(() => {
    if (configLoaded && !draft) setDraft(structuredClone(config));
  }, [configLoaded, config, draft]);

  const dirty = useMemo(() => draft && JSON.stringify(draft) !== JSON.stringify(config), [draft, config]);
  const problem = useMemo(() => (draft ? validate(draft) : null), [draft]);

  // Saqlanmagan o'zgarish bilan boshqa sahifaga o'tish — so'raymiz.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => Boolean(dirty) && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return undefined;
    const onUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  // Ochilganda fokus faol bo'limga.
  useEffect(() => {
    tabRefs.current[tab]?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setTab = (id, extra = {}) => {
    const next = new URLSearchParams({ tab: id, ...extra });
    setParams(next, { replace: true });
  };

  function onTabKey(e) {
    const i = SECTIONS.findIndex((s) => s.id === tab);
    let next = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = SECTIONS[(i + 1) % SECTIONS.length].id;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = SECTIONS[(i - 1 + SECTIONS.length) % SECTIONS.length].id;
    if (e.key === 'Home') next = SECTIONS[0].id;
    if (e.key === 'End') next = SECTIONS[SECTIONS.length - 1].id;
    if (next) {
      e.preventDefault();
      setTab(next);
      tabRefs.current[next]?.focus();
    }
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const saved = await saveConfig(draft);
      setDraft(structuredClone(saved));
      toast.show('Settings saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const drivers = useMemo(() => (fleet?.drivers ?? []).map((d) => ({ ...d, key: `${fleet.provider}:${d.driverId}` })), [fleet]);
  const companies = useMemo(() => {
    const m = new Map();
    for (const d of drivers) {
      const c = m.get(d.companyId) ?? { id: d.companyId, name: d.company, drivers: 0 };
      c.drivers++;
      m.set(d.companyId, c);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [drivers]);

  const isConfigTab = tab !== 'requirements';

  return (
    <>
      <TopBar user={user} onLogout={onLogout} />
      <main className="settings">
        <div className="settings-head">
          <Link to="/" className="btn btn-ghost btn-sm back">
            ‹ Dashboard
          </Link>
          <h1 className="page-title">Settings</h1>
        </div>

        <div className="settings-grid">
          <nav className="settings-nav" role="tablist" aria-orientation="vertical" aria-label="Settings sections" onKeyDown={onTabKey}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                ref={(el) => {
                  tabRefs.current[s.id] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${s.id}`}
                aria-selected={tab === s.id}
                aria-controls={`panel-${s.id}`}
                tabIndex={tab === s.id ? 0 : -1}
                className={`snav ${tab === s.id ? 'is-on' : ''}`}
                onClick={() => setTab(s.id)}
              >
                <span>{s.label}</span>
                <span className="snav-hint">{s.hint}</span>
              </button>
            ))}
          </nav>

          <section className="settings-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {!draft && <p className="muted">Loading…</p>}
            {draft && tab === 'columns' && (
              <div className="cols-2">
                <OptionList title="Status" items={draft.statuses} onChange={(statuses) => setDraft({ ...draft, statuses })} />
                <OptionList title="Profile Form" items={draft.profileForms} onChange={(profileForms) => setDraft({ ...draft, profileForms })} />
              </div>
            )}
            {draft && tab === 'responsible' && (
              <div className="stack narrow-col">
                <OptionList
                  title="Responsible people"
                  hint="The Responsible column only offers names from this list."
                  items={draft.responsibles}
                  onChange={(responsibles) => setDraft({ ...draft, responsibles, me: responsibles.some((r) => r.label === draft.me) ? draft.me : '' })}
                />
                <label className="field field-inline">
                  <span>Your name</span>
                  <select value={draft.me} onChange={(e) => setDraft({ ...draft, me: e.target.value })} disabled={!draft.responsibles.length}>
                    <option value="">— not set —</option>
                    {draft.responsibles.map((r) => (
                      <option key={r.label} value={r.label}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted small">Used by “Assign &lt;name&gt; to all” and as “checked by”.</p>
              </div>
            )}
            {draft && tab === 'boards' && <BoardsEditor boards={draft.boards} companies={companies} onChange={(boards) => setDraft({ ...draft, boards })} />}
            {tab === 'requirements' && (
              fleet ? (
                <RequirementsEditor
                  provider={fleet.provider}
                  drivers={drivers}
                  rows={rows}
                  notes={notes}
                  onSaveCompany={saveNote}
                  onSaveDriver={patchRow}
                  companyId={params.get('company')}
                  onOpenCompany={(id, driverKey) => setTab('requirements', id ? { company: id, ...(driverKey ? { driver: driverKey } : {}) } : {})}
                />
              ) : (
                <p className="muted">Loading drivers…</p>
              )
            )}
          </section>
        </div>

        {isConfigTab && draft && (
          <div className="savebar" role={problem || error ? 'alert' : undefined}>
            <span className={`small grow ${problem || error ? 'tone-red' : dirty ? 'tone-amber' : 'muted'}`}>{error || problem || (dirty ? 'Unsaved changes' : 'All changes saved')}</span>
            {dirty && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDraft(structuredClone(config))}>
                Discard
              </button>
            )}
            <button type="button" className="btn btn-sm btn-primary" disabled={!dirty || Boolean(problem) || saving} onClick={save}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}

        {blocker.state === 'blocked' && (
          <div className="overlay">
            <div className="card confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="leave-title">
              <h2 id="leave-title">Leave without saving?</h2>
              <p className="muted">You have unsaved changes in Settings.</p>
              <div className="actions">
                <button type="button" className="btn btn-sm btn-danger" onClick={() => blocker.proceed()}>
                  Discard and leave
                </button>
                <button type="button" className="btn btn-sm" autoFocus onClick={() => blocker.reset()}>
                  Stay
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

function validate(d) {
  for (const [name, list] of [
    ['Status', d.statuses],
    ['Profile Form', d.profileForms],
    ['Responsible', d.responsibles],
  ]) {
    const seen = new Set();
    for (const o of list) {
      const l = o.label.trim().toLowerCase();
      if (!l) return `${name}: an option has no name`;
      if (seen.has(l)) return `${name}: “${o.label.trim()}” is listed twice`;
      seen.add(l);
    }
  }
  for (const b of d.boards) if (!b.name.trim()) return 'A board has no name';
  return null;
}
