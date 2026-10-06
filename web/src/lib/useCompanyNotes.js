import { useCallback, useEffect, useState } from 'react';
import { get, put } from './api.js';

// Kompaniya eslatmalari: { "provider:companyId": matn }.
export function useCompanyNotes() {
  const [notes, setNotes] = useState({});
  useEffect(() => {
    get('/api/company-notes').then((r) => setNotes(r.notes)).catch(() => {});
  }, []);
  const save = useCallback(async (key, note) => {
    const r = await put('/api/company-notes', { key, note });
    setNotes((n) => {
      const next = { ...n };
      if (r.note) next[key] = r.note;
      else delete next[key];
      return next;
    });
    return r.note;
  }, []);
  return { notes, save };
}
