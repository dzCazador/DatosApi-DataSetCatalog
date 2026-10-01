import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsObject, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import { SourceStatus, SourceType } from '@datosapi/common';

/** Tope del `limit` de los listados de administración; el endpoint dinámico usa `MAX_LIMIT`. */
export const MAX_PAGE_SIZE = 200;

/**
 * `config` viaja como objeto opaco a propósito: su forma depende del `type` y la valida la
 * strategy correspondiente (`IngestorFactory.validateConfig`), que es donde viven las reglas
 * de negocio. Un `@ValidateNested` por variante convertiría el DTO en una copia del tipo que
 * puede desincronizarse sin que nadie se entere.
 *
 * La alternativa —un DTO por tipo con discriminated union— no se usa porque los DTOs de
 * `class-validator` noachmentan discriminantes: el `type` llega en otro campo del mismo body
 * y `POST /sources` acepta el par entero.
 */
export class CreateSourceDto {
  @ApiProperty({
    description: "Origen de los datos. Determina la forma del `config` y la strategy de ingesta.",
    enum: SourceType,
    example: SourceType.MANUAL,
  })
  @IsEnum(SourceType)
  type: SourceType;

  @ApiProperty({ description: 'Nombre de la fuente.', example: 'Listado interno — prueba' })
  @IsString()
  @Length(1, 200)
  name: string;

  @ApiPropertyOptional({
    description: 'Descripción libre del origen.',
    example: 'Publicación semestral de AFIP (Art. 94 LIG)',
  })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @ApiProperty({
    description:
      'Configuración del origen. La forma depende de `type`: `manual` exige ' +
      '`format` (`json`|`csv`) y `payload`; `api` exige `url` y `method`.',
    type: 'object',
    additionalProperties: true,
    example: {
      format: 'csv',
      hasHeaderRow: true,
      payload: 'codigo,descripcion,activo\nA01,Producto A,true',
    },
  })
  @IsObject()
  config: Record<string, unknown>;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Datos libres del usuario; no intervienen en la ingesta.',
    example: { organismo: 'AFIP', vigencia: '2026-07-01/2026-12-31' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * Actualización parcial (api-contract.md §3). `type` está ausente a propósito: cambiarlo
 * alteraría la semántica del `config` sin invalidarlo, y el contrato obliga a crear otra
 * fuente. `forbidNonWhitelisted` hace que mandarlo sea `400 VALIDATION_ERROR` en vez de
 * ignorarse en silencio.
 */
export class UpdateSourceDto {
  @ApiPropertyOptional({ description: 'Nuevo nombre.', example: 'Listado interno (actualizado)' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional({ description: 'Nueva descripción.' })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Nuevo config. Debe seguir correspondiendo al `type` de la fuente.',
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

class PaginationParams {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit = 50;
}

/** Filtros de `GET /sources` (api-contract.md §3). */
export class ListSourcesQueryDto extends PaginationParams {
  @ApiPropertyOptional({ enum: SourceType })
  @IsOptional()
  @IsEnum(SourceType)
  type?: SourceType;

  @ApiPropertyOptional({ enum: ['pending', 'processing', 'ready', 'error'] })
  @IsOptional()
  @IsEnum(SourceStatus)
  status?: SourceStatus;
}

/** Sólo paginación: `GET /sources/:id/datasets` no filtra por status. */
export class PaginationQueryDto extends PaginationParams {}