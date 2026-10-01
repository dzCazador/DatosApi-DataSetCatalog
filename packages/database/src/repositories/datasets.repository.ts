import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, Model } from 'mongoose';

import { DatasetStatus } from '@datosapi/common';
import type {
  ColumnSchema,
  DatasetEntity,
  DatasetListItem,
  ExtractionMeta,
  PaginationQuery,
  Row,
} from '@datosapi/common';

import { BaseRepository } from '../base.repository';
import { toDatasetDomain, toDatasetListItem } from '../entities/dataset.entity';
import { DatasetDoc } from '../schemas/dataset.schema';

export interface CreateDatasetData {
  sourceId: string;
  version: number;
  name: string;
  schema: ColumnSchema[];
  rows: Row[];
  meta: ExtractionMeta;
  warnings?: string[];
}

export interface ListDatasetsQuery {
  sourceId?: string;
  status?: DatasetStatus;
  page: PaginationQuery;
}

export interface DatasetsRepository {
  create(data: CreateDatasetData): Promise<DatasetEntity>;
  findAll(query: ListDatasetsQuery): Promise<{ items: DatasetListItem[]; total: number }>;
  findById(id: string): Promise<DatasetEntity | null>;
  findLatestPublished(sourceId: string): Promise<DatasetEntity | null>;
  nextVersion(sourceId: string): Promise<number>;
  publish(id: string, at: Date): Promise<DatasetEntity | null>;
  archive(id: string): Promise<DatasetEntity | null>;
}

@Injectable()
export class MongooseDatasetsRepository
  extends BaseRepository<DatasetDoc>
  implements DatasetsRepository
{
  constructor(@InjectModel(DatasetDoc.name) model: Model<DatasetDoc>) {
    super(model);
  }

  async create(data: CreateDatasetData): Promise<DatasetEntity> {
    // `rowCount` y `columnsCount` los calcula la ingesta, nunca el cliente
    // (data-model.md §3.1 regla 3).
    const created = await this.model.create({
      sourceId: data.sourceId,
      version: data.version,
      name: data.name,
      status: DatasetStatus.DRAFT,
      schema: data.schema,
      rows: data.rows,
      rowCount: data.rows.length,
      columnsCount: data.schema.length,
      warnings: data.warnings ?? [],
      meta: data.meta,
    });
    return toDatasetDomain(created);
  }

  async findAll(query: ListDatasetsQuery): Promise<{ items: DatasetListItem[]; total: number }> {
    const filter: FilterQuery<DatasetDoc> = {};
    if (query.sourceId !== undefined) filter.sourceId = query.sourceId;
    if (query.status !== undefined) filter.status = query.status;

    const page = await this.findPage(filter, query.page, { version: -1 });
    return { items: page.items.map(toDatasetListItem), total: page.total };
  }

  async findById(id: string): Promise<DatasetEntity | null> {
    const found = await this.model.findById(id).exec();
    return found ? toDatasetDomain(found) : null;
  }

  async findLatestPublished(sourceId: string): Promise<DatasetEntity | null> {
    const found = await this.model
      .findOne({ sourceId, status: DatasetStatus.PUBLISHED })
      .sort({ version: -1 })
      .exec();
    return found ? toDatasetDomain(found) : null;
  }

  /**
   * `max(version) + 1`. No es atómico: la carrera se resuelve por el índice único
   * `{ sourceId, version }`, que convierte el conflicto en `VERSION_CONFLICT` (409).
   */
  async nextVersion(sourceId: string): Promise<number> {
    const [latest] = await this.model.find({ sourceId }).sort({ version: -1 }).limit(1).exec();
    return latest ? latest.version + 1 : 1;
  }

  async publish(id: string, at: Date): Promise<DatasetEntity | null> {
    const published = await this.model
      .findByIdAndUpdate(
        id,
        { $set: { status: DatasetStatus.PUBLISHED, publishedAt: at } },
        { new: true },
      )
      .exec();
    return published ? toDatasetDomain(published) : null;
  }

  async archive(id: string): Promise<DatasetEntity | null> {
    const archived = await this.model
      .findByIdAndUpdate(id, { $set: { status: DatasetStatus.ARCHIVED } }, { new: true })
      .exec();
    return archived ? toDatasetDomain(archived) : null;
  }
}
