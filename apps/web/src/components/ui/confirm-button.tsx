'use client';

import { useState, useTransition, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { Button, type ButtonSize, type ButtonVariant } from './button';
import { Modal } from './modal';
import { toastToneFor, useToast, type ActionResult } from './toast';

export interface ConfirmButtonProps {
  action: () => Promise<ActionResult>;
  children: ReactNode;
  confirmTitle: string;
  /** El cuerpo tiene que decir qué pasa, no sólo "¿confirmás?" (`frontend.md` §6.5). */
  confirmBody: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  pendingLabel?: string;
}

/**
 * Acción destructiva con confirmación explícita. El Server Action **no** corre hasta que
 * el usuario confirma: el `<form>` no existe hasta entonces.
 */
export function ConfirmButton({
  action,
  children,
  confirmTitle,
  confirmBody,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'danger',
  size = 'md',
  className,
  pendingLabel = 'Trabajando…',
}: ConfirmButtonProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { push } = useToast();

  const confirm = () => {
    startTransition(async () => {
      const result = await action();
      push({ tone: toastToneFor(result), title: result.message, detail: result.detail ?? null });
      if (result.ok) setOpen(false);
    });
  };

  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)} disabled={pending}>
        {pending ? pendingLabel : children}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={confirmTitle}
        description={confirmBody}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              {cancelLabel}
            </Button>
            <Button variant={variant} onClick={confirm} disabled={pending} className={cn('min-w-28')}>
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </>
        }
      />
    </>
  );
}