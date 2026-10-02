'use client';

import { useEffect, useState, useTransition, type ReactNode } from 'react';

import {
  DefinitionLists,
  type EditorFilterRow,
  type EditorSortRow,
} from '@/components/endpoints/definition-lists';
import { ActionForm, SubmitButton, type ServerAction } from '@/components/ui/action-form';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/field';
import { Field } from '@/components/ui/label';
import { loadDatasetSchemaAction } from '@/lib/actions/schema';
import { apiBaseUrl } from '@/lib/api/client';
import type { ColumnSchema, DatasetListItem, Source } from '@/lib/api/types';
import { slugify, validateSlug } from '@/lib/schema/slug';

export interface EndpointEditorDefaults {
  name?: string;
  slug?: string;
  description?: string;
  sourceId?: string;
  datasetId?: string;
  followLatest?: boolean;
  fields?: readonly string[];
  filters?: readonly EditorFilterRow[];
  sort?: readonly EditorSortRow[];
  defaultLimit?: string;
  maxLimit?: string;
  enabled?: boolean;
}

export interface EndpointEditorProps {
  /** Fuentes habilitadas como origen del endpoint. */
  sources: readonly Source[];
  /** Sólo datasets `published`: es lo único que un endpoint puede servir. */
  publishedDatasets: readonly DatasetListItem[];
  defaults: EndpointEditorDefaults;
  /**
   * Schema conocido de antemano. El detalle lo tiene (el dataset resuelto); el alta lo pide
   * on-demand cuando se elige un dataset.
   */
  schema?: readonly ColumnSchema[];
  submitLabel: string;
  /** El slug ya existe y es inmutable: se muestra fijo, nunca editable. */
  slugLocked?: boolean;
  action: ServerAction;
  successMessage?: string;
  /** Botones secundarios (Validar, Borrar) que quedan junto al submit. */
  extraActions?: ReactNode;
}

const EMPTY_FILTERS: EditorFilterRow[] = [];
const EMPTY_SORT: EditorSortRow[] = [];

/**
 * Editor de la definición de un endpoint. Los desplegables de `fields`, `filters` y `sort`
 * se llenan con el `schema` del dataset resuelto: nunca hay un campo de texto libre para
 * una clave de columna, que es justamente lo que produciría un `422 SCHEMA_MISMATCH`.
 */
export function EndpointEditor({
  sources,
  publishedDatasets,
  defaults,
  schema: initialSchema,
  submitLabel,
  slugLocked = false,
  action,
  successMessage,
  extraActions,
}: EndpointEditorProps) {
  const [name, setName] = useState(defaults.name ?? '');
  const [slug, setSlug] = useState(defaults.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(slugLocked);
  const [sourceId, setSourceId] = useState(defaults.sourceId ?? '');
  const [datasetId, setDatasetId] = useState(defaults.datasetId ?? '');
  const [followLatest, setFollowLatest] = useState(defaults.followLatest ?? true);
  const [enabled, setEnabled] = useState(defaults.enabled ?? true);
  const [defaultLimit, setDefaultLimit] = useState(defaults.defaultLimit ?? '50');
  const [maxLimit, setMaxLimit] = useState(defaults.maxLimit ?? '500');
  const [fields, setFields] = useState<string[]>([...(defaults.fields ?? [])]);
  const [filters, setFilters] = useState<EditorFilterRow[]>([...(defaults.filters ?? EMPTY_FILTERS)]);
  const [sort, setSort] = useState<EditorSortRow[]>([...(defaults.sort ?? EMPTY_SORT)]);

  const [schema, setSchema] = useState<ColumnSchema[]>([...(initialSchema ?? [])]);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [loadingSchema, startLoading] = useTransition();

  const datasetsForSource = publishedDatasets.filter((dataset) => dataset.sourceId === sourceId);
  const slugCheck = validateSlug(slug);

  useEffect(() => {
    if (initialSchema !== undefined) {
      setSchema([...initialSchema]);
      setSchemaError(null);
      return;
    }
    if (datasetId === '') {
      setSchema([]);
      setSchemaError(null);
      return;
    }

    let cancelled = false;
    startLoading(async () => {
      const result = await loadDatasetSchemaAction(datasetId);
      if (cancelled) return;
      setSchema(result.schema);
      setSchemaError(result.ok ? null : result.message);
    });

    return () => {
      cancelled = true;
    };
  }, [datasetId, initialSchema]);

  const onNameChange = (value: string) => {
    setName(value);
    if (slugTouched) return;
    setSlug(slugify(value));
  };

  const toggleField = (key: string) => {
    setFields((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{slugLocked ? 'Definición del endpoint' : 'Nuevo endpoint'}</CardTitle>
          <CardDescription>
            {slugLocked
              ? 'El slug es la URL pública del endpoint y no se puede cambiar una vez creado.'
              : 'El slug es la URL pública: minúsculas, números y guiones simples.'}
          </CardDescription>
        </div>
      </CardHeader>

      <CardBody>
        <ActionForm action={action} successMessage={successMessage}>
          <input type="hidden" name="sourceId" value={sourceId} />
          <input type="hidden" name="followLatest" value={String(followLatest)} />
          <input type="hidden" name="enabled" value={String(enabled)} />
          <input type="hidden" name="datasetId" value={followLatest ? '' : datasetId} />
          <input type="hidden" name="defaultLimit" value={defaultLimit} />
          <input type="hidden" name="maxLimit" value={maxLimit} />
          {slugLocked ? <input type="hidden" name="slug" value={slug} /> : null}
          {schema.map((column) => (
            <input key={column.key} type="hidden" name="schemaKey" value={column.key} />
          ))}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Field label="Nombre" htmlFor="name" required>
              <Input id="name" name="name" maxLength={200} value={name} onChange={(event) => onNameChange(event.target.value)} required />
            </Field>

            <Field
              label="Slug"
              htmlFor="slug"
              required={!slugLocked}
              error={slug.length > 0 && !slugCheck.ok ? slugCheck.message : null}
              hint={slugCheck.ok ? <code>{`${apiBaseUrl()}/e/${slugCheck.slug}`}</code> : 'Entre 3 y 80 caracteres.'}
            >
              {slugLocked ? (
                <Input id="slug" value={slug} readOnly disabled />
              ) : (
                <Input
                  id="slug"
                  name="slug"
                  value={slug}
                  onChange={(event) => {
                    setSlugTouched(true);
                    setSlug(event.target.value);
                  }}
                  required
                />
              )}
            </Field>

            <Field label="Descripción" htmlFor="description" className="lg:col-span-2">
              <Input id="description" name="description" maxLength={1000} defaultValue={defaults.description ?? ''} />
            </Field>

            <Field label="Fuente" htmlFor="source-select" required>
              <Select
                id="source-select"
                value={sourceId}
                onChange={(event) => {
                  setSourceId(event.target.value);
                  setDatasetId('');
                }}
              >
                <option value="">Elegí una fuente…</option>
                {sources.map((source) => (
                  <option key={source._id} value={source._id}>
                    {source.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Dataset"
              htmlFor="dataset-select"
              required={!followLatest}
              hint={
                followLatest
                  ? 'Sólo para armar la definición: con followLatest el dataset se resuelve en cada request.'
                  : undefined
              }
            >
              <Select
                id="dataset-select"
                value={datasetId}
                onChange={(event) => setDatasetId(event.target.value)}
              >
                <option value="">
                  {datasetsForSource.length === 0 ? 'Sin datasets publicados en esa fuente' : 'Sin fijar'}
                </option>
                {datasetsForSource.map((dataset) => (
                  <option key={dataset._id} value={dataset._id}>
                    v{dataset.version} · {dataset.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-6 rounded-lg border border-line bg-surface-sunken/40 p-3">
            <Toggle
              label="followLatest"
              checked={followLatest}
              onChange={setFollowLatest}
              hint="Usa el último dataset publicado de la fuente en cada request."
            />
            <Toggle label="Habilitado" checked={enabled} onChange={setEnabled} hint="Deshabilitado responde 404 SLUG_NOT_FOUND." />
          </div>

          <div className="mt-6 space-y-2 border-t border-line pt-5">
            <h3 className="text-sm font-medium text-content">Límites de paginación</h3>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="defaultLimit" htmlFor="defaultLimit-input" hint="Registros por request sin `?limit=`.">
                <Input
                  id="defaultLimit-input"
                  inputMode="numeric"
                  value={defaultLimit}
                  onChange={(event) => setDefaultLimit(event.target.value)}
                />
              </Field>
              <Field
                label="maxLimit"
                htmlFor="maxLimit-input"
                hint="Tope duro; pasarse es 400 INVALID_PAGINATION, no un recorte silencioso."
              >
                <Input id="maxLimit-input" inputMode="numeric" value={maxLimit} onChange={(event) => setMaxLimit(event.target.value)} />
              </Field>
            </div>
          </div>

          <div className="mt-6 border-t border-line pt-5">
            <h3 className="mb-3 text-sm font-medium text-content">Proyección y consulta</h3>
            {loadingSchema ? (
              <p className="text-xs text-content-subtle">Cargando el schema del dataset…</p>
            ) : schemaError !== null ? (
              <p className="text-xs text-status-error">{schemaError}</p>
            ) : schema.length === 0 ? (
              <p className="text-xs text-content-subtle">
                Elegí un dataset publicado para definir columnas, filtros y orden contra su schema.
              </p>
            ) : (
              <DefinitionLists
                schema={schema}
                selectedFields={fields}
                onToggleField={toggleField}
                filters={filters}
                onFiltersChange={setFilters}
                sort={sort}
                onSortChange={setSort}
              />
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <SubmitButton>{submitLabel}</SubmitButton>
            {extraActions}
          </div>
        </ActionForm>
      </CardBody>
    </Card>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-content">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-brand" />
      <span>
        {label}
        <span className="block text-xs text-content-subtle">{hint}</span>
      </span>
    </label>
  );
}