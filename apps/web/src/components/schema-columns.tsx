import type { ColumnSchema } from '@/lib/api/types';
import { formatNumber } from '@/lib/format';
import type { Column } from './ui/data-table';

const TYPE_LABEL: Readonly<Record<ColumnSchema['type'], string>> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  date: 'date',
  json: 'json',
};

/** Tabla del `schema` de un dataset: `key`, `label`, `type`, `nullable`, `decimalScale`. */
export function schemaColumns(): Array<Column<ColumnSchema>> {
  return [
    {
      key: 'key',
      header: 'Clave',
      render: (column) => <span className="font-mono text-xs">{column.key}</span>,
    },
    { key: 'label', header: 'Etiqueta', render: (column) => column.label },
    {
      key: 'type',
      header: 'Tipo',
      render: (column) => <span className="font-mono text-xs">{TYPE_LABEL[column.type]}</span>,
    },
    {
      key: 'nullable',
      header: 'Nulo',
      render: (column) => (column.nullable ? 'sí' : 'no'),
    },
    {
      key: 'decimalScale',
      header: 'Escala',
      align: 'right',
      render: (column) => (column.decimalScale === undefined ? '—' : String(column.decimalScale)),
    },
    {
      key: 'source',
      header: 'Origen',
      render: (column) => column.source ?? '—',
    },
  ];
}

/** Ejemplo de cómo se ve una columna con `formatNumber`, para leer el schema de un vistazo. */
export function decimalExample(column: ColumnSchema): string | null {
  if (column.type !== 'number' || column.decimalScale === undefined) return null;
  const sample = column.decimalScale === 4 ? 0.15 : 1.5;
  return formatNumber(sample, column.decimalScale);
}