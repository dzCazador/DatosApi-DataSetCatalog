import Link from 'next/link';
import type { ReactNode } from 'react';

import type { PaginationMeta } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { pageWindow, rangeLabel } from '@/lib/schema/pagination';
import { EmptyState } from './feedback';

export interface Column<T> {
  /** `ColumnSchema.key` o el identificador estable de la columna derivada. */
  key: string;
  header: ReactNode;
  render: (row: T, index: number) => ReactNode;
  /** Alineación a la derecha para números: el panel los formatea en es-AR. */
  align?: 'left' | 'right';
  className?: string;
}

export interface DataTableProps<T> {
  columns: ReadonlyArray<Column<T>>;
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  skeletonRows?: number;
  /** Estado vacío con acción (`frontend.md` §6.4). */
  empty?: { title: string; description?: ReactNode; action?: ReactNode };
  meta?: PaginationMeta;
  /** Construye la URL de la página pedida conservando los filtros activos. */
  pageHref?: (page: number) => string;
  caption?: string;
  className?: string;
}

/**
 * Tabla declarativa: columnas, `loading` con skeleton, `empty` con acción y paginación
 * leyendo `meta`. La `key` de React sale de `rowKey`, que en las tablas de datos es
 * `ColumnSchema.key` — nunca el índice.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  skeletonRows = 5,
  empty,
  meta,
  pageHref,
  caption,
  className,
}: DataTableProps<T>) {
  if (!loading && rows.length === 0 && empty !== undefined) {
    return <EmptyState title={empty.title} description={empty.description} action={empty.action} />;
  }

  return (
    <div className={cn('w-full', className)}>
      <div className="dapi-scroll w-full overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          {caption !== undefined ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="border-b border-line">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap px-5 py-3 text-xs font-semibold uppercase tracking-wide text-content-subtle',
                    column.align === 'right' ? 'text-right' : 'text-left',
                    column.className,
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: skeletonRows }, (_unused, index) => (
                  <tr key={`skeleton-${index}`} className="border-b border-line/60">
                    {columns.map((column) => (
                      <td key={column.key} className="px-5 py-3">
                        <span className="block h-3 w-24 animate-pulse rounded bg-surface-sunken" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row, index) => (
                  <tr key={rowKey(row, index)} className="border-b border-line/60 transition-colors hover:bg-surface-sunken/60">
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          'px-5 py-3 align-top text-content',
                          column.align === 'right' ? 'text-right tabular-nums' : 'text-left',
                          column.className,
                        )}
                      >
                        {column.render(row, index)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {meta !== undefined && pageHref !== undefined ? <TablePagination meta={meta} href={pageHref} count={rows.length} /> : null}
    </div>
  );
}

function TablePagination({ meta, href, count }: { meta: PaginationMeta; href: (page: number) => string; count: number }) {
  if (meta.total === 0) return null;

  const pages = pageWindow({ page: meta.page, pages: meta.pages });
  const canPrev = meta.page > 1;
  const canNext = meta.page < meta.pages;

  return (
    <nav
      aria-label="Paginación"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-content-muted"
    >
      <span>{rangeLabel(meta.page, meta.limit, count, meta.total)}</span>

      <div className="flex items-center gap-1">
        <PageLink href={href(meta.page - 1)} disabled={!canPrev}>
          Anterior
        </PageLink>
        {pages.map((page) => (
          <Link
            key={page}
            href={href(page)}
            aria-current={page === meta.page ? 'page' : undefined}
            className={cn(
              'inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 font-medium transition-colors',
              page === meta.page ? 'bg-brand text-brand-fg' : 'text-content-muted hover:bg-surface-sunken',
            )}
          >
            {page}
          </Link>
        ))}
        <PageLink href={href(meta.page + 1)} disabled={!canNext}>
          Siguiente
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: ReactNode }) {
  const className =
    'inline-flex h-8 items-center rounded-lg px-3 font-medium transition-colors disabled:pointer-events-none disabled:opacity-40';

  if (disabled) {
    return (
      <span className={cn(className, 'cursor-not-allowed text-content-subtle')} aria-disabled="true">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={cn(className, 'text-content-muted hover:bg-surface-sunken')}>
      {children}
    </Link>
  );
}