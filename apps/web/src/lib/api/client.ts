import { httpError, parseError, transportError, type ApiError, type ApiResult } from './errors';
import type { ErrorCode } from './types';

/**
 * Base URL del panel. Sale de `NEXT_PUBLIC_API_URL`; nunca se escribe a mano en una
 * llamada. El acceso por punto (no `process.env[x]`) es lo que permite a Next embeber
 * el valor en el bundle del navegador.
 */
export const DEFAULT_API_URL = 'http://localhost:3001/api/v1';

export function apiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  const url = typeof configured === 'string' && configured.trim() !== '' ? configured.trim() : DEFAULT_API_URL;
  return url.replace(/\/+$/, '');
}

/** Raíz de la API: la misma base sin el prefijo. Sirve para `/health` y `/docs`. */
export function apiRootUrl(): string {
  return apiBaseUrl().replace(/\/api\/v\d+$/, '');
}

/** Origen de la API, para el link explícito a Swagger en `/docs`. */
export function apiOrigin(): string | null {
  try {
    return new URL(apiRootUrl()).origin;
  } catch {
    return null;
  }
}

export type QueryValue = string | number | boolean | undefined | null;

/**
 * `URLSearchParams` está permitido porque algunos endpoints aceptan el mismo parámetro
 * varias veces (`GET /e/:slug` con `sort=a:asc&sort=b:desc`), cosa que un objeto plano no
 * puede expresar.
 */
export type QueryInput = Readonly<Record<string, QueryValue>> | URLSearchParams;

export interface RequestOptions {
  query?: QueryInput;
  body?: unknown;
  signal?: AbortSignal;
  cache?: RequestCache;
}

function buildUrl(path: string, query?: QueryInput): string {
  const base = `${apiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  if (query === undefined) return base;

  let search: URLSearchParams;
  if (query instanceof URLSearchParams) {
    search = query;
  } else {
    search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      // `undefined` y `null` significan "no mandar el parámetro". La API usa
      // `?enabled=false` como filtro real, así que `false` sí se manda explícitamente y
      // no se confunde con ausencia.
      if (value === undefined || value === null) continue;
      search.append(key, String(value));
    }
  }

  const qs = search.toString();
  return qs === '' ? base : `${base}?${qs}`;
}

const KNOWN_ERROR_CODES = new Set<string>([
  'VALIDATION_ERROR',
  'SOURCE_CONFIG_INVALID',
  'SLUG_INVALID',
  'SLUG_TAKEN',
  'INGEST_ALREADY_RUNNING',
  'VERSION_CONFLICT',
  'SOURCE_NOT_FOUND',
  'DATASET_NOT_FOUND',
  'DATASET_INVALID_STATE',
  'ENDPOINT_NOT_FOUND',
  'SLUG_NOT_FOUND',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNPROCESSABLE_CONTENT',
  'ROWS_LIMIT_EXCEEDED',
  'FILTER_NOT_ALLOWED',
  'SORT_NOT_ALLOWED',
  'INVALID_PAGINATION',
  'SCHEMA_MISMATCH',
  'UPSTREAM_ERROR',
  'UPSTREAM_TIMEOUT',
  'ROUTE_NOT_FOUND',
  'HTTP_ERROR',
  'INTERNAL_ERROR',
]);

/** `code` del cuerpo de error; si no viene o no es conocido, se deriva del status. */
function codeFromBody(body: unknown, status: number): ErrorCode {
  if (typeof body === 'object' && body !== null) {
    const raw = (body as { code?: unknown }).code;
    if (typeof raw === 'string' && KNOWN_ERROR_CODES.has(raw)) return raw as ErrorCode;
  }
  if (status >= 500) return 'INTERNAL_ERROR';
  if (status === 404) return 'ROUTE_NOT_FOUND';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 415) return 'UNSUPPORTED_MEDIA_TYPE';
  if (status === 422) return 'UNPROCESSABLE_CONTENT';
  if (status === 502) return 'UPSTREAM_ERROR';
  if (status === 504) return 'UPSTREAM_TIMEOUT';
  return 'HTTP_ERROR';
}

function errorBodyFromResponse(response: Response): { body: unknown; message: string } {
  return { body: null, message: `HTTP ${response.status} ${response.statusText}`.trim() };
}

async function readErrorBody(response: Response): Promise<{ body: unknown; message: string }> {
  let raw: string;
  try {
    raw = await response.text();
  } catch {
    return errorBodyFromResponse(response);
  }

  if (raw === '') return errorBodyFromResponse(response);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { body: null, message: raw.slice(0, 200) };
  }

  const message =
    typeof parsed === 'object' && parsed !== null && typeof (parsed as { message?: unknown }).message === 'string'
      ? (parsed as { message: string }).message
      : `HTTP ${response.status} ${response.statusText}`.trim();

  return { body: parsed, message };
}

function toTransportError(cause: unknown, path: string): ApiError {
  if (cause instanceof DOMException && cause.name === 'AbortError') {
    return transportError('aborted', cause.message, path);
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  // El `fetch` de Node no distingue timeout de ECONNREFUSED; `TimeoutError` sí existe en
  // quien implementa el timeout (AbortSignal.timeout).
  const reason = cause instanceof Error && cause.name === 'TimeoutError' ? 'timeout' : 'unreachable';
  return transportError(reason, message, path);
}

/**
 * Base de todos los clientes por recurso. Devuelve un union discriminado: nunca lanza y
 * nunca devuelve `any`, para que el `code` de la API llegue intacto hasta la pantalla.
 */
async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const url = buildUrl(path, options.query);
  const hasBody = options.body !== undefined;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: hasBody ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      cache: options.cache ?? 'no-store',
    });
  } catch (cause) {
    return { ok: false, error: toTransportError(cause, path) };
  }

  if (!response.ok) {
    const { body, message } = await readErrorBody(response);
    const code = codeFromBody(body, response.status);
    const details = typeof body === 'object' && body !== null && 'details' in body ? (body as { details: unknown }).details : null;
    return { ok: false, error: httpError(code, response.status, message, details, path) };
  }

  if (response.status === 204) {
    return { ok: true, data: undefined as T };
  }

  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    return { ok: false, error: toTransportError(cause, path) };
  }

  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, error: parseError(response.status, text.slice(0, 200), path) };
  }
}

export const apiGet = <T>(path: string, options: Omit<RequestOptions, 'body'> = {}): Promise<ApiResult<T>> =>
  request<T>('GET', path, options);

export const apiPost = <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'body'> = {}): Promise<ApiResult<T>> =>
  request<T>('POST', path, { ...options, ...(body === undefined ? {} : { body }) });

export const apiPatch = <T>(path: string, body: unknown, options: Omit<RequestOptions, 'body'> = {}): Promise<ApiResult<T>> =>
  request<T>('PATCH', path, { ...options, body });

export const apiDelete = (path: string, options: Omit<RequestOptions, 'body'> = {}): Promise<ApiResult<undefined>> =>
  request<undefined>('DELETE', path, options);

/**
 * `GET /health` vive en la raíz de la API, fuera del prefijo global
 * (`/api/v1/health` es un 404), así que no usa `apiGet`.
 */
export async function apiHealth(signal?: AbortSignal): Promise<ApiResult<import('./types').HealthStatus>> {
  const url = `${apiRootUrl()}/health`;
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      ...(signal === undefined ? {} : { signal }),
      cache: 'no-store',
    });
    const { body, message } = await readErrorBody(response);
    if (!response.ok) {
      return { ok: false, error: httpError(codeFromBody(body, response.status), response.status, message, null, '/health') };
    }
    return { ok: true, data: body as import('./types').HealthStatus };
  } catch (cause) {
    return { ok: false, error: toTransportError(cause, '/health') };
  }
}