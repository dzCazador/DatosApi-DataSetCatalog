import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { DATASETS_REPOSITORY } from '@datosapi/common';

import { DatasetDoc, DatasetSchema } from '../schemas/dataset.schema';
import { MongooseDatasetsRepository } from '../repositories/datasets.repository';

@Module({
  imports: [MongooseModule.forFeature([{ name: DatasetDoc.name, schema: DatasetSchema }])],
  providers: [
    {
      provide: DATASETS_REPOSITORY,
      useClass: MongooseDatasetsRepository,
    },
  ],
  exports: [DATASETS_REPOSITORY],
})
export class DatasetsPersistenceModule {}
