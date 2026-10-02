import { Controller, Get, Headers, Param, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { DynamicService } from './dynamic.service';
import type { DynamicPayload } from './dynamic.service';

@ApiTags('e')
@Controller('e')
export class DynamicController {
  constructor(private readonly dynamicService: DynamicService) {}

  /**
   * `GET /api/v1/e/:slug` (api-contract.md §6). Único punto de acceso a los datos publicados.
   *
   * El `@Query()` va sin DTO a propósito: los parámetros son las columnas que la
   * `EndpointDefinition` habilitó y no se pueden declarar en una clase. El allowlist no lo
   * cumple el pipe —que no tiene nada que validar— sino `parseQuery`, que conoce la
   * definición. Sin esa separación, un `ValidationPipe` con `forbidNonWhitelisted` tiraría
   * `400` en el primer filtro legítimo y uno permisivo dejaría pasar cualquier columna.
   */
  @Get(':slug')
  @ApiOperation({
    summary: 'Consulta el dataset publicado detrás de un slug',
    description: [
      'El query se valida contra el allowlist de la `EndpointDefinition`:',
      '`page`, `limit`, `sort`, `fields` y las columnas de `filters[]`.',
      'Cualquier otro parámetro devuelve `400 FILTER_NOT_ALLOWED`.',
      '',
      'Respuesta con el ejemplo de la escala de retención de AFIP:',
      '',
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
      '    "total": 6,',
      '    "count": 6,',
      '    "page": 1,',
      '    "limit": 10,',
      '    "pages": 1,',
      '    "dataset": {',
      '      "id": "66f1…",',
      '      "version": 1,',
      '      "sourceId": "66f0…",',
      '      "updatedAt": "2026-01-15T12:00:00.000Z"',
      '    }',
      '  }',
      '}',
      '```',
    ].join('\n'),
  })
  @ApiOkResponse({
    description:
      'Página de filas con `meta.dataset`, que es lo que permite saber qué versión se está ' +
      'leyendo. `ETag` = hash de `datasetId + version + query`; `If-None-Match` devuelve `304`.',
  })
  async findOne(
    @Param('slug') slug: string,
    @Query() query: Record<string, unknown>,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DynamicPayload | undefined> {
    const result = await this.dynamicService.execute(slug, query);

    response.setHeader('ETag', result.etag);
    response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');

    // `304` con `ETag` y sin body: el cliente ya tiene la página y sólo necesita saber que
    // no cambió. Se decide acá y no en un interceptor porque el 304 depende del hash, que es
    // del service.
    if (matchesEtag(ifNoneMatch, result.etag)) {
      response.status(304);

      return undefined;
    }

    return result.payload;
  }
}

/**
 * Compara el `If-None-Match` con el `ETag` calculado. La cabecera admite lista y comodín, y
 * un `W/` débil: se ignoran los dos porque lo que se cachea acá son filas inmutables de un
 * dataset versionado, donde fuerte y débil significan lo mismo.
 */
function matchesEtag(ifNoneMatch: string | undefined, etag: string): boolean {
  if (ifNoneMatch === undefined) return false;

  const candidates = ifNoneMatch.split(',').map((candidate) => candidate.trim());

  return candidates.some(
    (candidate) => candidate === '*' || candidate.replace(/^W\//, '') === etag,
  );
}
