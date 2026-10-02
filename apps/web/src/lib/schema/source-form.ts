import { z } from 'zod';

import type {
  ApiSourceConfig,
  ManualSourceConfig,
  PdfSourceConfig,
  SourceConfig,
  SourceType,
  UrlSourceConfig,
} from '../api/types';

/**
 * Alta de fuente: el formulario pide **sólo** los campos de la variante del `SourceConfig`
 * que corresponde al `type` elegido (`data-model.md` §2.1). Un `ManualSourceConfig` con
 * `url` es inválido, así que el formulario ni siquiera lo ofrece.
 */

export const SOURCE_TYPES = ['manual', 'api', 'url', 'pdf'] as const satisfies readonly SourceType[];

export const SOURCE_TYPE_LABELS: Readonly<Record<SourceType, string>> = {
  manual: 'Manual (pegar el contenido)',
  api: 'API externa (JSON)',
  url: 'URL (CSV, JSON o TXT)',
  pdf: 'PDF descargable',
};

export const SOURCE_TYPE_HINTS: Readonly<Record<SourceType, string>> = {
  manual: 'Pegás el JSON o el CSV acá. No hace falta que el origen sea alcanzable.',
  api: 'La API responde JSON. `jsonPath` permite bajar a un nodo (`data.resultados`).',
  url: 'Descarga directa de un archivo. `contentTypeHint` sólo si el servidor no manda el correcto.',
  pdf: 'Se descarga en runtime y se busca la tabla por coordenadas de texto.',
};

const trimmed = z.string().trim();
const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** `pages` y `tableIndex` son opcionales: si no se mandan, la ingesta usa su default. */
const optionalInteger = (label: string, min: number) =>
  z
    .string()
    .trim()
    .transform((value) => (value === '' ? undefined : Number(value)))
    .refine((value) => value === undefined || Number.isInteger(value), `${label} tiene que ser un entero.`)
    .refine((value) => value === undefined || (value as number) >= min, `${label} tiene que ser >= ${min}.`);

const optionalIntegerList = z
  .string()
  .trim()
  .transform((value) => splitCsv(value))
  .refine(
    (parts) => parts.every((part) => Number.isInteger(part) && part >= 0),
    'Cada página tiene que ser un entero >= 0 (0-indexado).',
  );

function splitCsv(value: string): number[] {
  if (value.trim() === '') return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => Number(part));
}

const headerHints = z
  .string()
  .transform((value) =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== ''),
  );

export const sourceFormSchema = z.object({
  type: z.enum(SOURCE_TYPES),
  name: trimmed.min(1, 'El nombre es obligatorio.').max(200, 'Máximo 200 caracteres.'),
  description: optionalText,
  requestHeaders: optionalText,
  format: z.enum(['json', 'csv']).default('json'),
  payload: z.string().default(''),
  delimiter: optionalText,
  hasHeaderRow: z.enum(['true', 'false']).default('true'),
  method: z.enum(['GET', 'POST']).default('GET'),
  url: z.string().default(''),
  body: optionalText,
  jsonPath: optionalText,
  contentTypeHint: optionalText,
  pages: z.string().default(''),
  tableIndex: z.string().default(''),
  headerHints: z.string().default(''),
});

export type SourceFormValues = z.infer<typeof sourceFormSchema>;

/**
 * `config` según `type`. Devuelve un discriminated union para no tener que castear en
 * los Server Actions, y descarta las claves vacías: mandar `jsonPath: undefined` a la API
 * es peor que no mandarla.
 */
export function buildSourceConfig(
  values: SourceFormValues,
): { ok: true; config: SourceConfig } | { ok: false; message: string } {
  const headers = parseHeaders(values.requestHeaders);
  if (headers === null) return { ok: false, message: 'Los headers tienen que ser uno por línea, como `Clave: valor`.' };
  const base = headers === undefined ? {} : { requestHeaders: headers };

  switch (values.type) {
    case 'manual': {
      const payload = values.payload.trim();
      if (payload === '') return { ok: false, message: 'El payload es obligatorio para una fuente manual.' };

      if (values.format === 'csv') {
        const config: ManualSourceConfig = {
          format: 'csv',
          payload,
          hasHeaderRow: values.hasHeaderRow === 'true',
          ...base,
        };
        if (values.delimiter !== undefined && values.delimiter !== '') config.delimiter = values.delimiter;
        return { ok: true, config };
      }

      const config: ManualSourceConfig = { format: 'json', payload, ...base };
      return { ok: true, config };
    }

    case 'api': {
      if (!isHttpUrl(values.url.trim())) return { ok: false, message: 'La URL de la API es obligatoria y tiene que ser http(s).' };
      const config: ApiSourceConfig = { url: values.url.trim(), method: values.method, ...base };
      if (values.jsonPath !== undefined) config.jsonPath = values.jsonPath;
      if (values.method === 'POST') {
        if (values.body === undefined) return { ok: false, message: 'Con `POST` hay que mandar el body.' };
        config.body = parseJsonOrText(values.body);
      }
      return { ok: true, config };
    }

    case 'url': {
      if (!isHttpUrl(values.url.trim())) return { ok: false, message: 'La URL es obligatoria y tiene que ser http(s).' };
      const config: UrlSourceConfig = { url: values.url.trim(), ...base };
      if (values.contentTypeHint !== undefined) config.contentTypeHint = values.contentTypeHint;
      return { ok: true, config };
    }

    case 'pdf': {
      if (!isHttpUrl(values.url.trim())) return { ok: false, message: 'La URL del PDF es obligatoria y tiene que ser http(s).' };
      const config: PdfSourceConfig = { url: values.url.trim(), ...base };

      const pages = optionalIntegerList.safeParse(values.pages);
      if (!pages.success) return { ok: false, message: pages.error.issues[0]?.message ?? 'Páginas inválidas.' };
      if (pages.data.length > 0) config.pages = pages.data;

      const tableIndex = optionalInteger('tableIndex', 0).safeParse(values.tableIndex);
      if (!tableIndex.success) return { ok: false, message: tableIndex.error.issues[0]?.message ?? 'tableIndex inválido.' };
      if (tableIndex.data !== undefined) config.tableIndex = tableIndex.data;

      const hints = headerHints.parse(values.headerHints);
      if (hints.length > 0) config.headerHints = hints;
      return { ok: true, config };
    }
  }
}

/** `Clave: valor` por línea → objeto. `undefined` si no hay nada. `null` si una línea está mal. */
export function parseHeaders(raw: string | undefined): Record<string, string> | undefined | null {
  if (raw === undefined || raw.trim() === '') return undefined;

  const headers: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const text = line.trim();
    if (text === '') continue;
    const separator = text.indexOf(':');
    if (separator <= 0) return null;
    headers[text.slice(0, separator).trim()] = text.slice(separator + 1).trim();
  }
  return headers;
}

/** El body de un POST puede ser JSON o texto plano; si es JSON válido se manda parseado. */
export function parseJsonOrText(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}