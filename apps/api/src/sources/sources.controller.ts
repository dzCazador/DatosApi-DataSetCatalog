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
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { DatasetListItem, Paginated, SourceEntity } from '@datosapi/common';

import { withMongoId } from '../common/presenters/mongo-id';
import type { WithMongoId } from '../common/presenters/mongo-id';
import {
  CreateSourceDto,
  ListSourcesQueryDto,
  PaginationQueryDto,
  UpdateSourceDto,
} from './dto/sources.dto';
import type { IngestOutcome } from './sources.service';
import { SourcesService } from './sources.service';

@ApiTags('sources')
@Controller('sources')
export class SourcesController {
  constructor(private readonly sourcesService: SourcesService) {}

  @Post()
  @ApiOperation({
    summary: 'Registra una fuente',
    description:
      'No dispara la ingesta: registro e ingesta son pasos separados y explícitos ' +
      '(api-contract.md §3). Un `config` que no corresponde al `type` devuelve `400`.',
  })
  @ApiCreatedResponse({ description: 'Fuente creada con `status: pending`.' })
  async create(@Body() dto: CreateSourceDto): Promise<WithMongoId<SourceEntity>> {
    return withMongoId(await this.sourcesService.create(dto));
  }

  @Get()
  @ApiOperation({ summary: 'Lista las fuentes' })
  @ApiOkResponse({ description: 'Página de fuentes con su `meta` de paginación.' })
  async findAll(
    @Query() query: ListSourcesQueryDto,
  ): Promise<Paginated<WithMongoId<SourceEntity>>> {
    const page = await this.sourcesService.findAll(query);

    return { ...page, data: page.data.map(withMongoId) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de una fuente, con su `config` incluido' })
  @ApiOkResponse({ description: 'La fuente solicitada.' })
  async findOne(@Param('id') id: string): Promise<WithMongoId<SourceEntity>> {
    return withMongoId(await this.sourcesService.findOne(id));
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Actualización parcial de una fuente',
    description:
      'No cambia el `type`: hacerlo alteraría la semántica del `config`. Para cambiarla hay ' +
      'que crear otra fuente (api-contract.md §3).',
  })
  @ApiOkResponse({ description: 'La fuente actualizada.' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSourceDto,
  ): Promise<WithMongoId<SourceEntity>> {
    return withMongoId(await this.sourcesService.update(id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Baja lógica de una fuente',
    description: 'No borra los datasets, que pueden estar publicados.',
  })
  @ApiNoContentResponse({ description: 'Fuente dada de baja.' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.sourcesService.remove(id);
  }

  @Post(':id/ingest')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Dispara la ingesta de una fuente',
    description:
      'El trabajo ocurre en el request, pero el contrato es asíncrono para no atar al cliente ' +
      'a la duración. Reingerar crea `version + 1` y no pisa el dataset anterior.',
  })
  @ApiAcceptedResponse({ description: 'Dataset creado con los datos ya normalizados.' })
  ingest(@Param('id') id: string): Promise<IngestOutcome> {
    return this.sourcesService.ingest(id);
  }

  @Get(':id/datasets')
  @ApiOperation({ summary: 'Lista los datasets de una fuente, versión descendente' })
  @ApiOkResponse({ description: 'Página de datasets sin las filas.' })
  async listDatasets(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<WithMongoId<DatasetListItem>>> {
    const page = await this.sourcesService.listDatasets(id, {
      page: query.page,
      limit: query.limit,
    });

    return { ...page, data: page.data.map(withMongoId) };
  }
}