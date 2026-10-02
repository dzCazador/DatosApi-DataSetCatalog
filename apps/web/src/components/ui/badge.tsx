import type { HTMLAttributes, ReactNode } from 'react';

import type { DatasetStatus, SourceStatus } from '@/lib/api/types';
import { cn } from '@/lib/cn';

/**
 * Las variantes salen de los **estados del dominio**, no de un set genérico: así no
 * aparece un badge verde para algo que no está `ready` ni publicado
 * (`frontend.md` §3).
 */
export type BadgeVariant =
  | SourceStatus
  | DatasetStatus
  | 'enabled'
  | 'disabled'
  | 'neutral'
  | 'warning';

const VARIANT_CLASS: Readonly<Record<BadgeVariant, string>> = {
  pending: 'bg-status-pending/10 text-status-pending ring-status-pending/25',
  processing: 'bg-status-processing/10 text-status-processing ring-status-processing/25',
  ready: 'bg-status-ready/10 text-status-ready ring-status-ready/25',
  error: 'bg-status-error/10 text-status-error ring-status-error/25',
  draft: 'bg-status-neutral/10 text-status-neutral ring-status-neutral/25',
  published: 'bg-status-ready/10 text-status-ready ring-status-ready/25',
  archived: 'bg-status-neutral/10 text-status-neutral ring-status-neutral/25',
  enabled: 'bg-status-ready/10 text-status-ready ring-status-ready/25',
  disabled: 'bg-status-neutral/10 text-status-neutral ring-status-neutral/25',
  neutral: 'bg-status-neutral/10 text-status-neutral ring-status-neutral/25',
  warning: 'bg-status-pending/10 text-status-pending ring-status-pending/25',
};

const DOT_CLASS: Readonly<Record<BadgeVariant, string>> = {
  pending: 'bg-status-pending',
  processing: 'bg-status-processing animate-pulse',
  ready: 'bg-status-ready',
  error: 'bg-status-error',
  draft: 'bg-status-neutral',
  published: 'bg-status-ready',
  archived: 'bg-status-neutral',
  enabled: 'bg-status-ready',
  disabled: 'bg-status-neutral',
  neutral: 'bg-status-neutral',
  warning: 'bg-status-pending',
};

/** Texto legible por estado del dominio. `pending` es "sin ingerir todavía", no un error. */
export const STATUS_LABELS: Readonly<Record<SourceStatus | DatasetStatus, string>> = {
  pending: 'Sin ingerir',
  processing: 'Procesando',
  ready: 'Lista',
  error: 'Con error',
  draft: 'Borrador',
  published: 'Publicado',
  archived: 'Archivado',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  dot?: boolean;
  children: ReactNode;
}

export function Badge({ variant = 'neutral', dot = false, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        VARIANT_CLASS[variant],
        className,
      )}
      {...rest}
    >
      {dot ? <span className={cn('h-1.5 w-1.5 rounded-full', DOT_CLASS[variant])} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** `warnings[]` nunca se esconde: el badge muestra el count y el detalle se abre (`frontend.md` §6.2). */
export function WarningsBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Badge variant="warning" title={`${count} advertencia${count === 1 ? '' : 's'} de extracción`}>
      {count} advertencia{count === 1 ? '' : 's'}
    </Badge>
  );
}