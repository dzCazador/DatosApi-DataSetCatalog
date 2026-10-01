import { HttpStatus } from '@nestjs/common';

import { DomainException } from '../../common/errors/domain.exception';
import { ErrorCode } from '../../common/errors/error-code';

/**
 * Errores de ingesta con su código estable y su texto (ingestion.md §7). La tabla del spec
 * define para cada situación tres cosas — HTTP, `Source.status` y `lastError` — y el `message`
 * que se persiste en `lastError` es exactamente el que ve el usuario, así que ambos salen
 * del mismo lugar y no pueden divergir.
 *
 * `status` se lo aplica el `SourcesService`: `ingestion.md` §7 distingue los errores que
 * dejan la source en `error` de los que no la tocan (`400` de config, `409` de concurrencia).
 */

export type IngestionFailureKind = 'fatal' | 'keep-status';

export class IngestionError extends DomainException {
  /** Si la ingesta debe dejar la source en `status: error`. */
  readonly kind: IngestionFailureKind = 'fatal';
}

/** `config` que no corresponde al `type`: la source ni se toca (ingestion.md §7). */
export class SourceConfigInvalidError extends IngestionError {
  override readonly kind = 'keep-status';

  constructor(message: string, details?: unknown) {
    super(
      { code: ErrorCode.SOURCE_CONFIG_INVALID, message, ...(details === undefined ? {} : { details }) },
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class IngestAlreadyRunningError extends IngestionError {
  override readonly kind = 'keep-status';

  constructor() {
    super(
      {
        code: ErrorCode.INGEST_ALREADY_RUNNING,
        message: 'Ya hay una ingesta en curso sobre esta fuente',
        details: null,
      },
      HttpStatus.CONFLICT,
    );
  }
}

/** Carrera perdida contra el índice único `{sourceId, version}` (ingestion.md §2 punto 3). */
export class VersionConflictError extends IngestionError {
  constructor() {
    super(
      { code: ErrorCode.VERSION_CONFLICT, message: 'version conflict', details: null },
      HttpStatus.CONFLICT,
    );
  }
}

/** El origen respondió con error o no respondió: `502`, no `422` (ingestion.md §7). */
export class UpstreamError extends IngestionError {
  constructor(status: number, snippet: string) {
    super(
      {
        code: ErrorCode.UPSTREAM_ERROR,
        message: `upstream responded ${status}: ${snippet}`,
        details: { upstreamStatus: status },
      },
      HttpStatus.BAD_GATEWAY,
    );
  }
}

export class UpstreamTimeoutError extends IngestionError {
  constructor(timeoutMs: number) {
    super(
      {
        code: ErrorCode.UPSTREAM_TIMEOUT,
        message: `timeout after ${timeoutMs}ms`,
        details: { timeoutMs },
      },
      HttpStatus.GATEWAY_TIMEOUT,
    );
  }
}

export class PayloadTooLargeError extends IngestionError {
  constructor(maxBytes: number) {
    super(
      {
        code: ErrorCode.PAYLOAD_TOO_LARGE,
        message: `payload exceeds ${maxBytes} bytes`,
        details: { maxBytes },
      },
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }
}

export class UnsupportedMediaTypeError extends IngestionError {
  constructor(contentType: string) {
    super(
      {
        code: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
        message: `unsupported content-type: ${contentType}`,
        details: { contentType },
      },
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    );
  }
}

/** `422`: los datos de origen no se pudieron interpretar. */
export class UnprocessableContentError extends IngestionError {
  constructor(message: string, details?: unknown) {
    super(
      {
        code: ErrorCode.UNPROCESSABLE_CONTENT,
        message,
        ...(details === undefined ? {} : { details }),
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** `422 ROWS_LIMIT_EXCEEDED`: se falla, nunca se trunca (data-model.md §3.1 regla 2). */
export class RowsLimitExceededError extends IngestionError {
  constructor(extracted: number, limit: number) {
    super(
      {
        code: ErrorCode.ROWS_LIMIT_EXCEEDED,
        message: `extracted ${extracted} rows, limit ${limit}`,
        details: { extracted, limit },
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}