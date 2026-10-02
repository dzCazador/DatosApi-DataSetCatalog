import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';

import { DatasetStatus } from '@datosapi/common';

import { PaginationQueryDto } from '../../sources/dto/sources.dto';

/**
 * Filtros de `GET /datasets` (api-contract.md §4). Se extiende el DTO de paginación de
 * sources en vez de duplicarlo: los defaults (`page: 1`, `limit: 50`) y el tope
 * `MAX_PAGE_SIZE` son los mismos en todos los listados de administración.
 */
export class ListDatasetsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filtra por una source concreta.',
    example: '66f0a1b2c3d4e5f60718293a',
  })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiPropertyOptional({ enum: DatasetStatus, description: 'Filtra por estado del dataset.' })
  @IsOptional()
  @IsEnum(DatasetStatus)
  status?: DatasetStatus;
}

/** Valores que `?full` admite (api-contract.md §4). */
const FULL_VALUES = ['true', 'false', '1', '0'] as const;

/**
 * `?full=true` de `GET /datasets/:id` (api-contract.md §4).
 *
 * Se declara como `string` y no como `boolean` a propósito. Con
 * `enableImplicitConversion: true` (conventions.md §3), un campo cuyo `design:type` es
 * `Boolean` se convierte con `Boolean(valor)`, así que `?full=false`, `?full=0` y hasta
 * `?full=no` llegaban como `true` y devolvían el dataset entero. El `@Transform` explícito no
 * lo evita: la conversión implícita corre antes. Leyendo el string y decidiendo acá, el
 * comportamiento es el que dice el contrato y no el que dice `Boolean()`.
 *
 * Un valor fuera del conjunto es `400 VALIDATION_ERROR`: no tiene sentido aceptar `?full` y
 * decidir en silencio qué quiso decir el cliente.
 */
export class DatasetDetailQueryDto {
  @ApiPropertyOptional({
    description:
      'Devuelve todas las filas en lugar del preview. Sólo se honra si `rowCount <= ' +
      'INGEST_MAX_ROWS`.',
    enum: FULL_VALUES,
  })
  @IsOptional()
  @IsIn(FULL_VALUES)
  full?: (typeof FULL_VALUES)[number];
}

/** `?full` como boolean, con una sola fuente de verdad sobre qué string es "sí". */
export function isFullRequested(value: DatasetDetailQueryDto['full']): boolean {
  return value === 'true' || value === '1';
}
