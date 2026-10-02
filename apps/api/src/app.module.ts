import {
  DatabaseModule,
  DatasetsPersistenceModule,
  EndpointsPersistenceModule,
  SourcesPersistenceModule,
} from '@datosapi/database';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configuration } from './config/configuration';
import { resolveEnvFilePaths } from './config/env-file-path';
import { envValidationSchema } from './config/env.validation';
import { DatasetsModule } from './datasets/datasets.module';
import { EndpointsModule } from './endpoints/endpoints.module';
import { HealthModule } from './health/health.module';
import { SourcesModule } from './sources/sources.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: resolveEnvFilePaths(),
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
    }),
    DatabaseModule.forRoot(),
    SourcesPersistenceModule,
    DatasetsPersistenceModule,
    EndpointsPersistenceModule,
    HealthModule,
    SourcesModule,
    DatasetsModule,
    EndpointsModule,
  ],
})
export class AppModule {}
