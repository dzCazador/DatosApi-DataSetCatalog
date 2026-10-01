import { HttpStatus } from '@nestjs/common';

import { DomainException } from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-code';

/** `404` de source. Existe uno propio para que el `code` sea `SOURCE_NOT_FOUND` y no un 404 genérico. */
export class SourceNotFoundError extends DomainException {
  constructor(id: string) {
    super(
      { code: ErrorCode.SOURCE_NOT_FOUND, message: `No existe una fuente con id '${id}'`, details: null },
      HttpStatus.NOT_FOUND,
    );
  }
}