/**
 * Paginación. El panel **siempre** manda `page` y `limit` explícitos y lee `meta.total` /
 * `meta.pages`: nunca pagina en cliente sobre un conjunto ya recortado (`frontend.md` §5).
 *
 * Ojo con los dos regímenes distintos: los listados de administración topan en
 * `ADMIN_MAX_LIMIT` y el endpoint dinámico en el `maxLimit` de su definición. Cada
 * pantalla usa el que corresponde.
 */

export const ADMIN_MAX_LIMIT = 200;
export const ADMIN_DEFAULT_LIMIT = 50;

export function parsePage(value: string | undefined | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

export function parseLimit(value: string | undefined | null, max: number = ADMIN_MAX_LIMIT): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return ADMIN_DEFAULT_LIMIT;
  return Math.min(parsed, max);
}

export interface PageWindow {
  page: number;
  /** `meta.pages` de la API: `0` cuando no hay resultados. */
  pages: number;
}

/** Ventana de páginas a render: primera, última y las dos vecinas de la actual. */
export function pageWindow({ page, pages }: PageWindow): number[] {
  const pageCount = Math.max(pages, 1);
  const current = Math.min(Math.max(page, 1), pageCount);

  const wanted = new Set<number>([1, pageCount, current, current - 1, current + 1]);
  return [...wanted].filter((item) => item >= 1 && item <= pageCount).sort((a, b) => a - b);
}

/** Rango inclusivo de la página visible, para "mostrando 11–20 de 34". */
export function rangeLabel(page: number, limit: number, count: number, total: number): string {
  if (total === 0 || count === 0) return 'Sin resultados';
  const from = (page - 1) * limit + 1;
  const to = from + count - 1;
  return `${from}–${to} de ${total}`;
}