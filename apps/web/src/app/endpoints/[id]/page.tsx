import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { ApiErrorBanner } from '@/components/api-error-banner';
import { DeleteEndpointButton } from '@/components/endpoints/delete-endpoint-button';
import { EndpointEditor } from '@/components/endpoints/endpoint-editor';
import { ValidateEndpointButton } from '@/components/endpoints/validate-endpoint-button';
import { Breadcrumb } from '@/components/layout/navbar';
import { Badge, STATUS_LABELS } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import {
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  DescriptionItem,
  DescriptionList,
  PageHeader,
} from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { updateEndpointAction } from '@/lib/actions/endpoints';
import { getDatasetSchema, getEndpoint, listDatasets, listSources } from '@/lib/api';
import type { ColumnSchema } from '@/lib/api/types';
import { EMPTY_CELL, formatDateTime, formatNumber } from '@/lib/format';
import { declaredButMissing } from '@/lib/schema/endpoint-form';
import { ADMIN_MAX_LIMIT } from '@/lib/schema/pagination';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const endpoint = await getEndpoint(id);
  return { title: endpoint.ok ? endpoint.data.name : 'Endpoint' };
}

export default async function EndpointDetailPage({ params }: Params) {
  const { id } = await params;
  const endpoint = await getEndpoint(id);

  if (!endpoint.ok) {
    if (endpoint.error.kind === 'http' && endpoint.error.code === 'ENDPOINT_NOT_FOUND') notFound();
    return (
      <>
        <PageHeader
          title="Endpoint"
          breadcrumb={<Breadcrumb items={[{ label: 'Endpoints', href: '/endpoints' }, { label: id }]} />}
        />
        <ApiErrorBanner error={endpoint.error} />
      </>
    );
  }

  const data = endpoint.data;

  const [sources, published, schemaResult] = await Promise.all([
    listSources({ limit: ADMIN_MAX_LIMIT }),
    listDatasets({ status: 'published', limit: ADMIN_MAX_LIMIT }),
    data.resolved === null
      ? Promise.resolve({ ok: true as const, data: { schema: [] as ColumnSchema[] } })
      : getDatasetSchema(data.resolved.datasetId),
  ]);

  const schema = schemaResult.ok ? schemaResult.data.schema : [];
  const missing = declaredButMissing(data, schema);

  return (
    <>
      <PageHeader
        title={data.name}
        breadcrumb={<Breadcrumb items={[{ label: 'Endpoints', href: '/endpoints' }, { label: data.slug }]} />}
        description={data.description ?? null}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink href={`/e/${data.slug}`} variant="primary" size="md">
              Abrir playground
            </ButtonLink>
            <DeleteEndpointButton endpointId={id} slug={data.slug} />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {!data.enabled ? (
            <Alert
              tone="warning"
              title="Este endpoint está deshabilitado."
              detail="GET /e/:slug responde 404 SLUG_NOT_FOUND, igual que si no existiera. Habilitalo para publicarlo."
            />
          ) : null}

          {data.resolved === null ? (
            <Alert
              tone="warning"
              title="La definición no resuelve ningún dataset."
              detail={data.resolvedReason ?? 'La fuente todavía no tiene nada publicado.'}
              action={
                <Link href={`/sources/${data.sourceId}`} className="text-xs font-medium text-brand hover:underline">
                  Ir a la fuente
                </Link>
              }
            />
          ) : (
            <Alert
              tone={data.resolved.status === 'published' ? 'success' : 'warning'}
              title={`Resuelve el dataset v${data.resolved.version} (${STATUS_LABELS[data.resolved.status]})`}
              detail={`${formatNumber(data.resolved.rowCount, 0)} filas. Sólo los datasets publicados se sirven.`}
              action={
                <Link
                  href={`/datasets/${data.resolved.datasetId}`}
                  className="text-xs font-medium text-brand hover:underline"
                >
                  Ver dataset
                </Link>
              }
            />
          )}

          {schemaResult.ok && missing.length > 0 ? (
            <Alert
              tone="error"
              title="La definición declara columnas que el schema ya no tiene."
              detail={missing.map((item) => `${item.where} → ${item.field}`).join(' · ')}
              hint="Pasó después de una reingesta. Usá Validar para el detalle y corregí la definición."
            />
          ) : null}

          <EndpointEditor
            sources={sources.ok ? sources.data.data : []}
            publishedDatasets={published.ok ? published.data.data : []}
            schema={schema}
            slugLocked
            submitLabel="Guardar cambios"
            successMessage="Definición actualizada."
            action={updateEndpointAction.bind(null, id)}
            defaults={{
              name: data.name,
              slug: data.slug,
              description: data.description ?? '',
              sourceId: data.sourceId,
              datasetId: data.datasetId ?? '',
              followLatest: data.followLatest,
              fields: data.fields ?? [],
              filters: data.filters.map((filter) => ({
                id: `filter-${filter.field}-${filter.op}`,
                field: filter.field,
                op: filter.op,
                required: filter.required ?? false,
              })),
              sort: data.sort.map((entry, index) => ({
                id: `sort-${entry.field}-${index}`,
                field: entry.field,
                dir: entry.dir,
              })),
              defaultLimit: String(data.defaultLimit),
              maxLimit: String(data.maxLimit),
              enabled: data.enabled,
            }}
            extraActions={<ValidateEndpointButton endpointId={id} />}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Estado</CardTitle>
              <Badge variant={data.enabled ? 'enabled' : 'disabled'} dot>
                {data.enabled ? 'Habilitado' : 'Deshabilitado'}
              </Badge>
            </CardHeader>
            <CardBody>
              <DescriptionList className="sm:grid-cols-1">
                <DescriptionItem term="Slug" mono>
                  /e/{data.slug}
                </DescriptionItem>
                <DescriptionItem term="followLatest">{data.followLatest ? 'Sí' : 'No'}</DescriptionItem>
                <DescriptionItem term="Dataset fijado" mono>
                  {data.datasetId ?? EMPTY_CELL}
                </DescriptionItem>
                <DescriptionItem term="defaultLimit">{formatNumber(data.defaultLimit, 0)}</DescriptionItem>
                <DescriptionItem term="maxLimit">{formatNumber(data.maxLimit, 0)}</DescriptionItem>
                <DescriptionItem term="Creado">{formatDateTime(data.createdAt)}</DescriptionItem>
                <DescriptionItem term="Actualizado">{formatDateTime(data.updatedAt)}</DescriptionItem>
              </DescriptionList>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Definición actual</CardTitle>
                <CardDescription>Lo que la API valida en cada request.</CardDescription>
              </div>
            </CardHeader>
            <CardBody className="space-y-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-content-subtle">Campos expuestos</p>
                {data.fields === undefined || data.fields.length === 0 ? (
                  <p className="mt-1 text-xs text-content-muted">Todas las columnas del schema.</p>
                ) : (
                  <p className="mt-1 font-mono text-xs text-content">{data.fields.join(', ')}</p>
                )}
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-content-subtle">Filtros permitidos</p>
                {data.filters.length === 0 ? (
                  <p className="mt-1 text-xs text-content-muted">Ninguno: cualquier parámetro da 400.</p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {data.filters.map((filter) => (
                      <li key={`${filter.field}-${filter.op}`} className="font-mono text-xs text-content">
                        ?{filter.field} <span className="text-content-subtle">{filter.op}</span>
                        {filter.required === true ? (
                          <span className="ml-1 text-[10px] uppercase text-status-pending">requerido</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-content-subtle">Orden permitido</p>
                {data.sort.length === 0 ? (
                  <p className="mt-1 text-xs text-content-muted">Ninguno: ?sort da 400 SORT_NOT_ALLOWED.</p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {data.sort.map((entry) => (
                      <li key={`${entry.field}-${entry.dir}`} className="font-mono text-xs text-content">
                        {entry.field}:{entry.dir}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}