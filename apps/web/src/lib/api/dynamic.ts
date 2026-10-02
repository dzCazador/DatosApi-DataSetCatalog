import { apiGet, type RequestOptions } from './client';
import type { DynamicPayload } from './types';

/**
 * `GET /e/:slug`. El playground arma el query con `buildDynamicQuery` y lo pasa tal cual,
 * así que la API recibe exactamente el `curl` que la pantalla muestra. Los parámetros
 * repetidos (`sort`) se preservan porque el query viaja como `URLSearchParams`.
 */
export function queryDynamic(slug: string, params: URLSearchParams, options: RequestOptions = {}) {
  return apiGet<DynamicPayload>(`/e/${encodeURIComponent(slug)}`, { ...options, query: params });
}