'use client';

import { CheckCircle2, Info, TriangleAlert, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string | null;
}

interface ToastContextValue {
  push: (toast: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_ICON: Readonly<Record<ToastTone, typeof Info>> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: TriangleAlert,
};

const TONE_CLASS: Readonly<Record<ToastTone, string>> = {
  success: 'text-status-ready',
  error: 'text-status-error',
  info: 'text-status-processing',
  warning: 'text-status-pending',
};

/** Resultado de una acción que el panel necesita reportar. Es lo que pincha el toast. */
export interface ActionResult {
  ok: boolean;
  message: string;
  detail?: string | null;
  /** Errores por campo para pintar el formulario, no un toast. */
  fieldErrors?: Record<string, string>;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { ...toast, id }]);
    setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 6000);
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((toast) => {
          const Icon = TONE_ICON[toast.tone];
          return (
            <div
              key={toast.id}
              className="pointer-events-auto flex items-start gap-3 rounded-card border border-line bg-surface-raised px-4 py-3 shadow-overlay"
            >
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TONE_CLASS[toast.tone])} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-content">{toast.title}</p>
                {toast.detail !== undefined && toast.detail !== null && toast.detail !== '' ? (
                  <p className="mt-0.5 break-words text-xs text-content-muted">{toast.detail}</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) throw new Error('useToast requiere un <ToastProvider> en el layout.');
  return context;
}

export function toastToneFor(result: ActionResult): ToastTone {
  return result.ok ? 'success' : 'error';
}