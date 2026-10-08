import { useState } from 'react';
import BrandMark from '../components/BrandMark.jsx';
import { post } from '../lib/api.js';

export default function Login({ onLogin, devLogin }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await post('/api/auth/login', { login: login.trim(), password });
      onLogin(r.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Faqat lokal sinov rejimida (server devLogin=true desa) — production'da yo'q.
  async function continueAsDemo() {
    setBusy(true);
    setError('');
    try {
      const r = await post('/api/auth/dev-login');
      onLogin(r.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <form className="card auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <BrandMark />
          <h1 className="auth-title">Update Dashboard</h1>
          <p>Sign in to continue</p>
        </div>
        <label className="field">
          <span>Login</span>
          <input autoFocus autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {devLogin && (
          <>
            <div className="auth-or">
              <span>local testing</span>
            </div>
            <button type="button" className="btn" onClick={continueAsDemo} disabled={busy}>
              Continue as default user
            </button>
          </>
        )}
      </form>
    </main>
  );
}
