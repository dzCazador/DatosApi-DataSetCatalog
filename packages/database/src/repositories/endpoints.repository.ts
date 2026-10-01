import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, Model, UpdateQuery } from 'mongoose';

import type {
  EndpointDefinitionEntity,
  FilterDef,
  PaginationQuery,
  SortDef,
} from '@datosapi/common';

import { BaseRepository } from '../base.repository';
import { toEndpointDefinitionDomain } from '../entities/endpoint-definition.entity';
import { EndpointDefinitionDoc } from '../schemas/endpoint-definition.schema';

export interface CreateEndpointData {
  name: string;
  slug: string;
  sourceId: string;
  datasetId?: string;
  followLatest?: boolean;
  description?: string;
  fields?: string[];
  filters?: FilterDef[];
  sort?: SortDef[];
  defaultLimit: number;
  maxLimit: number;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export type UpdateEndpointData = Partial<Omit<CreateEndpointData, 'slug'>>;

export interface ListEndpointsQuery {
  sourceId?: string;
  enabled?: boolean;
  page: PaginationQuery;
}

export interface EndpointsRepository {
  create(data: CreateEndpointData): Promise<EndpointDefinitionEntity>;
  findAll(query: ListEndpointsQuery): Promise<{
    items: EndpointDefinitionEntity[];
    total: number;
  }>;
  findById(id: string): Promise<EndpointDefinitionEntity | null>;
  findBySlug(slug: string): Promise<EndpointDefinitionEntity | null>;
  update(id: string, data: UpdateEndpointData): Promise<EndpointDefinitionEntity | null>;
  delete(id: string): Promise<boolean>;
  disableBySourceId(sourceId: string): Promise<number>;
}

@Injectable()
export class MongooseEndpointsRepository
  extends BaseRepository<EndpointDefinitionDoc>
  implements EndpointsRepository
{
  constructor(@InjectModel(EndpointDefinitionDoc.name) model: Model<EndpointDefinitionDoc>) {
    super(model);
  }

  async create(data: CreateEndpointData): Promise<EndpointDefinitionEntity> {
    const created = await this.model.create({ ...data, enabled: data.enabled ?? true });
    return toEndpointDefinitionDomain(created);
  }

  async findAll(query: ListEndpointsQuery): Promise<{
    items: EndpointDefinitionEntity[];
    total: number;
  }> {
    const filter: FilterQuery<EndpointDefinitionDoc> = {};
    if (query.sourceId !== undefined) filter.sourceId = query.sourceId;
    if (query.enabled !== undefined) filter.enabled = query.enabled;

    const page = await this.findPage(filter, query.page, { slug: 1 });
    return { items: page.items.map(toEndpointDefinitionDomain), total: page.total };
  }

  async findById(id: string): Promise<EndpointDefinitionEntity | null> {
    const found = await this.model.findById(id).exec();
    return found ? toEndpointDefinitionDomain(found) : null;
  }

  async findBySlug(slug: string): Promise<EndpointDefinitionEntity | null> {
    const found = await this.model.findOne({ slug }).exec();
    return found ? toEndpointDefinitionDomain(found) : null;
  }

  async update(id: string, data: UpdateEndpointData): Promise<EndpointDefinitionEntity | null> {
    const update: UpdateQuery<EndpointDefinitionDoc> = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.description !== undefined) update.description = data.description;
    if (data.datasetId !== undefined) update.datasetId = data.datasetId;
    if (data.followLatest !== undefined) update.followLatest = data.followLatest;
    if (data.fields !== undefined) update.fields = data.fields;
    if (data.filters !== undefined) update.filters = data.filters;
    if (data.sort !== undefined) update.sort = data.sort;
    if (data.defaultLimit !== undefined) update.defaultLimit = data.defaultLimit;
    if (data.maxLimit !== undefined) update.maxLimit = data.maxLimit;
    if (data.enabled !== undefined) update.enabled = data.enabled;
    if (data.metadata !== undefined) update.metadata = data.metadata;

    const updated = await this.model
      .findByIdAndUpdate(id, update, { new: true, runValidators: true })
      .exec();
    return updated ? toEndpointDefinitionDomain(updated) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.model.deleteOne({ _id: id });
    return result.deletedCount === 1;
  }

  /** Al borrar o dejar inutilizable una source, sus endpoints se deshabilitan (data-model.md §5). */
  async disableBySourceId(sourceId: string): Promise<number> {
    const result = await this.model.updateMany(
      { sourceId, enabled: true },
      { $set: { enabled: false } },
    );
    return result.modifiedCount;
  }
}
