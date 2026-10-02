import { Module } from '@nestjs/common';

import { IngestorFactory } from './ingestor.factory';
import { INGEST_STRATEGIES } from './ingestion.types';
import type { IngestStrategy } from './ingestion.types';
import { Downloader } from './helpers/downloader';
import { ApiIngestStrategy } from './strategies/api.strategy';
import { ManualIngestStrategy } from './strategies/manual.strategy';
import { PdfIngestStrategy } from './strategies/pdf.strategy';
import { UrlIngestStrategy } from './strategies/url.strategy';

/**
 * El motor de ingesta (ingestion.md). Se registra en `AppModule` para que el `SourcesService`
 * resuelva strategies desde acá, y exporta `IngestorFactory` porque el service lo necesita
 * para validar el `config` en el alta, antes de que exista la ingesta.
 *
 * Las cuatro strategies registradas cubren los cuatro `SourceType`. Las de archivo comparten
 * `Downloader`, que es donde viven el timeout y el límite de bytes (ingestion.md §4.2 a §4.4),
 * y la de PDF comparte con `url` el módulo `pdfTableExtractor` (§5).
 */
@Module({
  providers: [
    Downloader,
    ManualIngestStrategy,
    ApiIngestStrategy,
    PdfIngestStrategy,
    UrlIngestStrategy,
    {
      provide: INGEST_STRATEGIES,
      useFactory: (...strategies: IngestStrategy[]) => strategies,
      inject: [
        ManualIngestStrategy,
        ApiIngestStrategy,
        PdfIngestStrategy,
        UrlIngestStrategy,
      ],
    },
    IngestorFactory,
  ],
  exports: [IngestorFactory],
})
export class IngestionModule {}