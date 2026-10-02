import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DATASETS_REPOSITORY } from '@datosapi/common';
import type {
  ColumnSchema,
  DatasetDetail,
  DatasetEntity,
  DatasetListItem,
  Paginated,
  PaginationQuery,
} from '@datosapi/common';
import type { DatasetsRepository } from '@datosapi/database';

import { DatasetInvalidStateError, DatasetNotFoundError } from './datasets.errors';
import type { ListDatasetsQueryDto } from './dto/datasets.dto';

export interface DatasetsConfig {
  PREVIEW_ROWS: number;
  INGEST_MAX_ROWS: number;
}

function toPaginationMeta(total: number, count: number, page: PaginationQuery) {
  return {
    total,
    count,
    page: page.page,
    limit: page.limit,
    pages: total === 0 ? 0 : Math.ceil(total / page.limit),
  };
}

/**
 * Catálogo de datasets (api-contract.md §4, data-model.md §3).
 *
 * El service no muta datos: sólo gobierna el ciclo de vida `draft → published → archived`.
 * La mutación de los datos en sí es de la ingesta, y siempre crea `version + 1`
 * (data-model.md §3.1 regla 4).
 */
@Injectable()
export class DatasetsService {
  constructor(
    @Inject(DATASETS_REPOSITORY) private readonly datasets: DatasetsRepository,
    private readonly config: ConfigService<DatasetsConfig, true>,
  ) {}

  /** Listado de catálogo: sin `rows`, que es lo que pesa (api-contract.md §4). */
  async findAll(query: ListDatasetsQueryDto): Promise<Paginated<DatasetListItem>> {
    const page: PaginationQuery = { page: query.page, limit: query.limit };
    const { items, total } = await this.datasets.findAll({
      ...(query.sourceId === undefined ? {} : { sourceId: query.sourceId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      page,
    });

    return { data: items, meta: toPaginationMeta(total, items.length, page) };
  }

  /**
   * Detalle con filas. Por defecto devuelve un preview de `PREVIEW_ROWS` y marca
   * `previewTruncated`; `?full=true` lo desactiva sólo si el dataset entra en
   * `INGEST_MAX_ROWS`.
   *
   * El recorte lo hace el repositorio con un `$slice` en la proyección, no este service con
   * `rows.slice()`: traer 100k filas para descartar 99980 es un costo que se paga en cada
   * preview del panel (data-model.md §3.3).
   */
  async findOne(id: string, options: { full?: boolean } = {}): Promise<DatasetDetail> {
    const maxRows = this.config.getOrThrow('INGEST_MAX_ROWS');
    const full = options.full === true;

    const dataset = await this.datasets.findById(id, {
      rowsLimit: full ? maxRows : this.config.getOrThrow('PREVIEW_ROWS'),
    });

    if (dataset === null) throw new DatasetNotFoundError(id);

    return {
      ...dataset,
      meta: { ...dataset.meta, previewTruncated: dataset.rowCount > dataset.rows.length },
    };
  }

  /**
   * Sólo el `schema`. Es lo que consume el panel para construir tabla, filtros y validaciones
   * sin arrastrar filas: el `schema` es la fuente de verdad de los tipos (frontend.md §6).
   */
  async getSchema(id: string): Promise<ColumnSchema[]> {
    return (await this.findEntity(id)).schema;
  }

  /**
   * `draft` → `published` (api-contract.md §4). Un dataset `published` no se despublica: la
   * vía de corrección es reingerar y publicar la versión nueva, así que repetir la operación
   * es un `409` y no un no-op silencioso.
   */
  async publish(id: string): Promise<DatasetEntity> {
    const published = await this.datasets.publish(id, new Date());

    if (published !== null) return published;

    // El update guardado devuelve `null` tanto si el id no existe como si el status no
    // admitía la transición. Releer separa los dos casos: `404` vs `409`.
    const current = await this.datasets.findById(id);
    if (current === null) throw new DatasetNotFoundError(id);

    throw new DatasetInvalidStateError('publish', current.status);
  }

  /** `published` → `archived`. Archivar un `draft` no es una transición del modelo. */
  async archive(id: string): Promise<DatasetEntity> {
    const archived = await this.datasets.archive(id);

    if (archived !== null) return archived;

    const current = await this.datasets.findById(id);
    if (current === null) throw new DatasetNotFoundError(id);

    throw new DatasetInvalidStateError('archive', current.status);
  }

  /**
   * Última versión `published` de una source. Resuelve el `followLatest` de los endpoints
   * dinámicos (api-contract.md §5), por eso devuelve la entidad completa y no el ítem de
   * catálogo: el motor de consulta necesita las filas.
   */
  async findLatestPublished(sourceId: string): Promise<DatasetEntity | null> {
    return this.datasets.findLatestPublished(sourceId);
  }

  private async findEntity(id: string): Promise<DatasetEntity> {
    const dataset = await this.datasets.findById(id);

    if (dataset === null) throw new DatasetNotFoundError(id);

    return dataset;
  }
}
