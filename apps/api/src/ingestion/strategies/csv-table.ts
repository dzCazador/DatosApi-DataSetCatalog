import { parse } from 'csv-parse/sync';

import type { ColumnSchema } from '@datosapi/common';

import { UnprocessableContentError } from '../errors/ingestion.errors';
import { maxWidthOf, normalizeTable } from '../normalization/tabular-normalizer';
import type { NormalizedTable, RawCell, RawRow } from '../normalization/tabular-normalizer';

export interface CsvTableOptions {
  source: ColumnSchema['source'];
  /** Texto que aparece en los mensajes de error, para que la fuente quede identificada. */
  subject?: string;
  hasHeaderRow?: boolean;
  delimiter?: string;
}

/**
 * CSV posicional (ingestion.md §4.1 y §4.3). Lo comparten `manual` y `url`, que es lo que
 * §5 pide: una sola implementación de la normalización para todos los orígenes, y por lo tanto
 * un `schema` calculado siempre de la misma forma.
 *
 * Siempre posicional, nunca `columns: true`: con `columns: true` `csv-parse` se come la primera
 * fila como encabezado y deja los nombres fuera de alcance, y hace falta distinguir el
 * encabezado de los datos para avisar cuando una fila trae menos celdas.
 */
export function parseCsvTable(payload: string, options: CsvTableOptions): NormalizedTable {
  const hasHeaderRow = options.hasHeaderRow ?? true;
  const subject = options.subject ?? 'El payload CSV';

  let records: RawRow[];

  try {
    records = parse(payload, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      columns: false,
      ...(options.delimiter === undefined || options.delimiter.length === 0
        ? {}
        : { delimiter: options.delimiter }),
    }) as RawRow[];
  } catch (error) {
    throw new UnprocessableContentError(
      `invalid CSV: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const [first] = records;

  if (first === undefined) {
    throw new UnprocessableContentError(`${subject} no contiene filas de datos`);
  }

  const body = hasHeaderRow ? records.slice(1) : records;

  if (body.length === 0) {
    throw new UnprocessableContentError(
      hasHeaderRow
        ? `${subject} sólo contiene la fila de encabezado`
        : `${subject} no contiene filas de datos`,
    );
  }

  // Sin encabezado no hay nombres: `col_N` hasta el ancho de la fila más larga, que es lo que
  // evita perder las columnas del final.
  const headers = hasHeaderRow
    ? (first as readonly RawCell[]).map((cell) => String(cell ?? ''))
    : Array.from({ length: maxWidthOf(records) }, (_, index) => `col_${index + 1}`);

  const table = normalizeTable(headers, body, { source: options.source });

  return {
    rows: table.rows,
    schema: table.schema,
    warnings: [...columnMismatchWarnings(body, headers.length), ...table.warnings],
  };
}

/**
 * ingestion.md §4.4: una fila con menos celdas que el encabezado se completa con `null`
 * (data-model.md §3.1 regla 5) y se deja constancia en `warnings`.
 */
function columnMismatchWarnings(rows: readonly RawRow[], expected: number): string[] {
  const warnings: string[] = [];

  for (const [index, row] of rows.entries()) {
    if (Array.isArray(row) && row.length !== expected) {
      warnings.push(`row ${index + 1} had ${row.length} cells, expected ${expected}`);
    }
  }

  return warnings;
}
