import { Module } from '@nestjs/common';

import { DatasetsPersistenceModule, SourcesPersistenceModule } from '@datosapi/database';

import { IngestionModule } from '../ingestion/ingestion.module';
import { SourcesController } from './sources.controller';
import { SourcesService } from './sources.service';

/**
 * Fuentes y disparo de ingesta. Importa `IngestionModule` sólo para `IngestorFactory`: el
 * service resuelve la strategy y no debería conocer el resto del motor.
 */
@Module({
  imports: [SourcesPersistenceModule, DatasetsPersistenceModule, IngestionModule],
  controllers: [SourcesController],
  providers: [SourcesService],
  exports: [SourcesService],
})
export class SourcesModule {}