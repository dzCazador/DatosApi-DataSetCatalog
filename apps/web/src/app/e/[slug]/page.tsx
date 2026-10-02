import Link from 'next/link';
import type { Metadata } from 'next';

import { ApiErrorBanner } from '@/components/api-error-banner';
import { dataColumns } from '@/components/data-columns';
import { Breadcrumb } from '@/components/layout/navbar';
import { PlaygroundFilters } from '@/components/playground/playground-filters';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle, PageHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { DataTable } from '@/components/ui/data-table';
import { Alert, EmptyState } from '@/components/ui/feedback';
import {
  apiBaseUrl,
  buildCurl,
  buildDynamicQuery,
  getDatasetSchema,
  getEndpoint,
  listEndpoints,
  queryDynamic,
} from '@/lib/api';
import { presentError } from '@/lib/api/errors';
import type { ColumnSchema, Row } from '@/lib/api/types';
import { formatDateTime, formatNumber } from '@/lib/format';
import { parsePage } from '@/lib/schema/pagination';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ slug: string }>;
}
type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Playground · ${slug}` };
}

/** `searchParams` con `string | string[]`: se aplana a texto y se vuelve a partir según el `op`. */
function flatten(params: SearchParams): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    values[key] = Array.isArray(value) ? value.join(',') : value;
  }
  return values;
}

export default async function PlaygroundPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const query = await searchParams;

  // El contrato no tiene "buscar endpoint por slug": se resuelve sobre el listado y se
  // toma el detalle, que es el único que trae `resolved`.
  const listed = await listEndpoints({ limit: 200 });
  const match = listed.ok ? listed.data.data.find((endpoint) => endpoint.slug === slug) : undefined;

  if (match === undefined) {
    return (
      <>
        <PageHeader
          title="Playground"
          breadcrumb={<Breadcrumb items={[{ label: 'Endpoints', href: '/endpoints' }, { label: slug }]} />}
        />
        {listed.ok ? (
          <Card>
            <EmptyState
              title={`No existe un endpoint con el slug «${slug}».`}
              description="El slug no existe o el endpoint está deshabilitado: la API no distingue los dos casos."
              action={
                <ButtonLink href="/endpoints" variant="primary" size="sm">
                  Ver los endpoints
                </ButtonLink>
              }
            />
          </Card>
        ) : (
          <ApiErrorBanner error={listed.error} />
        )}
      </>
    );
  }

  const detail = await getEndpoint(match._id);
  if (!detail.ok) return <ApiErrorBanner error={detail.error} />;

  const definition = detail.data;
  const schemaResult =
    definition.resolved === null ? { ok: true as const, data: { schema: [] as ColumnSchema[] } } : await getDatasetSchema(definition.resolved.datasetId);
  const schema: ColumnSchema[] = schemaResult.ok ? schemaResult.data.schema : [];

  const values = flatten(query);
  const page = parsePage(values['page']);
  const limit = limitOf(values['limit'], definition.defaultLimit, definition.maxLimit);
  const selectedFields = values['fields'] === undefined || values['fields'] === '' ? [] : values['fields'].split(',');
  const fieldOptions = definition.fields ?? schema.map((column) => column.key);

  const built = buildDynamicQuery({
    filters: definition.filters,
    sort: definition.sort,
    values,
    schema,
    page,
    limit,
    fields: selectedFields,
  });

  const payload = await queryDynamic(slug, built.params);
  const curl = buildCurl(apiBaseUrl(), slug, built.params);

  return (
    <>
      <PageHeader
        title={definition.name}
        breadcrumb={
          <Breadcrumb
            items={[
              { label: 'Endpoints', href: '/endpoints' },
              { label: definition.slug, href: `/endpoints/${definition._id}` },
              { label: 'Playground' },
            ]}
          />
        }
        description={definition.description ?? null}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={definition.enabled ? 'enabled' : 'disabled'} dot>
              {definition.enabled ? 'Habilitado' : 'Deshabilitado'}
            </Badge>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Resultado</CardTitle>
                <CardDescription>
                  {payload.ok
                    ? `${formatNumber(payload.data.meta.total, 0)} filas · página ${payload.data.meta.page} de ${Math.max(payload.data.meta.pages, 1)} · dataset v${payload.data.meta.dataset.version}`
                    : 'La consulta falló: abajo está el motivo por `code`.'}
                </CardDescription>
              </div>
              {payload.ok ? (
                <Badge variant="neutral">actualizado {formatDateTime(payload.data.meta.dataset.updatedAt)}</Badge>
              ) : null}
            </CardHeader>

            <CardBody className="space-y-4">
              {built.problems.length > 0 ? (
                <Alert
                  tone="warning"
                  title="Hay filtros que no se pueden enviar."
                  detail={built.problems.join(' · ')}
                  hint="Se mandan los que sí son válidos; la respuesta corresponde a esa consulta parcial."
                />
              ) : null}

              {built.missingRequired.length > 0 ? (
                <Alert
                  tone="warning"
                  title="Faltan filtros requeridos."
                  detail={built.missingRequired.join(', ')}
                  hint="Sin ellos la API responde 400 FILTER_NOT_ALLOWED."
                />
              ) : null}

              {payload.ok ? (
                <DataTable
                  columns={dataColumns(schema, selectedFields.length > 0 ? selectedFields : null)}
                  rows={payload.data.data}
                  rowKey={(row: Row, index) => `${index}`}
                  caption={`Filas de ${definition.slug}`}
                  empty={{
                    title: 'Ninguna fila coincide con la consulta.',
                    description: 'Los filtros están bien pero el rango no matchea. Probá subiendo el umbral.',
                    action: (
                      <ButtonLink href={`/e/${slug}`} variant="secondary" size="sm">
                        Limpiar filtros
                      </ButtonLink>
                    ),
                  }}
                />
              ) : (
                <DynamicErrorView error={payload.error} slug={slug} />
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Consulta</CardTitle>
                <CardDescription>
                  Los controles salen de <code>filters[]</code> y <code>sort[]</code>. La URL de esta pantalla es la
                  consulta.
                </CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              <PlaygroundFilters
                slug={slug}
                filters={definition.filters}
                sort={definition.sort}
                schema={schema}
                values={values}
                page={page}
                limit={limit}
                fieldOptions={fieldOptions}
                selectedFields={selectedFields.length > 0 ? selectedFields : fieldOptions}
                maxLimit={definition.maxLimit}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Equivalente en curl</CardTitle>
                <CardDescription>Para llevarte la consulta a tu código tal como la viste.</CardDescription>
              </div>
              <CopyButton value={curl} />
            </CardHeader>
            <CardBody>
              <pre className="dapi-scroll overflow-x-auto rounded-lg bg-surface-sunken p-3 font-mono text-xs text-content">
                {curl}
              </pre>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

/** Los errores del endpoint dinámico se explican por `code`: el problema suele no ser el panel. */
function DynamicErrorView({ error, slug }: { error: import('@/lib/api').ApiError; slug: string }) {
  const { title, detail, hint } = presentError(error);

  if (error.kind === 'http' && error.code === 'SLUG_NOT_FOUND') {
    return (
      <EmptyState
        title="Ese slug no existe o el endpoint está deshabilitado."
        description="La API no distingue los dos casos a propósito."
        action={
          <ButtonLink href="/endpoints" variant="secondary" size="sm">
            Ver los endpoints
          </ButtonLink>
        }
      />
    );
  }

  if (error.kind === 'http' && error.code === 'UPSTREAM_ERROR') {
    return (
      <Alert
        tone="error"
        title="El origen de datos falló."
        detail="El problema no es el panel: la fuente no respondió bien."
        action={
          <Link href="/sources" className="text-xs font-medium text-brand hover:underline">
            Revisar fuentes
          </Link>
        }
      />
    );
  }

  if (error.kind === 'http' && error.code === 'UPSTREAM_TIMEOUT') {
    return (
      <Alert tone="error" title="El origen tardó demasiado." detail="El problema no es el panel: la descarga del origen agotó el tiempo." />
    );
  }

  return (
    <Alert
      tone={error.kind === 'http' && error.status < 500 ? 'warning' : 'error'}
      title={title}
      detail={detail}
      hint={hint === null ? null : <span className="font-mono text-[11px]">{hint}</span>}
      action={
        <ButtonLink href={`/e/${slug}`} variant="secondary" size="sm">
          Limpiar filtros
        </ButtonLink>
      }
    />
  );
}

/** `?limit=` fuera de rango es `400 INVALID_PAGINATION`: se recorta para no consultar algo inválido. */
function limitOf(raw: string | undefined, fallback: number, maxLimit: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maxLimit);
}
