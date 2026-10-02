import { Injectable } from '@nestjs/common';

import { SourceType } from '@datosapi/common';
import type { IngestResult, ManualSourceConfig, SourceConfig } from '@datosapi/common';

import { SourceConfigInvalidError, UnprocessableContentError } from '../errors/ingestion.errors';
import { assertConfig } from '../helpers/json-payload';
import type { IngestContext, IngestStrategy } from '../ingestion.types';
import { flattenJson, headersFromRows, normalizeTable } from '../normalization/tabular-normalizer';
import type { RawRow } from '../normalization/tabular-normalizer';
import { parseCsvTable } from './csv-table';

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
    const table = parseCsvTable(config.payload, {
      source: 'manual',
      subject: 'El payload CSV',
      hasHeaderRow: config.hasHeaderRow ?? true,
      ...(config.delimiter === undefined ? {} : { delimiter: config.delimiter }),
    });

    return {
      rows: table.rows,
      schema: table.schema,
      warnings: table.warnings,
      meta: {
        method: 'csv-parse',
        rawRowCount: table.rows.length,
        durationMs: elapsed(ctx),
      },
    };
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