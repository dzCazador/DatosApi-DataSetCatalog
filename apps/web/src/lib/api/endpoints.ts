import { apiDelete, apiGet, apiPatch, apiPost, type RequestOptions } from './client';
import type { EndpointDefinition, EndpointDetail, FilterDef, Paginated, SortDef, ValidationReport } from './types';

const ROOT = '/endpoints';

export interface ListEndpointsParams {
  page?: number;
  limit?: number;
  sourceId?: string;
  enabled?: boolean;
}

export function listEndpoints(params: ListEndpointsParams = {}, options: RequestOptions = {}) {
  return apiGet<Paginated<EndpointDefinition>>(ROOT, {
    ...options,
    query: {
      page: params.page,
      limit: params.limit,
      sourceId: params.sourceId,
      // La API lo toma como enum de strings (`true|false|1|0`), no como booleano.
      enabled: params.enabled === undefined ? undefined : String(params.enabled),
    },
  });
}

/**
 * Detalle con `resolved` / `resolvedReason`. Nunca es 404 por dataset sin resolver: la
 * definición existe y el panel tiene que poder mostrarla contra qué apunta.
 */
export function getEndpoint(id: string, options: RequestOptions = {}) {
  return apiGet<EndpointDetail>(`${ROOT}/${encodeURIComponent(id)}`, options);
}

export interface CreateEndpointInput {
  name: string;
  slug: string;
  description?: string;
  sourceId: string;
  datasetId?: string;
  followLatest: boolean;
  fields?: string[];
  filters?: FilterDef[];
  sort?: SortDef[];
  defaultLimit?: number;
  maxLimit?: number;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export function createEndpoint(input: CreateEndpointInput, options: RequestOptions = {}) {
  return apiPost<EndpointDefinition>(ROOT, input, options);
}

/**
 * Actualización parcial. `slug` y `sourceId` no se pueden mandar: el slug es la URL
 * pública y mandarlo es un `400 VALIDATION_ERROR` (`api-contract.md` §5).
 */
export interface UpdateEndpointInput {
  name?: string;
  description?: string;
  datasetId?: string;
  followLatest?: boolean;
  fields?: string[];
  filters?: FilterDef[];
  sort?: SortDef[];
  defaultLimit?: number;
  maxLimit?: number;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export function updateEndpoint(id: string, input: UpdateEndpointInput, options: RequestOptions = {}) {
  return apiPatch<EndpointDefinition>(`${ROOT}/${encodeURIComponent(id)}`, input, options);
}

/** Reporte, siempre 200: sirve después de una reingesta que cambió el schema. */
export function validateEndpoint(id: string, options: RequestOptions = {}) {
  return apiPost<ValidationReport>(`${ROOT}/${encodeURIComponent(id)}/validate`, undefined, options);
}

/** Hard-delete de la definición. Los datasets quedan intactos. */
export function deleteEndpoint(id: string, options: RequestOptions = {}) {
  return apiDelete(`${ROOT}/${encodeURIComponent(id)}`, options);
}