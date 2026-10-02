import Link from 'next/link';
import type { Metadata } from 'next';

import { ApiErrorBanner } from '@/components/api-error-banner';
import { EndpointEditor } from '@/components/endpoints/endpoint-editor';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, PageHeader } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Select } from '@/components/ui/field';
import { listDatasets, listEndpoints, listSources } from '@/lib/api';
import type { DatasetListItem, EndpointDefinition } from '@/lib/api/types';
import { EMPTY_CELL, formatNumber } from '@/lib/format';
import { ADMIN_MAX_LIMIT, parseLimit, parsePage } from '@/lib/schema/pagination';
import { createEndpointAction } from '@/lib/actions/endpoints';

export const metadata: Metadata = { title: 'Endpoints' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  page?: string;
  limit?: string;
  enabled?: string;
}

export default async function EndpointsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const page = parsePage(params.page);
  const limit = parseLimit(params.limit);
  const enabled = parseEnabledFilter(params.enabled);

  const [endpoints, sources, published] = await Promise.all([
    listEndpoints({ page, limit, enabled }),
    listSources({ limit: ADMIN_MAX_LIMIT }),
    listDatasets({ status: 'published', limit: ADMIN_MAX_LIMIT }),
  ]);

  const sourceNames = new Map((sources.ok ? sources.data.data : []).map((source) => [source._id, source.name]));
  const datasetNames = new Map((published.ok ? published.data.data : []).map((dataset) => [dataset._id, dataset]));

  const href = (target: number) => {
    const query = new URLSearchParams();
    query.set('page', String(target));
    query.set('limit', String(limit));
    if (enabled !== undefined) query.set('enabled', String(enabled));
    return `/endpoints?${query.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Endpoints"
        description="Definiciones que publican un dataset como API REST. El allowlist de filtros y orden vive acá."
        actions={
          <ButtonLink href="/endpoints#nuevo" variant="primary">
            Nuevo endpoint
          </ButtonLink>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
          <form method="get" action="/endpoints" className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="filter-enabled">
              Habilitados
            </label>
            <Select id="filter-enabled" name="enabled" defaultValue={enabled === undefined ? '' : String(enabled)} className="h-9 w-40 text-xs">
              <option value="">Todos</option>
              <option value="true">Habilitados</option>
              <option value="false">Deshabilitados</option>
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

        {endpoints.ok ? (
          <DataTable<EndpointDefinition>
            columns={columns(sourceNames, datasetNames)}
            rows={endpoints.data.data}
            rowKey={(endpoint) => endpoint._id}
            meta={endpoints.data.meta}
            pageHref={href}
            caption="Definiciones de endpoint"
            empty={{
              title: 'Sin endpoints todavía.',
              description: 'Publicá un dataset y creá una definición para exponerlo.',
              action: (
                <ButtonLink href="/endpoints#nuevo" variant="primary" size="sm">
                  Crear el primero
                </ButtonLink>
              ),
            }}
          />
        ) : (
          <div className="p-5">
            <ApiErrorBanner error={endpoints.error} />
          </div>
        )}
      </Card>

      <div id="nuevo" className="mt-8 scroll-mt-24">
        <EndpointEditor
          sources={sources.ok ? sources.data.data : []}
          publishedDatasets={published.ok ? published.data.data : []}
          defaults={{ followLatest: true, enabled: true }}
          submitLabel="Crear endpoint"
          action={createEndpointAction}
          successMessage="Endpoint creado."
        />
      </div>
    </>
  );
}

function columns(
  sourceNames: ReadonlyMap<string, string>,
  datasetNames: ReadonlyMap<string, DatasetListItem>,
) {
  return [
    {
      key: 'name',
      header: 'Nombre',
      render: (endpoint: EndpointDefinition) => (
        <div className="min-w-0">
          <Link href={`/endpoints/${endpoint._id}`} className="block truncate font-medium text-content hover:text-brand">
            {endpoint.name}
          </Link>
          <span className="text-xs text-content-subtle">{sourceNames.get(endpoint.sourceId) ?? endpoint.sourceId}</span>
        </div>
      ),
    },
    {
      key: 'slug',
      header: 'Slug',
      render: (endpoint: EndpointDefinition) => (
        <Link href={`/e/${endpoint.slug}`} className="font-mono text-xs text-brand hover:underline">
          /e/{endpoint.slug}
        </Link>
      ),
    },
    {
      key: 'dataset',
      header: 'Dataset resuelto',
      render: (endpoint: EndpointDefinition) => {
        if (endpoint.followLatest) {
          return (
            <span className="text-xs text-content-muted" title="Se resuelve en cada request: el último publicado.">
              Última publicación
            </span>
          );
        }
        if (endpoint.datasetId === undefined) return EMPTY_CELL;
        const dataset = datasetNames.get(endpoint.datasetId);
        return dataset === undefined ? (
          <span className="text-xs text-content-muted">{endpoint.datasetId}</span>
        ) : (
          <Link href={`/datasets/${dataset._id}`} className="text-xs hover:text-brand">
            v{dataset.version} · {dataset.name}
          </Link>
        );
      },
    },
    {
      key: 'followLatest',
      header: 'followLatest',
      render: (endpoint: EndpointDefinition) => (
        <Badge variant={endpoint.followLatest ? 'ready' : 'neutral'}>
          {endpoint.followLatest ? 'sí' : 'no'}
        </Badge>
      ),
    },
    {
      key: 'enabled',
      header: 'Estado',
      render: (endpoint: EndpointDefinition) => (
        <Badge variant={endpoint.enabled ? 'enabled' : 'disabled'} dot>
          {endpoint.enabled ? 'Habilitado' : 'Deshabilitado'}
        </Badge>
      ),
    },
    {
      key: 'limits',
      header: 'Límites',
      align: 'right' as const,
      render: (endpoint: EndpointDefinition) => (
        <span className="text-xs tabular-nums">
          {formatNumber(endpoint.defaultLimit, 0)} / {formatNumber(endpoint.maxLimit, 0)}
        </span>
      ),
    },
  ];
}

function parseEnabledFilter(value: string | undefined): boolean | undefined {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}