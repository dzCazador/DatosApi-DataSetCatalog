import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { DATASETS_REPOSITORY, DatasetStatus, ENDPOINTS_REPOSITORY } from '@datosapi/common';
import type { DatasetEntity, EndpointDefinitionEntity, Row } from '@datosapi/common';
import type { DatasetsRepository, EndpointsRepository } from '@datosapi/database';

import {
  DatasetNotPublishedError,
  DatasetUnresolvedError,
  SlugNotFoundError,
} from './endpoints.errors';
import { QUERY_ENGINE, canonicalizeQuery, parseQuery } from './query-engine';
import type { QueryEngine } from './query-engine';

/** `meta.dataset` de `GET /api/v1/e/:slug` (api-contract.md §6). */
export interface DynamicDatasetMeta {
  id: string;
  version: number;
  sourceId: string;
  updatedAt: Date;
}

export interface DynamicMeta {
  total: number;
  count: number;
  page: number;
  limit: number;
  pages: number;
  dataset: DynamicDatasetMeta;
}

export interface DynamicPayload {
  data: Row[];
  meta: DynamicMeta;
}

export interface DynamicResult {
  payload: DynamicPayload;
  etag: string;
}

/**
 * `GET /api/v1/e/:slug` (api-contract.md §6).
 *
 * El service sólo orquesta: resolución del dataset, validación del query y ejecución del
 * motor. No conoce operadores ni límites, así que reemplazar el motor no lo toca.
 */
@Injectable()
export class DynamicService {
  constructor(
    @Inject(ENDPOINTS_REPOSITORY) private readonly endpoints: EndpointsRepository,
    @Inject(DATASETS_REPOSITORY) private readonly datasets: DatasetsRepository,
    @Inject(QUERY_ENGINE) private readonly queryEngine: QueryEngine,
  ) {}

  /**
   * `ETag` = hash de `datasetId + version + query canónico`.
   *
   * No lleva `updatedAt` porque `version` ya cambia en cada ingesta, así que dos datasets
   * distintos nunca comparten hash. El query va canonicalizado para que `?a=1&b=2` y
   * `?b=2&a=1` —la misma consulta— no produzcan dos ETags distintos y dos `304` perdidos.
   */
  private computeEtag(dataset: DatasetEntity, canonical: string): string {
    const material = `${dataset.id}|${dataset.version}|${canonical}`;

    return `"${createHash('sha256').update(material).digest('hex').slice(0, 32)}"`;
  }

  async execute(slug: string, query: Record<string, unknown>): Promise<DynamicResult> {
    const definition = await this.endpoints.findBySlug(slug);

    // Inexistente y deshabilitado son el mismo `404`: no se le confirma a un consumidor que
    // el slug existe si lo que hay es un endpoint apagado (api-contract.md §6).
    if (definition === null || !definition.enabled) throw new SlugNotFoundError(slug);

    const dataset = await this.resolveDataset(definition);
    const canonical = canonicalizeQuery(query);
    const result = this.queryEngine.execute(
      dataset.rows,
      dataset.schema,
      parseQuery(query, definition, dataset.schema),
    );

    return {
      etag: this.computeEtag(dataset, canonical),
      payload: {
        data: result.data,
        meta: {
          ...result.meta,
          dataset: {
            id: dataset.id,
            version: dataset.version,
            sourceId: dataset.sourceId,
            updatedAt: dataset.updatedAt,
          },
        },
      },
    };
  }

  /**
   * `datasetId` directo, o el último `published` si `followLatest` (api-contract.md §5).
   *
   * Sólo se sirve un dataset `published`. Un `draft` da `422` y no `404` porque el slug existe
   * y está habilitado: lo que falta es la publicación, que es un paso deliberado del flujo y
   * no una avería. Un `archived` también es `422`, salvo con `followLatest`, donde el
   * resolver busca el `published` más reciente y esquiva al archivado por definición.
   */
  private async resolveDataset(definition: EndpointDefinitionEntity): Promise<DatasetEntity> {
    const followsLatest = definition.followLatest || definition.datasetId === undefined;
    const dataset = followsLatest
      ? await this.datasets.findLatestPublished(definition.sourceId)
      : await this.datasets.findById(definition.datasetId as string);

    if (dataset === null) {
      throw new DatasetUnresolvedError(
        definition.slug,
        followsLatest ? 'no-published' : 'dataset-not-found',
      );
    }

    if (dataset.status !== DatasetStatus.PUBLISHED) {
      throw new DatasetNotPublishedError(definition.slug, dataset.status);
    }

    return dataset;
  }
}
