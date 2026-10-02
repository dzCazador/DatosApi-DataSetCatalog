import { HttpStatus } from '@nestjs/common';

import { DatasetStatus } from '@datosapi/common';

import { DomainException } from '../common/errors/domain.exception';
import { ErrorCode } from '../common/errors/error-code';

/** `404` de dataset. Propio para que el `code` sea `DATASET_NOT_FOUND` y no un 404 genérico. */
export class DatasetNotFoundError extends DomainException {
  constructor(id: string) {
    super(
      {
        code: ErrorCode.DATASET_NOT_FOUND,
        message: `No existe un dataset con id '${id}'`,
        details: null,
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

const TRANSITIONS: Record<'publish' | 'archive', { from: DatasetStatus; to: DatasetStatus }> = {
  publish: { from: DatasetStatus.DRAFT, to: DatasetStatus.PUBLISHED },
  archive: { from: DatasetStatus.PUBLISHED, to: DatasetStatus.ARCHIVED },
};

/**
 * `409` de transición inválida. El mensaje dice cuál era el estado y cuál se pedía: sin eso el
 * cliente sabe que falló pero no qué hacer, y la respuesta sería indistinguible de un `404`.
 */
export class DatasetInvalidStateError extends DomainException {
  constructor(operation: keyof typeof TRANSITIONS, current: DatasetStatus) {
    const { from, to } = TRANSITIONS[operation];
    super(
      {
        code: ErrorCode.DATASET_INVALID_STATE,
        message: `No se puede ${operation === 'publish' ? 'publicar' : 'archivar'} un dataset en '${current}': sólo se admite desde '${from}' hacia '${to}'`,
        details: { operation, current, expectedFrom: from, expectedTo: to },
      },
      HttpStatus.CONFLICT,
    );
  }
}
