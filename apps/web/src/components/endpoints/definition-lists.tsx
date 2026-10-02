'use client';

import { Plus, X } from 'lucide-react';
import { useRef } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { FILTER_OPERATORS, operatorHint } from '@/lib/api/dynamic-query';
import type { ColumnSchema, FilterOperator, SortDirection } from '@/lib/api/types';
import { cn } from '@/lib/cn';

/** Identidad estable de una fila del editor: no se reindexa al borrar otra. */
export interface EditorFilterRow {
  id: string;
  field: string;
  op: FilterOperator;
  required: boolean;
}

export interface EditorSortRow {
  id: string;
  field: string;
  dir: SortDirection;
}

/**
 * Fila de filtro editable. El desplegable de columna ofrece **sólo** claves del `schema`
 * del dataset resuelto: no hay campo de texto libre, así que el editor no puede producir un
 * `422 SCHEMA_MISMATCH`.
 */
function FilterRow({
  row,
  schema,
  onChange,
  onRemove,
}: {
  row: EditorFilterRow;
  schema: readonly ColumnSchema[];
  onChange: (next: EditorFilterRow) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-sunken/40 p-2">
      <label className="sr-only" htmlFor={`filter-field-${row.id}`}>
        Columna del filtro
      </label>
      <Select
        id={`filter-field-${row.id}`}
        name="filterField"
        value={row.field}
        onChange={(event) => onChange({ ...row, field: event.target.value })}
        className="h-9 min-w-48 flex-1 text-xs"
      >
        <option value="">Elegí una columna…</option>
        {schema.map((column) => (
          <option key={column.key} value={column.key}>
            {column.label} ({column.key})
          </option>
        ))}
      </Select>

      <label className="sr-only" htmlFor={`filter-op-${row.id}`}>
        Operador del filtro
      </label>
      <Select
        id={`filter-op-${row.id}`}
        name="filterOp"
        value={row.op}
        onChange={(event) => onChange({ ...row, op: event.target.value as FilterOperator })}
        className="h-9 w-56 text-xs"
      >
        {FILTER_OPERATORS.map((op) => (
          <option key={op} value={op}>
            {op} — {operatorHint(op)}
          </option>
        ))}
      </Select>

      <label className="inline-flex items-center gap-1.5 text-xs text-content-muted">
        <input
          type="checkbox"
          name="filterRequired"
          value="true"
          checked={row.required}
          onChange={(event) => onChange({ ...row, required: event.target.checked })}
          className="h-3.5 w-3.5 accent-brand"
        />
        requerido
      </label>

      <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label="Quitar el filtro">
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </li>
  );
}

function SortRow({
  row,
  schema,
  onChange,
  onRemove,
}: {
  row: EditorSortRow;
  schema: readonly ColumnSchema[];
  onChange: (next: EditorSortRow) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-sunken/40 p-2">
      <label className="sr-only" htmlFor={`sort-field-${row.id}`}>
        Columna de orden
      </label>
      <Select
        id={`sort-field-${row.id}`}
        name="sortField"
        value={row.field}
        onChange={(event) => onChange({ ...row, field: event.target.value })}
        className="h-9 min-w-48 flex-1 text-xs"
      >
        <option value="">Elegí una columna…</option>
        {schema.map((column) => (
          <option key={column.key} value={column.key}>
            {column.label} ({column.key})
          </option>
        ))}
      </Select>

      <label className="sr-only" htmlFor={`sort-dir-${row.id}`}>
        Dirección del orden
      </label>
      <Select
        id={`sort-dir-${row.id}`}
        name="sortDir"
        value={row.dir}
        onChange={(event) => onChange({ ...row, dir: event.target.value as SortDirection })}
        className="h-9 w-32 text-xs"
      >
        <option value="asc">asc</option>
        <option value="desc">desc</option>
      </Select>

      <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label="Quitar el orden">
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </li>
  );
}

/**
 * Bloques de `fields`, `filters` y `sort` del editor. Es cliente porque administra filas
 * dinámicas; el servidor igual revalida cada referencia contra el `schema`.
 */
export function DefinitionLists({
  schema,
  selectedFields,
  onToggleField,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  disabled = false,
}: {
  schema: readonly ColumnSchema[];
  selectedFields: readonly string[];
  onToggleField: (key: string) => void;
  filters: EditorFilterRow[];
  onFiltersChange: (next: EditorFilterRow[]) => void;
  sort: EditorSortRow[];
  onSortChange: (next: EditorSortRow[]) => void;
  disabled?: boolean;
}) {
  const sequence = useRef(0);
  const nextId = () => {
    sequence.current += 1;
    return `row-${sequence.current}`;
  };

  const freeFilterColumn = schema.find((column) => !filters.some((filter) => filter.field === column.key))?.key ?? '';
  const freeSortColumn = schema.find((column) => !sort.some((entry) => entry.field === column.key))?.key ?? '';

  return (
    <div className="space-y-6">
      <fieldset disabled={disabled} className="space-y-2">
        <legend className="text-sm font-medium text-content">Columnas expuestas (`fields`)</legend>
        <p className="text-xs text-content-subtle">
          Sin selección se publican todas las columnas del schema. Elegir una submuestra acota la proyección y también
          limita el <code>?fields=</code> del playground.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {schema.map((column) => {
            const checked = selectedFields.includes(column.key);
            return (
              <label
                key={column.key}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                  checked
                    ? 'border-brand bg-brand-soft text-brand'
                    : 'border-line text-content-muted hover:bg-surface-sunken',
                )}
              >
                <input
                  type="checkbox"
                  name="fields"
                  value={column.key}
                  checked={checked}
                  onChange={() => onToggleField(column.key)}
                  className="h-3.5 w-3.5 accent-brand"
                />
                {column.label}
                <span className="font-mono text-[10px] opacity-70">{column.key}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset disabled={disabled} className="space-y-2">
        <legend className="text-sm font-medium text-content">Filtros permitidos (`filters`)</legend>
        <p className="text-xs text-content-subtle">
          Es el allowlist: lo que no esté acá, el endpoint lo rechaza con{' '}
          <code>400 FILTER_NOT_ALLOWED</code>.
        </p>
        <ul className="space-y-2">
          {filters.map((row, index) => (
            <FilterRow
              key={row.id}
              row={row}
              schema={schema}
              onChange={(next) => onFiltersChange(filters.map((item, i) => (i === index ? next : item)))}
              onRemove={() => onFiltersChange(filters.filter((_unused, i) => i !== index))}
            />
          ))}
        </ul>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || freeFilterColumn === ''}
          onClick={() => onFiltersChange([...filters, { id: nextId(), field: freeFilterColumn, op: 'eq', required: false }])}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Agregar filtro
        </Button>
      </fieldset>

      <fieldset disabled={disabled} className="space-y-2">
        <legend className="text-sm font-medium text-content">Orden permitido (`sort`)</legend>
        <ul className="space-y-2">
          {sort.map((row, index) => (
            <SortRow
              key={row.id}
              row={row}
              schema={schema}
              onChange={(next) => onSortChange(sort.map((item, i) => (i === index ? next : item)))}
              onRemove={() => onSortChange(sort.filter((_unused, i) => i !== index))}
            />
          ))}
        </ul>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || freeSortColumn === ''}
          onClick={() => onSortChange([...sort, { id: nextId(), field: freeSortColumn, dir: 'asc' }])}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Agregar orden
        </Button>
      </fieldset>

      <p className="text-xs text-content-subtle">
        Columnas del schema:{' '}
        {schema.length === 0 ? (
          <Badge variant="warning">el dataset resuelto no tiene schema</Badge>
        ) : (
          <span className="font-mono">{schema.map((column) => column.key).join(', ')}</span>
        )}
      </p>
    </div>
  );
}