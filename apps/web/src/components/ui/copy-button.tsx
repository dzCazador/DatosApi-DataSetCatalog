'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/cn';
import { Button, type ButtonSize } from './button';

/**
 * Copia al portapapeles. El playground lo usa para el `curl` equivalente: el objetivo es
 * que el usuario pueda llevar la consulta a su código tal como la vio en la pantalla.
 */
export function CopyButton({
  value,
  label = 'Copiar',
  size = 'sm',
  className,
}: {
  value: string;
  label?: string;
  size?: ButtonSize;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso de portapapeles (contexto no seguro): el `curl` sigue visible y se
      // puede seleccionar a mano, que es el objetivo de la pantalla.
      setCopied(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      onClick={() => void copy()}
      className={cn(className)}
      aria-label={copied ? 'Copiado' : label}
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      <span>{copied ? 'Copiado' : label}</span>
    </Button>
  );
}