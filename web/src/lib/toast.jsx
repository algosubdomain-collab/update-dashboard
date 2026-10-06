import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

// Qisqa bildirishnomalar: ommaviy amal natijasi ("Cleared 46 checks") va
// saqlash xatolari. Ixtiyoriy "Undo" tugmasi bilan.

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);

  const dismiss = useCallback((id) => setItems((xs) => xs.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (text, { tone = 'info', action, ms = tone === 'error' ? 7000 : 4000 } = {}) => {
      const id = ++seq.current;
      // Bir vaqtda ko'pi bilan 3 ta — ekranni to'ldirib yubormasin.
      setItems((xs) => [...xs.slice(-2), { id, text, tone, action }]);
      setTimeout(() => dismiss(id), ms);
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {/* role=status — ekran o'qigichlar xabarni o'qiydi, fokus o'g'irlanmaydi. */}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  dismiss(t.id);
                  t.action.run();
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
