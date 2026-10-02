'use server';

import { redirect } from 'next/navigation';

import type { ActionResult } from '@/components/ui/toast';
import { createEndpoint, deleteEndpoint, updateEndpoint, validateEndpoint } from '@/lib/api';
import { parseEndpointForm } from '@/lib/schema/endpoint-form';
import { validateSlug } from '@/lib/schema/slug';
import { fromApiError, fail, ok, refresh, ROUTES, endpointRoute } from './result';

/**
 * Alta de definición. El `slug` se valida en cliente **y** acá: es la URL pública del
 * endpoint y un `409 SLUG_TAKEN` se muestra en el campo, no como error genérico.
 */
export async function createEndpointAction(form: FormData): Promise<ActionResult> {
  const parsed = parseEndpointForm(form);
  if (!parsed.ok) return fail('Revisá la definición.', 'Hay campos incompletos o inconsistentes.', parsed.fieldErrors);

  const { values, fields, filters, sort } = parsed.parsed;

  const slugCheck = validateSlug(String(form.get('slug') ?? ''));
  if (!slugCheck.ok) return fail('El slug no es válido.', slugCheck.message, { slug: slugCheck.message });

  const result = await createEndpoint({
    name: values.name,
    slug: slugCheck.slug,
    sourceId: values.sourceId,
    followLatest: values.followLatest,
    enabled: values.enabled,
    defaultLimit: values.defaultLimit,
    maxLimit: values.maxLimit,
    ...(values.description === undefined ? {} : { description: values.description }),
    ...(values.followLatest || values.datasetId === undefined || values.datasetId === ''
      ? {}
      : { datasetId: values.datasetId }),
    fields,
    filters,
    sort,
  });

  if (!result.ok) return fromApiError(result.error);

  refresh([ROUTES.endpoints, ROUTES.dashboard]);
  redirect(endpointRoute(result.data._id));
}

/** Edición parcial. `slug` y `sourceId` no se mandan: la API los rechaza (`api-contract.md` §5). */
export async function updateEndpointAction(endpointId: string, form: FormData): Promise<ActionResult> {
  const parsed = parseEndpointForm(form);
  if (!parsed.ok) return fail('Revisá la definición.', 'Hay campos incompletos o inconsistentes.', parsed.fieldErrors);

  const { values, fields, filters, sort } = parsed.parsed;

  const result = await updateEndpoint(endpointId, {
    name: values.name,
    followLatest: values.followLatest,
    enabled: values.enabled,
    defaultLimit: values.defaultLimit,
    maxLimit: values.maxLimit,
    description: values.description ?? '',
    ...(values.followLatest ? { datasetId: '' } : { datasetId: values.datasetId ?? '' }),
    fields,
    filters,
    sort,
  });

  if (!result.ok) return fromApiError(result.error);

  refresh([endpointRoute(endpointId), ROUTES.endpoints, ROUTES.dashboard]);
  return ok('Definición actualizada.', `El playground está en /e/${result.data.slug}.`);
}

export async function deleteEndpointAction(endpointId: string): Promise<ActionResult> {
  const result = await deleteEndpoint(endpointId);
  if (!result.ok) return fromApiError(result.error);

  refresh([ROUTES.endpoints, endpointRoute(endpointId), ROUTES.dashboard]);
  redirect(ROUTES.endpoints);
}

/**
 * `POST /endpoints/:id/validate` es un reporte y siempre devuelve 200, así que acá no hay
 * error que traducir: lo que se muestra es `valid` y la lista de `unknownFields` con el
 * `where` de cada una.
 */
export async function validateEndpointAction(endpointId: string): Promise<ActionResult> {
  const result = await validateEndpoint(endpointId);
  if (!result.ok) return fromApiError(result.error);

  const report = result.data;
  refresh([endpointRoute(endpointId)]);

  if (report.valid) {
    const where = report.datasetId === null ? 'sin dataset resuelto' : `dataset ${report.datasetId}`;
    return ok('La definición coincide con el schema.', `Validada contra ${where}.`);
  }

  if (report.unknownFields.length > 0) {
    return fail(
      'La definición no coincide con el schema del dataset.',
      report.unknownFields.map((item) => `${item.where} → ${item.field}: ${item.reason}`).join(' · '),
    );
  }

  return fail(
    'La definición no resuelve un dataset publicable.',
    report.reason ?? `Estado del dataset resuelto: ${report.status ?? 'sin dataset'}.`,
  );
}