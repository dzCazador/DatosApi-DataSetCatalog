import { z } from 'zod';

import type { ColumnSchema, FilterDef, FilterOperator, SortDef, SortDirection } from '../api/types';

/**
 * Editor de la definición de un endpoint. `fields`, `filters` y `sort` se editan contra
 * el `schema` del dataset resuelto: el formulario ofrece un desplegable por columna, no un
 * campo de texto libre. Así el panel no produce un `422 SCHEMA_MISMATCH` por un typo.
 *
 * Los grupos repetidos viajan por `FormData` con el mismo nombre y se leen con
 * `getAll`, en el mismo orden en que se renderizaron.
 */

export const endpointFormSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(200, 'Máximo 200 caracteres.'),
  description: z.string().trim().max(1000, 'Máximo 1000 caracteres.').optional(),
  sourceId: z.string().trim().min(1, 'Elegí la fuente.'),
  datasetId: z.string().trim().optional(),
  followLatest: z.boolean(),
  defaultLimit: z.number().int().min(1, 'Mínimo 1.'),
  maxLimit: z.number().int().min(1, 'Mínimo 1.'),
  enabled: z.boolean(),
});

export type EndpointFormValues = z.infer<typeof endpointFormSchema>;

export interface EndpointFormParsed {
  values: EndpointFormValues;
  fields: string[];
  filters: FilterDef[];
  sort: SortDef[];
}

const FILTER_OPS = new Set<string>([
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
]);

const SORT_DIRS = new Set<string>(['asc', 'desc']);

/** Se lee un `FormData` plano y se devuelve el dominio; el `schema` local es la validación. */
export function parseEndpointForm(form: FormData): {
  ok: true;
  parsed: EndpointFormParsed;
} | {
  ok: false;
  fieldErrors: Record<string, string>;
} {
  const raw = {
    name: text(form, 'name'),
    description: text(form, 'description'),
    sourceId: text(form, 'sourceId'),
    datasetId: text(form, 'datasetId'),
    followLatest: text(form, 'followLatest') === 'true',
    defaultLimit: integer(form, 'defaultLimit', 50),
    maxLimit: integer(form, 'maxLimit', 500),
    enabled: text(form, 'enabled') === 'true',
  };

  const parsed = endpointFormSchema.safeParse(raw);
  const fieldErrors: Record<string, string> = {};

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && fieldErrors[key] === undefined) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const values = parsed.data;
  if (values.defaultLimit > values.maxLimit) {
    fieldErrors['maxLimit'] = 'El máximo tiene que ser mayor o igual que el default.';
    return { ok: false, fieldErrors };
  }
  if (!values.followLatest && (values.datasetId === undefined || values.datasetId === '')) {
    fieldErrors['datasetId'] = 'Sin `followLatest` hay que fijar un dataset.';
    return { ok: false, fieldErrors };
  }

  const columns = new Set(form.getAll('schemaKey').map((value) => String(value)));

  const fields = form
    .getAll('fields')
    .map(String)
    .filter((key) => columns.has(key));

  const filterFields = form.getAll('filterField').map(String);
  const filterOps = form.getAll('filterOp').map(String);
  const filterRequired = form.getAll('filterRequired').map(String);

  const filters: FilterDef[] = [];
  for (const [index, field] of filterFields.entries()) {
    if (field === '' || !columns.has(field)) continue;
    const op = filterOps[index] ?? '';
    if (!FILTER_OPS.has(op)) continue;
    filters.push({
      field,
      op: op as FilterOperator,
      ...(filterRequired[index] === 'true' ? { required: true } : {}),
    });
  }

  const sortFields = form.getAll('sortField').map(String);
  const sortDirs = form.getAll('sortDir').map(String);

  const sort: SortDef[] = [];
  for (const [index, field] of sortFields.entries()) {
    if (field === '' || !columns.has(field)) continue;
    const dir = sortDirs[index] ?? '';
    if (!SORT_DIRS.has(dir)) continue;
    sort.push({ field, dir: dir as SortDirection });
  }

  return { ok: true, parsed: { values, fields, filters, sort } };
}

/* ── lectura de la definición hacia el estado inicial del editor ────── */

export function editorStateFrom(
  definition: {
    fields?: string[];
    filters: FilterDef[];
    sort: SortDef[];
    defaultLimit: number;
    maxLimit: number;
    enabled: boolean;
    followLatest: boolean;
  },
): {
  fields: string[];
  filters: Array<FilterDef & { required: boolean }>;
  sort: SortDef[];
  defaultLimit: string;
  maxLimit: string;
  enabled: boolean;
  followLatest: boolean;
} {
  return {
    fields: definition.fields ?? [],
    filters: definition.filters.map((filter) => ({ ...filter, required: filter.required ?? false })),
    sort: [...definition.sort],
    defaultLimit: String(definition.defaultLimit),
    maxLimit: String(definition.maxLimit),
    enabled: definition.enabled,
    followLatest: definition.followLatest,
  };
}

/** Columnas que la definición declara y el schema ya no tiene: lo que `validate` va a marcar. */
export function declaredButMissing(
  definition: { fields?: string[]; filters: FilterDef[]; sort: SortDef[] },
  schema: readonly ColumnSchema[],
): Array<{ where: string; field: string }> {
  const keys = new Set(schema.map((column) => column.key));
  const missing: Array<{ where: string; field: string }> = [];

  (definition.fields ?? []).forEach((field, index) => {
    if (!keys.has(field)) missing.push({ where: `fields[${index}]`, field });
  });
  definition.filters.forEach((filter, index) => {
    if (!keys.has(filter.field)) missing.push({ where: `filters[${index}].field`, field: filter.field });
  });
  definition.sort.forEach((entry, index) => {
    if (!keys.has(entry.field)) missing.push({ where: `sort[${index}].field`, field: entry.field });
  });

  return missing;
}

/** Columnas del schema que la definición todavía no expone. Es lo que ofrece el editor. */
export function undeclared(schema: readonly ColumnSchema[], declared: readonly string[]): ColumnSchema[] {
  const set = new Set(declared);
  return schema.filter((column) => !set.has(column.key));
}

/* ── helpers de FormData ────────────────────────────────────────────── */

export function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function integer(form: FormData, key: string, fallback: number): number {
  const parsed = Number(text(form, key));
  return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : fallback;
}