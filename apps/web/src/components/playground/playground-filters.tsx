import { Search } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button, ButtonLink } from '@/components/ui/button';
import { Field } from '@/components/ui/label';
import { Input, Select } from '@/components/ui/field';
import { controlFor, operatorHint } from '@/lib/api/dynamic-query';
import type { ColumnSchema, FilterDef, SortDef } from '@/lib/api/types';

/**
 * Formulario del playground. Todo sale de la `EndpointDefinition`: por cada entrada de
 * `filters[]` se renderiza un control según el `op` y el tipo de la columna. No hay campos
 * libres porque la API los rechazaría con `400 FILTER_NOT_ALLOWED` (`frontend.md` §5).
 *
 * Es un `<form method="get">` sin JavaScript: la URL de la pantalla **es** la consulta, así
 * que el `curl` que se muestra es exactamente lo que se ejecutó.
 */
export function PlaygroundFilters({
  slug,
  filters,
  sort,
  schema,
  values,
  page,
  limit,
  fieldOptions,
  selectedFields,
  maxLimit,
  children,
}: {
  slug: string;
  filters: readonly FilterDef[];
  sort: readonly SortDef[];
  schema: readonly ColumnSchema[];
  values: Readonly<Record<string, string>>;
  page: number;
  limit: number;
  fieldOptions: readonly string[];
  selectedFields: readonly string[];
  maxLimit: number;
  children?: ReactNode;
}) {
  const columns = new Map(schema.map((column) => [column.key, column]));

  return (
    <form method="get" action={`/e/${slug}`} className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-content">Filtros</legend>

        {filters.length === 0 ? (
          <p className="text-xs text-content-subtle">
            Esta definición no declara filtros: cualquier parámetro de consulta da{' '}
            <code>400 FILTER_NOT_ALLOWED</code>.
          </p>
        ) : null}

        {filters.map((filter) => {
          const column = columns.get(filter.field);
          const control = controlFor(filter.op, column);
          const current = values[filter.field] ?? '';
          const label = column?.label ?? filter.field;
          const numericProps =
            control === 'number'
              ? { type: 'number' as const, step: 'any' }
              : control === 'date'
                ? { type: 'date' as const, step: undefined }
                : { type: 'text' as const, step: undefined };

          if (control === 'range') {
            const [from = '', to = ''] = current.split(',');
            return (
              <Field
                key={filter.field}
                label={`${label} · ${filter.op}`}
                hint={operatorHint(filter.op)}
                required={filter.required === true}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    name={filter.field}
                    defaultValue={from}
                    aria-label={`${label} desde`}
                    placeholder="desde"
                    {...numericProps}
                  />
                  <Input
                    name={filter.field}
                    defaultValue={to}
                    aria-label={`${label} hasta`}
                    placeholder="hasta"
                    {...numericProps}
                  />
                </div>
              </Field>
            );
          }

          return (
            <Field
              key={filter.field}
              label={`${label} · ${filter.op}`}
              hint={operatorHint(filter.op)}
              required={filter.required === true}
            >
              {control === 'select' ? (
                <Select name={filter.field} defaultValue={current}>
                  <option value="">Sin filtro</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </Select>
              ) : (
                <Input name={filter.field} defaultValue={current} placeholder={control === 'csv' ? 'A,B,C' : undefined} {...numericProps} />
              )}
            </Field>
          );
        })}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-content">Orden y paginación</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {sort.map((entry) => (
            <Field key={`${entry.field}-${entry.dir}`} label={`${columns.get(entry.field)?.label ?? entry.field} · ${entry.dir}`}>
              <Select name="sort" defaultValue={`${entry.field}:${entry.dir}`}>
                <option value={`${entry.field}:${entry.dir}`}>
                  {entry.field}:{entry.dir}
                </option>
                <option value="">— sin ordenar —</option>
              </Select>
            </Field>
          ))}

          <Field label="Filas por página" hint={`Tope del endpoint: ${maxLimit}.`}>
            <Input name="limit" type="number" min={1} max={maxLimit} defaultValue={limit} />
          </Field>

          <Field label="Página">
            <Input name="page" type="number" min={1} defaultValue={page} />
          </Field>
        </div>
      </fieldset>

      {fieldOptions.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-content">Proyección</legend>
          <div className="flex flex-wrap gap-2">
            {fieldOptions.map((key) => (
              <label
                key={key}
                className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-xs text-content-muted transition-colors hover:bg-surface-sunken"
              >
                <input
                  type="checkbox"
                  name="fields"
                  value={key}
                  defaultChecked={selectedFields.includes(key)}
                  className="h-3.5 w-3.5 accent-brand"
                />
                {columns.get(key)?.label ?? key}
              </label>
            ))}
          </div>
          <p className="text-xs text-content-subtle">
            Sólo se puede acotar la proyección, nunca ampliarla: pedir una columna fuera de <code>fields[]</code> es{' '}
            <code>400 FILTER_NOT_ALLOWED</code>.
          </p>
        </fieldset>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary">
          <Search className="h-4 w-4" aria-hidden="true" />
          Consultar
        </Button>
        <ButtonLink href={`/e/${slug}`} variant="ghost">
          Limpiar
        </ButtonLink>
        {children}
      </div>
    </form>
  );
}