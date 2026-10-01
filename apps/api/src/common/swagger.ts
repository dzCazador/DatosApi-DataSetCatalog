import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';

export const SWAGGER_PATH = 'docs';

const API_TITLE = 'DatosApi API';
const API_DESCRIPTION = [
  'Ingestión de datos de terceros, catálogo de datasets versionados y endpoint dinámico.',
  'Los filtros, el orden y la proyección de cada dataset publicado se declaran en su',
  'EndpointDefinition: lo que no está en el allowlist devuelve 400, nunca se ignora.',
].join(' ');

export function createSwaggerDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle(API_TITLE)
    .setDescription(API_DESCRIPTION)
    .setVersion('0.1.0')
    .build();

  return SwaggerModule.createDocument(app, config);
}
