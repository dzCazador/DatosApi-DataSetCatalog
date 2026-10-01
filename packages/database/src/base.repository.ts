import type { FilterQuery, HydratedDocument, Model, SortOrder } from 'mongoose';

import type { PaginationMeta, PaginationQuery } from '@datosapi/common';

export interface Page<TDoc> {
  items: TDoc[];
  total: number;
}

export function toPageMeta(query: PaginationQuery, total: number): PaginationMeta {
  const skipped = Math.max(total - (query.page - 1) * query.limit, 0);
  return {
    total,
    count: Math.min(query.limit, skipped),
    page: query.page,
    limit: query.limit,
    pages: Math.ceil(total / query.limit),
  };
}

export function skipOf(query: PaginationQuery): number {
  return (query.page - 1) * query.limit;
}

/**
 * Helpers compartidos por los repositorios: lectura por id, translate y paginación. Sin
 * lógica de negocio ni conocimiento del dominio, para que las decisiones (última versión
 * publicada, CAS de status) queden explícitas en cada repositorio.
 */
export abstract class BaseRepository<TDoc> {
  protected constructor(protected readonly model: Model<TDoc>) {}

  protected async findPage(
    filter: FilterQuery<TDoc>,
    query: PaginationQuery,
    sort: Record<string, SortOrder> = { createdAt: -1 },
  ): Promise<Page<HydratedDocument<TDoc>>> {
    const [items, total] = await Promise.all([
      this.model.find(filter).sort(sort).skip(skipOf(query)).limit(query.limit).exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { items, total };
  }
}
