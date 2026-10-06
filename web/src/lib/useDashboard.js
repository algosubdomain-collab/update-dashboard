import { useCallback, useEffect, useRef, useState } from 'react';
import { get, post, put } from './api.js';
import { useToast } from './toast.jsx';

const POLL_MS = 30_000;

// Serverdagi qoidaning lokal nusxasi — optimistik yangilanish uchun.
// Server javobi kelganda baribir uning natijasi yoziladi.
function applyLocal(row, patch, by) {
  const next = { ...(row ?? {}) };
  for (const f of ['status', 'profileForm', 'responsible']) {
    if (!(f in patch)) continue;
    if (patch[f]) next[f] = patch[f];
    else delete next[f];
  }
  if (patch.checked === true && !next.checkedAt) {
    next.checkedAt = new Date().toISOString();
    next.checkedBy = by;
  } else if (patch.checked === false) {
    delete next.checkedAt;
    delete next.checkedBy;
  }
  return Object.keys(next).length ? next : null;
}

function setKeys(rows, entries) {
  const out = { ...rows };
  for (const [k, v] of entries) {
    if (v) out[k] = v;
    else delete out[k];
  }
  return out;
}

export function useDashboard(provider, user) {
  const toast = useToast();
  const [fleet, setFleet] = useState(null);
  const [fleetError, setFleetError] = useState(null);
  const [rows, setRows] = useState({});
  const [config, setConfig] = useState(null); // null — hali yuklanmagan
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  // Saqlash davom etayotganda fon so'rovi qatorlarni eski holat bilan
  // bosib yozmasin (optimistik o'zgarish bir zumga "orqaga sakramasin").
  const pending = useRef(0);
  const by = config?.me || user.login;

  const loadFleet = useCallback(async () => {
    if (!provider) return;
    try {
      const r = await get(`/api/drivers?provider=${encodeURIComponent(provider)}`);
      setFleet(r);
      setFleetError(null);
    } catch (err) {
      setFleetError(err);
    }
  }, [provider]);

  useEffect(() => {
    setFleet(null);
    loadFleet();
    get('/api/board').then((r) => setRows(r.rows)).catch((e) => toast.show(`Board: ${e.message}`, { tone: 'error' }));
    get('/api/board-config').then((r) => setConfig(r.config)).catch((e) => toast.show(`Settings: ${e.message}`, { tone: 'error' }));

    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      loadFleet();
      get('/api/board')
        .then((r) => {
          if (pending.current === 0) setRows(r.rows);
        })
        .catch(() => {});
    };
    const t = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [provider, loadFleet, toast]);

  // Bitta qator.
  const patchRow = useCallback(
    async (key, patch) => {
      const prev = rowsRef.current[key];
      setRows((r) => setKeys(r, [[key, applyLocal(r[key], patch, by)]]));
      pending.current++;
      try {
        const res = await put('/api/board', { key, patch });
        setRows((r) => setKeys(r, [[key, res.row]]));
      } catch (err) {
        setRows((r) => setKeys(r, [[key, prev]]));
        toast.show(`Not saved: ${err.message}`, { tone: 'error' });
      } finally {
        pending.current--;
      }
    },
    [by, toast],
  );

  // Ko'p qatorga bitta patch — ALBATTA bitta so'rov.
  const bulk = useCallback(
    async (keys, patch) => {
      if (!keys.length) return true;
      const prev = keys.map((k) => [k, rowsRef.current[k]]);
      setRows((r) => setKeys(r, keys.map((k) => [k, applyLocal(r[k], patch, by)])));
      pending.current++;
      try {
        const res = await post('/api/board/bulk', { keys, patch });
        setRows((r) => setKeys(r, Object.entries(res.rows)));
        return true;
      } catch (err) {
        setRows((r) => setKeys(r, prev));
        toast.show(`Not saved: ${err.message}`, { tone: 'error' });
        return false;
      } finally {
        pending.current--;
      }
    },
    [by, toast],
  );

  const saveConfig = useCallback(async (next) => {
    const r = await put('/api/board-config', { config: next });
    setConfig(r.config);
    return r.config;
  }, []);

  const certify = useCallback(
    async (driverId) => {
      const r = await post('/api/certify', { provider, driverId });
      setRows((rs) => setKeys(rs, [[r.key, r.row]]));
      return r;
    },
    [provider],
  );

  return { fleet, fleetError, rows, config, configLoaded: config !== null, patchRow, bulk, saveConfig, certify, reload: loadFleet };
}
