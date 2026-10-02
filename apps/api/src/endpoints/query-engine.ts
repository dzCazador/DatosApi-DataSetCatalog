import { FilterOperator } from '@datosapi/common';
import type {
  ColumnSchema,
  EndpointDefinitionEntity,
  FilterDef,
  Row,
  SortDef,
  SortDirection,
} from '@datosapi/common';

import {
  FilterNotAllowedError,
  InvalidPaginationError,
  SchemaMismatchError,
  SortNotAllowedError,
  ValueCastError,
} from './endpoints.errors';

/** Valor de celda después del cast al tipo del `ColumnSchema`. */
type CellValue = string | number | boolean | Date | null;

/** Comparable de una celda: `date` colapsa a milisegundos para que el orden sea numérico. */
type Comparable = string | number | boolean | null;

/** Un filtro ya parseado y casteado: ya no quedan strings sin convertir. */
export interface ParsedFilter {
  field: string;
  op: FilterOperator;
  value: CellValue | CellValue[];
}

export interface ParsedQuery {
  page: number;
  limit: number;
  sort: SortDef[];
  filters: ParsedFilter[];
  /** `undefined` cuando la proyección no se sobreescribe: se usan todas las columnas. */
  fields?: string[];
}

export interface QueryResult {
  data: Row[];
  meta: { total: number; count: number; page: number; limit: number; pages: number };
}

/** Parámetros de control del endpoint dinámico; los únicos que no son filtros de columna. */
const CONTROL_PARAMS = new Set(['page', 'limit', 'sort', 'fields']);

const SORT_DIRECTIONS: readonly SortDirection[] = ['asc', 'desc'];

const BOOLEAN_TRUE = new Set(['true', '1']);
const BOOLEAN_FALSE = new Set(['false', '0']);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/;

/**
 * Token de inyección del motor. La interfaz `QueryEngine` no puede usarse como token
 * porque las interfaces no existen en runtime: `provide: QueryEngine` sería `undefined`.
 */
export const QUERY_ENGINE = 'QUERY_ENGINE';

/**
 * Interfaz única del motor (fase 07 §3). El `DynamicService` no sabe cómo se ejecuta la
 * consulta: si mañana los datasets crecen y hace falta un `Aggregation Pipeline`, se cambia
 * esta implementación y nadie más.
 */
export interface QueryEngine {
  execute(rows: Row[], schema: ColumnSchema[], query: ParsedQuery): QueryResult;
}

/**
 * Normaliza el query crudo de Express a una forma estable para el `ETag`: el orden de las
 * claves no puede cambiar el hash, porque `?a=1&b=2` y `?b=2&a=1` son la misma consulta.
 */
export function canonicalizeQuery(query: Record<string, unknown>): string {
  return Object.keys(query)
    .sort()
    .map((key) => {
      const value = query[key];
      const parts = (Array.isArray(value) ? value : [value]).map(String);

      return `${key}=${parts.join('|')}`;
    })
    .join('&');
}

function toSchemaMap(schema: ColumnSchema[]): Map<string, ColumnSchema> {
  return new Map(schema.map((column) => [column.key, column]));
}

function parseInteger(raw: string, param: string): number {
  // `Number('')` es 0 y `Number('1.5')` es 1.5: el entero se valida con un patrón en vez de
  // confiar en el casteo, que truncaría en silencio.
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new InvalidPaginationError(param, raw, 'debe ser un entero');
  }

  return Number(raw);
}

/**
 * Castea el valor del query al tipo de la columna (api-contract.md §6). Sin este paso,
 * `?importe_desde=50000` compararía el string `"50000"` contra el número `50000` y no
 * matchearía nunca: el filtro parecería no filtrar.
 */
function castValue(raw: string, column: ColumnSchema, param: string): CellValue {
  const value = raw.trim();

  switch (column.type) {
    case 'number': {
      const parsed = Number(value);

      if (value === '' || !Number.isFinite(parsed)) {
        throw new ValueCastError(param, raw, 'número');
      }

      return parsed;
    }
    case 'boolean': {
      if (BOOLEAN_TRUE.has(value.toLowerCase())) return true;
      if (BOOLEAN_FALSE.has(value.toLowerCase())) return false;

      throw new ValueCastError(param, raw, 'booleano');
    }
    case 'date': {
      // `Date.parse` acepta basura como `2026` o `marzo`; se exige una fecha ISO con día
      // para no comparar un instante arbitrario contra la celda.
      if (!ISO_DATE.test(value)) throw new ValueCastError(param, raw, 'fecha ISO');

      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) throw new ValueCastError(param, raw, 'fecha ISO');

      return parsed;
    }
    case 'json':
      // Una celda `json` no tiene casting natural desde el query string: se compara como
      // texto. Es la única opción honesta sin pedirle JSON al cliente.
      return value;
    case 'string':
      return value;
  }
}

function splitCsv(raw: string, param: string): string[] {
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) throw new ValueCastError(param, raw, 'valor o lista de valores');

  return parts;
}

function parseFilterValue(
  raw: string,
  filter: FilterDef,
  column: ColumnSchema,
): CellValue | CellValue[] {
  if (filter.op === FilterOperator.IN) {
    return splitCsv(raw, filter.field).map((part) => castValue(part, column, filter.field));
  }

  if (filter.op === FilterOperator.BETWEEN) {
    const parts = splitCsv(raw, filter.field);

    // Un intervalo con un solo extremo es un error del cliente, no un `from` sin `to`
    // interpretado como -Infinity/+Infinity.
    if (parts.length !== 2) throw new ValueCastError(filter.field, raw, 'intervalo "desde,hasta"');

    return parts.map((part) => castValue(part, column, filter.field));
  }

  return castValue(raw, column, filter.field);
}

/**
 * Nada se ignora en silencio (api-contract.md §6): una clave no reconocida es `400`, no un
 * filtro descartado. Sin esto, un typo en el nombre del filtro devolvía `200` con el
 * dataset entero sin filtrar, que es peor que un error porque el cliente no se entera.
 */
function assertKnownParams(
  query: Record<string, unknown>,
  definition: EndpointDefinitionEntity,
): void {
  const allowed = new Set<string>(CONTROL_PARAMS);
  for (const filter of definition.filters) allowed.add(filter.field);
  for (const sort of definition.sort) allowed.add(sort.field);

  for (const param of Object.keys(query)) {
    if (!allowed.has(param)) throw new FilterNotAllowedError(param);
  }
}

function parsePage(query: Record<string, unknown>): number {
  if (query['page'] === undefined) return 1;

  const page = parseInteger(String(query['page']), 'page');
  if (page < 1) throw new InvalidPaginationError('page', String(query['page']), 'debe ser >= 1');

  return page;
}

function parseLimit(query: Record<string, unknown>, definition: EndpointDefinitionEntity): number {
  if (query['limit'] === undefined) return definition.defaultLimit;

  const limit = parseInteger(String(query['limit']), 'limit');

  if (limit < 1) throw new InvalidPaginationError('limit', String(query['limit']), 'debe ser >= 1');

  // Se rechaza en vez de clampar (decisión de la fase): clampar en silencio esconde el error
  // del cliente y le devuelve una página distinta de la que pidió.
  if (limit > definition.maxLimit) {
    throw new InvalidPaginationError(
      'limit',
      String(query['limit']),
      `supera el maxLimit de la definición (${definition.maxLimit})`,
    );
  }

  return limit;
}

/**
 * Una definición puede quedar desactualizada si una reingesta cambió el schema
 * (data-model.md §3.3). Referenciar una columna que ya no existe es `422 SCHEMA_MISMATCH`, no
 * un filtro descartado: si el cliente mandó `?descripcion=abc` y la definición lo declaraba,
 * ignorarlo devolvería `200` con el dataset entero y el cliente creería que filtró.
 *
 * El allowlist y el schema son dos listas distintas: `filters[]` decide *qué se puede
 * filtrar* y el schema decide *sobre qué datos*. Una columna declarada que el schema no tiene
 * es un error de configuración de la definición, y por eso es `422` y no `400`.
 */
function assertColumnExists(
  field: string,
  where: string,
  columns: Map<string, ColumnSchema>,
): void {
  if (columns.has(field)) return;

  throw new SchemaMismatchError(
    `La definición referencia la columna '${field}' (${where}) y el dataset no la tiene: puede ` +
      'haber cambiado el schema con una reingesta',
    { unknownFields: [{ where, field, reason: 'not in dataset schema' }] },
  );
}

function parseSort(
  query: Record<string, unknown>,
  definition: EndpointDefinitionEntity,
  columns: Map<string, ColumnSchema>,
): SortDef[] {
  definition.sort.forEach((declared, index) => {
    assertColumnExists(declared.field, `sort[${index}].field`, columns);
  });

  if (query['sort'] === undefined) return [];

  const raw = Array.isArray(query['sort']) ? query['sort'].map(String) : [String(query['sort'])];
  const parsed: SortDef[] = [];

  for (const entry of raw) {
    // `lastIndexOf` y no `indexOf`: una clave de columna puede contener `:` y el separador
    // es siempre el último.
    const separator = entry.lastIndexOf(':');
    const field = separator === -1 ? entry : entry.slice(0, separator);
    const dir = (separator === -1 ? 'asc' : entry.slice(separator + 1)) as SortDirection;
    const allowed = definition.sort.map((candidate) => candidate.field);

    if (!allowed.includes(field)) throw new SortNotAllowedError(field, allowed);
    if (!SORT_DIRECTIONS.includes(dir)) throw new SortNotAllowedError(entry, allowed);

    parsed.push({ field, dir });
  }

  return parsed;
}

/**
 * Proyección de la respuesta: la de `definition.fields`, o el override `?fields=`.
 *
 * El override es un subconjunto, no un escape del allowlist: si la definición declara
 * `fields`, el query sólo puede pedir columnas de ahí (decisión de la fase). Sin `fields` en la
 * definición, cualquier columna del schema es admisible.
 *
 * Sin override, la proyección es la que declara la definición —no todas las columnas del
 * schema— porque declarar `fields` es justamente la forma de exponer menos columnas de las que
 * tiene el dataset.
 */
function parseFields(
  query: Record<string, unknown>,
  definition: EndpointDefinitionEntity,
  columns: Map<string, ColumnSchema>,
): string[] | undefined {
  const declared = definition.fields;

  declared?.forEach((field, index) => {
    assertColumnExists(field, `fields[${index}]`, columns);
  });

  if (query['fields'] === undefined) return declared;

  const requested = String(query['fields'])
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field.length > 0);

  const allowed = declared ?? [...columns.keys()];

  for (const field of requested) {
    // Fuera de `fields[]` es un escape del allowlist → `400`. La columna no existir en el
    // schema es un error de configuración → `422`, y lo reporta `assertColumnExists`.
    if (!allowed.includes(field)) {
      throw new FilterNotAllowedError(
        'fields',
        field,
        undefined,
        'columna fuera de la proyección permitida',
      );
    }
  }

  return requested;
}

function parseFilters(
  query: Record<string, unknown>,
  definition: EndpointDefinitionEntity,
  columns: Map<string, ColumnSchema>,
): ParsedFilter[] {
  const parsed: ParsedFilter[] = [];

  definition.filters.forEach((filter, index) => {
    assertColumnExists(filter.field, `filters[${index}].field`, columns);
  });

  for (const filter of definition.filters) {
    const column = columns.get(filter.field) as ColumnSchema;
    const raw = query[filter.field];

    if (raw === undefined) {
      if (filter.required === true) {
        throw new FilterNotAllowedError(
          filter.field,
          undefined,
          column.key,
          'el filtro es requerido y no vino en el query',
        );
      }

      continue;
    }

    parsed.push({
      field: filter.field,
      op: filter.op,
      value: parseFilterValue(String(raw), filter, column),
    });
  }

  return parsed;
}

/**
 * Valida **todo** el query antes de calcular nada (fase 07 §3): si un filtro está mal y el
 * orden también, el cliente recibe el error del filtro y no un resultado parcial.
 */
export function parseQuery(
  query: Record<string, unknown>,
  definition: EndpointDefinitionEntity,
  schema: ColumnSchema[],
): ParsedQuery {
  const columns = toSchemaMap(schema);
  assertKnownParams(query, definition);

  const fields = parseFields(query, definition, columns);

  return {
    page: parsePage(query),
    limit: parseLimit(query, definition),
    sort: parseSort(query, definition, columns),
    filters: parseFilters(query, definition, columns),
    ...(fields === undefined ? {} : { fields }),
  };
}

/** Castea un valor de celda al comparable del tipo de la columna. */
function comparable(value: CellValue, column: ColumnSchema): Comparable {
  if (value === null) return null;
  if (column.type === 'date' && value instanceof Date) return value.getTime();
  if (column.type === 'number' && typeof value === 'number') return value;
  if (column.type === 'boolean' && typeof value === 'boolean') return value;

  return String(value);
}

function toText(value: CellValue): string {
  if (value === null) return '';
  if (value instanceof Date) return value.toISOString();

  return String(value);
}

// Acepta `undefined` porque `noUncheckedIndexedAccess` está activo y un intervalo mal
// armado no puede llegar acá: `between` ya validó que haya dos valores.
function asNumber(value: Comparable | undefined): number | null {
  return typeof value === 'number' ? value : null;
}

function compareOrder(left: Comparable, right: Comparable): number {
  if (typeof left === 'number' && typeof right === 'number') {
    if (left === right) return 0;

    return left < right ? -1 : 1;
  }

  const leftText = toText(left as CellValue);
  const rightText = toText(right as CellValue);

  if (leftText === rightText) return 0;

  return leftText < rightText ? -1 : 1;
}

/**
 * Una celda `null` no satisface ni una comparación ni un `contains`: `?importe_desde=gt:1`
 * devolviendo las filas sin dato sería tan ilegible como el `400`. Para `ne` sí se cuentan
 * como distintas, porque "no es igual a 5" también es cierto para una celda vacía.
 */
function matchesFilter(row: Row, filter: ParsedFilter, column: ColumnSchema): boolean {
  const cell = (row[filter.field] ?? null) as CellValue;
  const target = comparable(filter.value as CellValue, column);
  const value = comparable(cell, column);

  switch (filter.op) {
    case FilterOperator.EQ:
      return value !== null && value === target;
    case FilterOperator.NE:
      return value !== target;
    case FilterOperator.GT:
    case FilterOperator.GTE:
    case FilterOperator.LT:
    case FilterOperator.LTE: {
      const left = asNumber(value);
      const right = asNumber(target);

      if (left === null || right === null) return false;

      const ordering = compareOrder(left, right);
      switch (filter.op) {
        case FilterOperator.GT:
          return ordering > 0;
        case FilterOperator.GTE:
          return ordering >= 0;
        case FilterOperator.LT:
          return ordering < 0;
        default:
          return ordering <= 0;
      }
    }
    case FilterOperator.IN: {
      const values = (filter.value as CellValue[]).map((item) => comparable(item, column));

      return value !== null && values.includes(value);
    }
    case FilterOperator.BETWEEN: {
      const [from, to] = (filter.value as CellValue[]).map((item) => comparable(item, column));
      const left = asNumber(value);
      const low = asNumber(from);
      const high = asNumber(to);

      if (left === null || low === null || high === null) return false;

      return left >= low && left <= high;
    }
    case FilterOperator.CONTAINS:
      return value !== null && toText(cell).toLowerCase().includes(toText(target).toLowerCase());
    case FilterOperator.STARTS_WITH:
      return value !== null && toText(cell).toLowerCase().startsWith(toText(target).toLowerCase());
  }
}

function project(row: Row, fields: string[]): Row {
  const projected: Row = {};

  for (const field of fields) {
    // Una columna del schema que la fila no tiene llega como `null` y no como clave
    // ausente: el panel necesita la columna presente para pintar la celda vacía.
    projected[field] = row[field] ?? null;
  }

  return projected;
}

/**
 * Orden estable: el índice de partida desempata, así que dos filas con la misma clave de
 * orden conservan la posición con que llegaron en `rows` y el resultado no depende de cómo
 * los ordene el motor.
 */
function sortRows(rows: Row[], sort: SortDef[], columns: Map<string, ColumnSchema>): Row[] {
  if (sort.length === 0) return rows;

  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      for (const { field, dir } of sort) {
        const column = columns.get(field);
        const leftValue = comparable(
          (left.row[field] ?? null) as CellValue,
          column as ColumnSchema,
        );
        const rightValue = comparable(
          (right.row[field] ?? null) as CellValue,
          column as ColumnSchema,
        );

        // Los `null` van al final en ambos sentidos: un orden ascendente sin datos tiene que
        // dejar los huecos al final de la tabla, no intercalados entre los valores.
        if (leftValue === null && rightValue === null) continue;
        if (leftValue === null) return 1;
        if (rightValue === null) return -1;

        const ordering = compareOrder(leftValue, rightValue);
        if (ordering !== 0) return dir === 'asc' ? ordering : -ordering;
      }

      return left.index - right.index;
    })
    .map(({ row }) => row);
}

/**
 * Motor en memoria (fase 07 §3, decisión 1). Los datasets del MVP son chicos y el filtrado
 * en memoria es el único modo de castear cada valor contra el tipo del `ColumnSchema` sin
 * duplicar esa lógica de tipos en un aggregation pipeline.
 */
export class InMemoryQueryEngine implements QueryEngine {
  execute(rows: Row[], schema: ColumnSchema[], query: ParsedQuery): QueryResult {
    const columns = toSchemaMap(schema);
    const filters = query.filters.filter((filter) => columns.has(filter.field));

    const filtered = rows.filter((row) =>
      filters.every((filter) =>
        matchesFilter(row, filter, columns.get(filter.field) as ColumnSchema),
      ),
    );

    // `total` va después de filtrar y antes de paginar (api-contract.md §1.3): es lo que
    // permite al cliente saber cuántas páginas existen sin pedir todas.
    const total = filtered.length;
    const sorted = sortRows(filtered, query.sort, columns);
    const offset = (query.page - 1) * query.limit;
    const page = sorted.slice(offset, offset + query.limit);

    return {
      data: page.map((row) => project(row, query.fields ?? schema.map((column) => column.key))),
      meta: {
        total,
        count: page.length,
        page: query.page,
        limit: query.limit,
        pages: total === 0 ? 0 : Math.ceil(total / query.limit),
      },
    };
  }
}
