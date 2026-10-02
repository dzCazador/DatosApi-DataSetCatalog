import { apiDelete, apiGet, apiPost, type RequestOptions } from './client';
import type { ColumnSchema, DatasetDetail, DatasetListItem, DatasetStatus, Paginated } from './types';

const ROOT = '/datasets';

export interface ListDatasetsParams {
  page?: number;
  limit?: number;
  sourceId?: string;
  status?: DatasetStatus;
}

/** El listado no trae `rows`: son pesadas. Para ver filas, ir al detalle. */
export function listDatasets(params: ListDatasetsParams = {}, options: RequestOptions = {}) {
  return apiGet<Paginated<DatasetListItem>>(ROOT, {
    ...options,
    query: { page: params.page, limit: params.limit, sourceId: params.sourceId, status: params.status },
  });
}

/**
 * Detalle con `rows` acotado por `PREVIEW_ROWS` y `meta.previewTruncated`. `?full=true`
 * existe pero el panel no lo usa: no necesita volcar el dataset entero.
 */
export function getDataset(id: string, options: RequestOptions = {}) {
  return apiGet<DatasetDetail>(`${ROOT}/${encodeURIComponent(id)}`, options);
}

/** Sólo el `schema`: es lo que consume el panel para construir tablas y filtros. */
export function getDatasetSchema(id: string, options: RequestOptions = {}) {
  return apiGet<{ schema: ColumnSchema[] }>(`${ROOT}/${encodeURIComponent(id)}/schema`, options);
}

export function publishDataset(id: string, options: RequestOptions = {}) {
  return apiPost<DatasetDetail>(`${ROOT}/${encodeURIComponent(id)}/publish`, undefined, options);
}

export function archiveDataset(id: string, options: RequestOptions = {}) {
  return apiPost<DatasetDetail>(`${ROOT}/${encodeURIComponent(id)}/archive`, undefined, options);
}

/** Alias de `archive`. Nunca hay hard-delete de datasets (`api-contract.md` §4). */
export function deleteDataset(id: string, options: RequestOptions = {}) {
  return apiDelete(`${ROOT}/${encodeURIComponent(id)}`, options);
}