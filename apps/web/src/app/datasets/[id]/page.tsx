import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { ApiErrorBanner } from '@/components/api-error-banner';
import { dataColumns } from '@/components/data-columns';
import { DatasetActions } from '@/components/datasets/dataset-actions';
import { WarningsList } from '@/components/datasets/warnings-list';
import { Breadcrumb } from '@/components/layout/navbar';
import { schemaColumns } from '@/components/schema-columns';
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
import { DataTable } from '@/components/ui/data-table';
import { Alert } from '@/components/ui/feedback';
import { getDataset } from '@/lib/api';
import type { Row } from '@/lib/api/types';
import { formatBytes, formatCount, formatDateTime, formatDuration, formatNumber } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const dataset = await getDataset(id);
  return { title: dataset.ok ? `${dataset.data.name} · v${dataset.data.version}` : 'Dataset' };
}

export default async function DatasetDetailPage({ params }: Params) {
  const { id } = await params;
  const dataset = await getDataset(id);

  if (!dataset.ok) {
    if (dataset.error.kind === 'http' && dataset.error.code === 'DATASET_NOT_FOUND') notFound();
    return (
      <>
        <PageHeader title="Dataset" breadcrumb={<Breadcrumb items={[{ label: 'Datasets', href: '/datasets' }, { label: id }]} />} />
        <ApiErrorBanner error={dataset.error} />
      </>
    );
  }

  const data = dataset.data;

  return (
    <>
      <PageHeader
        title={data.name}
        breadcrumb={
          <Breadcrumb
            items={[
              { label: 'Datasets', href: '/datasets' },
              { label: `Fuente ${data.sourceId}`, href: `/datasets?sourceId=${data.sourceId}` },
              { label: `v${data.version}` },
            ]}
          />
        }
        description={`Versión ${data.version} de la fuente ${data.sourceId}.`}
        actions={<DatasetActions datasetId={id} status={data.status} />}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {data.warnings.length > 0 ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Advertencias de extracción</CardTitle>
                  <CardDescription>
                    La ingesta registroó dudas: revisá la preview antes de publicar.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardBody>
                <WarningsList warnings={data.warnings} />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Schema</CardTitle>
                <CardDescription>
                  La fuente de verdad de las columnas. Las tablas y los filtros del panel se generan desde acá.
                </CardDescription>
              </div>
              <Badge variant={data.status} dot>
                {STATUS_LABELS[data.status]}
              </Badge>
            </CardHeader>
            <DataTable
              columns={schemaColumns()}
              rows={data.schema}
              rowKey={(column) => column.key}
              caption={`Schema del dataset ${data.name}`}
            />
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Preview de filas</CardTitle>
                <CardDescription>
                  {data.meta.previewTruncated
                    ? `Mostrando las primeras ${formatNumber(data.rows.length, 0)} de ${formatNumber(data.rowCount, 0)} filas.`
                    : `Las ${formatNumber(data.rows.length, 0)} filas completas.`}
                </CardDescription>
              </div>
            </CardHeader>
            <DataTable
              columns={dataColumns(data.schema)}
              rows={data.rows}
              rowKey={(row: Row, index) => `${data._id}-${index}`}
              skeletonRows={8}
              caption="Filas del dataset"
              empty={{ title: 'El dataset no tiene filas.', description: 'Revisá las advertencias de la ingesta.' }}
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Resumen</CardTitle>
            </CardHeader>
            <CardBody>
              <DescriptionList className="sm:grid-cols-1">
                <DescriptionItem term="Estado">{STATUS_LABELS[data.status]}</DescriptionItem>
                <DescriptionItem term="Filas">{formatNumber(data.rowCount, 0)}</DescriptionItem>
                <DescriptionItem term="Columnas">{formatNumber(data.columnsCount, 0)}</DescriptionItem>
                <DescriptionItem term="Advertencias">{formatNumber(data.warnings.length, 0)}</DescriptionItem>
                <DescriptionItem term="Publicado">{formatDateTime(data.publishedAt)}</DescriptionItem>
                <DescriptionItem term="Actualizado">{formatDateTime(data.updatedAt)}</DescriptionItem>
              </DescriptionList>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Trazabilidad</CardTitle>
                <CardDescription>De dónde salió esta versión y cuánto tardó.</CardDescription>
              </div>
            </CardHeader>
            <CardBody>
              <DescriptionList className="sm:grid-cols-1">
                <DescriptionItem term="Método" mono>
                  {data.meta.method}
                </DescriptionItem>
                <DescriptionItem term="Duración">{formatDuration(data.meta.durationMs)}</DescriptionItem>
                <DescriptionItem term="Páginas">{formatCount(data.meta.pageCount)}</DescriptionItem>
                <DescriptionItem term="Tablas">{formatCount(data.meta.tableCount)}</DescriptionItem>
                <DescriptionItem term="Filas crudas">{formatNumber(data.meta.rawRowCount, 0)}</DescriptionItem>
                <DescriptionItem term="Bytes">{formatBytes(data.meta.bytes ?? null)}</DescriptionItem>
                <DescriptionItem term="Content-Type" mono>
                  {data.meta.contentType ?? '—'}
                </DescriptionItem>
                <DescriptionItem term="Obtenido">{formatDateTime(data.meta.fetchedAt)}</DescriptionItem>
              </DescriptionList>

              {data.meta.sourceUrl !== undefined ? (
                <div className="mt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-content-subtle">URL de origen</p>
                  <a
                    href={data.meta.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1 block break-all font-mono text-xs text-brand hover:underline"
                  >
                    {data.meta.sourceUrl}
                  </a>
                </div>
              ) : null}
            </CardBody>
          </Card>

          {data.status === 'draft' ? (
            <Alert
              tone="info"
              title="Todavía no es visible para los endpoints."
              detail="Sólo se sirven datasets publicados. Publicá el dataset para empezar a exponerlo."
            />
          ) : null}

          <Card>
            <CardBody className="text-xs text-content-subtle">
              <p>
                Los <code>rows</code> y el <code>schema</code> no se editan desde el panel: los datos cambian
                reingeriendo, que crea la versión siguiente.
              </p>
              <p className="mt-2">
                <Link href={`/sources/${data.sourceId}`} className="font-medium text-brand hover:underline">
                  Ir a la fuente
                </Link>{' '}
                para disparar una ingesta nueva.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
