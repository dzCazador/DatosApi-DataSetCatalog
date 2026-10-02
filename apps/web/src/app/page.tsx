import { Database, Layers, Link2, Radio } from 'lucide-react';
import Link from 'next/link';

import { ApiErrorBanner, firstApiError } from '@/components/api-error-banner';
import { Badge, STATUS_LABELS, WarningsBadge } from '@/components/ui/badge';
import { Card, CardBody, CardDescription, CardHeader, CardTitle, PageHeader } from '@/components/ui/card';
import { Alert, StatCard } from '@/components/ui/feedback';
import { listDatasets, listEndpoints, listSources } from '@/lib/api';
import type { DatasetListItem, EndpointDefinition, Source, SourceStatus } from '@/lib/api/types';
import { EMPTY_CELL, formatDateTime, formatNumber } from '@/lib/format';
import { ADMIN_MAX_LIMIT } from '@/lib/schema/pagination';

const SOURCE_STATUSES = ['pending', 'processing', 'ready', 'error'] as const satisfies readonly SourceStatus[];

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const [sourcesTotal, statusCounts, publishedTotal, enabledTotal, recentDatasets, sources, endpoints] = await Promise.all([
    listSources({ limit: 1 }),
    Promise.all(SOURCE_STATUSES.map((status) => listSources({ status, limit: 1 }))),
    listDatasets({ status: 'published', limit: 1 }),
    listEndpoints({ enabled: true, limit: 1 }),
    listDatasets({ limit: 6 }),
    listSources({ limit: ADMIN_MAX_LIMIT }),
    listEndpoints({ limit: ADMIN_MAX_LIMIT }),
  ]);

  const countsByStatus = new Map<SourceStatus, number>(
    SOURCE_STATUSES.map((status, index) => [status, statusCounts[index]?.ok === true ? statusCounts[index].data.meta.total : 0]),
  );

  const failure = firstApiError([
    sourcesTotal,
    publishedTotal,
    enabledTotal,
    recentDatasets,
    sources,
    endpoints,
    ...statusCounts,
  ]);

  const sourceRows = sources.ok ? sources.data.data : [];
  const recentRows = recentDatasets.ok ? recentDatasets.data.data : [];
  const endpointRows = endpoints.ok ? endpoints.data.data : [];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Estado del sistema: fuentes por estado, ingesta reciente y endpoints publicados."
      />

      {failure !== null ? <ApiErrorBanner error={failure} className="mb-6" /> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Fuentes"
          value={countOf(sourcesTotal)}
          hint={sourcesTotal.ok ? undefined : 'No se pudo leer el listado.'}
          icon={<Database className="h-4 w-4" aria-hidden="true" />}
        />
        <StatCard
          label="Fuentes por estado"
          value={formatNumber(countsByStatus.get('ready') ?? 0, 0)}
          hint={
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {SOURCE_STATUSES.map((status) => (
                <span key={status} className="inline-flex items-center gap-1">
                  <Badge variant={status} dot>
                    {STATUS_LABELS[status]}
                  </Badge>
                  <span className="tabular-nums">{countsByStatus.get(status) ?? 0}</span>
                </span>
              ))}
            </span>
          }
        />
        <StatCard
          label="Datasets publicados"
          value={countOf(publishedTotal)}
          icon={<Layers className="h-4 w-4" aria-hidden="true" />}
        />
        <StatCard
          label="Endpoints habilitados"
          value={countOf(enabledTotal)}
          icon={<Link2 className="h-4 w-4" aria-hidden="true" />}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Ingesta reciente</CardTitle>
              <CardDescription>Los últimos datasets producidos, con filas y advertencias de extracción.</CardDescription>
            </div>
            <Link href="/datasets" className="text-xs font-medium text-brand hover:underline">
              Ver todos
            </Link>
          </CardHeader>
          <CardBody className="space-y-3 p-0">
            {recentRows.length === 0 ? (
              <div className="px-5 py-5">
                <Alert
                  tone="info"
                  title="Todavía no hay ningún dataset."
                  detail="Creá una fuente y dispará su ingesta: el resultado aparece acá."
                  action={
                    <Link href="/sources" className="text-xs font-medium text-brand hover:underline">
                      Ir a Fuentes
                    </Link>
                  }
                />
              </div>
            ) : (
              recentRows.map((dataset) => (
                <RecentIngestionRow
                  key={dataset._id}
                  dataset={dataset}
                  sourceName={sourceNameOf(sourceRows, dataset.sourceId)}
                />
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Endpoints</CardTitle>
              <CardDescription>Con su slug y el enlace directo al playground.</CardDescription>
            </div>
            <Link href="/endpoints" className="text-xs font-medium text-brand hover:underline">
              Ver todos
            </Link>
          </CardHeader>
          <CardBody className="space-y-2 p-0">
            {endpointRows.length === 0 ? (
              <div className="px-5 py-5">
                <Alert
                  tone="info"
                  title="Sin endpoints todavía."
                  detail="Creá uno desde un dataset publicado para empezar a publicar datos."
                  action={
                    <Link href="/endpoints" className="text-xs font-medium text-brand hover:underline">
                      Crear endpoint
                    </Link>
                  }
                />
              </div>
            ) : (
              endpointRows.map((endpoint) => <EndpointRow key={endpoint._id} endpoint={endpoint} />)
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function countOf(result: { ok: true; data: { meta: { total: number } } } | { ok: false }): string {
  return result.ok ? formatNumber(result.data.meta.total, 0) : EMPTY_CELL;
}

function RecentIngestionRow({ dataset, sourceName }: { dataset: DatasetListItem; sourceName: string }) {
  return (
    <Link
      href={`/datasets/${dataset._id}`}
      className="flex items-center justify-between gap-4 border-b border-line/60 px-5 py-3 transition-colors last:border-b-0 hover:bg-surface-sunken/60"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-content">{sourceName}</p>
        <p className="mt-0.5 text-xs text-content-subtle">
          v{dataset.version} · {formatDateTime(dataset.createdAt)} · {formatNumber(dataset.rowCount, 0)} fila
          {dataset.rowCount === 1 ? '' : 's'}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <WarningsBadge count={dataset.warnings.length} />
        <Badge variant={dataset.status}>{STATUS_LABELS[dataset.status]}</Badge>
      </div>
    </Link>
  );
}

function EndpointRow({ endpoint }: { endpoint: EndpointDefinition }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line/60 px-5 py-3 last:border-b-0">
      <div className="min-w-0">
        <Link
          href={`/endpoints/${endpoint._id}`}
          className="block truncate text-sm font-medium text-content hover:text-brand"
        >
          {endpoint.name}
        </Link>
        <code className="mt-0.5 block truncate font-mono text-xs text-content-subtle">/e/{endpoint.slug}</code>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {endpoint.followLatest ? (
          <Badge variant="neutral" title="Sigue la última versión publicada de la fuente">
            <Radio className="h-3 w-3" aria-hidden="true" />
            followLatest
          </Badge>
        ) : null}
        <Badge variant={endpoint.enabled ? 'enabled' : 'disabled'} dot>
          {endpoint.enabled ? 'Habilitado' : 'Deshabilitado'}
        </Badge>
      </div>
    </div>
  );
}

function sourceNameOf(sources: readonly Source[], sourceId: string): string {
  return sources.find((source) => source._id === sourceId)?.name ?? `Fuente ${sourceId}`;
}