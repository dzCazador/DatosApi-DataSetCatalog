'use server';

import { redirect } from 'next/navigation';

import { createSource, deleteSource, ingestSource } from '@/lib/api';
import type { ActionResult } from '@/components/ui/toast';
import { buildSourceConfig, sourceFormSchema } from '@/lib/schema/source-form';
import { fromApiError, fail, ok, refresh, ROUTES, sourceRoute } from './result';

/**
 * Alta de fuente. No dispara la ingesta: registrar y ingerir son pasos separados y
 * explícitos (`api-contract.md` §3), así que el alta deja `status: pending` y el detalle
 * ofrece el botón Ingerir.
 */
export async function createSourceAction(form: FormData): Promise<ActionResult> {
  const parsed = sourceFormSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && fieldErrors[key] === undefined) fieldErrors[key] = issue.message;
    }
    return fail('Revisá el formulario.', 'Hay campos incompletos o con formato inválido.', fieldErrors);
  }

  const config = buildSourceConfig(parsed.data);
  if (!config.ok) {
    const field = config.message.includes('URL') || config.message.includes('headers') ? 'url' : 'payload';
    return fail('El `config` no es válido para el tipo elegido.', config.message, { [field]: config.message });
  }

  const result = await createSource({
    name: parsed.data.name,
    type: parsed.data.type,
    ...(parsed.data.description === undefined ? {} : { description: parsed.data.description }),
    config: config.config,
  });

  if (!result.ok) return fromApiError(result.error);

  refresh([ROUTES.sources, ROUTES.dashboard]);
  redirect(sourceRoute(result.data._id));
}

export async function deleteSourceAction(sourceId: string): Promise<ReturnType<typeof ok>> {
  const result = await deleteSource(sourceId);
  if (!result.ok) return fromApiError(result.error);

  refresh([ROUTES.sources, sourceRoute(sourceId), ROUTES.dashboard, ROUTES.endpoints]);
  redirect(ROUTES.sources);
}

/**
 * Dispara la ingesta y devuelve el resultado: `rowCount`, `warnings` y `durationMs` son
 * justo lo que la pantalla tiene que mostrar, así que viajan en el mensaje.
 */
export async function ingestSourceAction(sourceId: string): Promise<ReturnType<typeof ok>> {
  const result = await ingestSource(sourceId);
  if (!result.ok) return fromApiError(result.error);

  refresh([sourceRoute(sourceId), ROUTES.sources, ROUTES.datasets, ROUTES.dashboard]);

  const { rowCount, warnings, version, meta } = result.data;
  const parts = [
    `Dataset v${version} con ${rowCount} fila${rowCount === 1 ? '' : 's'}`,
    `en ${meta.durationMs ?? '—'} ms`,
  ];
  if (warnings.length > 0) parts.push(`${warnings.length} advertencia${warnings.length === 1 ? '' : 's'}`);

  return ok(`Ingesta terminada: ${parts.join(' · ')}`, warnings.length > 0 ? warnings.join(' · ') : undefined);
}