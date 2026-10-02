import { Module } from '@nestjs/common';

import {
  DatasetsPersistenceModule,
  EndpointsPersistenceModule,
  SourcesPersistenceModule,
} from '@datosapi/database';

import { IngestionModule } from '../ingestion/ingestion.module';
import { SourcesController } from './sources.controller';
import { SourcesService } from './sources.service';

/**
 * Fuentes y disparo de ingesta. Importa `IngestionModule` sólo para `IngestorFactory`: el
 * service resuelve la strategy y no debería conocer el resto del motor.
 *
 * `EndpointsPersistenceModule` está porque `DELETE /sources/:id` deshabilita los endpoints de
 * la fuente (data-model.md §5). Se usa el repositorio y no `EndpointsService` a propósito:
 * el service de endpoints además valida contra el schema del dataset, y una baja de fuente
 * tiene que funcionar también con definiciones desactualizadas, que son justo las que hay que
 * apagar.
 */
@Module({
  imports: [
    SourcesPersistenceModule,
    DatasetsPersistenceModule,
    EndpointsPersistenceModule,
    IngestionModule,
  ],
  controllers: [SourcesController],
  providers: [SourcesService],
  exports: [SourcesService],
})
export class SourcesModule {}
