import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { SOURCES_REPOSITORY } from '@datosapi/common';

import { MongooseSourcesRepository } from '../repositories/sources.repository';
import { SourceDoc, SourceSchema } from '../schemas/source.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: SourceDoc.name, schema: SourceSchema }])],
  providers: [
    {
      provide: SOURCES_REPOSITORY,
      useClass: MongooseSourcesRepository,
    },
  ],
  exports: [SOURCES_REPOSITORY],
})
export class SourcesPersistenceModule {}
