import type { LabelHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

type LabelProps = LabelHTMLAttributes<HTMLLabelElement> & {
  /** Marca el campo como obligatorio en la UI, sin cambiar su comportamiento. */
  required?: boolean;
};

export function Label({ className, required, children, ...rest }: LabelProps) {
  return (
    <label className={cn('block text-sm font-medium text-content', className)} {...rest}>
      {children}
      {required === true ? (
        <span className="ml-1 text-status-error" aria-hidden="true">
          *
        </span>
      ) : null}
    </label>
  );
}

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Envoltura de campo: label, hint y error. El error va con `role="alert"` y `aria-describedby`
 * para que un lector de pantalla lo anuncie al enfocar el control.
 */
export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {error !== undefined && error !== null ? (
        <p id={htmlFor === undefined ? undefined : `${htmlFor}-error`} role="alert" className="text-xs text-status-error">
          {error}
        </p>
      ) : hint !== undefined ? (
        <p className="text-xs text-content-subtle">{hint}</p>
      ) : null}
    </div>
  );
}