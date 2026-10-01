import type { ColumnSchema, ColumnType, Row } from '@datosapi/common';

/**
 * Marcadores que una fuente escribe para expresar "sin dato". No es lo mismo que un `"0"`
 * ni que el texto `"No"` en una columna de texto (ingestion.md §6.3).
 */
const NULL_TOKENS = new Set(['', '-', '--', '—', '–', 'n/a', 'na', 'null', 'nan', 'sin dato']);

/** Verdaderos y falsos textuales. Sólo se aceptan enúsculas exactas para no pisar un "No" real. */
const TRUE_TOKENS = new Set(['true', 'sí', 'si', 'verdadero', 'yes']);
const FALSE_TOKENS = new Set(['false', 'no', 'falso']);

/** Un ISO-8601 simple: `YYYY-MM-DD`, opcionalmente con hora. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export type NormalizedValue = string | number | boolean | Date | null;

/**
 * Fila tal como llega de la estrategia, antes de normalizar: CSV y JSON posicional llegan
 * como arreglo de celdas en orden de columna; la API externa puede mandar objetos ya
 * etiquetados. Ambas formas terminan en el mismo `Row` plano.
 */
export type RawCell = string | number | boolean | Date | null | object | undefined;
export type RawRow = readonly RawCell[] | Readonly<Record<string, unknown>>;

export interface ParseNumberResult {
  value: number | null;
  /** `true` sólo cuando la cadena admite dos lecturas numéricas y se eligió una. */
  ambiguous: boolean;
}

export interface NormalizedTable {
  rows: Row[];
  schema: ColumnSchema[];
  warnings: string[];
}

/**
 * Desambiguación de encabezados: dos columnas que colapsan al mismo `key` se numeran
 * `monto`, `monto_2`, `monto_3` (ingestion.md §6.1 punto 6).
 *
 * El sufijo generado se reserva también contra el resto de las claves, porque sin eso
 * `['Monto', 'Monto', 'Monto 2']` devolvería `monto_2` dos veces y el esquema uniforme que
 * exige data-model.md §3.1 regla 5 quedaría roto desde el header.
 */
function dedupeKeys(keys: string[]): string[] {
  const used = new Set<string>();
  const counts = new Map<string, number>();
  const result: string[] = [];

  for (const key of keys) {
    if (!used.has(key)) {
      used.add(key);
      counts.set(key, 1);
      result.push(key);
      continue;
    }

    let suffix = (counts.get(key) ?? 1) + 1;
    while (used.has(`${key}_${suffix}`)) suffix += 1;

    counts.set(key, suffix);
    used.add(`${key}_${suffix}`);
    result.push(`${key}_${suffix}`);
  }

  return result;
}

/**
 * Reduce un encabezado a una clave snake_case estable, sin tildes y sin depender de que
 * el resultado sea legible: la identidad la aporta el desambiguado posterior.
 */
function slugifyHeader(raw: string, index: number): string {
  const normalized = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

  // Cualquier secuencia no alfanumérica cae a `_`; los signos del separador de miles
  // (`$ 1.000`) sólo pueden aparecer en valores, pero se cleans aquí por si vienen en el header.
  const slug = normalized
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');

  const prefixed = /^\d/.test(slug) ? `col_${slug}` : slug;

  return prefixed === '' ? `col_${index + 1}` : prefixed;
}

/** Expuesto por separado porque el extractor de PDF lo reutiliza tal cual (fase 05). */
export function slugifyColumnKey(raw: string, index: number): string {
  return slugifyHeader(raw, index);
}

export function normalizeHeaders(rawHeaders: string[]): string[] {
  const slugified = rawHeaders.map(slugifyHeader);
  return dedupeKeys(slugified);
}

/** Cuenta los decimales de un número, para alimentar `decimalScale` (data-model.md §6). */
function decimalScaleOf(value: number): number {
  const text = String(value);
  const dot = text.indexOf('.');

  if (dot === -1) return 0;

  return text.length - dot - 1;
}

/**
 * Convierte texto es-AR a número, con las reglas de ingestion.md §4.4:
 *
 * - varios separadores ⇒ el último grupo decide: de 3 dígitos es de miles, de 1–2 es el
 *   decimal, y el resto son separadores de miles (`1.234,56` → 1234.56);
 * - sólo coma ⇒ decimal si va al final con 1–2 dígitos, miles si tiene 3 (`1,234` → 1234);
 * - sólo punto ⇒ decimal salvo que tenga 3 dígitos detrás, que es ambiguo (`"1.234"`).
 *
 * Se acepta la forma en-US (`1,234.56`) porque hay orígenes que la emiten.
 */
export function parseNumberEsAr(raw: string): ParseNumberResult {
  let text = raw.trim();
  text = text.replace(/\s+/g, '');
  text = text.replace(/^[$€£¥]/, '');
  text = text.replace(/^\((.*)\)$/, '-$1');

  const negative = text.startsWith('-');
  if (negative || text.startsWith('+')) text = text.slice(1);

  if (text === '' || !/^[0-9.,]+$/.test(text)) {
    return { value: null, ambiguous: false };
  }

  const separatorCount = (text.match(/[.,]/g) ?? []).length;
  let normalized: string;

  if (separatorCount === 0) {
    normalized = text;
  } else if (separatorCount > 1) {
    const lastSeparator = Math.max(text.lastIndexOf(','), text.lastIndexOf('.'));
    const head = text.slice(0, lastSeparator);
    const tail = text.slice(lastSeparator + 1);
    const groups = head.split(/[.,]/);
    const leading = groups[0] ?? '';

    // Todo grupo intermedio es un millar y tiene que medir 3 dígitos; si no, la cadena no
    // es un número coherente y no hay nada que desambiguar.
    const validThousands =
      leading.length > 0 &&
      leading.length <= 3 &&
      groups.slice(1).every((group) => group.length === 3);

    if (!validThousands) {
      return { value: null, ambiguous: true };
    }

    if (tail.length === 3) {
      normalized = text.replace(/[.,]/g, '');
    } else if (tail.length === 1 || tail.length === 2) {
      normalized = `${head.replace(/[.,]/g, '')}.${tail}`;
    } else {
      return { value: null, ambiguous: true };
    }
  } else if (text.includes(',')) {
    const decimals = text.length - text.lastIndexOf(',') - 1;
    if (decimals === 3 && text.lastIndexOf(',') > 0) {
      // "1,234" → miles: el patrón es-AR mayoritario y sin evidencia en contra.
      normalized = text.replace(/,/g, '');
    } else if (decimals === 1 || decimals === 2) {
      normalized = `${text.slice(0, text.lastIndexOf(','))}.${text.slice(text.lastIndexOf(',') + 1)}`;
    } else {
      return { value: null, ambiguous: true };
    }
  } else {
    const decimals = text.length - text.lastIndexOf('.') - 1;
    if (decimals === 3 && text.lastIndexOf('.') > 0) {
      // "1.234" admite dos lecturas y nada en la celda las distingue: se declara ambiguo
      // y la columna queda como texto en vez de devolver un número inventado.
      return { value: null, ambiguous: true };
    }

    normalized = text;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return { value: null, ambiguous: false };
  }

  return { value: negative ? -value : value, ambiguous: false };
}

/**
 * Convierte una celda cruda en su valor normalizado. Un porcentaje `"35%"` es `0.35`
 * (ingestion.md §6.2), no `35`.
 */
export function normalizeCell(raw: string, onWarning?: (warning: string) => void): NormalizedValue {
  const text = raw.trim().replace(/\s+/g, ' ');

  if (NULL_TOKENS.has(text.toLowerCase())) return null;

  const lowered = text.toLowerCase();
  if (TRUE_TOKENS.has(lowered)) return true;
  if (FALSE_TOKENS.has(lowered)) return false;

  const isPercent = text.endsWith('%');
  const numericPart = isPercent ? text.slice(0, -1) : text;

  if (/^[0-9.,]+$/.test(numericPart) && (numericPart !== '' || isPercent)) {
    const { value, ambiguous } = parseNumberEsAr(numericPart);

    if (ambiguous) {
      onWarning?.(`ambiguous-number ${JSON.stringify(raw.trim())}`);
      return text;
    }

    if (value !== null) {
      return isPercent ? value / 100 : value;
    }
  }

  if (ISO_DATE.test(text)) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return text;
}

/**
 * Aplana un objeto JSON anidado a una fila plana, uniendo los niveles con `_`
 * (ingestion.md §6.4: `{tramo:{desde:0}}` → `tramo_desde`). Los arrays de objetos dentro
 * de una celda se conservan como `json`: no se expanden a filas.
 */
export function flattenJson(value: unknown, prefix = ''): Row {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`flattenJson espera un objeto en '${prefix || 'root'}'`);
  }

  const row: Row = {};

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const path = prefix ? `${prefix}_${rawKey}` : rawKey;

    if (rawValue !== null && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      Object.assign(row, flattenJson(rawValue, path));
      continue;
    }

    if (Array.isArray(rawValue)) {
      // Un array es un valor de celda, no un grupo de columnas (ingestion.md §6.4).
      row[path] = JSON.stringify(rawValue);
      continue;
    }

    row[path] = rawValue as Row[string];
  }

  return row;
}

/**
 * Lee la celda de una fila cruda. Las filas posicionales se leen por índice y las etiquetadas
 * por encabezado original, que es como `csv-parse` con `columns: true` las entrega.
 */
function readCell(rawRow: RawRow, columnIndex: number, header: string): RawCell {
  if (Array.isArray(rawRow)) {
    return (rawRow as readonly RawCell[])[columnIndex];
  }

  return (rawRow as Readonly<Record<string, unknown>>)[header] as RawCell;
}

function isDate(value: NormalizedValue): value is Date {
  return value instanceof Date;
}

function typeRank(value: NormalizedValue): ColumnType {
  if (value === null) return 'string';
  if (isDate(value)) return 'date';
  switch (typeof value) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'json';
    default:
      return 'string';
  }
}

/**
 * Resuelve el tipo de una columna recorriendo todas sus celdas. Los tipos mezclados degradan
 * a `string` con `mixed-types` (data-model.md §6, regla de degradación): devolver texto es
 * preferible a devolver números equivocados.
 */
function inferColumnType(
  key: string,
  values: NormalizedValue[],
  warnings: string[],
): { type: ColumnType; decimalScale?: number } {
  const seen = new Set<ColumnType>();
  let maxScale = 0;

  // `nullable` no se resuelve acá: depende de `null`, `''` y celda ausente, y lo calcula
  // `normalizeTable` sobre las filas ya normalizadas.
  for (const value of values) {
    if (value === null) continue;

    seen.add(typeRank(value));

    if (typeof value === 'number') {
      maxScale = Math.max(maxScale, decimalScaleOf(value));
    }
  }

  if (seen.size === 0) return { type: 'string' };

  if (seen.size > 1) {
    warnings.push(`mixed-types column '${key}': ${[...seen].join(', ')} -> string`);
    return { type: 'string' };
  }

  const [type = 'string'] = [...seen];

  if (type === 'number' && maxScale > 0) return { type, decimalScale: maxScale };

  return { type };
}

/**
 * Encabezados derivados de las filas cuando no hay una fila de encabezado que los imponga:
 * unión de todas las claves en orden de primera aparición.
 *
 * Recorrer todas las filas y no sólo la primera es lo que evita perder columnas cuando el
 * origen devuelve objetos heterogéneos, que es el caso habitual en JSON libre.
 */
export function headersFromRows(rawRows: readonly RawRow[]): string[] {
  const headers: string[] = [];
  const seen = new Set<string>();

  for (const row of rawRows) {
    const keys = Array.isArray(row)
      ? row.map((_, index) => `col_${index + 1}`)
      : Object.keys(row as Record<string, unknown>);

    for (const key of keys) {
      if (seen.has(key)) continue;
      seen.add(key);
      headers.push(key);
    }
  }

  return headers;
}

/** Anchura máxima observada: define cuántos `col_N` hacen falta cuando no hay encabezado. */
export function maxWidthOf(rawRows: readonly RawRow[]): number {
  return rawRows.reduce(
    (width, row) => Math.max(width, Array.isArray(row) ? row.length : Object.keys(row).length),
    0,
  );
}

/**
 * Punto único por donde pasa todo origen (ingestion.md §5): garantiza que el `schema` se
 * calcula de la misma forma para manual, api, url y pdf.
 *
 * Acepta filas posicionales y etiquetadas, y `jsonKeys` explícito en las opciones porque
 * `flattenJson` serializa los arrays anidados a texto y eso degradaría a `string` una columna
 * que en el JSON original sí era estructurada.
 */
export function normalizeTable(
  headers: string[],
  rawRows: readonly RawRow[],
  options: { source: ColumnSchema['source']; jsonKeys?: Set<string> } = {
    source: 'derived',
  },
): NormalizedTable {
  const warnings: string[] = [];
  const keys = normalizeHeaders(headers);
  const jsonKeys = options.jsonKeys ?? new Set<string>();

  const rows: Row[] = [];

  for (const [rowIndex, rawRow] of rawRows.entries()) {
    const row: Row = {};

    keys.forEach((key, columnIndex) => {
      const header = headers[columnIndex] ?? key;
      const rawValue = readCell(rawRow, columnIndex, header);

      if (rawValue === null || rawValue === undefined) {
        row[key] = null;
        return;
      }

      if (typeof rawValue === 'object' && !(rawValue instanceof Date)) {
        // Valores JSON que llegaron sin aplanar (o celdas de tipo json declaradas).
        row[key] = JSON.stringify(rawValue);
        return;
      }

      if (jsonKeys.has(key)) {
        row[key] = String(rawValue);
        return;
      }

      row[key] = rawValue instanceof Date
        ? rawValue
        : normalizeCell(String(rawValue), (warning) =>
            warnings.push(`row ${rowIndex + 1} column '${key}': ${warning}`),
          );
    });

    rows.push(row);
  }

  const schema: ColumnSchema[] = keys.map((key, columnIndex) => {
    const values = rows.map((row) => row[key] as NormalizedValue);

    if (jsonKeys.has(key)) {
      return {
        key,
        label: headers[columnIndex] ?? key,
        type: 'json',
        nullable: values.some((value) => value === null),
        source: options.source,
      };
    }

    const { type, decimalScale } = inferColumnType(key, values, warnings);

    return {
      key,
      label: headers[columnIndex] ?? key,
      type,
      nullable: values.some((value) => value === null),
      ...(decimalScale === undefined ? {} : { decimalScale }),
      source: options.source,
    };
  });

  return { rows, schema, warnings };
}