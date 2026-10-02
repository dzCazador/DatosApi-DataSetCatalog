import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import type { BadgeVariant } from './badge';

export type AlertTone = 'info' | 'success' | 'warning' | 'error';

const TONE_CLASS: Readonly<Record<AlertTone, string>> = {
  info: 'border-status-processing/30 bg-status-processing/5 text-status-processing',
  success: 'border-status-ready/30 bg-status-ready/5 text-status-ready',
  warning: 'border-status-pending/30 bg-status-pending/5 text-status-pending',
  error: 'border-status-error/30 bg-status-error/5 text-status-error',
};

export interface AlertProps {
  tone?: AlertTone;
  title: string;
  detail?: string | null;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Aviso de error o estado. Es lo que se pinta cuando la API no responde, con el motivo. */
export function Alert({ tone = 'info', title, detail, hint, action, className }: AlertProps) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('rounded-card border px-4 py-3', TONE_CLASS[tone], className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold">{title}</p>
          {detail !== undefined && detail !== null && detail !== '' ? (
            <p className="break-words text-xs text-content-muted">{detail}</p>
          ) : null}
          {hint !== undefined && hint !== null ? <div className="text-xs text-content-subtle">{hint}</div> : null}
        </div>
        {action !== undefined ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Estado vacío **con acción**: "Sin fuentes todavía" ofrece crear una (`frontend.md` §6.4). */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      <p className="text-sm font-medium text-content">{title}</p>
      {description !== undefined ? <p className="max-w-md text-xs text-content-subtle">{description}</p> : null}
      {action !== undefined ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export interface MetricProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  status?: BadgeVariant;
  icon?: ReactNode;
}

/** Métrica del dashboard: número grande, label arriba, estado abajo. */
export function StatCard({ label, value, hint, status, icon }: MetricProps) {
  return (
    <div className="rounded-card border border-line bg-surface-raised px-5 py-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-content-subtle">{label}</p>
        {icon !== undefined ? <span className="text-content-subtle">{icon}</span> : null}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-content">{value}</p>
      {hint !== undefined ? (
        <div className="mt-1 text-xs text-content-subtle">{hint}</div>
      ) : status !== undefined ? (
        <div className="mt-2">
          <StatusDot status={status} />
        </div>
      ) : null}
    </div>
  );
}

export function StatusDot({ status }: { status: BadgeVariant }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-content-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      <StatusLabel status={status} />
    </span>
  );
}

const STATUS_TEXT: Readonly<Record<BadgeVariant, string>> = {
  pending: 'Sin ingerir',
  processing: 'Procesando',
  ready: 'Lista',
  error: 'Con error',
  draft: 'Borrador',
  published: 'Publicado',
  archived: 'Archivado',
  enabled: 'Habilitado',
  disabled: 'Deshabilitado',
  neutral: '—',
  warning: 'Con advertencias',
};

export function StatusLabel({ status }: { status: BadgeVariant }) {
  return <>{STATUS_TEXT[status]}</>;
}