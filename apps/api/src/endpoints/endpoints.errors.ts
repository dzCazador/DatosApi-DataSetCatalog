import { HttpStatus } from '@nestjs/common';

import { DatasetStatus } from '@datosapi/common';

import { DomainException } from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-code';

/** `404` de definición de endpoint (api-contract.md §5). */
export class EndpointNotFoundError extends DomainException {
  constructor(id: string) {
    super(
      {
        code: ErrorCode.ENDPOINT_NOT_FOUND,
        message: `No existe un endpoint con id '${id}'`,
        details: null,
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * `404` del endpoint público (api-contract.md §6).
 *
 * Inexistente y deshabilitado dan el mismo error a propósito: un `404` distinto para
 * "existe pero está apagado" le confirmaría al consumidor que el slug existe, que es
 * información de la que no debería depender.
 */
export class SlugNotFoundError extends DomainException {
  constructor(slug: string) {
    super(
      {
        code: ErrorCode.SLUG_NOT_FOUND,
        message: `No existe un endpoint con slug '${slug}'`,
        details: null,
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

/** `400 SLUG_INVALID` (api-contract.md §1.2). */
export class SlugInvalidError extends DomainException {
  constructor(slug: string, reason: string) {
    super(
      {
        code: ErrorCode.SLUG_INVALID,
        message: `Slug inválido '${slug}': ${reason}`,
        details: { slug },
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** `409 SLUG_TAKEN`. Lo dispara el índice único `{ slug }`, traducido a error de dominio. */
export class SlugTakenError extends DomainException {
  constructor(slug: string) {
    super(
      {
        code: ErrorCode.SLUG_TAKEN,
        message: `Ya existe un endpoint con slug '${slug}'`,
        details: { slug },
      },
      HttpStatus.CONFLICT,
    );
  }
}

export interface UnknownFieldReport {
  /** Ubicación exacta dentro de la definición, tal como la nombra `api-contract.md` §5. */
  where: string;
  field: string;
  reason: string;
}

/**
 * `422 SCHEMA_MISMATCH` (api-contract.md §5 y §6).
 *
 * Lo comparten los dos casos en que la definición y el schema no coinciden: columnas que
 * el dataset no tiene, y un dataset resuelto que no se puede servir. El `details` lista lo
 * involucrado para que el panel ofrezca corregirlo sin adivinar.
 */
export class SchemaMismatchError extends DomainException {
  constructor(message: string, details: unknown) {
    super({ code: ErrorCode.SCHEMA_MISMATCH, message, details }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/** Constructor de `SchemaMismatchError` para columnas desconocidas. */
export function unknownFieldsError(
  unknownFields: UnknownFieldReport[],
  slug?: string,
): SchemaMismatchError {
  const columns = [...new Set(unknownFields.map((report) => report.field))].join(', ');

  return new SchemaMismatchError(
    `La definición${slug === undefined ? '' : ` de '${slug}'`} referencia columnas que el dataset no ` +
      `tiene: ${columns}`,
    { unknownFields },
  );
}

/**
 * Base de los `422 SCHEMA_MISMATCH` del endpoint público (api-contract.md §6): el slug existe
 * y está habilitado, así que no es `404`; lo que falla es el dataset detrás.
 *
 * El `details.status` dice cuál de los dos casos es, porque el consumidor tiene que poder
 * distinguir "todavía no se publicó" de "se archivó lo que estaba sirviendo".
 */
abstract class DatasetNotServableError extends DomainException {
  protected constructor(message: string, details: unknown) {
    super({ code: ErrorCode.SCHEMA_MISMATCH, message, details }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/** El dataset declarado no existe, o la fuente todavía no publicó ninguno. */
export class DatasetUnresolvedError extends DatasetNotServableError {
  constructor(slug: string, reason: 'dataset-not-found' | 'no-published') {
    super(
      reason === 'dataset-not-found'
        ? `El dataset declarado por el endpoint '${slug}' no existe`
        : `La fuente del endpoint '${slug}' todavía no tiene ningún dataset publicado`,
      { slug, reason },
    );
  }
}

/**
 * El dataset existe pero no está `published`. Un `draft` nunca se sirve —no es un
 * afterthought del filtro, es que publicar es un paso deliberado— y un `archived` es la
 * transición que el contrato convierte en `422`.
 */
export class DatasetNotPublishedError extends DatasetNotServableError {
  constructor(slug: string, status: DatasetStatus) {
    super(
      `El endpoint '${slug}' resuelve a un dataset en '${status}' y sólo se sirven datasets published`,
      { slug, status },
    );
  }
}

/**
 * `400 FILTER_NOT_ALLOWED` (api-contract.md §6). Cubre también la clave de query no
 * reconocida, porque el efecto es el mismo para el cliente: le mandaron algo que esta
 * definición no admite y necesita saber cuál para corregirlo.
 */
export class FilterNotAllowedError extends DomainException {
  constructor(param: string, value?: string, field?: string, reason?: string) {
    super(
      {
        code: ErrorCode.FILTER_NOT_ALLOWED,
        message: describe(param, value, reason),
        details: {
          param,
          ...(field === undefined ? {} : { field }),
          ...(reason === undefined ? {} : { reason }),
        },
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

function describe(param: string, value: string | undefined, reason: string | undefined): string {
  if (value === undefined && reason === undefined) {
    return `El parámetro '${param}' no está permitido en esta definición`;
  }

  if (value === undefined) return `El parámetro '${param}' ${reason ?? ''}`.trim();

  return `Valor inválido '${value}' para '${param}': ${reason ?? 'no permitido'}`;
}

/** `400 SORT_NOT_ALLOWED` (api-contract.md §6). `details.allowed` dice qué sí se puede. */
export class SortNotAllowedError extends DomainException {
  constructor(field: string, allowed: string[]) {
    super(
      {
        code: ErrorCode.SORT_NOT_ALLOWED,
        message: `No se puede ordenar por '${field}': no está en la lista permitida`,
        details: { field, allowed },
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/** `400 INVALID_PAGINATION` (api-contract.md §1.2 y §6). */
export class InvalidPaginationError extends DomainException {
  constructor(param: string, value: string, reason: string) {
    super(
      {
        code: ErrorCode.INVALID_PAGINATION,
        message: `${param} inválido: '${value}' (${reason})`,
        details: { param, value, reason },
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * `400 VALIDATION_ERROR` de un valor que no se puede castear al tipo de la columna
 * (api-contract.md §6). Es el caso que el contrato separa de `FILTER_NOT_ALLOWED`: el
 * filtro está permitido, lo que está mal es su valor.
 */
export class ValueCastError extends DomainException {
  constructor(field: string, raw: string, expected: string) {
    super(
      {
        code: ErrorCode.VALIDATION_ERROR,
        message: `El valor '${raw}' de '${field}' no es ${expected}`,
        details: { field, value: raw, expected },
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

export interface EndpointLimits {
  defaultLimit: number;
  maxLimit: number;
  /** `MAX_LIMIT` de la configuración: el techo que ninguna definición puede superar. */
  ceiling: number;
}

/**
 * `400` de una definición internamente inconsistente.
 *
 * Usa `VALIDATION_ERROR` porque no tiene código propio en `api-contract.md` §1.2: no es una
 * forma de body inválida sino una relación entre campos que el DTO no puede expresar —y el
 * `ValidationPipe` tampoco puede, porque el techo sale de la configuración y no de un
 * decorador constante—. El `details` dice cuál corregir.
 */
export class EndpointLimitsInvalidError extends DomainException {
  constructor(limits: EndpointLimits) {
    const { defaultLimit, maxLimit, ceiling } = limits;

    super(
      {
        code: ErrorCode.VALIDATION_ERROR,
        message:
          defaultLimit > maxLimit
            ? `defaultLimit (${defaultLimit}) no puede ser mayor que maxLimit (${maxLimit})`
            : `maxLimit (${maxLimit}) no puede superar el tope global MAX_LIMIT (${ceiling})`,
        details: limits,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * `404 DATASET_NOT_FOUND` al apuntar la definición a un id de dataset inexistente.
 *
 * El contrato no lista este caso en §5, pero apuntar a un id que no existe no es un
 * `SCHEMA_MISMATCH`: no hay schema con el cual comparar. Se devuelve el `404` que el cliente
 * ya conoce de `GET /datasets/:id` en vez de inventar un status nuevo.
 */
export class EndpointDatasetNotFoundError extends DomainException {
  constructor(datasetId: string) {
    super(
      {
        code: ErrorCode.DATASET_NOT_FOUND,
        message: `No existe un dataset con id '${datasetId}'`,
        details: { datasetId },
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * `422 SCHEMA_MISMATCH` cuando el `datasetId` declarado pertenece a otra `sourceId` que la
 * de la definición. Es una referencia cruzada imposible de resolver en el futuro: si la
 * definición sigue a la última versión publicada de su source, jamás verá ese dataset.
 */
export class EndpointSourceMismatchError extends DomainException {
  constructor(datasetId: string, datasetSourceId: string, definitionSourceId: string) {
    super(
      {
        code: ErrorCode.SCHEMA_MISMATCH,
        message:
          `El dataset '${datasetId}' pertenece a la source '${datasetSourceId}' y la definición a la ` +
          `'${definitionSourceId}'`,
        details: { datasetId, datasetSourceId, definitionSourceId },
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/**
 * `400 VALIDATION_ERROR` cuando la definición no dice qué dataset servir: `datasetId` es
 * obligatorio salvo con `followLatest: true` (api-contract.md §5).
 */
export class EndpointDatasetRequiredError extends DomainException {
  constructor() {
    super(
      {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'datasetId es obligatorio cuando followLatest es false',
        details: { datasetId: null },
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
