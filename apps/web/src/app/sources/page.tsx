import { Plus } from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';

import { ApiErrorBanner } from '@/components/api-error-banner';
import { SourceCreateForm } from '@/components/sources/source-create-form';
import { Badge, STATUS_LABELS } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, PageHeader } from '@/components/ui/card';
import { Column, DataTable } from '@/components/ui/data-table';
import { Select } from '@/components/ui/field';
import { listSources } from '@/lib/api';
import type { Source, SourceStatus, SourceType } from '@/lib/api/types';
import { SOURCE_TYPE_LABELS } from '@/lib/schema/source-form';
import { formatDateTime } from '@/lib/format';
import { parseLimit, parsePage } from '@/lib/schema/pagination';

export const metadata: Metadata = { title: 'Fuentes' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  page?: string;
  limit?: string;
  type?: string;
  status?: string;
}

const STATUSES: readonly SourceStatus[] = ['pending', 'processing', 'ready', 'error'];
const TYPES: readonly SourceType[] = ['manual', 'api', 'url', 'pdf'];

export default async function SourcesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const page = parsePage(params.page);
  const limit = parseLimit(params.limit);
  const type = isSourceType(params.type) ? params.type : undefined;
  const status = isSourceStatus(params.status) ? params.status : undefined;

  const result = await listSources({ page, limit, type, status });

  const href = (target: number) => {
    const query = new URLSearchParams();
    query.set('page', String(target));
    query.set('limit', String(limit));
    if (type !== undefined) query.set('type', type);
    if (status !== undefined) query.set('status', status);
    return `/sources?${query.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Fuentes"
        description="Orígenes declarados por el usuario. Cada uno tiene su config y su estrategia de ingesta."
        actions={
          <ButtonLink href="/sources#nueva" variant="primary">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nueva fuente
          </ButtonLink>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
          <form method="get" action="/sources" className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="filter-type">
              Tipo
            </label>
            <Select id="filter-type" name="type" defaultValue={type ?? ''} className="h-9 w-36 text-xs">
              <option value="">Todos los tipos</option>
              {TYPES.map((option) => (
                <option key={option} value={option}>
                  {SOURCE_TYPE_LABELS[option]}
                </option>
              ))}
            </Select>

            <label className="sr-only" htmlFor="filter-status">
              Estado
            </label>
            <Select id="filter-status" name="status" defaultValue={status ?? ''} className="h-9 w-36 text-xs">
              <option value="">Todos los estados</option>
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

        {result.ok ? (
          <DataTable<Source>
            columns={sourceColumns()}
            rows={result.data.data}
            rowKey={(source) => source._id}
            meta={result.data.meta}
            pageHref={href}
            caption="Fuentes registradas"
            empty={{
              title: 'Sin fuentes todavía.',
              description: 'Creá la primera para empezar a ingerir datos de un origen externo.',
              action: (
                <ButtonLink href="/sources#nueva" variant="primary" size="sm">
                  Crear la primera fuente
                </ButtonLink>
              ),
            }}
          />
        ) : (
          <div className="p-5">
            <ApiErrorBanner error={result.error} />
          </div>
        )}
      </Card>

      <div id="nueva" className="mt-8 scroll-mt-24">
        <SourceCreateForm />
      </div>
    </>
  );
}

function sourceColumns(): Array<Column<Source>> {
  return [
    {
      key: 'name',
      header: 'Nombre',
      render: (source) => (
        <Link href={`/sources/${source._id}`} className="font-medium text-content hover:text-brand">
          {source.name}
        </Link>
      ),
    },
    { key: 'type', header: 'Tipo', render: (source) => <span className="text-xs">{SOURCE_TYPE_LABELS[source.type]}</span> },
    {
      key: 'status',
      header: 'Estado',
      render: (source) => (
        <Badge variant={source.status} dot>
          {STATUS_LABELS[source.status]}
        </Badge>
      ),
    },
    {
      key: 'lastIngestAt',
      header: 'Última ingesta',
      render: (source) => <span className="text-xs text-content-muted">{formatDateTime(source.lastIngestAt)}</span>,
    },
  ];
}

function isSourceType(value: string | undefined): value is SourceType {
  return value !== undefined && (TYPES as readonly string[]).includes(value);
}

function isSourceStatus(value: string | undefined): value is SourceStatus {
  return value !== undefined && (STATUSES as readonly string[]).includes(value);
}