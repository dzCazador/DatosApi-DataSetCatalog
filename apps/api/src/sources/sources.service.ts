import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DATASETS_REPOSITORY, SOURCES_REPOSITORY, SourceStatus } from '@datosapi/common';
import type {
  DatasetListItem,
  IngestContext,
  IngestLimits,
  IngestResult,
  Paginated,
  PaginationQuery,
  SourceEntity,
} from '@datosapi/common';
import type { DatasetsRepository, SourcesRepository } from '@datosapi/database';

import {
  IngestAlreadyRunningError,
  IngestionError,
  RowsLimitExceededError,
  VersionConflictError,
} from '../ingestion/errors/ingestion.errors';
import { IngestorFactory } from '../ingestion/ingestor.factory';
import { toSourceConfig } from '../ingestion/ingestion.types';
import type { CreateSourceDto, ListSourcesQueryDto, UpdateSourceDto } from './dto/sources.dto';
import { SourceNotFoundError } from './sources.errors';

export interface IngestConfig {
  INGEST_TIMEOUT_MS: number;
  INGEST_MAX_BYTES: number;
  INGEST_MAX_ROWS: number;
  STORAGE_DIR: string;
}

/** Respuesta de `POST /sources/:id/ingest` (api-contract.md §3). */
export interface IngestOutcome {
  sourceId: string;
  datasetId: string;
  version: number;
  rowCount: number;
  columnsCount: number;
  warnings: string[];
  meta: IngestResult['meta'];
}

/** Estados desde los que se puede tomar una ingesta. `processing` queda fuera por definición. */
const INGRESSIBLE: readonly SourceStatus[] = [
  SourceStatus.PENDING,
  SourceStatus.READY,
  SourceStatus.ERROR,
];

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000
  );
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

@Injectable()
export class SourcesService {
  private readonly logger = new Logger(SourcesService.name);

  constructor(
    @Inject(SOURCES_REPOSITORY) private readonly sources: SourcesRepository,
    @Inject(DATASETS_REPOSITORY) private readonly datasets: DatasetsRepository,
    private readonly ingestorFactory: IngestorFactory,
    private readonly config: ConfigService<IngestConfig, true>,
  ) {}

  async create(dto: CreateSourceDto): Promise<SourceEntity> {
    // El config se valida antes de persistir: una fuente con config incoherente no sirve ni
    // para ingerir ni para corregir, y queda como basura consultable.
    this.ingestorFactory.validateConfig(dto.type, toSourceConfig(dto.config));

    return this.sources.create({
      name: dto.name,
      type: dto.type,
      config: toSourceConfig(dto.config),
      ...(dto.description === undefined ? {} : { description: dto.description }),
      ...(dto.metadata === undefined ? {} : { metadata: dto.metadata }),
    });
  }

  async findAll(query: ListSourcesQueryDto): Promise<Paginated<SourceEntity>> {
    const page: PaginationQuery = { page: query.page, limit: query.limit };
    const { items, total } = await this.sources.findAll({
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.status === undefined ? {} : { status: query.status }),
      page,
    });

    return { data: items, meta: toPaginationMeta(total, items.length, page) };
  }

  async findOne(id: string): Promise<SourceEntity> {
    const source = await this.sources.findById(id);

    if (source === null) throw new SourceNotFoundError(id);

    return source;
  }

  async update(id: string, dto: UpdateSourceDto): Promise<SourceEntity> {
    const current = await this.findOne(id);

    if (dto.config !== undefined) {
      // El `type` no cambia nunca (api-contract.md §3), así que el config nuevo tiene que
      // seguir correspondiendo al viejo: si no, el `400` evita dejar la fuente con un config
      // que sólo se descubre inválido en la próxima ingesta.
      this.ingestorFactory.validateConfig(current.type, toSourceConfig(dto.config));
    }

    const updated = await this.sources.update(id, {
      ...(dto.name === undefined ? {} : { name: dto.name }),
      ...(dto.description === undefined ? {} : { description: dto.description }),
      ...(dto.config === undefined ? {} : { config: toSourceConfig(dto.config) }),
      ...(dto.metadata === undefined ? {} : { metadata: dto.metadata }),
    });

    if (updated === null) throw new SourceNotFoundError(id);

    return updated;
  }

  /**
   * Borrado lógico (api-contract.md §3): no se borran datasets, que pueden estar publicados.
   *
   * TODO(fase 07): desactivar también los endpoints asociados con `enabled = false`, antes de
   * marcar la fuente como dada de baja. Hoy no se puede porque no hay ningún endpoint
   * publicado y `EndpointsRepository` todavía no expone esa operación.
   */
  async remove(id: string): Promise<void> {
    const source = await this.findOne(id);

    await this.sources.markFailed(
      source.id,
      'La fuente fue dada de baja; sus datasets se conservan y no admite nuevas ingestas',
    );
  }

  async listDatasets(id: string, page: PaginationQuery): Promise<Paginated<DatasetListItem>> {
    // Se valida que la fuente exista para que un id inexistente dé `404 SOURCE_NOT_FOUND` y
    // no una lista vacía indistinguible de "esta fuente no tiene datasets".
    await this.findOne(id);

    const { items, total } = await this.datasets.findAll({ sourceId: id, page });

    return { data: items, meta: toPaginationMeta(total, items.length, page) };
  }

  /**
   * Ingesta de una fuente (ingestion.md §2). El orden de los pasos es normativo:
   *
   * 1. compare-and-swap del status, que serializa la ingesta concurrente;
   * 2. cálculo de versión;
   * 3. extracción con la strategy del `type`;
   * 4. límite de filas, que falla en vez de truncar (data-model.md §3.1 regla 2);
   * 5. alta del dataset y cierre de la fuente en `ready`.
   *
   * Reingerar nunca pisa el dataset anterior: crea `version + 1`.
   */
  async ingest(id: string): Promise<IngestOutcome> {
    const source = await this.findOne(id);

    if (source.status === SourceStatus.PROCESSING) {
      throw new IngestAlreadyRunningError();
    }

    const previousStatus = source.status;
    await this.acquireIngestSlot(source);
    const ctx = this.buildContext();

    try {
      const version = await this.datasets.nextVersion(source.id);
      const strategy = this.ingestorFactory.resolve(source.type);
      const result = await strategy.ingest(source.config, ctx);

      if (result.rows.length > ctx.limits.maxRows) {
        throw new RowsLimitExceededError(result.rows.length, ctx.limits.maxRows);
      }

      const dataset = await this.createDataset(source, version, result);
      await this.sources.markIngested(source.id, dataset.id, new Date());

      this.logger.log(
        `ingest ${source.id}: version ${version}, ${dataset.rowCount} filas, ` +
          `${dataset.warnings.length} warnings`,
      );

      return {
        sourceId: source.id,
        datasetId: dataset.id,
        version,
        rowCount: dataset.rowCount,
        columnsCount: dataset.columnsCount,
        warnings: dataset.warnings,
        meta: result.meta,
      };
    } catch (error) {
      await this.settleIngestSlot(source, previousStatus, error);
      throw error;
    }
  }

  /**
   * El CAS se hace probando cada status admisible, no contra el leído: entre el `findById` y
   * este update otra ingesta pudo tomar la fuente. Si ninguno aplica, hay alguien más
   * ingiriendo y corresponde `409` (ingestion.md §2).
   */
  private async acquireIngestSlot(source: SourceEntity): Promise<void> {
    for (const from of INGRESSIBLE) {
      if (await this.sources.compareAndSetStatus(source.id, from, SourceStatus.PROCESSING)) {
        return;
      }
    }

    throw new IngestAlreadyRunningError();
  }

  private buildContext(): IngestContext {
    const limits: IngestLimits = {
      timeoutMs: this.config.getOrThrow('INGEST_TIMEOUT_MS'),
      maxBytes: this.config.getOrThrow('INGEST_MAX_BYTES'),
      maxRows: this.config.getOrThrow('INGEST_MAX_ROWS'),
    };

    return { now: new Date(), storageDir: this.config.getOrThrow('STORAGE_DIR'), limits };
  }

  private async createDataset(
    source: SourceEntity,
    version: number,
    result: IngestResult,
  ) {
    try {
      return await this.datasets.create({
        sourceId: source.id,
        version,
        name: source.name,
        schema: result.schema,
        rows: result.rows,
        meta: result.meta,
        warnings: result.warnings,
      });
    } catch (error) {
      // Índice único `{sourceId, version}` vencido: es la garantía final de ingestion.md §2
      // punto 3, para el caso en que dos procesosograduan pasar el CAS.
      if (isDuplicateKeyError(error)) throw new VersionConflictError();

      throw error;
    }
  }

  /**
   * ingestion.md §7: casi todo error deja la fuente en `error` con el motivo. Los dos casos
   * `keep-status` (config inválido, `409` de concurrencia) describen un problema del pedido y
   * no del origen, así que la fuente vuelve al estado que tenía en vez de quedar en `error`.
   */
  private async settleIngestSlot(
    source: SourceEntity,
    previousStatus: SourceStatus,
    error: unknown,
  ): Promise<void> {
    if (error instanceof IngestionError && error.kind === 'keep-status') {
      await this.sources.compareAndSetStatus(
        source.id,
        SourceStatus.PROCESSING,
        previousStatus,
      );
      return;
    }

    const message = error instanceof Error ? error.message : String(error);

    this.logger.warn(`ingest ${source.id} falló: ${message}`);
    await this.sources.markFailed(source.id, message);
  }
}