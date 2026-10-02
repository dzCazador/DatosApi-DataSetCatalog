import { Module } from '@nestjs/common';

import { DatasetsPersistenceModule, EndpointsPersistenceModule } from '@datosapi/database';

import { DynamicController } from './dynamic.controller';
import { DynamicService } from './dynamic.service';
import { EndpointsController } from './endpoints.controller';
import { EndpointsService } from './endpoints.service';
import { QUERY_ENGINE, InMemoryQueryEngine } from './query-engine';

/**
 * Definiciones de endpoint y endpoint dinámico (api-contract.md §5 y §6).
 *
 * El motor de consulta se inyecta por el token `QUERY_ENGINE` y no se instancia en el
 * service: es el punto de reemplazo si los datasets crecen y hay que pasar a un
 * `Aggregation Pipeline` (fase 07 §3). Hoy el binding es `InMemoryQueryEngine` y ningún
 * service lo referencia por su clase.
 */
@Module({
  imports: [EndpointsPersistenceModule, DatasetsPersistenceModule],
  controllers: [EndpointsController, DynamicController],
  providers: [
    EndpointsService,
    DynamicService,
    { provide: QUERY_ENGINE, useClass: InMemoryQueryEngine },
  ],
  exports: [EndpointsService],
})
export class EndpointsModule {}
