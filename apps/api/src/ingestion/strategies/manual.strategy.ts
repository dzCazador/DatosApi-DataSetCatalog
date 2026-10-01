import { parse } from 'csv-parse/sync';
import { Injectable } from '@nestjs/common';

import { SourceType } from '@datosapi/common';
import type { IngestResult, ManualSourceConfig, SourceConfig } from '@datosapi/common';

import { SourceConfigInvalidError, UnprocessableContentError } from '../errors/ingestion.errors';
import { assertConfig } from '../helpers/json-payload';
import type { IngestContext, IngestStrategy } from '../ingestion.types';
import {
  flattenJson,
  headersFromRows,
  maxWidthOf,
  normalizeTable,
} from '../normalization/tabular-normalizer';
import type { RawCell, RawRow } from '../normalization/tabular-normalizer';

function isManualConfig(config: SourceConfig): config is ManualSourceConfig {
  if (!('format' in config) || !('payload' in config)) return false;

  return (config.format === 'json' || config.format === 'csv') && typeof config.payload === 'string';
}

/**
 * Carga manual (ingestion.md §4.1). Sin red: el payload vive en el `Source.config`.
 *
 * `json` acepta las tres formas que pega un usuario — array plano, objeto que envuelve un
 * array y objeto único — porque no puede saber de antemano con cuál va a cargar la tabla.
 */
@Injectable()
export class ManualIngestStrategy implements IngestStrategy {
  readonly type = SourceType.MANUAL;

  validateConfig(config: SourceConfig): void {
    assertConfig(config, isManualConfig, SourceType.MANUAL);

    if (config.payload.trim() === '') {
      throw new SourceConfigInvalidError(
        `El payload ${config.format.toUpperCase()} está vacío`,
      );
    }
  }

  async ingest(config: SourceConfig, ctx: IngestContext): Promise<IngestResult> {
    this.validateConfig(config);
    const manual = config as ManualSourceConfig;

    return manual.format === 'csv'
      ? this.ingestCsv(manual, ctx)
      : this.ingestJson(manual, ctx);
  }

  private ingestJson(config: ManualSourceConfig, ctx: IngestContext): IngestResult {
    let parsed: unknown;

    try {
      parsed = JSON.parse(config.payload) as unknown;
    } catch (error) {
      throw new UnprocessableContentError(
        `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const { rawRows, jsonKeys } = this.extractJsonRows(parsed);

    if (rawRows.length === 0) {
      throw new UnprocessableContentError('El payload JSON no contiene filas de datos');
    }

    const table = normalizeTable(headersFromRows(rawRows), rawRows, {
      source: 'manual',
      jsonKeys,
    });

    return {
      rows: table.rows,
      schema: table.schema,
      warnings: table.warnings,
      meta: {
        method: 'manual-json',
        rawRowCount: rawRows.length,
        durationMs: Date.now() - ctx.now.getTime(),
      },
    };
  }

  private ingestCsv(config: ManualSourceConfig, ctx: IngestContext): IngestResult {
    const hasHeaderRow = config.hasHeaderRow ?? true;

    let records: RawRow[];

    try {
      records = parse(config.payload, {
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        // Siempre posicional: con `columns: true` `csv-parse` se come la primera fila como
        // encabezado y deja los nombres fuera de alcance, y hace falta distinguir el
        // encabezado de los datos para avisar cuando una fila trae menos celdas.
        columns: false,
        ...(config.delimiter === undefined || config.delimiter.length === 0
          ? {}
          : { delimiter: config.delimiter }),
      }) as RawRow[];
    } catch (error) {
      throw new UnprocessableContentError(
        `invalid CSV: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const [first] = records;

    if (first === undefined) {
      throw new UnprocessableContentError('El payload CSV no contiene filas de datos');
    }

    const body = hasHeaderRow ? records.slice(1) : records;

    if (body.length === 0) {
      throw new UnprocessableContentError(
        hasHeaderRow
          ? 'El payload CSV sólo contiene la fila de encabezado'
          : 'El payload CSV no contiene filas de datos',
      );
    }

    // Sin encabezado no hay nombres: `col_N` hasta el ancho de la fila más larga, que es
    // lo que evita perder las columnas del final.
    const headers = hasHeaderRow
      ? (first as readonly RawCell[]).map((cell) => String(cell ?? ''))
      : Array.from({ length: maxWidthOf(records) }, (_, index) => `col_${index + 1}`);

    const warnings = hasHeaderRow ? this.warningsForColumnMismatch(body, headers.length) : [];
    const table = normalizeTable(headers, body, { source: 'manual' });

    return {
      rows: table.rows,
      schema: table.schema,
      warnings: [...warnings, ...table.warnings],
      meta: { method: 'csv-parse', rawRowCount: body.length, durationMs: elapsed(ctx) },
    };
  }

  /**
   * ingestion.md §4.4: una fila con menos celdas que el encabezado se completa con `null`
   * (data-model.md §3.1 regla 5) y se deja constancia en `warnings`.
   */
  private warningsForColumnMismatch(rows: RawRow[], expected: number): string[] {
    const warnings: string[] = [];

    for (const [index, row] of rows.entries()) {
      if (Array.isArray(row) && row.length !== expected) {
        warnings.push(`row ${index + 1} had ${row.length} cells, expected ${expected}`);
      }
    }

    return warnings;
  }

  /**
   * Extrae filas de las tres formas aceptadas y, además, qué claves eran en el JSON original
   * un array. `flattenJson` las serializa a texto, y sin este conjunto el normalizador las
   * degradaría a `string` perdiendo que eran datos estructurados.
   */
  private extractJsonRows(parsed: unknown): { rawRows: RawRow[]; jsonKeys: Set<string> } {
    if (Array.isArray(parsed)) {
      return { rawRows: this.toRecordRows(parsed), jsonKeys: this.collectArrayKeys(parsed) };
    }

    if (parsed === null || typeof parsed !== 'object') {
      throw new UnprocessableContentError(
        'El payload JSON debe ser un array de objetos o un objeto',
      );
    }

    const record = parsed as Record<string, unknown>;
    const wrapped = Object.values(record).find((value) => Array.isArray(value));

    // Objeto único → una fila: es el caso de pegarle a la API un registro suelto.
    if (wrapped === undefined) {
      return { rawRows: [flattenJson(record)], jsonKeys: new Set() };
    }

    return { rawRows: this.toRecordRows(wrapped), jsonKeys: this.collectArrayKeys(wrapped) };
  }

  private toRecordRows(values: unknown[]): RawRow[] {
    return values.map((value) =>
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? flattenJson(value as Record<string, unknown>)
        : { col_1: value },
    );
  }

  /** Sólo se marcan los arrays: los objetos anidados los aplana `flattenJson` en columnas. */
  private collectArrayKeys(values: unknown[]): Set<string> {
    const keys = new Set<string>();

    for (const value of values) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;

      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (Array.isArray(child)) keys.add(key);
      }
    }

    return keys;
  }
}

function elapsed(ctx: IngestContext): number {
  return Math.max(0, Date.now() - ctx.now.getTime());
}