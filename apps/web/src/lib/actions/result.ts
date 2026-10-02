import { revalidatePath } from 'next/cache';

import type { ApiError } from '@/lib/api';
import { presentError } from '@/lib/api/errors';
import type { ActionResult } from '@/components/ui/toast';

/**
 * Puente entre las Server Actions y los componentes de UI. Toda acción devuelve el mismo
 * shape: nunca lanza, nunca devuelve `Error`, y el mensaje sale del `code` de la API.
 */

export function ok(message: string, detail?: string): ActionResult {
  return detail === undefined ? { ok: true, message } : { ok: true, message, detail };
}

export function fail(message: string, detail?: string, fieldErrors?: Record<string, string>): ActionResult {
  return {
    ok: false,
    message,
    ...(detail === undefined ? {} : { detail }),
    ...(fieldErrors === undefined ? {} : { fieldErrors }),
  };
}

/** Traduce un fallo de la API usando el mensaje por `code` y el `details` que corresponda. */
export function fromApiError(error: ApiError): ActionResult {
  const presentation = presentError(error);
  return fail(presentation.title, [presentation.detail, presentation.hint].filter(Boolean).join(' ') || undefined);
}

/** Revalida las rutas que una acción dejó desactualizadas. */
export function refresh(paths: readonly string[]): void {
  for (const path of paths) revalidatePath(path);
}

export const ROUTES = {
  dashboard: '/',
  sources: '/sources',
  datasets: '/datasets',
  endpoints: '/endpoints',
  docs: '/docs',
} as const;

export function sourceRoute(id: string): string {
  return `/sources/${id}`;
}

export function datasetRoute(id: string): string {
  return `/datasets/${id}`;
}

export function endpointRoute(id: string): string {
  return `/endpoints/${id}`;
}

export function playgroundRoute(slug: string): string {
  return `/e/${slug}`;
}