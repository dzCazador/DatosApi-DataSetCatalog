import { apiDelete, apiGet, apiPatch, apiPost, type RequestOptions } from './client';
import type {
  DatasetListItem,
  IngestOutcome,
  Paginated,
  Source,
  SourceConfig,
  SourceStatus,
  SourceType,
} from './types';

const ROOT = '/sources';

export interface ListSourcesParams {
  page?: number;
  limit?: number;
  type?: SourceType;
  status?: SourceStatus;
}

export function listSources(params: ListSourcesParams = {}, options: RequestOptions = {}) {
  return apiGet<Paginated<Source>>(ROOT, {
    ...options,
    query: {
      page: params.page,
      limit: params.limit,
      type: params.type,
      status: params.status,
    },
  });
}

export function getSource(id: string, options: RequestOptions = {}) {
  return apiGet<Source>(`${ROOT}/${encodeURIComponent(id)}`, options);
}

export interface CreateSourceInput {
  name: string;
  type: SourceType;
  description?: string;
  config: SourceConfig;
  metadata?: Record<string, unknown>;
}

/** Alta pura: no dispara ingesta. Ingesta y registro son pasos separados (`api-contract.md` §3). */
export function createSource(input: CreateSourceInput, options: RequestOptions = {}) {
  return apiPost<Source>(ROOT, input, options);
}

export interface UpdateSourceInput {
  name?: string;
  description?: string;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** `type` no se manda: cambiarlo alteraría la semántica del `config` y es un 400. */
export function updateSource(id: string, input: UpdateSourceInput, options: RequestOptions = {}) {
  return apiPatch<Source>(`${ROOT}/${encodeURIComponent(id)}`, input, options);
}

/** Borrado lógico: deshabilita los endpoints asociados y deja `lastError` (`data-model.md` §5). */
export function deleteSource(id: string, options: RequestOptions = {}) {
  return apiDelete(`${ROOT}/${encodeURIComponent(id)}`, options);
}

export function ingestSource(id: string, options: RequestOptions = {}) {
  return apiPost<IngestOutcome>(`${ROOT}/${encodeURIComponent(id)}/ingest`, undefined, options);
}

export function listSourceDatasets(
  id: string,
  params: { page?: number; limit?: number } = {},
  options: RequestOptions = {},
) {
  return apiGet<Paginated<DatasetListItem>>(`${ROOT}/${encodeURIComponent(id)}/datasets`, {
    ...options,
    query: { page: params.page, limit: params.limit },
  });
}