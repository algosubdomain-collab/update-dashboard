import { Link } from 'react-router-dom';

export default function TopBar({ user, onLogout, children }) {
  return (
    <header className="topbar">
      <Link to="/" className="brand">
        Update Dashboard
      </Link>
      <div className="topbar-mid">{children}</div>
      <div className="topbar-end">
        {user.role === 'user' && (
          <Link className="btn btn-ghost btn-sm" to="/connect">
            Connections
          </Link>
        )}
        <span className="who" title={`Signed in as ${user.login}`}>
          {user.login}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </header>
  );
}
