import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ENDPOINTS_REPOSITORY } from '@datosapi/common';

import {
  EndpointDefinitionDoc,
  EndpointDefinitionSchema,
} from '../schemas/endpoint-definition.schema';
import { MongooseEndpointsRepository } from '../repositories/endpoints.repository';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EndpointDefinitionDoc.name, schema: EndpointDefinitionSchema },
    ]),
  ],
  providers: [
    {
      provide: ENDPOINTS_REPOSITORY,
      useClass: MongooseEndpointsRepository,
    },
  ],
  exports: [ENDPOINTS_REPOSITORY],
})
export class EndpointsPersistenceModule {}
