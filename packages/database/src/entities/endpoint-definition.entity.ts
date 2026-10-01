import type { EndpointDefinitionEntity, FilterDef, SortDef } from '@datosapi/common';

import type { EndpointDefinitionDocument } from '../schemas/endpoint-definition.schema';

/**
 * `filters[]` y `sort[]` son subdocumentos de Mongoose: se proyectan a objetos planos para
 * que la entidad de dominio no arrastre estado interno del driver.
 */
export function toFilterDef(filter: FilterDef & { toObject?: () => unknown }): FilterDef {
  const plain = (filter.toObject?.() ?? filter) as FilterDef;
  const projected: FilterDef = { field: plain.field, op: plain.op };
  if (plain.required !== undefined) projected.required = plain.required;
  return projected;
}

export function toSortDef(sort: SortDef & { toObject?: () => unknown }): SortDef {
  const plain = (sort.toObject?.() ?? sort) as SortDef;
  return { field: plain.field, dir: plain.dir };
}

export function toEndpointDefinitionDomain(
  doc: EndpointDefinitionDocument,
): EndpointDefinitionEntity {
  const entity: EndpointDefinitionEntity = {
    id: String(doc._id),
    name: doc.name,
    slug: doc.slug,
    sourceId: String(doc.sourceId),
    followLatest: doc.followLatest,
    filters: doc.filters.map(toFilterDef),
    sort: doc.sort.map(toSortDef),
    defaultLimit: doc.defaultLimit,
    maxLimit: doc.maxLimit,
    enabled: doc.enabled,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };

  if (doc.description !== undefined) entity.description = doc.description;
  if (doc.datasetId !== undefined) entity.datasetId = String(doc.datasetId);
  if (doc.fields !== undefined) entity.fields = [...doc.fields];
  if (doc.metadata !== undefined) entity.metadata = doc.metadata;

  return entity;
}
