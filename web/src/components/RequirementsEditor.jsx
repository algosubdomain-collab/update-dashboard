import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../lib/toast.jsx';

// Requirements (eslatmalar). Kompaniyalar ro'yxati ko'rsatilmaydi — faqat
// qidiruv. Kompaniya topilgach uning ICHIGA kiriladi:
//   • kompaniya eslatmasi — dashboard'da faqat kompaniya sarlavhasida chiqadi
//     (har bir haydovchi ostida takrorlanmaydi);
//   • haydovchi eslatmasi — faqat o'sha haydovchining qatorida chiqadi.
export default function RequirementsEditor({ provider, drivers, rows, notes, onSaveCompany, onSaveDriver, companyId, onOpenCompany }) {
  const [q, setQ] = useState('');
  const search = useRef(null);

  const companies = useMemo(() => {
    const m = new Map();
    for (const d of drivers) {
      const c = m.get(d.companyId) ?? { id: d.companyId, name: d.company, drivers: [] };
      c.drivers.push(d);
      m.set(d.companyId, c);
    }
    for (const c of m.values()) c.drivers.sort((a, b) => a.driverName.localeCompare(b.driverName));
    return m;
  }, [drivers]);

  const open = companyId ? companies.get(companyId) : null;

  useEffect(() => {
    if (!companyId) search.current?.focus();
  }, [companyId]);

  if (open) {
    return <CompanyNotes provider={provider} company={open} rows={rows} note={notes[`${provider}:${open.id}`] ?? ''} onSaveCompany={onSaveCompany} onSaveDriver={onSaveDriver} onBack={() => onOpenCompany(null)} />;
  }

  const query = q.trim().toLowerCase();
  const companyHits = query ? [...companies.values()].filter((c) => c.name.toLowerCase().includes(query)).slice(0, 12) : [];
  const driverHits = query ? drivers.filter((d) => d.driverName.toLowerCase().includes(query) || d.truck.toLowerCase().includes(query)).slice(0, 8) : [];
  const companyNoteCount = Object.keys(notes).filter((k) => k.startsWith(`${provider}:`)).length;
  const driverNoteCount = drivers.filter((d) => rows[d.key]?.requirement).length;

  return (
    <div className="req">
      <div className="search req-search">
        <input
          ref={search}
          type="search"
          value={q}
          placeholder="Search a company (or a driver)…"
          aria-label="Search a company or driver to add a note"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && companyHits[0]) onOpenCompany(companyHits[0].id);
          }}
        />
        {q && (
          <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setQ('')}>
            ×
          </button>
        )}
      </div>

      {!query && (
        <p className="muted small">
          Find a company, open it and write a note for the whole company or for a single driver.
          {(companyNoteCount > 0 || driverNoteCount > 0) && ` Now: ${companyNoteCount} company notes · ${driverNoteCount} driver notes.`}
        </p>
      )}

      {query && (
        <div className="req-results">
          {companyHits.length > 0 && (
            <>
              <h3>Companies</h3>
              <ul>
                {companyHits.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="req-hit" onClick={() => onOpenCompany(c.id)}>
                      <span className="grow ellipsis strong">{c.name}</span>
                      {notes[`${provider}:${c.id}`] && <span className="note-mark">has note</span>}
                      <span className="muted small num">{c.drivers.length} drivers</span>
                      <span className="req-go" aria-hidden="true">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {driverHits.length > 0 && (
            <>
              <h3>Drivers</h3>
              <ul>
                {driverHits.map((d) => (
                  <li key={d.key}>
                    <button type="button" className="req-hit" onClick={() => onOpenCompany(d.companyId, d.key)}>
                      <span className="grow ellipsis">{d.driverName}</span>
                      <span className="muted small">{d.company}</span>
                      <span className="req-go" aria-hidden="true">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {!companyHits.length && !driverHits.length && <p className="muted small">Nothing matches “{q.trim()}”.</p>}
        </div>
      )}
    </div>
  );
}

function CompanyNotes({ provider, company, rows, note, onSaveCompany, onSaveDriver, onBack }) {
  const toast = useToast();
  const [text, setText] = useState(note);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const box = useRef(null);
  useEffect(() => setText(note), [note]);
  useEffect(() => {
    // Haydovchi qidiruvidan kelgan bo'lsa — o'sha haydovchining maydoniga.
    const focusKey = new URLSearchParams(window.location.search).get('driver');
    const el = focusKey && document.querySelector(`[data-note-key="${CSS.escape(focusKey)}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      el.focus();
    } else box.current?.focus();
  }, []);

  const dirty = text.trim() !== note.trim();
  async function save() {
    setBusy(true);
    try {
      await onSaveCompany(`${provider}:${company.id}`, text);
      toast.show(text.trim() ? `Note saved for ${company.name}` : `Note removed from ${company.name}`);
    } catch (err) {
      toast.show(`Not saved: ${err.message}`, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const f = filter.trim().toLowerCase();
  const list = f ? company.drivers.filter((d) => d.driverName.toLowerCase().includes(f) || d.truck.toLowerCase().includes(f)) : company.drivers;

  return (
    <div className="req">
      <button type="button" className="btn btn-ghost btn-sm back" onClick={onBack}>
        ‹ Search
      </button>
      <h2 className="req-title">
        {company.name} <span className="muted small num">{company.drivers.length} drivers</span>
      </h2>

      <section className="card req-company">
        <label className="field">
          <span>Note for the whole company</span>
          <textarea
            ref={box}
            rows={2}
            maxLength={280}
            value={text}
            placeholder="e.g. Call dispatch before any reset"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && dirty) {
                e.preventDefault();
                save();
              }
            }}
          />
        </label>
        <div className="row-line">
          <span className="muted small grow">Shown on the company row in the dashboard, not under each driver.</span>
          {note && (
            <button type="button" className="btn btn-xs btn-ghost" disabled={busy} onClick={() => { setText(''); onSaveCompany(`${provider}:${company.id}`, '').then(() => toast.show(`Note removed from ${company.name}`)); }}>
              Remove
            </button>
          )}
          <button type="button" className="btn btn-sm btn-primary" disabled={busy || !dirty} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>

      <section className="req-drivers">
        <div className="row-line">
          <h3 className="grow">Driver notes</h3>
          {company.drivers.length > 8 && <input type="search" placeholder="Filter drivers…" aria-label="Filter drivers" value={filter} onChange={(e) => setFilter(e.target.value)} />}
        </div>
        <p className="muted small">Shown next to that driver only.</p>
        <ul className="card list">
          {list.map((d) => (
            <DriverNote key={d.key} driver={d} note={rows[d.key]?.requirement ?? ''} onSave={onSaveDriver} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function DriverNote({ driver, note, onSave }) {
  const [text, setText] = useState(note);
  useEffect(() => setText(note), [note]);
  const dirty = text.trim() !== note.trim();
  const save = () => dirty && onSave(driver.key, { requirement: text.trim() });
  return (
    <li className="list-row driver-note">
      <span className="dn-name ellipsis" title={driver.driverName}>
        {driver.driverName} <span className="muted small num">{driver.truck}</span>
      </span>
      <input
        data-note-key={driver.key}
        className="grow"
        maxLength={280}
        value={text}
        placeholder="No note"
        aria-label={`Note for ${driver.driverName}`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setText(note);
        }}
        onBlur={save}
      />
      {dirty && <span className="tone-amber small">Enter to save</span>}
    </li>
  );
}
