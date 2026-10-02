import type { ColumnSchema, FilterDef, FilterOperator, SortDef } from './types';

/**
 * Construcción del query del playground. Todo sale de la `EndpointDefinition`: el panel no
 * ofrece campos de filtro libres porque la API los rechaza con `400 FILTER_NOT_ALLOWED`
 * (`frontend.md` §5). Este módulo es puro y es lo que se testea.
 */

/** Estado del formulario: `field` → texto crudo del control. */
export type FilterFormState = Readonly<Record<string, string>>;

export interface DynamicQueryInput {
  filters: readonly FilterDef[];
  sort: readonly SortDef[];
  values: FilterFormState;
  /**
   * Schema del dataset resuelto. Necesario para distinguir `?importe_desde=50000` de
   * `?vigencia_desde=2026-07-01`: los dos son `gt`/`gte`, pero castean distinto.
   */
  schema?: readonly ColumnSchema[];
  page?: number;
  limit?: number;
  /** Override de proyección: CSV, subconjunto de `fields[]`. `undefined` = la de la definición. */
  fields?: readonly string[] | null;
}

export interface DynamicQueryResult {
  params: URLSearchParams;
  /** Un mensaje por filtro que no se pudo traducir a un valor válido. Si no está vacío, no se consulta. */
  problems: string[];
  /** Filtros `required: true` sin valor. La API también los rechaza, pero se detecta antes. */
  missingRequired: string[];
}

const NUMERIC_OPS: ReadonlySet<FilterOperator> = new Set<FilterOperator>(['gt', 'gte', 'lt', 'lte']);
const LIST_OPS: ReadonlySet<FilterOperator> = new Set<FilterOperator>(['in']);

export const FILTER_OPERATORS: readonly FilterOperator[] = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'contains',
  'starts_with',
  'between',
];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;

/** Texto de ayuda del control que corresponde a cada `op` (`api-contract.md` §6). */
export function operatorHint(op: FilterOperator): string {
  switch (op) {
    case 'eq':
      return 'igual a';
    case 'ne':
      return 'distinto de';
    case 'gt':
      return 'mayor que';
    case 'gte':
      return 'mayor o igual que';
    case 'lt':
      return 'menor que';
    case 'lte':
      return 'menor o igual que';
    case 'in':
      return 'uno de (CSV, ej. A,B,C)';
    case 'contains':
      return 'contiene (no distingue mayúsculas)';
    case 'starts_with':
      return 'empieza con (no distingue mayúsculas)';
    case 'between':
      return 'entre a,b (inclusive)';
  }
}

/** Qué control se renderiza: el panel elige el input según el `op` y el tipo de columna. */
export type FilterControl = 'text' | 'number' | 'date' | 'select' | 'csv' | 'range';

export function controlFor(op: FilterOperator, column: ColumnSchema | undefined): FilterControl {
  if (op === 'between') return 'range';
  if (LIST_OPS.has(op)) return 'csv';
  if (NUMERIC_OPS.has(op)) return column?.type === 'date' ? 'date' : 'number';
  if (op === 'eq' || op === 'ne') return column?.type === 'boolean' ? 'select' : 'text';
  return 'text';
}

function isBlank(value: string): boolean {
  return value.trim() === '';
}

/**
 * Convierte el texto de un control al valor que espera el query string. Devuelve `null`
 * cuando el texto no es válido para la columna, con el motivo para mostrarlo en el campo.
 */
export function normalizeFilterValue(
  op: FilterOperator,
  column: ColumnSchema | undefined,
  raw: string,
): { value: string } | { problem: string } {
  const text = raw.trim();

  if (NUMERIC_OPS.has(op)) {
    if (column?.type === 'date') return validateDate(text);
    if (!isFiniteNumber(text)) return { problem: 'Tiene que ser un número.' };
    return { value: text };
  }

  if (op === 'between') return normalizeBetween(column, text);

  if (LIST_OPS.has(op)) {
    const parts = text
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '');
    if (parts.length === 0) return { problem: 'Indicá al menos un valor (CSV).' };
    return { value: parts.join(',') };
  }

  if (column?.type === 'boolean' && (op === 'eq' || op === 'ne')) {
    if (text !== 'true' && text !== 'false') return { problem: 'Tiene que ser true o false.' };
    return { value: text };
  }

  return { value: text };
}

function normalizeBetween(column: ColumnSchema | undefined, text: string): { value: string } | { problem: string } {
  const parts = text.split(',').map((part) => part.trim());
  const invalid = parts.find((part) => part === '');
  if (invalid !== undefined || parts.length !== 2) {
    return { problem: 'El rango se escribe a,b con los dos extremos.' };
  }

  const [from, to] = parts;
  if (from === undefined || to === undefined) return { problem: 'El rango se escribe a,b con los dos extremos.' };

  if (column?.type === 'date') {
    const fromCheck = validateDate(from);
    if ('problem' in fromCheck) return fromCheck;
    const toCheck = validateDate(to);
    if ('problem' in toCheck) return toCheck;
    return { value: `${from},${to}` };
  }

  if (!isFiniteNumber(from) || !isFiniteNumber(to)) {
    return { problem: 'Los dos extremos tienen que ser números.' };
  }
  // `a > b` no se normaliza: la API devuelve cero resultados y esa es la semántica.
  return { value: `${from},${to}` };
}

function isFiniteNumber(text: string): boolean {
  if (text === '') return false;
  return Number.isFinite(Number(text));
}

function validateDate(text: string): { value: string } | { problem: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { problem: 'La fecha va como AAAA-MM-DD.' };
  }
  const parsed = Date.parse(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed)) return { problem: 'La fecha no existe.' };
  return { value: text };
}

export function buildDynamicQuery(input: DynamicQueryInput): DynamicQueryResult {
  const params = new URLSearchParams();
  const problems: string[] = [];
  const missingRequired: string[] = [];
  const columns = new Map((input.schema ?? []).map((column) => [column.key, column]));

  for (const filter of input.filters) {
    const raw = input.values[filter.field];
    if (raw === undefined || isBlank(raw)) {
      if (filter.required === true) missingRequired.push(filter.field);
      continue;
    }

    const normalized = normalizeFilterValue(filter.op, columns.get(filter.field), raw);
    if ('problem' in normalized) {
      problems.push(`${filter.field}: ${normalized.problem}`);
      continue;
    }
    params.append(filter.field, normalized.value);
  }

  for (const sort of input.sort) {
    params.append('sort', `${sort.field}:${sort.dir}`);
  }

  if (input.fields !== undefined && input.fields !== null && input.fields.length > 0) {
    params.set('fields', input.fields.join(','));
  }

  if (input.page !== undefined && input.page > 0) params.set('page', String(input.page));
  if (input.limit !== undefined && input.limit > 0) params.set('limit', String(input.limit));

  return { params, problems, missingRequired };
}

/** El mismo query, listo para pegar en una terminal: es lo que el playground muestra. */
export function buildCurl(baseUrl: string, slug: string, params: URLSearchParams): string {
  const qs = params.toString();
  const url = `${baseUrl.replace(/\/+$/, '')}/e/${slug}${qs === '' ? '' : `?${qs}`}`;
  return `curl -sS '${url}'`;
}

/** Fila de `sort` a string del query. `undefined` cuando la columna no está permitida. */
export function sortParamValue(sort: SortDef): string {
  return `${sort.field}:${sort.dir}`;
}