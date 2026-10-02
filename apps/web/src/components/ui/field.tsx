import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

const FIELD_CLASS =
  'w-full rounded-lg border border-line bg-surface-raised px-3 text-sm text-content placeholder:text-content-subtle transition-colors disabled:cursor-not-allowed disabled:opacity-60';

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...rest }: InputProps) {
  return <input className={cn(FIELD_CLASS, 'h-10', className)} {...rest} />;
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <select className={cn(FIELD_CLASS, 'h-10 pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...rest }: TextareaProps) {
  return <textarea className={cn(FIELD_CLASS, 'py-2 font-mono text-xs leading-relaxed', className)} {...rest} />;
}

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export function Checkbox({ className, ...rest }: CheckboxProps) {
  return (
    <input
      type="checkbox"
      className={cn('h-4 w-4 shrink-0 cursor-pointer rounded border-line accent-brand', className)}
      {...rest}
    />
  );
}