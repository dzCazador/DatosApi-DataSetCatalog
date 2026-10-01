import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import type { MongooseModuleFactoryOptions } from '@nestjs/mongoose';

// Sin límite, una caída de Mongo deja requests colgados hasta el timeout del load balancer.
const SERVER_SELECTION_TIMEOUT_MS = 5_000;

export function mongooseConnectionOptions(uri: string): MongooseModuleFactoryOptions {
  return {
    uri,
    autoIndex: true,
    serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
  };
}

@Module({})
export class DatabaseModule {
  static forRoot(): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [
        MongooseModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (configService: ConfigService) =>
            mongooseConnectionOptions(configService.getOrThrow<string>('MONGODB_URI')),
        }),
      ],
      exports: [MongooseModule],
    };
  }
}
