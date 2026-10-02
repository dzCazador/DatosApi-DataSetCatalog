import { DatasetStatus } from '@datosapi/common';
import type { DatasetEntity, EndpointDefinitionEntity } from '@datosapi/common';
import type { DatasetsRepository } from '@datosapi/database';

export type ResolutionResult =
  | { dataset: DatasetEntity; reason: null }
  | { dataset: null; reason: 'dataset-not-found' | 'no-published' };

/**
 * Resuelve qué dataset usaría ahora una definición (api-contract.md §5).
 *
 * `datasetId` directo, o el último `published` de la `sourceId` si `followLatest`.
 *
 * Devuelve un discriminante en vez de `null` a secas porque "el dataset no existe" y "la
 * source todavía no publicó nada" necesitan mensajes distintos en el panel: uno es un id
 * mal escrito y el otro es un flujo que todavía no llegó a `publish`.
 *
 * No filtra por `status`: el llamador decide. El endpoint público rechaza el `archived`
 * (api-contract.md §6) y el panel de administración quiere mostrárselo al usuario para que
 * entienda por qué el endpoint no responde.
 */
export async function resolveDataset(
  datasets: DatasetsRepository,
  definition: Pick<EndpointDefinitionEntity, 'sourceId' | 'datasetId' | 'followLatest'>,
): Promise<ResolutionResult> {
  if (!definition.followLatest && definition.datasetId !== undefined) {
    const dataset = await datasets.findById(definition.datasetId);

    return dataset === null
      ? { dataset: null, reason: 'dataset-not-found' }
      : { dataset, reason: null };
  }

  const latest = await datasets.findLatestPublished(definition.sourceId);

  return latest === null
    ? { dataset: null, reason: 'no-published' }
    : { dataset: latest, reason: null };
}

/** `resolved` de `GET /endpoints/:id` (api-contract.md §5). `null` cuando no resuelve. */
export interface ResolvedDataset {
  datasetId: string;
  version: number;
  status: DatasetStatus;
  rowCount: number;
}

export function toResolvedDataset(dataset: DatasetEntity): ResolvedDataset {
  return {
    datasetId: dataset.id,
    version: dataset.version,
    status: dataset.status,
    rowCount: dataset.rowCount,
  };
}

/** Texto para el `message` cuando `resolved` es `null`. */
export function describeUnresolved(reason: Exclude<ResolutionResult['reason'], null>): string {
  return reason === 'dataset-not-found'
    ? 'El dataset con el id declarado no existe'
    : 'La fuente todavía no tiene ningún dataset publicado';
}
