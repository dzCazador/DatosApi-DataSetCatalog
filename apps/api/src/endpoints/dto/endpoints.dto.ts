import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

import { FilterOperator } from '@datosapi/common';
import type { SortDirection } from '@datosapi/common';

import { PaginationQueryDto } from '../../sources/dto/sources.dto';

/**
 * `filters[]` de una `EndpointDefinition` (api-contract.md §5).
 *
 * El allowlist completo vive acá: lo que no esté en esta lista devuelve `400
 * FILTER_NOT_ALLOWED` al consultar, nunca se ignora. Por eso el `field` se valida contra el
 * patrón de una clave de columna y no contra el schema en el DTO: el schema se resuelve
 * recién en el service, contra el dataset real.
 */
export class FilterDefDto {
  @ApiProperty({
    description: 'Clave de la columna a filtrar. Debe existir en el schema del dataset.',
    example: 'importe_desde',
  })
  @IsString()
  @Matches(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, {
    message: 'El field del filtro debe ser una clave de columna en snake_case',
  })
  field: string;

  @ApiProperty({
    description:
      'Semántica del filtro. El valor del query se castea al tipo de la columna antes de ' +
      'comparar, así que un `gte` sobre una columna `number` espera un número.',
    enum: FilterOperator,
    example: FilterOperator.GTE,
  })
  @IsEnum(FilterOperator)
  op: FilterOperator;

  @ApiPropertyOptional({
    description: 'Si es `true`, omitir el parámetro en el query es `400 FILTER_NOT_ALLOWED`.',
  })
  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

/** `sort[]` de una `EndpointDefinition`. Mismo criterio que `filters[]`: allowlist. */
export class SortDefDto {
  @ApiProperty({
    description: 'Clave de la columna por la que se puede ordenar.',
    example: 'importe_desde',
  })
  @IsString()
  @Matches(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, {
    message: 'El field del sort debe ser una clave de columna en snake_case',
  })
  field: string;

  @ApiProperty({ enum: ['asc', 'desc'], example: 'asc' })
  @IsIn(['asc', 'desc'])
  dir: SortDirection;
}

/**
 * `POST /api/v1/endpoints` (api-contract.md §5).
 *
 * El `slug` se valida en el service y no con `@Matches` para que el código de error sea
 * `SLUG_INVALID` y no el `VALIDATION_ERROR` genérico: el cliente ramifica con `code`, y
 * "tu slug tiene mayúsculas" es un mensaje distinto del que recibe al mandar un body con un
 * campo desconocido.
 */
export class CreateEndpointDto {
  @ApiProperty({
    description: 'Nombre visible del endpoint.',
    example: 'Escala de Retención Ganancias 4ª Categoría',
  })
  @IsString()
  @Length(1, 200)
  name: string;

  @ApiProperty({
    description:
      'Identificador público en la URL. Se valida contra `^[a-z0-9]+(-[a-z0-9]+)*$`, 3–80.',
    example: 'escala-retencion-4ta-categoria',
  })
  @IsString()
  @Length(3, 80)
  slug: string;

  @ApiPropertyOptional({
    description: 'Descripción libre.',
    example: 'Tramos y alícuotas, jul-dic 2026',
  })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @ApiProperty({
    description: 'Source a la que pertenece la definición.',
    example: '66f0a1b2c3d4e5f607182930',
  })
  @IsString()
  sourceId: string;

  @ApiPropertyOptional({
    description:
      'Dataset a servir. Obligatorio si `followLatest` es `false`; con `followLatest: true` ' +
      'se usa el último `published` de la `sourceId` y este campo es opcional.',
  })
  @IsOptional()
  @IsString()
  datasetId?: string;

  @ApiPropertyOptional({
    description:
      'Si es `true`, sigue la última versión `published` de la `sourceId` sin tocar la definición.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  followLatest = false;

  @ApiPropertyOptional({
    description:
      'Proyección por defecto. Si se declara, `?fields=` sólo puede pedir un subconjunto: ' +
      'es un override de la proyección, no un escape del allowlist.',
    type: [String],
    example: ['tramo', 'importe_desde', 'alicuota'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  fields?: string[];

  @ApiPropertyOptional({
    description: 'Allowlist de filtros. Un parámetro fuera de esta lista devuelve `400`.',
    type: [FilterDefDto],
    example: [{ field: 'importe_desde', op: 'gte' }],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FilterDefDto)
  filters?: FilterDefDto[];

  @ApiPropertyOptional({
    description:
      'Allowlist de columnas por las que se puede ordenar. `sort=` fuera de esta lista devuelve `400`.',
    type: [SortDefDto],
    example: [{ field: 'importe_desde', dir: 'asc' }],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SortDefDto)
  sort?: SortDefDto[];

  @ApiPropertyOptional({
    description:
      'Cantidad de filas por página cuando el query no manda `limit`. Si se omite se usa ' +
      '`DEFAULT_LIMIT`. El `ValidationPipe` no puede aplicar el tope porque viene de la ' +
      'configuración: lo valida el service.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  defaultLimit?: number;

  @ApiPropertyOptional({
    description:
      'Tope de `limit` para este endpoint. Un `limit` mayor devuelve `400 INVALID_PAGINATION`: ' +
      'no se clampa. Si se omite se usa `MAX_LIMIT`, y nunca puede superarlo.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxLimit?: number;

  @ApiPropertyOptional({
    description: 'Si es `false`, `GET /e/{slug}` devuelve `404 SLUG_NOT_FOUND`.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled = true;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * `PATCH /api/v1/endpoints/:id` (api-contract.md §5).
 *
 * El `slug` está ausente a propósito y `forbidNonWhitelisted` lo convierte en `400`: cambiar
 * el slug rompería las URLs ya publicadas, y para eso se crea otro endpoint.
 */
export class UpdateEndpointDto {
  @ApiPropertyOptional({ description: 'Nuevo nombre.' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional({ description: 'Nueva descripción.' })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @ApiPropertyOptional({ description: 'Otro dataset a servir.' })
  @IsOptional()
  @IsString()
  datasetId?: string;

  @ApiPropertyOptional({
    description: 'Si es `true`, sigue el último `published` de la `sourceId`.',
  })
  @IsOptional()
  @IsBoolean()
  followLatest?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'Nueva proyección por defecto.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  fields?: string[];

  @ApiPropertyOptional({ type: [FilterDefDto], description: 'Nuevo allowlist de filtros.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FilterDefDto)
  filters?: FilterDefDto[];

  @ApiPropertyOptional({ type: [SortDefDto], description: 'Nuevo allowlist de orden.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SortDefDto)
  sort?: SortDefDto[];

  @ApiPropertyOptional({
    minimum: 1,
    description: 'Si se omite se conserva el `defaultLimit` actual.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  defaultLimit?: number;

  @ApiPropertyOptional({ minimum: 1, description: 'Si se omite se conserva el `maxLimit` actual.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxLimit?: number;

  @ApiPropertyOptional({ description: 'Habilita o deshabilita el endpoint público.' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * Filtros de `GET /endpoints` (api-contract.md §5). `enabled` viene como `string` por el
 * mismo motivo que `?full` en datasets (ver `DatasetDetailQueryDto`): con
 * `enableImplicitConversion` un `boolean` se convierte con `Boolean(valor)` y `?enabled=false`
 * filtraría por `true`. Los valores fuera del conjunto son `400` en vez de una decisión en
 * silencio.
 */
const BOOLEAN_VALUES = ['true', 'false', '1', '0'] as const;

export class ListEndpointsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filtra por una source concreta.',
    example: '66f0a1b2c3d4e5f607182930',
  })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiPropertyOptional({
    description: 'Filtra por estado del endpoint.',
    enum: BOOLEAN_VALUES,
  })
  @IsOptional()
  @IsIn(BOOLEAN_VALUES)
  enabled?: (typeof BOOLEAN_VALUES)[number];
}

export function isEnabledRequested(value: ListEndpointsQueryDto['enabled']): boolean | undefined {
  if (value === undefined) return undefined;

  return value === 'true' || value === '1';
}
