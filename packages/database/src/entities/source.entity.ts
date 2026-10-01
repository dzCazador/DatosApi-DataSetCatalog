import { SourceType } from '@datosapi/common';
import type {
  ApiSourceConfig,
  ManualSourceConfig,
  PdfSourceConfig,
  SourceConfig,
  SourceEntity,
  UrlSourceConfig,
} from '@datosapi/common';
import type { SourceDocument } from '../schemas/source.schema';

/**
 * `config` es una union discriminada por `type`. El esquema lo guarda como objeto libre:
 * el descarte de la forma inválida ocurre en la ingesta (data-model.md §2.1), y el mapper
 * sólo proyecta lo que corresponde al tipo declarado.
 */
export function toSourceConfig(type: SourceType, config: SourceConfig): SourceConfig {
  switch (type) {
    case SourceType.MANUAL:
      return config as ManualSourceConfig;
    case SourceType.API:
      return config as ApiSourceConfig;
    case SourceType.URL:
      return config as UrlSourceConfig;
    case SourceType.PDF:
      return config as PdfSourceConfig;
  }
}

export function toSourceDomain(doc: SourceDocument): SourceEntity {
  const entity: SourceEntity = {
    id: String(doc._id),
    name: doc.name,
    type: doc.type,
    config: toSourceConfig(doc.type, doc.config),
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };

  if (doc.description !== undefined) entity.description = doc.description;
  if (doc.lastIngestAt !== undefined) entity.lastIngestAt = doc.lastIngestAt;
  if (doc.lastError !== undefined) entity.lastError = doc.lastError;
  if (doc.lastDatasetId !== undefined) entity.lastDatasetId = String(doc.lastDatasetId);
  if (doc.metadata !== undefined) entity.metadata = doc.metadata;

  return entity;
}
