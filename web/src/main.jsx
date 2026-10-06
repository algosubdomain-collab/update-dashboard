import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, Route, RouterProvider, Routes, useNavigate } from 'react-router-dom';
import { get, post, setUnauthorizedHandler } from './lib/api.js';
import { ToastProvider } from './lib/toast.jsx';
import Connect from './pages/Connect.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Login from './pages/Login.jsx';
import Owner from './pages/Owner.jsx';
import Settings from './pages/Settings.jsx';
import './styles/tokens.css';
import './styles/app.css';

function App() {
  // undefined — hali bilmaymiz; null — kirmagan.
  const [user, setUser] = useState(undefined);
  const [devLogin, setDevLogin] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    get('/api/auth/status')
      .then((r) => {
        setUser(r.user);
        setDevLogin(Boolean(r.devLogin));
      })
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  const logout = useCallback(async () => {
    await post('/api/auth/logout').catch(() => {});
    setUser(null);
    navigate('/login');
  }, [navigate]);

  if (user === undefined) return <div className="boot" aria-busy="true" />;

  // Owner faqat foydalanuvchilarni boshqaradi, dashboard'ni ko'rmaydi.
  const home = !user ? '/login' : user.role === 'owner' ? '/owner' : '/';

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={home} replace /> : <Login onLogin={setUser} devLogin={devLogin} />} />
      <Route path="/owner" element={user?.role === 'owner' ? <Owner user={user} onLogout={logout} /> : <Navigate to={home} replace />} />
      <Route path="/connect" element={user?.role === 'user' ? <Connect user={user} onLogout={logout} /> : <Navigate to={home} replace />} />
      <Route path="/" element={user?.role === 'user' ? <Dashboard user={user} onLogout={logout} /> : <Navigate to={home} replace />} />
      <Route path="/settings" element={user?.role === 'user' ? <Settings user={user} onLogout={logout} /> : <Navigate to={home} replace />} />
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}

// Data router — Settings sahifasida useBlocker (saqlanmagan o'zgarish bilan
// chiqib ketishdan oldin so'rash) faqat shu bilan ishlaydi.
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <ToastProvider>
        <App />
      </ToastProvider>
    ),
  },
]);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
