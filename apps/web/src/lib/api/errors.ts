import type { ErrorCode, UnknownFieldReport } from './types';

/**
 * Los tres motivos por los que una llamada al panel puede fallar. El panel ramifica por
 * `code`, nunca por `message`: `message` es humano y puede cambiar sin aviso
 * (`api-contract.md` §1.1).
 */
export type ApiErrorKind = 'http' | 'transport' | 'parse';

export interface ApiErrorBase {
  kind: ApiErrorKind;
  /** Texto para la UI. En `http` sale de `messageByCode`, no del `message` de la API. */
  uiMessage: string;
  /** Path de la API que falló, para que el diagnóstico sea accionable. */
  path: string;
}

/** La API respondió con un error: hay `code` programático y `details` con forma por código. */
export interface ApiHttpError extends ApiErrorBase {
  kind: 'http';
  code: ErrorCode;
  status: number;
  message: string;
  details: unknown;
}

/** La API no respondió: apagada, sin CORS, `NEXT_PUBLIC_API_URL` mal, timeout, red caída. */
export interface ApiTransportError extends ApiErrorBase {
  kind: 'transport';
  reason: 'unreachable' | 'timeout' | 'aborted';
  cause: string;
}

/** La API respondió `2xx` con un body que no es el envelope esperado. */
export interface ApiParseError extends ApiErrorBase {
  kind: 'parse';
  status: number;
  snippet: string;
}

export type ApiError = ApiHttpError | ApiTransportError | ApiParseError;

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/**
 * Mensaje por `code` (`api-contract.md` §1.2). Se escribe uno por código: un `code` sin
 * entrada cae en el `HTTP_ERROR` genérico, nunca en el `message` crudo de la API.
 */
const MESSAGE_BY_CODE: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_ERROR: 'La API rechazó los datos enviados. Revisá los campos marcados.',
  SOURCE_CONFIG_INVALID: 'El `config` no corresponde al `type` de la fuente elegido.',
  SLUG_INVALID:
    'El slug no es válido: sólo minúsculas, números y guiones, entre 3 y 80 caracteres.',
  SLUG_TAKEN: 'Ya existe un endpoint con ese slug. Elegí otro.',
  INGEST_ALREADY_RUNNING: 'Ya hay una ingesta en curso sobre esa fuente. Esperala y reintentá.',
  VERSION_CONFLICT: 'La versión del dataset ya existe. Reintentá la ingesta.',
  SOURCE_NOT_FOUND: 'La fuente ya no existe.',
  DATASET_NOT_FOUND: 'El dataset ya no existe.',
  DATASET_INVALID_STATE: 'Esa transición de estado no está permitida sobre el dataset.',
  ENDPOINT_NOT_FOUND: 'La definición de endpoint ya no existe.',
  SLUG_NOT_FOUND: 'No existe un endpoint habilitado con ese slug.',
  PAYLOAD_TOO_LARGE: 'El origen devolvió un archivo más grande que el límite configurado.',
  UNSUPPORTED_MEDIA_TYPE: 'El origen devolvió un tipo de contenido no soportado.',
  UNPROCESSABLE_CONTENT: 'Los datos del origen no se pudieron interpretar.',
  ROWS_LIMIT_EXCEEDED: 'La ingesta superó el máximo de filas configurado.',
  FILTER_NOT_ALLOWED: 'Ese filtro no está permitido por la definición del endpoint.',
  SORT_NOT_ALLOWED: 'Ese orden no está permitido por la definición del endpoint.',
  INVALID_PAGINATION: 'La paginación es inválida para este endpoint.',
  SCHEMA_MISMATCH: 'La definición del endpoint no coincide con el schema del dataset.',
  UPSTREAM_ERROR: 'El origen de datos respondió con error. El problema no es el panel.',
  UPSTREAM_TIMEOUT: 'El origen de datos tardó demasiado. El problema no es el panel.',
  ROUTE_NOT_FOUND: 'La API no expone esa ruta.',
  HTTP_ERROR: 'La API devolvió un error.',
  INTERNAL_ERROR: 'La API falló por un error interno.',
};

export function messageByCode(code: ErrorCode): string {
  return MESSAGE_BY_CODE[code] ?? MESSAGE_BY_CODE.HTTP_ERROR;
}

/** `details` de `SCHEMA_MISMATCH`: `{ unknownFields: [...] }` (`api-contract.md` §5). */
export function unknownFieldsFromDetails(details: unknown): UnknownFieldReport[] {
  if (typeof details !== 'object' || details === null) return [];
  if (!('unknownFields' in details)) return [];
  const value = (details as { unknownFields: unknown }).unknownFields;
  return Array.isArray(value) ? (value as UnknownFieldReport[]) : [];
}

/** `details` del `ValidationPipe`: `string[]` de mensajes por campo. */
export function validationMessagesFromDetails(details: unknown): string[] {
  return Array.isArray(details) ? details.filter((item): item is string => typeof item === 'string') : [];
}

/** `details` de `FILTER_NOT_ALLOWED`: `{ param, field?, reason? }`. */
export function paramFromDetails(details: unknown): string | null {
  if (typeof details !== 'object' || details === null) return null;
  if (!('param' in details)) return null;
  const value = (details as { param: unknown }).param;
  return typeof value === 'string' ? value : null;
}

export function allowedFromDetails(details: unknown): string[] {
  if (typeof details !== 'object' || details === null) return [];
  if (!('allowed' in details)) return [];
  const value = (details as { allowed: unknown }).allowed;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** `details` de `DATASET_INVALID_STATE`: `{ operation, current, expectedFrom, expectedTo }`. */
export function datasetStateFromDetails(
  details: unknown,
): { operation: string; current: string; expectedFrom: string; expectedTo: string } | null {
  if (typeof details !== 'object' || details === null) return null;
  const raw = details as Record<string, unknown>;
  const { operation, current, expectedFrom, expectedTo } = raw;
  if (
    typeof operation !== 'string' ||
    typeof current !== 'string' ||
    typeof expectedFrom !== 'string' ||
    typeof expectedTo !== 'string'
  ) {
    return null;
  }
  return { operation, current, expectedFrom, expectedTo };
}

/* ── constructores ───────────────────────────────────────────────────── */

export function httpError(
  code: ErrorCode,
  status: number,
  message: string,
  details: unknown,
  path: string,
): ApiHttpError {
  return {
    kind: 'http',
    code,
    status,
    message,
    details,
    path,
    uiMessage: messageByCode(code),
  };
}

export function transportError(reason: 'unreachable' | 'timeout' | 'aborted', cause: string, path: string): ApiTransportError {
  return { kind: 'transport', reason, cause, path, uiMessage: transportMessage(reason) };
}

export function parseError(status: number, snippet: string, path: string): ApiParseError {
  return {
    kind: 'parse',
    status,
    snippet,
    path,
    uiMessage: 'La API respondió algo que el panel no entiende. Revisá la URL configurada.',
  };
}

function transportMessage(reason: 'unreachable' | 'timeout' | 'aborted'): string {
  switch (reason) {
    case 'unreachable':
      return 'No se pudo contactar la API. Verificá que esté levantada y que NEXT_PUBLIC_API_URL sea correcta.';
    case 'timeout':
      return 'La API tardó demasiado en responder.';
    case 'aborted':
      return 'La consulta fue cancelada.';
  }
}

/* ── presentación ────────────────────────────────────────────────────── */

/** Un error y cómo mostrarlo: título, detalle y, cuando aplica, qué hacer. */
export interface ErrorPresentation {
  title: string;
  detail: string;
  hint: string | null;
}

export function presentError(error: ApiError): ErrorPresentation {
  switch (error.kind) {
    case 'http':
      return presentHttpError(error);
    case 'transport':
      return {
        title: error.uiMessage,
        detail: error.cause,
        hint:
          error.reason === 'unreachable'
            ? 'Levantá la API con `pnpm dev` (o `pnpm --filter @datosapi/api dev`) y revisá CORS_ORIGINS.'
            : null,
      };
    case 'parse':
      return {
        title: 'Respuesta inesperada de la API',
        detail: `HTTP ${error.status}: ${error.snippet}`,
        hint: 'Suele ser una URL base equivocada en apps/web/.env.local.',
      };
  }
}

function presentHttpError(error: ApiHttpError): ErrorPresentation {
  const base = { title: error.uiMessage, detail: error.message, hint: errorHint(error) };

  switch (error.code) {
    case 'VALIDATION_ERROR': {
      const messages = validationMessagesFromDetails(error.details);
      return {
        ...base,
        detail: messages.length > 0 ? messages.join(' · ') : error.message,
      };
    }
    case 'SCHEMA_MISMATCH': {
      const unknownFields = unknownFieldsFromDetails(error.details);
      if (unknownFields.length === 0) return base;
      return {
        ...base,
        detail: unknownFields.map((item) => `${item.where}: ${item.field}`).join(' · '),
        hint: 'Corregí la definición con POST /endpoints/:id/validate y el editor de Endpoints.',
      };
    }
    case 'SORT_NOT_ALLOWED': {
      const allowed = allowedFromDetails(error.details);
      return {
        ...base,
        detail: error.message,
        hint: allowed.length > 0 ? `Orden permitido: ${allowed.join(', ')}` : null,
      };
    }
    case 'FILTER_NOT_ALLOWED': {
      const param = paramFromDetails(error.details);
      return { ...base, detail: param === null ? error.message : `Parámetro rechazado: ${param}` };
    }
    default:
      return base;
  }
}

function errorHint(error: ApiHttpError): string | null {
  switch (error.code) {
    case 'SLUG_TAKEN':
      return 'Elegí otro slug: es la URL pública del endpoint y no se puede reutilizar.';
    case 'SLUG_NOT_FOUND':
      return 'Revisá que el endpoint exista y esté habilitado.';
    case 'INGEST_ALREADY_RUNNING':
      return 'La ingesta en curso va a crear su propia versión; no hace falta disparar otra.';
    case 'UPSTREAM_ERROR':
    case 'UPSTREAM_TIMEOUT':
      return 'El problema está en el origen de datos, no en el panel.';
    case 'DATASET_INVALID_STATE': {
      const state = datasetStateFromDetails(error.details);
      if (state === null) return null;
      return `Sólo se permite ${state.operation} desde '${state.expectedFrom}' hacia '${state.expectedTo}'; está en '${state.current}'.`;
    }
    default:
      return null;
  }
}

/** Descripción de un fallo para el `ApiResult`, sin desempaquetar. */
export function describeFailure(error: ApiError): string {
  const { title, detail } = presentError(error);
  return detail === title ? title : `${title}: ${detail}`;
}