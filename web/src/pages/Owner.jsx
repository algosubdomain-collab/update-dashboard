import { useCallback, useEffect, useState } from 'react';
import TopBar from '../components/TopBar.jsx';
import { del, get, patch, post } from '../lib/api.js';
import { when } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';

// Owner ekrani: faqat foydalanuvchilarni boshqarish.
export default function Owner({ user, onLogout }) {
  const toast = useToast();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ login: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // login
  const [newPw, setNewPw] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(() => {
    get('/api/users')
      .then((r) => setUsers(r.users))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/api/users', { login: form.login.trim(), password: form.password });
      toast.show(`Created ${form.login.trim()}`);
      setForm({ login: '', password: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(login) {
    try {
      await patch(`/api/users/${encodeURIComponent(login)}`, { password: newPw });
      toast.show(`Password changed for ${login}. Their sessions were signed out.`);
      setEditing(null);
      setNewPw('');
    } catch (err) {
      toast.show(err.message, { tone: 'error' });
    }
  }

  async function remove(login) {
    // Ikki bosish: birinchisi so'raydi, ikkinchisi o'chiradi — foydalanuvchi
    // bilan uning butun board'i, ulanishlari va sozlamalari ham ketadi.
    if (confirmDelete !== login) {
      setConfirmDelete(login);
      return;
    }
    try {
      await del(`/api/users/${encodeURIComponent(login)}`);
      toast.show(`Deleted ${login} and all of their data`);
      setConfirmDelete(null);
      load();
    } catch (err) {
      toast.show(err.message, { tone: 'error' });
    }
  }

  return (
    <>
      <TopBar user={user} onLogout={onLogout} />
      <main className="page narrow">
        <h1 className="page-title">Users</h1>

        <form className="card row-form" onSubmit={create}>
          <label className="field">
            <span>Login</span>
            <input value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} autoComplete="off" required pattern="[A-Za-z0-9._\-]{3,32}" title="3–32 characters: letters, digits, . _ -" />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" minLength={8} required />
          </label>
          <button className="btn btn-primary" disabled={busy}>
            Create user
          </button>
        </form>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="card list">
          {!users && <p className="muted pad">Loading…</p>}
          {users?.map((u) => (
            <div key={u.login} className="list-row">
              <div className="grow">
                <div className="strong">
                  {u.login} {u.role === 'owner' && <span className="tag">owner</span>}
                </div>
                <div className="muted small">
                  Created {when(u.createdAt)}
                  {u.providers.length > 0 && ` · ${u.providers.join(', ')}`}
                </div>
              </div>
              {editing === u.login ? (
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    savePassword(u.login);
                  }}
                >
                  <input type="password" placeholder="New password" aria-label={`New password for ${u.login}`} value={newPw} onChange={(e) => setNewPw(e.target.value)} minLength={8} required autoFocus autoComplete="new-password" />
                  <button className="btn btn-sm btn-primary">Save</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="actions">
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setEditing(u.login); setNewPw(''); }}>
                    Change password
                  </button>
                  {u.login !== user.login && (
                    <button
                      type="button"
                      className={`btn btn-sm ${confirmDelete === u.login ? 'btn-danger' : 'btn-ghost'}`}
                      onClick={() => remove(u.login)}
                      onBlur={() => setConfirmDelete((c) => (c === u.login ? null : c))}
                    >
                      {confirmDelete === u.login ? 'Delete with all data?' : 'Delete'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
