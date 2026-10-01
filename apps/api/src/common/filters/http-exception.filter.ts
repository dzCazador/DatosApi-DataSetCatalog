import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorCode } from '../errors/error-code';

export interface ErrorResponseBody {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details: unknown;
  path: string;
  timestamp: string;
}

interface DescribedError {
  code: ErrorCode;
  message: string;
  details: unknown;
}

const CODE_BY_STATUS: Readonly<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.NOT_FOUND]: ErrorCode.ROUTE_NOT_FOUND,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCode.UNPROCESSABLE_CONTENT,
  [HttpStatus.BAD_GATEWAY]: ErrorCode.UPSTREAM_ERROR,
  [HttpStatus.GATEWAY_TIMEOUT]: ErrorCode.UPSTREAM_TIMEOUT,
};

const VALIDATION_MESSAGE = 'Datos inválidos';
const INTERNAL_MESSAGE = 'Error interno';

function codeForStatus(statusCode: number): ErrorCode {
  if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
    return ErrorCode.INTERNAL_ERROR;
  }

  return CODE_BY_STATUS[statusCode] ?? ErrorCode.HTTP_ERROR;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * `body-parser` lanza sus propios errores (cuerpo demasiado grande, JSON malformado) que no
 * son `HttpException` de Nest, pero traen `status`/`statusCode` y un mensaje útil. Sin esto un
 * body de 2 MB terminaba como `500 INTERNAL_ERROR` en vez de `413 PAYLOAD_TOO_LARGE`.
 */
function statusOf(error: unknown): number | null {
  if (error instanceof HttpException) return error.getStatus();

  if (typeof error !== 'object' || error === null) return null;

  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };

  for (const candidate of [status, statusCode]) {
    if (typeof candidate === 'number' && candidate >= 400 && candidate <= 599) return candidate;
  }

  return null;
}

function describeError(exception: unknown, statusCode: number): DescribedError {
  if (!(exception instanceof HttpException)) {
    const status = statusOf(exception);

    if (status !== null) {
      const message = exception instanceof Error ? exception.message : String(exception);

      return { code: codeForStatus(status), message, details: null };
    }

    return { code: ErrorCode.INTERNAL_ERROR, message: INTERNAL_MESSAGE, details: null };
  }

  const payload = exception.getResponse();
  const fallbackCode = codeForStatus(statusCode);

  if (typeof payload === 'string') {
    return { code: fallbackCode, message: payload, details: null };
  }

  if (isRecord(payload)) {
    const { code, message, details } = payload;
    const resolvedCode = typeof code === 'string' ? (code as ErrorCode) : fallbackCode;

    if (Array.isArray(message)) {
      return { code: resolvedCode, message: VALIDATION_MESSAGE, details: message };
    }

    return {
      code: resolvedCode,
      message: typeof message === 'string' ? message : exception.message,
      details: details ?? null,
    };
  }

  return { code: fallbackCode, message: exception.message, details: null };
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const statusCode = statusOf(exception) ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const error = describeError(exception, statusCode);

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(
        `${request.method} ${request.originalUrl} → ${statusCode} ${error.code}`,
        stack,
      );
    }

    const body: ErrorResponseBody = {
      statusCode,
      code: error.code,
      message: error.message,
      details: error.details,
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
    };

    response.status(statusCode).json(body);
  }
}
