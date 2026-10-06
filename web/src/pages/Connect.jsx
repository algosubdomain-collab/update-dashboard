import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import TopBar from '../components/TopBar.jsx';
import { del, get, put } from '../lib/api.js';
import { ago } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';

// Platformalarni ulash. Login sahifalari reCAPTCHA bilan himoyalangani uchun
// login/parol bilan ulanib bo'lmaydi: foydalanuvchi platformaga o'zi kiradi
// va brauzer konsolidan tokenni olib keladi. Token serverda saqlanadi —
// fon yangilanishi brauzer yopiq bo'lganda ham ishlashi kerak.
export default function Connect({ user, onLogout }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => get('/api/connections').then(setData), []);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  useEffect(() => {
    setToken('');
    setError('');
    setCopied(false);
  }, [open]);

  async function connect(id) {
    setBusy(true);
    setError('');
    try {
      const r = await put(`/api/connections/${id}`, { token });
      const s = r.summary ?? {};
      toast.show(`Connected${s.companies !== undefined ? ` · ${s.companies} companies` : ''}${r.autoRefresh ? ' · auto-refresh on' : ''}`);
      setOpen(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(id) {
    await del(`/api/connections/${id}`);
    toast.show('Disconnected');
    load();
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const connected = new Map((data?.connections ?? []).map((c) => [c.provider, c]));

  return (
    <>
      <TopBar user={user} onLogout={onLogout} />
      <main className="page narrow">
        <div className="page-head">
          <h1 className="page-title">Connections</h1>
          {connected.size > 0 && (
            <Link className="btn btn-primary btn-sm" to="/">
              Open dashboard
            </Link>
          )}
        </div>
        {!data && !error && <p className="muted">Loading…</p>}
        {data && connected.size === 0 && <p className="muted">Connect a platform to start. Sample works without a real account.</p>}

        <div className="card list">
          {data?.providers.map((p) => {
            const c = connected.get(p.id);
            const isOpen = open === p.id;
            return (
              <section key={p.id} className="list-row col">
                <div className="row-line">
                  <div className="grow">
                    <div className="strong">{p.name}</div>
                    <div className="muted small">
                      {c
                        ? c.readable
                          ? `Connected ${ago(c.updatedAt)}${c.autoRefresh ? ' · token auto-refresh on' : ''}`
                          : 'Token unreadable — reconnect'
                        : p.site ?? 'Demo data, no account needed'}
                      {!p.supportsCertify && ' · no certify'}
                    </div>
                  </div>
                  <div className="actions">
                    {c && (
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => disconnect(p.id)}>
                        Disconnect
                      </button>
                    )}
                    <button type="button" className="btn btn-sm" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.id)}>
                      {c ? 'Replace token' : 'Connect'}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <form
                    className="connect-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      connect(p.id);
                    }}
                  >
                    {p.snippet ? (
                      <ol className="steps">
                        <li>
                          Open{' '}
                          <a href={`https://${p.site}`} target="_blank" rel="noreferrer">
                            {p.site}
                          </a>{' '}
                          and sign in.
                        </li>
                        <li>
                          Press <kbd>F12</kbd> → Console, paste this and press Enter:
                          <div className="snippet">
                            <code>{p.snippet}</code>
                            <button type="button" className="btn btn-sm" onClick={() => copy(p.snippet)}>
                              {copied ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                        </li>
                        <li>Paste the copied value below.</li>
                      </ol>
                    ) : (
                      <p className="muted small">{p.tokenHint}</p>
                    )}
                    <label className="field">
                      <span>Token</span>
                      <textarea rows={3} value={token} onChange={(e) => setToken(e.target.value)} required spellCheck={false} autoFocus />
                    </label>
                    {error && (
                      <p className="form-error" role="alert">
                        {error}
                      </p>
                    )}
                    <div className="actions">
                      <button className="btn btn-primary btn-sm" disabled={busy || !token.trim()}>
                        {busy ? 'Checking token…' : 'Check and save'}
                      </button>
                    </div>
                  </form>
                )}
              </section>
            );
          })}
        </div>
      </main>
    </>
  );
}
