import { useState } from 'react';

export const COLORS = ['lime', 'amber', 'red', 'violet', 'sky', 'slate'];

// Nom + rang ro'yxati (Status, Profile Form, Responsible variantlari).
// Rang kvadratchani bosib almashtiriladi.
export default function OptionList({ title, hint, items, onChange }) {
  const [text, setText] = useState('');
  const add = () => {
    const label = text.trim();
    if (!label) return;
    // Yangi variant birinchi ishlatilmagan rangni oladi.
    const used = new Set(items.map((i) => i.color));
    onChange([...items, { label, color: COLORS.find((c) => !used.has(c)) ?? 'slate' }]);
    setText('');
  };
  return (
    <section className="optlist">
      <h3>{title}</h3>
      {hint && <p className="muted small">{hint}</p>}
      <ul>
        {items.map((o, i) => (
          <li key={i} className="opt">
            <button
              type="button"
              className={`swatch swatch-${o.color}`}
              aria-label={`Color ${o.color} for ${o.label || 'option'} — click to change`}
              title="Click to change color"
              onClick={() => onChange(items.map((x, j) => (j === i ? { ...x, color: COLORS[(COLORS.indexOf(x.color) + 1) % COLORS.length] } : x)))}
            />
            <input value={o.label} maxLength={40} aria-label={`${title} option ${i + 1}`} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <button type="button" className="btn btn-ghost btn-xs" aria-label={`Remove ${o.label}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              Remove
            </button>
          </li>
        ))}
        {!items.length && <li className="muted small">No options yet.</li>}
      </ul>
      <form
        className="opt-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={text} maxLength={40} placeholder={`Add ${title.toLowerCase()}…`} aria-label={`New ${title} option`} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-sm" disabled={!text.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}
