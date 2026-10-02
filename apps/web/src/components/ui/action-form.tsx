'use client';

import { useFormStatus } from 'react-dom';
import { useActionState, useEffect, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { Button, type ButtonSize, type ButtonVariant } from './button';
import { toastToneFor, useToast, type ActionResult } from './toast';

/**
 * Firma de toda Server Action del panel. Declara el FormData porque el runtime de React
 * se lo pasa siempre a las acciones de formulario; las que ya tienen todo en el cierre
 * (ingesta, publicar, borrar) simplemente lo ignoran.
 */
export type ServerAction = (formData: FormData) => Promise<ActionResult>;

const INITIAL_STATE: ActionResult = { ok: true, message: '' };

export interface ActionFormProps {
  action: ServerAction;
  /** Mensaje de éxito explícito; si falta se usa el que devuelve la acción. */
  successMessage?: string;
  children: ReactNode;
  className?: string;
  /** `li` cuando el form es un ítem de lista: evita un `div` inválido dentro de `ul`. */
  as?: 'div' | 'li';
}

/**
 * Formulario alrededor de una Server Action, con el resultado reportado en un toast. Los
 * errores por campo los pinta el propio formulario con `fieldErrors`; lo que es global
 * (un `SLUG_TAKEN`, un `UPSTREAM_TIMEOUT`) va al toast con el mensaje por `code`.
 */
export function ActionForm({ action, successMessage, children, className, as = 'div' }: ActionFormProps) {
  const [state, formAction, pending] = useActionState(
    async (_previous: ActionResult, formData: FormData): Promise<ActionResult> => action(formData),
    INITIAL_STATE,
  );

  const { push } = useToast();
  const reported = useRef<string | null>(null);

  useEffect(() => {
    if (state.message === '' || state.message === reported.current) return;
    reported.current = state.message;
    push({
      tone: toastToneFor(state),
      title: state.ok ? (successMessage ?? state.message) : state.message,
      detail: state.detail ?? null,
    });
  }, [state, push, successMessage]);

  const Wrapper = as === 'li' ? 'li' : 'div';

  return (
    <Wrapper className={className}>
      <form action={formAction}>{children}</form>
      <PendingContextHint pending={pending} />
    </Wrapper>
  );
}

/**
 * `pending` vive en el `form` de `useActionState`, no en un contexto compartido. Este
 * marcador existe para que el CSS pueda atenuar el bloque mientras corre la acción.
 */
function PendingContextHint({ pending }: { pending: boolean }) {
  return pending ? (
    <span role="status" aria-live="polite" className="sr-only">
      Guardando…
    </span>
  ) : null;
}

export interface SubmitButtonProps {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** Texto mientras la acción corre; por defecto "Guardando…". */
  pendingLabel?: string;
  disabled?: boolean;
}

/** Botón de submit que se bloquea solo mientras su form está en transición. */
export function SubmitButton({
  children,
  variant = 'primary',
  size = 'md',
  className,
  pendingLabel = 'Guardando…',
  disabled,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant={variant} size={size} className={cn(className)} disabled={disabled === true || pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}