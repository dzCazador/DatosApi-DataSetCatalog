import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANT_CLASS: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-brand text-brand-fg hover:opacity-90 shadow-card',
  secondary: 'bg-surface-raised text-content border border-line hover:bg-surface-sunken',
  ghost: 'bg-transparent text-content-muted hover:bg-surface-sunken hover:text-content',
  danger: 'bg-status-error text-white hover:opacity-90 shadow-card',
};

const SIZE_CLASS: Readonly<Record<ButtonSize, string>> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
};

const BASE_CLASS =
  'inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
};

/** Botón de acción. Sin `'use client'`: no usa estado, así que sirve en Server Components. */
export function Button({ variant = 'secondary', size = 'md', className, children, ...rest }: ButtonProps) {
  return (
    <button className={cn(BASE_CLASS, VARIANT_CLASS[variant], SIZE_CLASS[size], className)} {...rest}>
      {children}
    </button>
  );
}

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
};

/** Botón que navega. `Link` para que el App Router resuelva la transición en el cliente. */
export function ButtonLink({
  href,
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link href={href} className={cn(BASE_CLASS, VARIANT_CLASS[variant], SIZE_CLASS[size], className)} {...rest}>
      {children}
    </Link>
  );
}