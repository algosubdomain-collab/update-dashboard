import { useMemo, useRef, useState } from 'react';

// Boardlar: har biri karta — nomi, kompaniya chip'lari (× bilan olib
// tashlanadi) va "Add company" qidiruvi (yozasiz → Enter → qo'shildi).
// Pastda hech bir boardga tushmagan kompaniyalar — har biri yonida
// boardga bir bosishda qo'shish tugmalari.
export default function BoardsEditor({ boards, companies, onChange }) {
  const [newName, setNewName] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);
  const byId = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const inSome = new Set(boards.flatMap((b) => b.companies));
  const orphans = companies.filter((c) => !inSome.has(c.id));

  const update = (id, patch) => onChange(boards.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const addTo = (id, companyIds) => {
    const b = boards.find((x) => x.id === id);
    update(id, { companies: [...new Set([...b.companies, ...companyIds])] });
  };

  function create(e) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    onChange([...boards, { id: `b${Date.now().toString(36)}`, name, companies: [] }]);
    setNewName('');
  }

  return (
    <div className="boards">
      <p className="muted small">A board is a saved view of some companies. A company can be on several boards; values stay the same on every board.</p>

      <form className="opt-add board-new" onSubmit={create}>
        <input value={newName} maxLength={40} placeholder="New board name…" aria-label="New board name" onChange={(e) => setNewName(e.target.value)} />
        <button className="btn btn-sm btn-primary" disabled={!newName.trim()}>
          Create board
        </button>
      </form>

      {boards.map((b) => (
        <section key={b.id} className="card board-card" aria-label={`Board ${b.name}`}>
          <div className="row-line board-card-head">
            <input className="board-name" value={b.name} maxLength={40} aria-label="Board name" onChange={(e) => update(b.id, { name: e.target.value })} />
            <span className="muted small num">{b.companies.length} companies</span>
            <span className="grow" />
            <button
              type="button"
              className={`btn btn-xs ${confirmDel === b.id ? 'btn-danger' : 'btn-ghost'}`}
              onClick={() => {
                if (confirmDel !== b.id) return setConfirmDel(b.id);
                onChange(boards.filter((x) => x.id !== b.id));
                setConfirmDel(null);
              }}
              onBlur={() => setConfirmDel(null)}
            >
              {confirmDel === b.id ? `Delete “${b.name}”?` : 'Delete'}
            </button>
          </div>

          <ul className="chips" aria-label={`Companies on ${b.name}`}>
            {b.companies.map((id) => (
              <li key={id} className={`chip ${byId.has(id) ? '' : 'chip-stale'}`} title={byId.has(id) ? undefined : 'Not in the current fleet'}>
                <span className="ellipsis">{byId.get(id)?.name ?? id}</span>
                <button type="button" aria-label={`Remove ${byId.get(id)?.name ?? id} from ${b.name}`} onClick={() => update(b.id, { companies: b.companies.filter((x) => x !== id) })}>
                  ×
                </button>
              </li>
            ))}
            {!b.companies.length && <li className="muted small">No companies yet — add some below.</li>}
          </ul>

          <CompanyAdder companies={companies.filter((c) => !b.companies.includes(c.id))} onAdd={(ids) => addTo(b.id, ids)} />
        </section>
      ))}

      {boards.length > 0 && orphans.length > 0 && (
        <section className="orphans">
          <h3>Only in All ({orphans.length})</h3>
          <ul className="orphan-list">
            {orphans.map((c) => (
              <li key={c.id}>
                <span className="grow ellipsis">{c.name}</span>
                <span className="muted small num">{c.drivers}</span>
                {boards.map((b) => (
                  <button key={b.id} type="button" className="btn btn-xs" onClick={() => addTo(b.id, [c.id])} aria-label={`Add ${c.name} to ${b.name}`}>
                    + {b.name}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// Qidiruv bilan kompaniya qo'shish: yozasiz, ↑↓ bilan tanlaysiz, Enter.
function CompanyAdder({ companies, onAdd }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef(null);
  const query = q.trim().toLowerCase();
  const found = query ? companies.filter((c) => c.name.toLowerCase().includes(query)).slice(0, 8) : [];

  const add = (c) => {
    onAdd([c.id]);
    setQ('');
    setActive(0);
    input.current?.focus();
  };

  return (
    <div className="adder">
      <div className="row-line">
        <input
          ref={input}
          className="grow"
          value={q}
          placeholder={companies.length ? 'Add company — type to search…' : 'All companies are on this board'}
          disabled={!companies.length}
          aria-label="Add company to board"
          role="combobox"
          aria-expanded={found.length > 0}
          aria-autocomplete="list"
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(found.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter' && found[active]) {
              e.preventDefault();
              add(found[active]);
            } else if (e.key === 'Escape') setQ('');
          }}
        />
        {companies.length > 0 && (
          <button type="button" className="btn btn-xs btn-ghost" onClick={() => onAdd((query ? companies.filter((c) => c.name.toLowerCase().includes(query)) : companies).map((c) => c.id))}>
            {query ? 'Add all found' : `Add all ${companies.length}`}
          </button>
        )}
      </div>
      {found.length > 0 && (
        <ul className="adder-list" role="listbox">
          {found.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === active} className={`menu-item ${i === active ? 'is-active' : ''}`} onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => add(c)}>
              <span>{c.name}</span>
              <span className="muted small num">{c.drivers} drivers</span>
            </li>
          ))}
        </ul>
      )}
      {query && !found.length && <p className="muted small">No company matches “{q.trim()}”.</p>}
    </div>
  );
}
