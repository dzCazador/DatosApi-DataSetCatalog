'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/cn';

/**
 * `warnings[]` nunca se esconde: el badge muestra el count y el detalle se abre acá. La
 * extracción dudosa es información, no ruido (`frontend.md` §6.2).
 */
export function WarningsList({ warnings }: { warnings: readonly string[] }) {
  const [open, setOpen] = useState(false);

  if (warnings.length === 0) {
    return <p className="text-xs text-content-subtle">La ingesta no dejó advertencias.</p>;
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-status-pending hover:underline"
      >
        {warnings.length} advertencia{warnings.length === 1 ? '' : 's'} de extracción
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open ? (
        <ul className="list-disc space-y-1 rounded-lg bg-surface-sunken px-4 py-3 pl-8 text-xs text-content-muted">
          {warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}