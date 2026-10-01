import { HttpException } from '@nestjs/common';
import type { HttpStatus } from '@nestjs/common';
import type { ErrorCode } from './error-code';

export interface DomainExceptionBody {
  code: ErrorCode;
  message: string;
  details: unknown;
}

export interface DomainExceptionOptions {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/**
 * Único camino para responder un error de dominio con `code` estable: el filtro global sólo
 * sabe leer excepciones de Nest, así que el `code` viaja en el body de la excepción.
 */
export class DomainException extends HttpException {
  constructor(options: DomainExceptionOptions, status: HttpStatus) {
    const body: DomainExceptionBody = {
      code: options.code,
      message: options.message,
      details: options.details ?? null,
    };

    super(body, status);
  }
}
