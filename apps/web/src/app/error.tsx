'use client';

import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-6">
      <div className="w-full max-w-lg rounded-card border border-line bg-surface-raised p-6 shadow-overlay">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-status-error" aria-hidden="true" />
          <div>
            <h1 className="text-sm font-semibold text-content">El panel falló al renderizar</h1>
            <p className="mt-2 text-sm text-content-muted">
              No es un error de la API: es un error del panel. Probá de nuevo; si persiste, revisá la consola del
              servidor de Next.
            </p>
            {error.digest !== undefined ? (
              <p className="mt-2 font-mono text-xs text-content-subtle">digest: {error.digest}</p>
            ) : null}
            <div className="mt-4">
              <Button variant="primary" onClick={reset}>
                Reintentar
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}