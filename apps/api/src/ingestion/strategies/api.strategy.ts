import { Injectable } from '@nestjs/common';

import { SourceType } from '@datosapi/common';
import type { ApiSourceConfig, IngestResult, SourceConfig } from '@datosapi/common';

import { SourceConfigInvalidError, UnprocessableContentError } from '../errors/ingestion.errors';
import { Downloader } from '../helpers/downloader';
import { assertConfig, parseJsonPayload, resolveJsonPath } from '../helpers/json-payload';
import type { IngestContext, IngestStrategy } from '../ingestion.types';
import { headersFromRows, normalizeTable } from '../normalization/tabular-normalizer';
import type { RawRow } from '../normalization/tabular-normalizer';

function isApiConfig(config: SourceConfig): config is ApiSourceConfig {
  if (!('url' in config) || !('method' in config)) return false;

  return (
    typeof config.url === 'string' &&
    config.url.length > 0 &&
    (config.method === 'GET' || config.method === 'POST')
  );
}

/**
 * API JSON externa (ingestion.md §4.2).
 *
 * El `jsonPath` se resuelve segmento por segmento y el body debe terminar en un array: un
 * objeto único se trata como error `422` porque la ingesta necesita filas, y adivinar qué
 * clave del objeto es "la tabla" sería inventar el schema.
 */
@Injectable()
export class ApiIngestStrategy implements IngestStrategy {
  readonly type = SourceType.API;

  constructor(private readonly downloader: Downloader) {}

  validateConfig(config: SourceConfig): void {
    assertConfig(config, isApiConfig, SourceType.API);

    let parsed: URL;
    try {
      parsed = new URL(config.url);
    } catch {
      throw new SourceConfigInvalidError(`'${config.url}' no es una URL válida`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new SourceConfigInvalidError(`Sólo se admiten http/https, no '${parsed.protocol}'`);
    }
  }

  async ingest(config: SourceConfig, ctx: IngestContext): Promise<IngestResult> {
    this.validateConfig(config);

    const api = config as ApiSourceConfig;
    const startedAt = Date.now();

    const { body: buffer, contentType } = await this.downloader.download(
      {
        url: api.url,
        method: api.method,
        ...(api.body === undefined ? {} : { body: api.body }),
        ...(api.requestHeaders === undefined ? {} : { requestHeaders: api.requestHeaders }),
      },
      ctx,
    );

    const parsed = parseJsonPayload(buffer, contentType);
    const resolved = resolveJsonPath(parsed, api.jsonPath);

    if (!Array.isArray(resolved)) {
      throw new UnprocessableContentError(
        `La respuesta de '${api.url}' no es un array${api.jsonPath ? ` en '${api.jsonPath}'` : ''}`,
        { resolvedType: resolved === null ? 'null' : typeof resolved },
      );
    }

    if (resolved.length === 0) {
      throw new UnprocessableContentError(`La respuesta de '${api.url}' es un array vacío`);
    }

    const rows = resolved as RawRow[];
    const table = normalizeTable(headersFromRows(rows), rows, { source: 'api' });

    return {
      rows: table.rows,
      schema: table.schema,
      warnings: table.warnings,
      meta: {
        method: 'api-json',
        sourceUrl: api.url,
        contentType,
        bytes: buffer.byteLength,
        fetchedAt: new Date(),
        rawRowCount: rows.length,
        durationMs: Date.now() - startedAt,
      },
    };
  }
}
