import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import type { EndpointDefinitionEntity, Paginated } from '@datosapi/common';

import { withMongoId } from '../common/presenters/mongo-id';
import type { WithMongoId } from '../common/presenters/mongo-id';
import {
  CreateEndpointDto,
  isEnabledRequested,
  ListEndpointsQueryDto,
  UpdateEndpointDto,
} from './dto/endpoints.dto';
import { EndpointsService } from './endpoints.service';
import type { EndpointDetail, ValidationReport } from './endpoints.service';

/**
 * Ejemplo reutilizado en las seis operaciones (api-contract.md §7): cada `EndpointDefinition`
 * documenta cómo se consulta a sí misma, porque la forma de `GET /e/{slug}` depende del
 * dataset y no se puede escribir un ejemplo único que sirva para todos.
 */
const DYNAMIC_EXAMPLE = [
  '```',
  'GET /api/v1/e/escala-retencion-4ta-categoria?importe_desde=50000&limit=10&sort=importe_desde:asc',
  '```',
  '',
  '```json',
  '{',
  '  "data": [',
  '    { "tramo": "5", "importe_desde": 54785.28, "alicuota": 0.15, "retencion": 8217.79 }',
  '  ],',
  '  "meta": {',
  '    "total": 6, "count": 6, "page": 1, "limit": 10, "pages": 1,',
  '    "dataset": { "id": "66f1…", "version": 1, "sourceId": "66f0…", "updatedAt": "2026-01-15T12:00:00.000Z" }',
  '  }',
  '}',
  '```',
].join('\n');

@ApiTags('endpoints')
@Controller('endpoints')
export class EndpointsController {
  constructor(private readonly endpointsService: EndpointsService) {}

  @Post()
  @ApiOperation({
    summary: 'Publica un dataset detrás de un slug',
    description: [
      'Valida que cada `field` de `fields`, `filters` y `sort` exista en el schema del dataset',
      'resuelto: una referencia a una columna inexistente es `422 SCHEMA_MISMATCH`, no una',
      'definición guardada que después no responde.',
      '',
      DYNAMIC_EXAMPLE,
    ].join('\n'),
  })
  @ApiCreatedResponse({ description: 'Definición creada y habilitada.' })
  @ApiConflictResponse({ description: 'El slug ya existe (`SLUG_TAKEN`).' })
  @ApiUnprocessableEntityResponse({
    description: 'Alguna columna referenciada no está en el schema del dataset.',
  })
  async create(@Body() dto: CreateEndpointDto): Promise<WithMongoId<EndpointDefinitionEntity>> {
    return withMongoId(await this.endpointsService.create(dto));
  }

  @Get()
  @ApiOperation({
    summary: 'Lista las definiciones de endpoint',
    description: [
      'Sin resolver dataset: el listado es de definiciones, no de datos.',
      '',
      DYNAMIC_EXAMPLE,
    ].join('\n'),
  })
  @ApiOkResponse({ description: 'Página de definiciones con su `meta` de paginación.' })
  async findAll(
    @Query() query: ListEndpointsQueryDto,
  ): Promise<Paginated<WithMongoId<EndpointDefinitionEntity>>> {
    const page = await this.endpointsService.findAll({
      ...(query.sourceId === undefined ? {} : { sourceId: query.sourceId }),
      enabled: isEnabledRequested(query.enabled),
      page: { page: query.page, limit: query.limit },
    });

    return { ...page, data: page.data.map(withMongoId) };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Detalle de una definición con el dataset que usaría ahora',
    description: [
      '`resolved` informa qué dataset sirve hoy: el `datasetId` declarado, o el último',
      '`published` si `followLatest`. Viene `null` con `resolvedReason` cuando no resuelve —',
      'por ejemplo una fuente sin publicaciones— en lugar de `404`: la definición existe y',
      'el panel tiene que poder mostrarla.',
      '',
      DYNAMIC_EXAMPLE,
    ].join('\n'),
  })
  @ApiOkResponse({ description: 'La definición con `resolved` y `resolvedReason`.' })
  @ApiNotFoundResponse({ description: 'No existe una definición con ese id.' })
  async findOne(@Param('id') id: string): Promise<WithMongoId<EndpointDetail>> {
    return withMongoId(await this.endpointsService.findOne(id));
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Actualización parcial de una definición',
    description: [
      'Revalida contra el schema si cambian `fields`, `filters`, `sort`, `datasetId` o',
      '`followLatest`. El `slug` no se puede cambiar: rompería las URLs ya publicadas, y',
      '`forbidNonWhitelisted` lo devuelve como `400`.',
      '',
      DYNAMIC_EXAMPLE,
    ].join('\n'),
  })
  @ApiOkResponse({ description: 'La definición actualizada.' })
  @ApiUnprocessableEntityResponse({
    description: 'Las columnas pedidas no están en el schema del dataset resuelto.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEndpointDto,
  ): Promise<WithMongoId<EndpointDefinitionEntity>> {
    return withMongoId(await this.endpointsService.update(id, dto));
  }

  @Post(':id/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revalida la definición contra el schema actual',
    description: [
      'Siempre `200`: es un reporte, no un fallo. Es la vía para enterarse de que una ' +
        'reingesta cambió el schema y dejó columnas huérfanas en una definición ya publicada.',
      '',
      DYNAMIC_EXAMPLE,
    ].join('\n'),
  })
  @ApiOkResponse({ description: 'Reporte con `valid`, `datasetId`, `version` y `unknownFields`.' })
  async validate(@Param('id') id: string): Promise<ValidationReport> {
    return this.endpointsService.validate(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Borra la definición',
    description: [
      'Hard-delete: desaparecen la definición y su URL. Los datasets quedan intactos ' +
        '(api-contract.md §5).',
      '',
      DYNAMIC_EXAMPLE,
    ].join('\n'),
  })
  @ApiNoContentResponse({ description: 'Definición borrada.' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.endpointsService.remove(id);
  }
}
