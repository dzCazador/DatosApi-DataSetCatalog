import { DatasetStatus } from '@datosapi/common';
import type { DatasetEntity, DatasetListItem } from '@datosapi/common';

import type { DatasetDocument } from '../schemas/dataset.schema';

function base(doc: DatasetDocument): DatasetListItem {
  return {
    id: String(doc._id),
    sourceId: String(doc.sourceId),
    version: doc.version,
    name: doc.name,
    status: doc.status,
    schema: doc.schema,
    rowCount: doc.rowCount,
    columnsCount: doc.columnsCount,
    warnings: doc.warnings,
    meta: doc.meta,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    ...(doc.publishedAt !== undefined ? { publishedAt: doc.publishedAt } : {}),
  };
}

export function toDatasetDomain(doc: DatasetDocument): DatasetEntity {
  return { ...base(doc), rows: doc.rows };
}

export function toDatasetListItem(doc: DatasetDocument): DatasetListItem {
  return base(doc);
}

export function isPublished(doc: DatasetDocument): boolean {
  return doc.status === DatasetStatus.PUBLISHED;
}
