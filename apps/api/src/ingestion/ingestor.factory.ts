import { Inject, Injectable } from '@nestjs/common';

import { SourceType } from '@datosapi/common';
import type { SourceConfig } from '@datosapi/common';

import { SourceConfigInvalidError } from './errors/ingestion.errors';
import { INGEST_STRATEGIES } from './ingestion.types';
import type { IngestStrategy } from './ingestion.types';

/**
 * Resuelve la estrategia de ingesta de un `SourceType` (ingestion.md §3).
 *
 * Se construye con el mapa de strategies inyectado y no con un `switch`: `url` y `pdf` se
 * registran en la fase 05 y no deben obligar a tocar este archivo.
 */
@Injectable()
export class IngestorFactory {
  constructor(
    @Inject(INGEST_STRATEGIES)
    private readonly strategies: readonly IngestStrategy[],
  ) {}

  resolve(type: SourceType): IngestStrategy {
    const strategy = this.strategies.find((candidate) => candidate.type === type);

    if (strategy === undefined) {
      throw new SourceConfigInvalidError(
        `No hay strategy de ingesta registrada para el tipo '${type}'`,
        { type, available: this.strategies.map((candidate) => candidate.type) },
      );
    }

    return strategy;
  }

  /** Valida un `config` contra su `type` sin ingerir: lo usa el alta y el PATCH de sources. */
  validateConfig(type: SourceType, config: SourceConfig): void {
    this.resolve(type).validateConfig(config);
  }
}