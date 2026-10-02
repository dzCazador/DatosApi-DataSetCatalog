'use server';

import { archiveDataset, publishDataset } from '@/lib/api';
import { datasetStateFromDetails } from '@/lib/api/errors';
import { fromApiError, fail, ok, refresh, ROUTES, datasetRoute } from './result';

export async function publishDatasetAction(datasetId: string): Promise<ReturnType<typeof ok>> {
  const result = await publishDataset(datasetId);
  if (!result.ok) return explainStateError(result.error);

  refresh([datasetRoute(datasetId), ROUTES.datasets, ROUTES.endpoints, ROUTES.dashboard]);
  return ok('Dataset publicado.', `La versión ${result.data.version} quedó visible para los endpoints.`);
}

export async function archiveDatasetAction(datasetId: string): Promise<ReturnType<typeof ok>> {
  const result = await archiveDataset(datasetId);
  if (!result.ok) return explainStateError(result.error);

  refresh([datasetRoute(datasetId), ROUTES.datasets, ROUTES.endpoints, ROUTES.dashboard]);
  return ok('Dataset archivado.', 'Los endpoints que lo apuntaban pasan a devolver 422 hasta que publiques otra versión.');
}

/**
 * `DATASET_INVALID_STATE` trae `details` con la transición pedida, la actual y la válida.
 * Se aprovecha para decir exactamente por qué no se pudo: publicar un `archived` no es lo
 * mismo que publicar un `draft`.
 */
function explainStateError(error: import('@/lib/api').ApiError): ReturnType<typeof ok> {
  const base = fromApiError(error);
  if (error.kind !== 'http') return base;

  const state = datasetStateFromDetails(error.details);
  if (state === null) return base;

  return fail(
    base.message,
    `Está '${state.current}' y sólo se admite '${state.operation}' desde '${state.expectedFrom}' hacia '${state.expectedTo}'.`,
  );
}