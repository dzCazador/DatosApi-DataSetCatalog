import { Injectable } from '@nestjs/common';

import { SourceType } from '@datosapi/common';
import type { IngestResult, SourceConfig, UrlSourceConfig } from '@datosapi/common';

import { UnprocessableContentError, UnsupportedMediaTypeError } from '../errors/ingestion.errors';
import { Downloader } from '../helpers/downloader';
import { assertConfig, parseJsonPayload } from '../helpers/json-payload';
import type { IngestContext, IngestStrategy } from '../ingestion.types';
import { headersFromRows, normalizeTable } from '../normalization/tabular-normalizer';
import type { RawRow } from '../normalization/tabular-normalizer';
import { extractPdfTable } from '../pdf/pdf-table-extractor';
import { parseCsvTable } from './csv-table';
import { assertHttpUrl } from './pdf.strategy';

function isUrlConfig(config: SourceConfig): config is UrlSourceConfig {
  if (!('url' in config)) return false;

  const url = config as Partial<UrlSourceConfig>;

  return (
    typeof url.url === 'string' &&
    url.url.length > 0 &&
    (url.contentTypeHint === undefined || typeof url.contentTypeHint === 'string')
  );
}

/** Qué se resolvió para este cuerpo, según el despacho de ingestion.md §4.3. */
type Dispatch = 'pdf' | 'json' | 'csv';

/**
 * `content-type` → tipo de cuerpo. `text/plain` cae en `csv` porque ingestion.md §4.3 lo pide
 * como "intentar CSV"; si no parsea, el `422` del parseo explica mejor que un `415`.
 *
 * El orden dentro de cada lista es el orden de preferencia cuando un mismo valor puede llevar a
 * más de un tipo, y las listas vacías son valores que no dicen nada del tipo real.
 */
const MIME_CANDIDATES = new Map<string, readonly Dispatch[]>([
  ['application/pdf', ['pdf']],
  ['application/x-pdf', ['pdf']],
  ['application/acrobat', ['pdf']],
  ['application/json', ['json']],
  ['text/json', ['json']],
  ['application/ld+json', ['json']],
  ['text/csv', ['csv']],
  ['application/csv', ['csv']],
  ['text/plain', ['csv']],
  ['text/markdown', ['csv']],
]);

const EXTENSION_CANDIDATES = new Map<string, readonly Dispatch[]>([
  ['pdf', ['pdf']],
  ['json', ['json']],
  ['geojson', ['json']],
  ['csv', ['csv']],
  ['tsv', ['csv']],
  ['txt', ['csv']],
]);

/** Sin tipo reconocible el `415` lleva el content-type recibido, que es lo que hay que corregir. */
function fail(contentType: string): never {
  throw new UnsupportedMediaTypeError(contentType || 'desconocido');
}

/**
 * Descarga con despacho por content-type (ingestion.md §4.3).
 *
 * La corporalidad es de `url` y no de cada estrategia: la URL y la descarga son las mismas en
 * los cuatro casos y lo único que cambia es quién parsea el cuerpo. Por eso el despacho ocurre
 * **una sola vez**, sobre los bytes ya bajados, y las tres ramas delegan en los mismos módulos
 * que usan `pdf`, `api` y `manual` (§5: lógica compartida, no código duplicado).
 */
@Injectable()
export class UrlIngestStrategy implements IngestStrategy {
  readonly type = SourceType.URL;

  constructor(private readonly downloader: Downloader) {}

  validateConfig(config: SourceConfig): void {
    assertConfig(config, isUrlConfig, SourceType.URL);
    assertHttpUrl(config.url);
  }

  async ingest(config: SourceConfig, ctx: IngestContext): Promise<IngestResult> {
    this.validateConfig(config);
    const url = config as UrlSourceConfig;
    const startedAt = Date.now();

    const { body, contentType } = await this.downloader.download(
      {
        url: url.url,
        ...(url.requestHeaders === undefined ? {} : { requestHeaders: url.requestHeaders }),
      },
      ctx,
    );

    const dispatch = this.resolveDispatch(url, contentType);
    const result =
      dispatch === 'pdf'
        ? await this.ingestPdf(body)
        : dispatch === 'json'
          ? this.ingestJson(body, contentType)
          : this.ingestCsv(body, contentType);

    return {
      ...result,
      meta: {
        ...result.meta,
        method: `url-${dispatch}`,
        sourceUrl: url.url,
        contentType,
        bytes: body.byteLength,
        fetchedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    };
  }

  /**
   * Decide el tipo del cuerpo. El `content-type` manda cuando el origen lo manda bien; el
   * `contentTypeHint` del config y la extensión de la URL son el respaldo para orígenes que
   * responden `application/octet-stream` o nada, que es lo habitual en downloads de PDF.
   */
  private resolveDispatch(config: UrlSourceConfig, contentType: string): Dispatch {
    const candidates = [
      ...(MIME_CANDIDATES.get(contentType.split(';')[0]!.trim().toLowerCase()) ?? []),
      ...(MIME_CANDIDATES.get((config.contentTypeHint ?? '').split(';')[0]!.trim().toLowerCase()) ??
        []),
      ...(EXTENSION_CANDIDATES.get(extensionOf(config.url)) ?? []),
    ];

    return candidates[0] ?? fail(contentType);
  }

  private async ingestPdf(body: Buffer): Promise<IngestResult> {
    const extraction = await extractPdfTable(body, {});

    return {
      rows: extraction.rows,
      schema: extraction.schema,
      warnings: extraction.warnings,
      meta: {
        method: 'url-pdf',
        pageCount: extraction.pageCount,
        tableCount: extraction.tableCount,
        rawRowCount: extraction.rows.length,
      },
    };
  }

  /** Misma normalización que `api` (ingestion.md §4.3): un array de objetos, sin `jsonPath`. */
  private ingestJson(body: Buffer, contentType: string): IngestResult {
    const parsed = parseJsonPayload(body, contentType);

    // Sin `jsonPath` no hay forma de saber qué clave del objeto es "la tabla": adivinarla sería
    // inventar el schema, así que un objeto donde se espera un array es `422`.
    if (!Array.isArray(parsed)) {
      throw new UnprocessableContentError('La respuesta descargada no es un array', {
        resolvedType: parsed === null ? 'null' : typeof parsed,
      });
    }

    if (parsed.length === 0) {
      throw new UnprocessableContentError('La respuesta descargada es un array vacío');
    }

    const rows = parsed as RawRow[];
    const table = normalizeTable(headersFromRows(rows), rows, { source: 'url' });

    return {
      rows: table.rows,
      schema: table.schema,
      warnings: table.warnings,
      meta: { method: 'url-json', rawRowCount: rows.length },
    };
  }

  private ingestCsv(body: Buffer, contentType: string): IngestResult {
    // `text/plain` se intenta como CSV y si no parsea queda `422` con el motivo del parseo, que
    // es más útil que un `415`: el origen sí respondió y sí era texto (ingestion.md §4.3).
    const table = parseCsvTable(body.toString('utf8'), { source: 'url', subject: contentType });

    return {
      rows: table.rows,
      schema: table.schema,
      warnings: table.warnings,
      meta: { method: 'url-csv', rawRowCount: table.rows.length },
    };
  }
}

function extensionOf(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0] ?? '';
  const last = withoutQuery.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');

  if (dot <= 0) return '';

  return last.slice(dot + 1).toLowerCase();
}
