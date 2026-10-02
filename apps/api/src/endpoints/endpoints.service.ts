import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DATASETS_REPOSITORY, ENDPOINTS_REPOSITORY } from '@datosapi/common';
import type {
  ColumnSchema,
  DatasetEntity,
  EndpointDefinitionEntity,
  Paginated,
  PaginationQuery,
} from '@datosapi/common';
import type { DatasetsRepository, EndpointsRepository } from '@datosapi/database';

import { describeUnresolved, resolveDataset, toResolvedDataset } from './definition-resolution';
import type { ResolvedDataset } from './definition-resolution';
import type { CreateEndpointDto, UpdateEndpointDto } from './dto/endpoints.dto';
import {
  EndpointDatasetNotFoundError,
  EndpointDatasetRequiredError,
  EndpointLimitsInvalidError,
  EndpointNotFoundError,
  EndpointSourceMismatchError,
  SlugInvalidError,
  SlugTakenError,
  unknownFieldsError,
} from './endpoints.errors';
import type { UnknownFieldReport } from './endpoints.errors';

/**
 * Formato del slug (api-contract.md §1.2). Se valida acá y no con `@Matches` en el DTO para
 * que el `code` del error sea `SLUG_INVALID` y no el `VALIDATION_ERROR` genérico: el cliente
 * ramifica con `code`, y "tu slug tiene mayúsculas" es un mensaje distinto del que recibe al
 * mandar un body con un campo desconocido.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SLUG_MIN = 3;
const SLUG_MAX = 80;

/** `DEFAULT_LIMIT` y `MAX_LIMIT` gobiernan los límites de las definiciones (env.validation.ts). */
export interface EndpointsConfig {
  DEFAULT_LIMIT: number;
  MAX_LIMIT: number;
}

/** `GET /endpoints/:id`: la definición más qué dataset usaría ahora (api-contract.md §5). */
export interface EndpointDetail extends EndpointDefinitionEntity {
  resolved: ResolvedDataset | null;
  resolvedReason: string | null;
}

/**
 * Reporte de `POST /endpoints/:id/validate` (api-contract.md §5).
 *
 * `valid` es `false` también cuando el dataset no resuelve: una definición que apunta a un
 * dataset archivado o a una fuente sin publicaciones no es consultable, y el panel necesita
 * saberlo. Por eso el reporte distingue `unknownFields` de `reason`.
 */
export interface ValidationReport {
  valid: boolean;
  datasetId: string | null;
  version: number | null;
  status: DatasetEntity['status'] | null;
  unknownFields: UnknownFieldReport[];
  reason: string | null;
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

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000
  );
}

/**
 * Columnas que la definición referencia y el dataset no tiene, con la ubicación exacta como
 * la nombra `api-contract.md` §5 (`filters[1].field`). La ubicación importa: sin ella el
 * panel no puede señalar el control concreto que hay que corregir.
 */
function collectUnknownFields(
  definition: Pick<EndpointDefinitionEntity, 'fields' | 'filters' | 'sort'>,
  schema: ColumnSchema[],
): UnknownFieldReport[] {
  const known = new Set(schema.map((column) => column.key));
  const reports: UnknownFieldReport[] = [];

  (definition.fields ?? []).forEach((field, index) => {
    if (!known.has(field)) {
      reports.push({ where: `fields[${index}]`, field, reason: 'not in dataset schema' });
    }
  });

  definition.filters.forEach((filter, index) => {
    if (!known.has(filter.field)) {
      reports.push({
        where: `filters[${index}].field`,
        field: filter.field,
        reason: 'not in dataset schema',
      });
    }
  });

  definition.sort.forEach((sort, index) => {
    if (!known.has(sort.field)) {
      reports.push({
        where: `sort[${index}].field`,
        field: sort.field,
        reason: 'not in dataset schema',
      });
    }
  });

  return reports;
}

@Injectable()
export class EndpointsService {
  constructor(
    @Inject(ENDPOINTS_REPOSITORY) private readonly endpoints: EndpointsRepository,
    @Inject(DATASETS_REPOSITORY) private readonly datasets: DatasetsRepository,
    private readonly config: ConfigService<EndpointsConfig, true>,
  ) {}

  async create(dto: CreateEndpointDto): Promise<EndpointDefinitionEntity> {
    assertValidSlug(dto.slug);

    // Los límites por defecto salen de la configuración, no de constantes del DTO: `MAX_LIMIT`
    // es el contrato global de "cuántas filas puede pedir como mucho un consumidor", y un
    // `maxLimit` por definición nunca puede pasarlo.
    const defaultLimit = dto.defaultLimit ?? this.config.getOrThrow('DEFAULT_LIMIT');
    const maxLimit = dto.maxLimit ?? this.config.getOrThrow('MAX_LIMIT');

    this.assertValidLimits(defaultLimit, maxLimit);

    const dataset = await this.resolveForWrite(dto.sourceId, dto.datasetId, dto.followLatest);
    const schema = dataset?.schema ?? [];

    // La validación contra el schema ocurre antes de persistir: una definición con una
    // columna inexistente nunca fue consultable, así que guardarla dejaría basura que el
    // panel ofrece como si funcionara.
    const unknown = collectUnknownFields(
      { fields: dto.fields, filters: dto.filters ?? [], sort: dto.sort ?? [] },
      schema,
    );
    if (unknown.length > 0) throw unknownFieldsError(unknown, dto.slug);

    try {
      return await this.endpoints.create({
        name: dto.name,
        slug: dto.slug,
        sourceId: dto.sourceId,
        ...(dto.datasetId === undefined ? {} : { datasetId: dto.datasetId }),
        followLatest: dto.followLatest,
        ...(dto.description === undefined ? {} : { description: dto.description }),
        ...(dto.fields === undefined ? {} : { fields: dto.fields }),
        ...(dto.filters === undefined ? {} : { filters: dto.filters }),
        ...(dto.sort === undefined ? {} : { sort: dto.sort }),
        defaultLimit,
        maxLimit,
        enabled: dto.enabled,
        ...(dto.metadata === undefined ? {} : { metadata: dto.metadata }),
      });
    } catch (error) {
      // Índice único `{ slug }` vencido: el `409 SLUG_TAKEN` lo define el índice, no una
      // lectura previa que abriría una carrera entre dos POST con el mismo slug.
      if (isDuplicateKeyError(error)) throw new SlugTakenError(dto.slug);

      throw error;
    }
  }

  async findAll(query: {
    sourceId?: string;
    enabled?: boolean;
    page: PaginationQuery;
  }): Promise<Paginated<EndpointDefinitionEntity>> {
    const { items, total } = await this.endpoints.findAll({
      ...(query.sourceId === undefined ? {} : { sourceId: query.sourceId }),
      ...(query.enabled === undefined ? {} : { enabled: query.enabled }),
      page: query.page,
    });

    return { data: items, meta: toPaginationMeta(total, items.length, query.page) };
  }

  /**
   * Detalle con `resolved` (api-contract.md §5): qué dataset usaría ahora.
   *
   * `resolved` es `null` cuando no resuelve, y nunca `422`: el endpoint existe y el panel
   * tiene que poder mostrarlo aunque no sirva datos. El 422 queda para el consumidor del
   * endpoint público, que sí necesita un error.
   */
  async findOne(id: string): Promise<EndpointDetail> {
    const definition = await this.findEntity(id);
    const resolution = await resolveDataset(this.datasets, definition);

    return {
      ...definition,
      resolved: resolution.dataset === null ? null : toResolvedDataset(resolution.dataset),
      resolvedReason: resolution.dataset === null ? describeUnresolved(resolution.reason) : null,
    };
  }

  /**
   * Actualización parcial (api-contract.md §5). Revalida contra el schema si cambian
   * `fields`, `filters` o `sort`, y también si cambia el dataset al que apunta la
   * definición: el schema nuevo puede no tener las columnas de la proyección vieja.
   */
  async update(id: string, dto: UpdateEndpointDto): Promise<EndpointDefinitionEntity> {
    const current = await this.findEntity(id);

    const datasetId = dto.datasetId ?? current.datasetId;
    const followLatest = dto.followLatest ?? current.followLatest;
    const defaultLimit = dto.defaultLimit ?? current.defaultLimit;
    const maxLimit = dto.maxLimit ?? current.maxLimit;

    this.assertValidLimits(defaultLimit, maxLimit);

    const retargets = dto.datasetId !== undefined || dto.followLatest !== undefined;
    const changesAllowlist =
      dto.fields !== undefined || dto.filters !== undefined || dto.sort !== undefined;

    if (retargets || changesAllowlist) {
      const dataset = await this.resolveForWrite(current.sourceId, datasetId, followLatest);

      // Sin dataset no hay contra qué validar: la definición queda apuntando a algo que
      // todavía no existe y el panel la va a marcar como inválida al abrirla.
      if (dataset !== null) {
        const unknown = collectUnknownFields(
          {
            fields: dto.fields ?? current.fields,
            filters: dto.filters ?? current.filters,
            sort: dto.sort ?? current.sort,
          },
          dataset.schema,
        );

        if (unknown.length > 0) throw unknownFieldsError(unknown, current.slug);
      }
    }

    const updated = await this.endpoints.update(id, {
      ...(dto.name === undefined ? {} : { name: dto.name }),
      ...(dto.description === undefined ? {} : { description: dto.description }),
      ...(dto.datasetId === undefined ? {} : { datasetId: dto.datasetId }),
      ...(dto.followLatest === undefined ? {} : { followLatest: dto.followLatest }),
      ...(dto.fields === undefined ? {} : { fields: dto.fields }),
      ...(dto.filters === undefined ? {} : { filters: dto.filters }),
      ...(dto.sort === undefined ? {} : { sort: dto.sort }),
      ...(dto.defaultLimit === undefined ? {} : { defaultLimit: dto.defaultLimit }),
      ...(dto.maxLimit === undefined ? {} : { maxLimit: dto.maxLimit }),
      ...(dto.enabled === undefined ? {} : { enabled: dto.enabled }),
      ...(dto.metadata === undefined ? {} : { metadata: dto.metadata }),
    });

    if (updated === null) throw new EndpointNotFoundError(id);

    return updated;
  }

  /**
   * Revalida contra el schema actual y devuelve el detalle (api-contract.md §5). Siempre
   * `200`: es un reporte, no un fallo. Es la vía para enterarse de que una reingesta cambió
   * el schema y dejó columnas huérfanas en una definición publicada.
   */
  async validate(id: string): Promise<ValidationReport> {
    const definition = await this.findEntity(id);
    const resolution = await resolveDataset(this.datasets, definition);

    if (resolution.dataset === null) {
      return {
        valid: false,
        datasetId: definition.datasetId ?? null,
        version: null,
        status: null,
        unknownFields: [],
        reason: describeUnresolved(resolution.reason),
      };
    }

    const { dataset } = resolution;
    const unknownFields = collectUnknownFields(definition, dataset.schema);

    // Un dataset `archived` no invalida la definición — sus columnas siguen ahí y
    // `followLatest` va a seguir sirviendo la versión nueva — pero sí impide consultarla
    // mientras esté archivada, así que el reporte lo dice.
    const archived = dataset.status === 'archived';
    const reason = archived
      ? `El dataset resuelto está archivado; el endpoint devuelve 422 hasta que se publiques otra versión`
      : null;

    return {
      valid: unknownFields.length === 0 && !archived,
      datasetId: dataset.id,
      version: dataset.version,
      status: dataset.status,
      unknownFields,
      reason,
    };
  }

  /** Hard-delete de la definición; los datasets quedan intactos (api-contract.md §5). */
  async remove(id: string): Promise<void> {
    const deleted = await this.endpoints.delete(id);

    if (!deleted) throw new EndpointNotFoundError(id);
  }

  /**
   * Baja de una fuente (api-contract.md §3 y data-model.md §5): deshabilita sus endpoints.
   *
   * `EndpointsRepository.disableBySourceId` filtra por `enabled: true`, así que es
   * idempotente: dar de baja dos veces la misma fuente no vuelve a tocar los endpoints que ya
   * estaban apagados, y el `count` que devuelve distingue "deshabilité 2" de "no había
   * nada activo" para que el log diga la verdad.
   */
  async disableBySourceId(sourceId: string): Promise<number> {
    return this.endpoints.disableBySourceId(sourceId);
  }

  private async findEntity(id: string): Promise<EndpointDefinitionEntity> {
    const definition = await this.endpoints.findById(id);

    if (definition === null) throw new EndpointNotFoundError(id);

    return definition;
  }

  private assertValidLimits(defaultLimit: number, maxLimit: number): void {
    const ceiling = this.config.getOrThrow('MAX_LIMIT');

    if (defaultLimit > maxLimit || maxLimit > ceiling) {
      throw new EndpointLimitsInvalidError({ defaultLimit, maxLimit, ceiling });
    }
  }

  /**
   * Dataset contra el que se valida una escritura. `null` significa "todavía no hay
   * dataset": con `followLatest: true` es un estado legítimo —una fuente recién registrada
   * sin publicaciones— y la definición se valida sola cuando la primera se publique.
   */
  private async resolveForWrite(
    sourceId: string,
    datasetId: string | undefined,
    followLatest: boolean,
  ): Promise<DatasetEntity | null> {
    if (!followLatest && datasetId === undefined) throw new EndpointDatasetRequiredError();

    if (datasetId !== undefined) {
      const dataset = await this.datasets.findById(datasetId);

      if (dataset === null) throw new EndpointDatasetNotFoundError(datasetId);

      // Una definición no puede apuntar al dataset de otra fuente: si después pasa a
      // `followLatest`, resolvería contra su propia `sourceId` y nunca vería ese dataset.
      if (dataset.sourceId !== sourceId) {
        throw new EndpointSourceMismatchError(datasetId, dataset.sourceId, sourceId);
      }

      return dataset;
    }

    return (await this.datasets.findLatestPublished(sourceId)) ?? null;
  }
}

function assertValidSlug(slug: string): void {
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) {
    throw new SlugInvalidError(slug, `debe tener entre ${SLUG_MIN} y ${SLUG_MAX} caracteres`);
  }

  if (!SLUG_PATTERN.test(slug)) {
    throw new SlugInvalidError(
      slug,
      'sólo minúsculas, dígitos y guiones simples entre palabras (ej. escala-retencion-4ta)',
    );
  }
}
