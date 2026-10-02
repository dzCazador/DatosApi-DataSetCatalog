import { Module } from '@nestjs/common';

import { DatasetsPersistenceModule } from '@datosapi/database';

import { DatasetsController } from './datasets.controller';
import { DatasetsService } from './datasets.service';

/**
 * Catálogo de datasets. Importa `DatasetsPersistenceModule` y nada más: no depende de
 * `IngestionModule` porque publicar un dataset no toca el motor de ingesta (los datos se
 * cambian reingeriendo, no desde acá).
 */
@Module({
  imports: [DatasetsPersistenceModule],
  controllers: [DatasetsController],
  providers: [DatasetsService],
  exports: [DatasetsService],
})
export class DatasetsModule {}
