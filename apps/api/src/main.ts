import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { createSwaggerDocument, SWAGGER_PATH } from './common/swagger';
import { isWildcardOrigin } from './config/configuration';
import type { AppConfiguration } from './config/configuration';

// La salud vive fuera del preijo: es la ruta que consulta el orquestador antes de que
// exista alguna ruta de negocio.
const HEALTH_ROUTE = { path: 'health', method: RequestMethod.GET } as const;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<AppConfiguration, true>>(ConfigService);

  const prefix = config.getOrThrow('API_PREFIX');
  const port = config.getOrThrow('API_PORT');
  const corsOrigins = config.getOrThrow('CORS_ORIGINS');

  app.setGlobalPrefix(prefix, { exclude: [HEALTH_ROUTE] });
  app.enableCors({ origin: isWildcardOrigin(corsOrigins) ? '*' : corsOrigins });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  SwaggerModule.setup(SWAGGER_PATH, app, createSwaggerDocument(app));

  await app.listen(port);

  new Logger('Bootstrap').log(
    `API escuchando en http://localhost:${port}${prefix} · docs en /${SWAGGER_PATH} · health en /health`,
  );
}

void bootstrap();
