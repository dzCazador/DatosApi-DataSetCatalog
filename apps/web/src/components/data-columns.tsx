import type { ColumnSchema, Row } from '@/lib/api/types';
import { formatCell } from '@/lib/format';
import type { Column } from './ui/data-table';

/**
 * Columnas de una tabla de datos derivadas **sólo** del `schema`: el encabezado es
 * `ColumnSchema.label` y el cuerpo sale de `formatCell` con el `type` y el `decimalScale`
 * de la columna. No hay ni un nombre de columna hardcodeado (`frontend.md` §6.1).
 */
export function dataColumns(schema: readonly ColumnSchema[], projection?: readonly string[] | null): Array<Column<Row>> {
  const visible = projection === undefined || projection === null
    ? schema
    : schema.filter((column) => projection.includes(column.key));

  return visible.map((column) => ({
    key: column.key,
    header: column.label,
    align: column.type === 'number' ? 'right' : 'left',
    render: (row: Row) => formatCell(column, row[column.key]),
  }));
}