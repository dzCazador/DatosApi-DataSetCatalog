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

export interface FindDatasetOptions {
  /**
   * Tope de filas a traer. `rowCount` sigue siendo el total real, así que el consumidor
   * distingue "truncado" de "completo" comparando ambos, sin un segundo request.
   */
  rowsLimit?: number;
}

export interface DatasetsRepository {
  create(data: CreateDatasetData): Promise<DatasetEntity>;
  findAll(query: ListDatasetsQuery): Promise<{ items: DatasetListItem[]; total: number }>;
  findById(id: string, options?: FindDatasetOptions): Promise<DatasetEntity | null>;
  findLatestPublished(sourceId: string): Promise<DatasetEntity | null>;
  nextVersion(sourceId: string): Promise<number>;
  publish(id: string, at: Date): Promise<DatasetEntity | null>;
  archive(id: string): Promise<DatasetEntity | null>;
  /**
   * Costura de la transición a `dataset_rows` (data-model.md §3.3).
   *
   * Hoy `rows` está embebido y toda lectura pasa por `findById`, que trunca con un `$slice`.
   * El día que `rowCount > 100_000` haya que mover las filas a `{ datasetId, index, ...Row }`
   * con índice `{ datasetId: 1, index: 1 }`, la migración se hace **por detrás de esta
   * interfaz**: alcanza con splitear el acceso a las filas fuera de `findById` —una lectura
   * paginada `{ datasetId, offset, limit }` más un `count`— y los services de datasets y el
   * endpoint dinámico no cambian, porque ninguno toca `rows` del documento.
   *
   * Por eso `rowsLimit` es un parámetro del repositorio y no un `slice` en el service: el
   * service pide "estas filas" y no "este array embebido".
   */
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

  async findById(id: string, options: FindDatasetOptions = {}): Promise<DatasetEntity | null> {
    const query = this.model.findById(id);

    // `$slice` en la proyección en vez de `rows.slice()` en memoria: el preview no debería
    // traer del servidor 100k filas para descartar 99980. `rowCount` sigue siendo el total
    // real, así que `previewTruncated` se deduce comparando `rowCount` contra `rows.length`.
    if (options.rowsLimit !== undefined) {
      query.select({ rows: { $slice: options.rowsLimit } });
    }

    const found = await query.exec();
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

  /**
   * `draft` → `published` (api-contract.md §4). El `status` viaja en el filtro y no se
   * valida antes de actualizar: la transición tiene que ser atómica, y dos `publish`
   * concurrentes sobre el mismo dataset no pueden ganar los dos. Devuelve `null` si el id no
   * existe **o** si el status no es `draft`; el service distingue los dos casos con un
   * relectura para no inventar un `404` donde hubo un `409`.
   */
  async publish(id: string, at: Date): Promise<DatasetEntity | null> {
    const published = await this.model
      .findOneAndUpdate(
        { _id: id, status: DatasetStatus.DRAFT },
        { $set: { status: DatasetStatus.PUBLISHED, publishedAt: at } },
        { new: true },
      )
      .exec();
    return published ? toDatasetDomain(published) : null;
  }

  /**
   * `published` → `archived` (api-contract.md §4). Guardada por la misma razón que `publish`:
   * archivar un `draft` no es una transición válida, y el filtro lo hace imposible en vez de
   * confiar en que el service leyó el status antes.
   */
  async archive(id: string): Promise<DatasetEntity | null> {
    const archived = await this.model
      .findOneAndUpdate(
        { _id: id, status: DatasetStatus.PUBLISHED },
        { $set: { status: DatasetStatus.ARCHIVED } },
        { new: true },
      )
      .exec();
    return archived ? toDatasetDomain(archived) : null;
  }
}
