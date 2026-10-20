import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastKind = 'info' | 'success' | 'error';
export interface ToastAction {
  label: string;
  /** In-app route the action links to. */
  to: string;
}
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

interface ToastContextValue {
  toasts: Toast[];
  push(message: string, kind?: ToastKind, action?: ToastAction): void;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (message: string, kind: ToastKind = 'info', action?: ToastAction) => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-2), action ? { id, kind, message, action } : { id, kind, message }]);
      window.setTimeout(() => dismiss(id), kind === 'error' ? 6000 : action ? 5200 : 3200);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

/** Turn any thrown value into a toast-able message. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return 'Something went wrong. Try again.';
}
