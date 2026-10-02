import { Alert } from '@/components/ui/feedback';
import { presentError, type ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';

/**
 * Error de API traducido a la pantalla. Todos los listados lo usan: si la API no
 * responde, el panel dice **por qué** en vez de mostrar una pantalla en blanco.
 */
export function ApiErrorBanner({ error, className }: { error: ApiError; className?: string }) {
  const { title, detail, hint } = presentError(error);

  return (
    <Alert
      tone={error.kind === 'http' && error.status < 500 ? 'warning' : 'error'}
      title={title}
      detail={detail}
      hint={hint === null ? null : <span className="font-mono text-[11px]">{hint}</span>}
      className={cn(className)}
    />
  );
}

/** Primer error de un conjunto de resultados, para no mostrar cuatro alertas iguales. */
export function firstApiError(results: readonly { ok: boolean }[]): ApiError | null {
  for (const result of results) {
    if (result.ok) continue;
    return (result as { ok: false; error: ApiError }).error;
  }
  return null;
}