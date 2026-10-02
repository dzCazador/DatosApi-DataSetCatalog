import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';

import { SourceType } from '@datosapi/common';
import type { IngestResult, PdfSourceConfig, SourceConfig } from '@datosapi/common';

import { SourceConfigInvalidError } from '../errors/ingestion.errors';
import { Downloader } from '../helpers/downloader';
import { assertConfig } from '../helpers/json-payload';
import type { IngestContext, IngestStrategy } from '../ingestion.types';
import { extractPdfTable } from '../pdf/pdf-table-extractor';

export function isPdfConfig(config: SourceConfig): config is PdfSourceConfig {
  if (!('url' in config)) return false;

  const pdf = config as Partial<PdfSourceConfig>;

  return (
    typeof pdf.url === 'string' &&
    pdf.url.length > 0 &&
    (pdf.tableIndex === undefined || Number.isInteger(pdf.tableIndex)) &&
    (pdf.pages === undefined ||
      (Array.isArray(pdf.pages) &&
        pdf.pages.every((page) => Number.isInteger(page) && page > 0))) &&
    (pdf.headerHints === undefined ||
      (Array.isArray(pdf.headerHints) && pdf.headerHints.every((hint) => typeof hint === 'string')))
  );
}

/**
 * Valida la URL de una fuente que descarga un archivo: la comparte `api`, `url` y `pdf`
 * (ingestion.md §4.2 y §4.4). Sólo `http`/`https`: un `file://` sería leer el disco del
 * servidor desde un dato de usuario.
 */
export function assertHttpUrl(url: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new SourceConfigInvalidError(`'${url}' no es una URL válida`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SourceConfigInvalidError(`Sólo se admiten http/https, no '${parsed.protocol}'`);
  }

  return parsed;
}

export interface PdfIngestOptions {
  pages?: number[];
  tableIndex?: number;
  headerHints?: string[];
}

/**
 * Ingesta PDF (ingestion.md §4.4): descarga con timeout y límite de tamaño, persiste el binario
 * para trazabilidad y extrae la tabla por coordenadas.
 *
 * El `tableIndex` es el índice de la tabla **dentro del PDF**, y lo recibe `extractPdfTable`.
 * El default es la primera tabla útil, que es la que un usuario espera al no saber cuántas hay;
 * en el PDF de AFIP es la escala del Art. 94 de la primera página.
 */
@Injectable()
export class PdfIngestStrategy implements IngestStrategy {
  readonly type = SourceType.PDF;

  constructor(private readonly downloader: Downloader) {}

  validateConfig(config: SourceConfig): void {
    assertConfig(config, isPdfConfig, SourceType.PDF);
    assertHttpUrl(config.url);
  }

  async ingest(config: SourceConfig, ctx: IngestContext): Promise<IngestResult> {
    this.validateConfig(config);
    const pdf = config as PdfSourceConfig;
    const startedAt = Date.now();

    const { body, contentType } = await this.downloader.download(
      {
        url: pdf.url,
        ...(pdf.requestHeaders === undefined ? {} : { requestHeaders: pdf.requestHeaders }),
      },
      ctx,
    );

    await this.persist(body, ctx);

    const extraction = await extractPdfTable(body, {
      ...(pdf.pages === undefined ? {} : { pages: pdf.pages }),
      ...(pdf.tableIndex === undefined ? {} : { tableIndex: pdf.tableIndex }),
      ...(pdf.headerHints === undefined ? {} : { headerHints: pdf.headerHints }),
    });

    return {
      rows: extraction.rows,
      schema: extraction.schema,
      warnings: extraction.warnings,
      meta: {
        method: 'pdfjs-text-coords',
        sourceUrl: pdf.url,
        contentType,
        bytes: body.byteLength,
        fetchedAt: new Date(),
        pageCount: extraction.pageCount,
        tableCount: extraction.tableCount,
        rawRowCount: extraction.rows.length,
        durationMs: Date.now() - startedAt,
      },
    };
  }

  /**
   * Guarda el binario en `STORAGE_DIR/<sourceId>/<timestamp>.pdf` (ingestion.md §4.4).
   *
   * El directorio lleva el id de la source para que el archivo sea atribuible, y `storage/`
   * está en `.gitignore`: el PDF nunca se commitea.
   *
   * Un fallo al guardar **no** aborta la ingesta: la fuente ya se descargó y el dataset es
   * válido, y perder el archivo de trazabilidad es menos grave que perder la ingesta entera.
   */
  private async persist(body: Buffer, ctx: IngestContext): Promise<void> {
    const directory = join(ctx.storageDir, ctx.sourceId);

    try {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, `${ctx.now.toISOString().replace(/[:.]/g, '-')}.pdf`), body);
    } catch {
      // Se deja constancia en los logs del proceso, no en el dataset: el dataset no lleva
      // campos para eso y agrega un warning por un problema de infraestructura local.
    }
  }
}
