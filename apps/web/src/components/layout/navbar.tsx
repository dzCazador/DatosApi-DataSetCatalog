import Link from 'next/link';
import type { ReactNode } from 'react';

import type { ApiError, ApiResult } from '@/lib/api';
import { describeFailure } from '@/lib/api/errors';
import type { HealthStatus } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { ThemeToggle } from './shell';

export interface Crumb {
  label: string;
  href?: string;
}

/** Migas de pan: sólo en las páginas de detalle, que es donde aportan. */
export function Breadcrumb({ items }: { items: readonly Crumb[] }) {
  return (
    <nav aria-label="Ruta">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-content-subtle">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {item.href !== undefined && !last ? (
                <Link href={item.href} className="transition-colors hover:text-content">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={last ? 'text-content-muted' : undefined}>
                  {item.label}
                </span>
              )}
              {!last ? <span aria-hidden="true">/</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export type HealthResult = ApiResult<HealthStatus> | undefined;

interface IndicatorState {
  label: string;
  title: string;
  dotClass: string;
}

function describe(result: HealthResult): IndicatorState {
  if (result === undefined) {
    return {
      label: 'Comprobando…',
      title: 'No se pudo consultar GET /health todavía.',
      dotClass: 'bg-status-pending animate-pulse',
    };
  }

  if (!result.ok) {
    return { label: 'API caída', title: describeFailure(result.error), dotClass: 'bg-status-error' };
  }

  const { status, database } = result.data;
  if (status !== 'ok' || database.status !== 'up') {
    return {
      label: 'MongoDB caído',
      title: database.message ?? 'MongoDB no responde.',
      dotClass: 'bg-status-error',
    };
  }

  const ping = database.ping === null ? '—' : `${database.ping} ms`;
  return {
    label: `API ok · ${ping}`,
    title: `API arriba. MongoDB responde en ${ping}. Uptime ${Math.round(result.data.uptime)} s.`,
    dotClass: 'bg-status-ready',
  };
}

/**
 * Estado de la API en la navbar. Es un Server Component: el layout lo consulta una vez y
 * pasa el resultado. Cuando la API no responde muestra el motivo en el `title` y en un
 * texto para lectores de pantalla — el problema se ve, no se esconde.
 */
export function ApiIndicator({ result }: { result: HealthResult }) {
  const state = describe(result);

  return (
    <div className="flex items-center gap-2">
      <span className={cn('h-2 w-2 rounded-full', state.dotClass)} title={state.title} aria-hidden="true" />
      <span className="hidden text-xs text-content-muted sm:inline" title={state.title}>
        {state.label}
      </span>
      <span className="sr-only" role="status">
        {state.title}
      </span>
      <ThemeToggle />
    </div>
  );
}

/** Navbar superior: contexto a la izquierda, estado de la API y el tema a la derecha. */
export function Navbar({ health, children }: { health: HealthResult; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-4 border-b border-line bg-surface/90 px-6 backdrop-blur">
      <div className="min-w-0 truncate text-sm text-content-muted">{children}</div>
      <ApiIndicator result={health} />
    </header>
  );
}

export type { ApiError };