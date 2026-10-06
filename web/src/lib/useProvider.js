import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get } from './api.js';
import { load, save } from './storage.js';

// Qaysi platforma ko'rsatilayotgani — Dashboard va Settings uchun umumiy
// (bir xil localStorage kaliti: Settings'dagi kompaniyalar dashboard'dagi
// bilan bir xil platformadan olinadi).
export function useProvider(user) {
  const navigate = useNavigate();
  const key = `ud:${user.login}:provider`;
  const [connections, setConnections] = useState(null);
  const [provider, setProvider] = useState(() => load(key, null));

  useEffect(() => {
    get('/api/connections').then((r) => {
      const ids = r.connections.map((c) => c.provider);
      if (!ids.length) return navigate('/connect', { replace: true });
      setConnections(r.connections.map((c) => ({ ...c, name: r.providers.find((p) => p.id === c.provider)?.name ?? c.provider })));
      setProvider((p) => (ids.includes(p) ? p : ids[0]));
    });
  }, [navigate]);

  useEffect(() => save(key, provider), [key, provider]);

  return { connections, provider: connections ? provider : null, setProvider };
}
