import type { Cell, ColumnSchema } from '../api/types';

/**
 * Formateo es-AR guiado por el `ColumnSchema` (`frontend.md` §6.3). Dos reglas no se
 * negocian: un `null` se muestra como `—` (nunca `0`) y un número usa el `decimalScale`
 * que la ingesta calculó, no el que "parece" correcto.
 */

/** Guion largo: el marcador de "sin valor" del panel. */
export const EMPTY_CELL = '—';

const LOCALE = 'es-AR';

const numberFormatters = new Map<string, Intl.NumberFormat>();

function formatterFor(decimalScale: number | undefined): Intl.NumberFormat {
  const scale = decimalScale ?? 2;
  const cached = numberFormatters.get(String(scale));
  if (cached !== undefined) return cached;

  const created = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  });
  numberFormatters.set(String(scale), created);
  return created;
}

/**
 * `decimalScale` marca una columna como porcentaje cuando vale 4: en la escala de
 * retención de AFIP la alícuota es `0.15`, que se lee `15 %`, no `0,15`.
 */
export function isPercentScale(decimalScale: number | undefined): boolean {
  return decimalScale === 4;
}

/**
 * Números con `decimalScale` explícito: `54785.28` con scale 2 → `54.785,28`.
 * El `decimalScale` es el dato, así que el default es 2 decimales y no el del `Number`.
 */
export function formatNumber(value: number, decimalScale?: number): string {
  if (!Number.isFinite(value)) return EMPTY_CELL;

  if (isPercentScale(decimalScale)) {
    const percent = new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value * 100);
    return `${percent} %`;
  }

  return formatterFor(decimalScale).format(value);
}

/** `date` del schema o `createdAt`/`updatedAt`: `dd/mm/aaaa`. */
export function formatDate(iso: string | undefined | null): string {
  if (iso === undefined || iso === null || iso.trim() === '') return EMPTY_CELL;

  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return EMPTY_CELL;

  return new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed);
}

/** Los campos `date` del schema se muestran como `YYYY-MM-DD`, sin conversión de zona. */
export function formatDay(iso: string | undefined | null): string {
  if (iso === undefined || iso === null || iso.trim() === '') return EMPTY_CELL;

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (match !== null) {
    const [, year, month, day] = match;
    return `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
  }

  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return EMPTY_CELL;
  return formatDate(iso);
}

/** `date` con hora, para `lastIngestAt` y `fetchedAt`. */
export function formatDateTime(iso: string | undefined | null): string {
  if (iso === undefined || iso === null || iso.trim() === '') return EMPTY_CELL;

  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return EMPTY_CELL;

  return new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

/**
 * Contador acotado por el rango de la página: `pageCount` o `tableCount` pueden no venir,
 * y un contador ausente se muestra como `—`, no como `0`.
 */
export function formatCount(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return EMPTY_CELL;
  return formatNumber(value, 0);
}

/** Duración legible a partir de milisegundos (`durationMs` de la ingesta). */
export function formatDuration(durationMs: number | undefined | null): string {
  if (durationMs === undefined || durationMs === null || !Number.isFinite(durationMs)) return EMPTY_CELL;
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1).replace('.', ',')} s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes} min ${seconds} s`;
}

/** Bytes de `meta.bytes`. */
export function formatBytes(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes)) return EMPTY_CELL;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1).replace('.', ',')} ${units[unitIndex] ?? 'B'}`;
}

export function formatBoolean(value: boolean | undefined | null): string {
  if (value === undefined || value === null) return EMPTY_CELL;
  return value ? 'Sí' : 'No';
}

/**
 * Celda de columna `json`. El contrato las manda como texto ya serializado
 * (`Cell` no incluye objetos), así que un string se muestra tal cual y sólo se
 * serializa lo que venga como estructura. Trunca si es largo.
 */
export function formatJson(value: unknown, maxLength = 120): string {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? EMPTY_CELL);
  if (text === '') return EMPTY_CELL;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

/**
 * Formatea una celda **según su columna**. Es la función que usan las tablas generadas
 * desde el `schema`: el `type` y el `decimalScale` del `ColumnSchema` deciden.
 */
export function formatCell(column: ColumnSchema, value: Cell | undefined): string {
  if (value === undefined || value === null) return EMPTY_CELL;

  switch (column.type) {
    case 'number':
      return typeof value === 'number' ? formatNumber(value, column.decimalScale) : String(value);
    case 'date':
      return formatDay(typeof value === 'string' ? value : String(value));
    case 'boolean':
      return typeof value === 'boolean' ? formatBoolean(value) : String(value);
    case 'json':
      return formatJson(value);
    case 'string':
      return value === '' ? EMPTY_CELL : String(value);
  }
}