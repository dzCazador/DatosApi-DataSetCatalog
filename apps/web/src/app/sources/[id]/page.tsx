import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { ApiErrorBanner } from '@/components/api-error-banner';
import { Breadcrumb } from '@/components/layout/navbar';
import { DeleteSourceButton } from '@/components/sources/delete-source-button';
import { IngestPanel } from '@/components/sources/ingest-panel';
import { Badge, STATUS_LABELS } from '@/components/ui/badge';
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
import { Column, DataTable } from '@/components/ui/data-table';
import { Alert } from '@/components/ui/feedback';
import { getSource, listEndpoints, listSourceDatasets } from '@/lib/api';
import type { DatasetListItem, Source } from '@/lib/api/types';
import { formatDateTime, formatDuration, formatNumber } from '@/lib/format';
import { SOURCE_TYPE_LABELS } from '@/lib/schema/source-form';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const source = await getSource(id);
  return { title: source.ok ? source.data.name : 'Fuente' };
}

export default async function SourceDetailPage({ params }: Params) {
  const { id } = await params;
  const source = await getSource(id);

  if (!source.ok) {
    if (source.error.kind === 'http' && source.error.code === 'SOURCE_NOT_FOUND') notFound();
    return (
      <>
        <PageHeader title="Fuente" breadcrumb={<Breadcrumb items={[{ label: 'Fuentes', href: '/sources' }, { label: id }]} />} />
        <ApiErrorBanner error={source.error} />
      </>
    );
  }

  const [datasets, endpoints] = await Promise.all([
    listSourceDatasets(id, { limit: 50 }),
    listEndpoints({ limit: 200 }),
  ]);

  const affectedEndpoints = endpoints.ok ? endpoints.data.data.filter((item) => item.sourceId === id) : [];
  const datasetRows = datasets.ok ? datasets.data.data : [];

  return (
    <>
      <PageHeader
        title={source.data.name}
        breadcrumb={
          <Breadcrumb
            items={[{ label: 'Fuentes', href: '/sources' }, { label: source.data.name }]}
          />
        }
        description={source.data.description ?? null}
        actions={<DeleteSourceButton sourceId={id} endpointCount={affectedEndpoints.length} />}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {source.data.status === 'error' && source.data.lastError !== undefined ? (
            <Alert tone="error" title="La última ingesta falló." detail={source.data.lastError} />
          ) : null}

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Identidad</CardTitle>
                <CardDescription>El `config` se muestra en solo lectura: cambiarlo es parte del diseño.</CardDescription>
              </div>
              <Badge variant={source.data.status} dot>
                {STATUS_LABELS[source.data.status]}
              </Badge>
            </CardHeader>
            <CardBody>
              <DescriptionList>
                <DescriptionItem term="Tipo">{SOURCE_TYPE_LABELS[source.data.type]}</DescriptionItem>
                <DescriptionItem term="Id">
                  <code className="font-mono text-xs">{source.data._id}</code>
                </DescriptionItem>
                <DescriptionItem term="Última ingesta">{formatDateTime(source.data.lastIngestAt)}</DescriptionItem>
                <DescriptionItem term="Creada">{formatDateTime(source.data.createdAt)}</DescriptionItem>
                <DescriptionItem term="Actualizada">{formatDateTime(source.data.updatedAt)}</DescriptionItem>
                <DescriptionItem term="Último dataset">
                  {source.data.lastDatasetId === undefined ? (
                    '—'
                  ) : (
                    <Link href={`/datasets/${source.data.lastDatasetId}`} className="font-mono text-xs hover:text-brand">
                      {source.data.lastDatasetId}
                    </Link>
                  )}
                </DescriptionItem>
              </DescriptionList>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Configuración</CardTitle>
                <CardDescription>
                  Variante <code>{source.data.type}</code> del <code>SourceConfig</code>. Los <code>rows</code> y el{' '}
                  <code>schema</code> no se editan desde la UI: los datos cambian reingeriendo.
                </CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              <ConfigView source={source.data} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Versiones del dataset</CardTitle>
                <CardDescription>Cada ingesta agrega una versión; las publicadas no se mutan.</CardDescription>
              </div>
              <Link href={`/datasets?sourceId=${id}`} className="text-xs font-medium text-brand hover:underline">
                Ver en Datasets
              </Link>
            </CardHeader>
            {datasets.ok ? (
              <DataTable<DatasetListItem>
                columns={datasetColumns()}
                rows={datasetRows}
                rowKey={(dataset) => dataset._id}
                caption={`Datasets de ${source.data.name}`}
                empty={{
                  title: 'Esta fuente todavía no produjo ningún dataset.',
                  description: 'Dispará la ingesta para generar la versión 1.',
                }}
              />
            ) : (
              <CardBody>
                <ApiErrorBanner error={datasets.error} />
              </CardBody>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <IngestPanel sourceId={id} status={source.data.status} />

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Endpoints asociados</CardTitle>
                <CardDescription>Los que apuntan a esta fuente.</CardDescription>
              </div>
            </CardHeader>
            <CardBody className="space-y-2">
              {affectedEndpoints.length === 0 ? (
                <p className="text-xs text-content-subtle">Ninguno todavía.</p>
              ) : (
                affectedEndpoints.map((endpoint) => (
                  <div key={endpoint._id} className="flex items-center justify-between gap-3">
                    <Link href={`/endpoints/${endpoint._id}`} className="min-w-0 truncate text-sm hover:text-brand">
                      {endpoint.name}
                    </Link>
                    <Badge variant={endpoint.enabled ? 'enabled' : 'disabled'} dot>
                      {endpoint.enabled ? 'On' : 'Off'}
                    </Badge>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

/** Sólo las claves que la variante declara: nada inventado, nada de otro tipo. */
function ConfigView({ source }: { source: Source }) {
  const entries = configEntries(source);

  return (
    <dl className="space-y-3">
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-content-subtle">{key}</dt>
          <dd className="mt-1">
            {typeof value === 'string' ? (
              key === 'payload' ? (
                <pre className="dapi-scroll max-h-56 overflow-auto rounded-lg bg-surface-sunken p-3 font-mono text-xs text-content">
                  {value}
                </pre>
              ) : (
                <code className="break-all font-mono text-xs text-content">{value}</code>
              )
            ) : key === 'requestHeaders' ? (
              <pre className="dapi-scroll max-h-40 overflow-auto rounded-lg bg-surface-sunken p-3 font-mono text-xs text-content">
                {JSON.stringify(value, null, 2)}
              </pre>
            ) : (
              <code className="break-all font-mono text-xs text-content">{String(value)}</code>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function configEntries(source: Source): Array<[string, unknown]> {
  const config: Record<string, unknown> = { ...source.config };
  const entries = Object.entries(config).map(([key, value]) => [key, value] as [string, unknown]);
  return entries.filter(([, value]) => value !== undefined);
}

function datasetColumns(): Array<Column<DatasetListItem>> {
  return [
    {
      key: 'version',
      header: 'Versión',
      render: (dataset) => <span className="tabular-nums">v{dataset.version}</span>,
    },
    {
      key: 'name',
      header: 'Nombre',
      render: (dataset) => (
        <Link href={`/datasets/${dataset._id}`} className="font-medium text-content hover:text-brand">
          {dataset.name}
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (dataset) => <Badge variant={dataset.status}>{STATUS_LABELS[dataset.status]}</Badge>,
    },
    {
      key: 'rowCount',
      header: 'Filas',
      align: 'right',
      render: (dataset) => <span className="tabular-nums">{formatNumber(dataset.rowCount, 0)}</span>,
    },
    {
      key: 'columnsCount',
      header: 'Columnas',
      align: 'right',
      render: (dataset) => <span className="tabular-nums">{formatNumber(dataset.columnsCount, 0)}</span>,
    },
    {
      key: 'warnings',
      header: 'Advertencias',
      render: (dataset) =>
        dataset.warnings.length === 0 ? (
          '—'
        ) : (
          <span title={dataset.warnings.join(' · ')}>{formatNumber(dataset.warnings.length, 0)}</span>
        ),
    },
    {
      key: 'updatedAt',
      header: 'Actualizado',
      render: (dataset) => <span className="text-xs text-content-muted">{formatDateTime(dataset.updatedAt)}</span>,
    },
    {
      key: 'duration',
      header: 'Duración',
      align: 'right',
      render: (dataset) => <span className="text-xs tabular-nums">{formatDuration(dataset.meta.durationMs)}</span>,
    },
  ];
}