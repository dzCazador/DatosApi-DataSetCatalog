import Link from 'next/link';
import type { Metadata } from 'next';

import { ApiErrorBanner } from '@/components/api-error-banner';
import { Badge, STATUS_LABELS, WarningsBadge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, PageHeader } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Select } from '@/components/ui/field';
import { listDatasets, listSources } from '@/lib/api';
import type { DatasetListItem, DatasetStatus } from '@/lib/api/types';
import { formatDateTime, formatNumber } from '@/lib/format';
import { parseLimit, parsePage } from '@/lib/schema/pagination';

export const metadata: Metadata = { title: 'Datasets' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  page?: string;
  limit?: string;
  sourceId?: string;
  status?: string;
}

const STATUSES: readonly DatasetStatus[] = ['draft', 'published', 'archived'];

export default async function DatasetsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const page = parsePage(params.page);
  const limit = parseLimit(params.limit);
  const sourceId = params.sourceId === undefined || params.sourceId === '' ? undefined : params.sourceId;
  const status = isDatasetStatus(params.status) ? params.status : undefined;

  const [datasets, sources] = await Promise.all([
    listDatasets({ page, limit, sourceId, status }),
    listSources({ limit: 200 }),
  ]);

  const sourceNames = new Map((sources.ok ? sources.data.data : []).map((source) => [source._id, source.name]));

  const href = (target: number) => {
    const query = new URLSearchParams();
    query.set('page', String(target));
    query.set('limit', String(limit));
    if (sourceId !== undefined) query.set('sourceId', sourceId);
    if (status !== undefined) query.set('status', status);
    return `/datasets?${query.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Datasets"
        description="Versiones inmutables de datos normalizados. Un dataset publicado no se muta: para corregirlo, se reinge."
      />

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
          <form method="get" action="/datasets" className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="filter-source">
              Fuente
            </label>
            <Select id="filter-source" name="sourceId" defaultValue={sourceId ?? ''} className="h-9 w-56 text-xs">
              <option value="">Todas las fuentes</option>
              {(sources.ok ? sources.data.data : []).map((source) => (
                <option key={source._id} value={source._id}>
                  {source.name}
                </option>
              ))}
            </Select>

            <label className="sr-only" htmlFor="filter-status">
              Estado
            </label>
            <Select id="filter-status" name="status" defaultValue={status ?? ''} className="h-9 w-32 text-xs">
              <option value="">Todos</option>
              {STATUSES.map((option) => (
                <option key={option} value={option}>
                  {STATUS_LABELS[option]}
                </option>
              ))}
            </Select>

            <input type="hidden" name="limit" value={limit} />
            <button
              type="submit"
              className="h-9 rounded-lg border border-line px-3 text-xs font-medium text-content-muted transition-colors hover:bg-surface-sunken"
            >
              Filtrar
            </button>
          </form>
        </CardHeader>

        {datasets.ok ? (
          <DataTable<DatasetListItem>
            columns={columns(sourceNames)}
            rows={datasets.data.data}
            rowKey={(dataset) => dataset._id}
            meta={datasets.data.meta}
            pageHref={href}
            caption="Datasets del catálogo"
            empty={{
              title: 'Sin datasets todavía.',
              description: 'Ingerí una fuente para que aparezca su primera versión.',
              action: (
                <Link href="/sources" className="text-sm font-medium text-brand hover:underline">
                  Ir a Fuentes
                </Link>
              ),
            }}
          />
        ) : (
          <div className="p-5">
            <ApiErrorBanner error={datasets.error} />
          </div>
        )}
      </Card>
    </>
  );
}

function columns(sourceNames: ReadonlyMap<string, string>) {
  return [
    {
      key: 'name',
      header: 'Nombre',
      render: (dataset: DatasetListItem) => (
        <div className="min-w-0">
          <Link href={`/datasets/${dataset._id}`} className="block truncate font-medium text-content hover:text-brand">
            {dataset.name}
          </Link>
          <span className="text-xs text-content-subtle">{sourceNames.get(dataset.sourceId) ?? dataset.sourceId}</span>
        </div>
      ),
    },
    {
      key: 'version',
      header: 'Versión',
      render: (dataset: DatasetListItem) => <span className="tabular-nums">v{dataset.version}</span>,
    },
    {
      key: 'status',
      header: 'Estado',
      render: (dataset: DatasetListItem) => <Badge variant={dataset.status}>{STATUS_LABELS[dataset.status]}</Badge>,
    },
    {
      key: 'rowCount',
      header: 'Filas',
      align: 'right' as const,
      render: (dataset: DatasetListItem) => <span className="tabular-nums">{formatNumber(dataset.rowCount, 0)}</span>,
    },
    {
      key: 'columnsCount',
      header: 'Columnas',
      align: 'right' as const,
      render: (dataset: DatasetListItem) => <span className="tabular-nums">{formatNumber(dataset.columnsCount, 0)}</span>,
    },
    {
      key: 'warnings',
      header: 'Advertencias',
      render: (dataset: DatasetListItem) => <WarningsBadge count={dataset.warnings.length} />,
    },
    {
      key: 'updatedAt',
      header: 'Actualizado',
      render: (dataset: DatasetListItem) => (
        <span className="text-xs text-content-muted">{formatDateTime(dataset.updatedAt)}</span>
      ),
    },
  ];
}

function isDatasetStatus(value: string | undefined): value is DatasetStatus {
  return value !== undefined && (STATUSES as readonly string[]).includes(value);
}
