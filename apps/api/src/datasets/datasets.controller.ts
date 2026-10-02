import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type {
  ColumnSchema,
  DatasetDetail,
  DatasetEntity,
  DatasetListItem,
  Paginated,
} from '@datosapi/common';

import { withMongoId } from '../common/presenters/mongo-id';
import type { WithMongoId } from '../common/presenters/mongo-id';
import { DatasetsService } from './datasets.service';
import { DatasetDetailQueryDto, isFullRequested, ListDatasetsQueryDto } from './dto/datasets.dto';

@ApiTags('datasets')
@Controller('datasets')
export class DatasetsController {
  constructor(private readonly datasetsService: DatasetsService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista los datasets',
    description: 'Sin `rows`: el catálogo se lee en conjunto y las filas se piden por detalle.',
  })
  @ApiOkResponse({ description: 'Página de datasets con su `meta` de paginación.' })
  async findAll(
    @Query() query: ListDatasetsQueryDto,
  ): Promise<Paginated<WithMongoId<DatasetListItem>>> {
    const page = await this.datasetsService.findAll(query);

    return { ...page, data: page.data.map(withMongoId) };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Detalle de un dataset con sus filas',
    description:
      'Por defecto devuelve un preview de `PREVIEW_ROWS` filas y `meta.previewTruncated` ' +
      'indica si vino recortado. `?full=true` devuelve todo si `rowCount <= INGEST_MAX_ROWS`.',
  })
  @ApiOkResponse({ description: 'El dataset con `rows` y `meta.previewTruncated`.' })
  async findOne(
    @Param('id') id: string,
    @Query() query: DatasetDetailQueryDto,
  ): Promise<WithMongoId<DatasetDetail>> {
    return withMongoId(
      await this.datasetsService.findOne(id, { full: isFullRequested(query.full) }),
    );
  }

  @Get(':id/schema')
  @ApiOperation({
    summary: 'Sólo el `schema` del dataset',
    description: 'Es lo que consume el panel para construir tabla, filtros y validaciones.',
  })
  @ApiOkResponse({ description: 'Los `ColumnSchema[]` del dataset.' })
  async getSchema(@Param('id') id: string): Promise<{ schema: ColumnSchema[] }> {
    return { schema: await this.datasetsService.getSchema(id) };
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Publica un dataset',
    description:
      '`draft` → `published`. No es reversible: para corregir datos se reingiere y se publica ' +
      'la versión nueva (data-model.md §3.1 regla 4).',
  })
  @ApiOkResponse({ description: 'El dataset publicado, con `publishedAt`.' })
  @ApiConflictResponse({ description: 'El dataset ya estaba `published` o `archived`.' })
  async publish(@Param('id') id: string): Promise<WithMongoId<DatasetEntity>> {
    return withMongoId(await this.datasetsService.publish(id));
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Archiva un dataset',
    description: '`published` → `archived`. Los endpoints que lo apuntan pasan a `422`.',
  })
  @ApiOkResponse({ description: 'El dataset archivado.' })
  @ApiConflictResponse({ description: 'El dataset no estaba `published`.' })
  async archive(@Param('id') id: string): Promise<WithMongoId<DatasetEntity>> {
    return withMongoId(await this.datasetsService.archive(id));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Archiva un dataset',
    description: 'Alias de `POST /datasets/:id/archive`. Nunca borra datos (data-model.md §5).',
  })
  @ApiNoContentResponse({ description: 'Dataset archivados.' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.datasetsService.archive(id);
  }
}
