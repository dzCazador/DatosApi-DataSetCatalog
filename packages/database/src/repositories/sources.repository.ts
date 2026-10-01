import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, Model, UpdateQuery } from 'mongoose';

import { SourceStatus, SourceType } from '@datosapi/common';
import type { PaginationQuery, SourceConfig, SourceEntity } from '@datosapi/common';

import { BaseRepository } from '../base.repository';
import { toSourceDomain } from '../entities/source.entity';
import { SourceDoc } from '../schemas/source.schema';

export interface CreateSourceData {
  name: string;
  type: SourceType;
  config: SourceConfig;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateSourceData {
  name?: string;
  description?: string;
  config?: SourceConfig;
  metadata?: Record<string, unknown>;
}

export interface ListSourcesQuery {
  type?: SourceType;
  status?: SourceStatus;
  page: PaginationQuery;
}

export interface SourcesRepository {
  create(data: CreateSourceData): Promise<SourceEntity>;
  findAll(query: ListSourcesQuery): Promise<{ items: SourceEntity[]; total: number }>;
  findById(id: string): Promise<SourceEntity | null>;
  update(id: string, data: UpdateSourceData): Promise<SourceEntity | null>;
  compareAndSetStatus(id: string, from: SourceStatus, to: SourceStatus): Promise<boolean>;
  markIngested(id: string, datasetId: string, at: Date): Promise<SourceEntity | null>;
  markFailed(id: string, error: string): Promise<SourceEntity | null>;
}

@Injectable()
export class MongooseSourcesRepository
  extends BaseRepository<SourceDoc>
  implements SourcesRepository
{
  constructor(@InjectModel(SourceDoc.name) model: Model<SourceDoc>) {
    super(model);
  }

  async create(data: CreateSourceData): Promise<SourceEntity> {
    const created = await this.model.create({ ...data, status: SourceStatus.PENDING });
    return toSourceDomain(created);
  }

  async findAll(query: ListSourcesQuery): Promise<{ items: SourceEntity[]; total: number }> {
    const filter: FilterQuery<SourceDoc> = {};
    if (query.type !== undefined) filter.type = query.type;
    if (query.status !== undefined) filter.status = query.status;

    const page = await this.findPage(filter, query.page);
    return { items: page.items.map(toSourceDomain), total: page.total };
  }

  async findById(id: string): Promise<SourceEntity | null> {
    const found = await this.model.findById(id).exec();
    return found ? toSourceDomain(found) : null;
  }

  async update(id: string, data: UpdateSourceData): Promise<SourceEntity | null> {
    const update: UpdateQuery<SourceDoc> = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.config !== undefined) update.config = data.config as object;
    if (data.metadata !== undefined) update.metadata = data.metadata;

    const updated = await this.model
      .findByIdAndUpdate(id, update, { new: true, runValidators: true })
      .exec();
    return updated ? toSourceDomain(updated) : null;
  }

  /**
   * Es lo que serializa ingestas concurrentes sobre la misma source: dos `POST /ingest`
   * a la vez, sólo el que gana el `pending -> processing` sigue adelante (data-model.md
   * §3.1 regla 1).
   */
  async compareAndSetStatus(id: string, from: SourceStatus, to: SourceStatus): Promise<boolean> {
    const result = await this.model.updateOne({ _id: id, status: from }, { $set: { status: to } });
    return result.modifiedCount === 1;
  }

  async markIngested(id: string, datasetId: string, at: Date): Promise<SourceEntity | null> {
    const updated = await this.model
      .findByIdAndUpdate(
        id,
        {
          $set: {
            status: SourceStatus.READY,
            lastIngestAt: at,
            lastDatasetId: datasetId,
          },
          // El error anterior deja de ser cierto: se borra en vez de quedar como `null`.
          $unset: { lastError: 1 },
        },
        { new: true },
      )
      .exec();
    return updated ? toSourceDomain(updated) : null;
  }

  async markFailed(id: string, error: string): Promise<SourceEntity | null> {
    const updated = await this.model
      .findByIdAndUpdate(
        id,
        { $set: { status: SourceStatus.ERROR, lastError: error } },
        { new: true },
      )
      .exec();
    return updated ? toSourceDomain(updated) : null;
  }
}
