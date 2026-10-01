import { Module } from '@nestjs/common';

import { IngestorFactory } from './ingestor.factory';
import { INGEST_STRATEGIES } from './ingestion.types';
import type { IngestStrategy } from './ingestion.types';
import { Downloader } from './helpers/downloader';
import { ApiIngestStrategy } from './strategies/api.strategy';
import { ManualIngestStrategy } from './strategies/manual.strategy';

/**
 * El motor de ingesta (ingestion.md). Se registra en `AppModule` para que el `SourcesService`
 * resuelva strategies desde acá, y exporta `IngestorFactory` porque el service lo necesita
 * para validar el `config` en el alta, antes de que exista la ingesta.
 *
 * `url` y `pdf` se agregan en la fase 05: no están registradas a propósito, y
 * `IngestorFactory.resolve` devuelve `400` para esos tipos hasta entonces.
 */
@Module({
  providers: [
    Downloader,
    ManualIngestStrategy,
    ApiIngestStrategy,
    {
      provide: INGEST_STRATEGIES,
      useFactory: (...strategies: IngestStrategy[]) => strategies,
      inject: [ManualIngestStrategy, ApiIngestStrategy],
    },
    IngestorFactory,
  ],
  exports: [IngestorFactory],
})
export class IngestionModule {}