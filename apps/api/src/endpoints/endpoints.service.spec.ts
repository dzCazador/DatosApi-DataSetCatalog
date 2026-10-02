import { ConfigService } from '@nestjs/config';

import { DatasetStatus, FilterOperator } from '@datosapi/common';
import type { ColumnSchema, DatasetEntity, EndpointDefinitionEntity, Row } from '@datosapi/common';
import type { DatasetsRepository, EndpointsRepository } from '@datosapi/database';

import {
  EndpointDatasetNotFoundError,
  EndpointDatasetRequiredError,
  EndpointLimitsInvalidError,
  EndpointNotFoundError,
  EndpointSourceMismatchError,
  SchemaMismatchError,
  SlugInvalidError,
  SlugTakenError,
} from './endpoints.errors';
import { EndpointsService } from './endpoints.service';
import type { CreateEndpointDto, UpdateEndpointDto } from './dto/endpoints.dto';
import type { EndpointsConfig } from './endpoints.service';

const SCHEMA: ColumnSchema[] = [
  { key: 'tramo', label: 'Tramo', type: 'string', nullable: false },
  { key: 'importe_desde', label: 'Desde', type: 'number', nullable: true, decimalScale: 2 },
];

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const SOURCE_ID = '66f0a1b2c3d4e5f607182930';
const OTHER_SOURCE_ID = '66f0a1b2c3d4e5f607182931';
const DATASET_ID = '66f1a1b2c3d4e5f607182930';
const ENDPOINT_ID = '66f2a1b2c3d4e5f607182930';

function makeDataset(overrides: Partial<DatasetEntity> = {}): DatasetEntity {
  const rows: Row[] = [{ tramo: '1', importe_desde: 0 }];

  return {
    id: DATASET_ID,
    sourceId: SOURCE_ID,
    version: 1,
    name: 'Escala',
    status: DatasetStatus.PUBLISHED,
    schema: SCHEMA,
    rows,
    rowCount: rows.length,
    columnsCount: SCHEMA.length,
    warnings: [],
    meta: { method: 'pdfjs-text-coords', rawRowCount: rows.length },
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeDefinition(
  overrides: Partial<EndpointDefinitionEntity> = {},
): EndpointDefinitionEntity {
  return {
    id: ENDPOINT_ID,
    name: 'Escala',
    slug: 'escala-retencion',
    sourceId: SOURCE_ID,
    datasetId: DATASET_ID,
    followLatest: false,
    filters: [{ field: 'importe_desde', op: FilterOperator.GTE }],
    sort: [{ field: 'importe_desde', dir: 'asc' }],
    defaultLimit: 50,
    maxLimit: 200,
    enabled: true,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeDto(overrides: Partial<CreateEndpointDto> = {}): CreateEndpointDto {
  return {
    name: 'Escala',
    slug: 'escala-retencion',
    sourceId: SOURCE_ID,
    datasetId: DATASET_ID,
    followLatest: false,
    defaultLimit: DEFAULT_LIMIT,
    maxLimit: MAX_LIMIT,
    enabled: true,
    ...overrides,
  } as CreateEndpointDto;
}

function makeService(repo: {
  endpoints?: Partial<EndpointsRepository>;
  datasets?: Partial<DatasetsRepository>;
}) {
  const config = {
    getOrThrow: (key: keyof EndpointsConfig) =>
      key === 'DEFAULT_LIMIT' ? DEFAULT_LIMIT : key === 'MAX_LIMIT' ? MAX_LIMIT : undefined,
  } as unknown as ConfigService<EndpointsConfig, true>;

  return new EndpointsService(
    repo.endpoints as EndpointsRepository,
    repo.datasets as DatasetsRepository,
    config,
  );
}

/** Repositorio de endpoints que no tiene dado de entrada, para los defaults de cada test. */
const STUB_ENDPOINTS = {
  create: jest.fn(),
  findAll: jest.fn(),
  findById: jest.fn().mockResolvedValue(makeDefinition()),
  findBySlug: jest.fn(),
  update: jest.fn(),
  delete: jest.fn().mockResolvedValue(true),
  disableBySourceId: jest.fn().mockResolvedValue(0),
};

const STUB_DATASETS = {
  findById: jest.fn().mockResolvedValue(makeDataset()),
  findLatestPublished: jest.fn().mockResolvedValue(makeDataset()),
};

function service(
  overrides: {
    endpoints?: Partial<EndpointsRepository>;
    datasets?: Partial<DatasetsRepository>;
  } = {},
) {
  return makeService({
    endpoints: { ...STUB_ENDPOINTS, ...overrides.endpoints },
    datasets: { ...STUB_DATASETS, ...overrides.datasets },
  });
}

function duplicateKeyError(): unknown {
  return { code: 11000, keyValue: { slug: 'escala-retencion' } };
}

describe('EndpointsService.create', () => {
  it('crea la definición y guarda el allowlist tal como vino', async () => {
    const create = jest.fn().mockResolvedValue(makeDefinition());
    const dto = makeDto({
      fields: ['tramo', 'importe_desde'],
      filters: [{ field: 'importe_desde', op: FilterOperator.GTE }],
      sort: [{ field: 'importe_desde', dir: 'asc' }],
    });

    await service({ endpoints: { create } }).create(dto);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'escala-retencion',
        sourceId: SOURCE_ID,
        datasetId: DATASET_ID,
        fields: ['tramo', 'importe_desde'],
        filters: [{ field: 'importe_desde', op: FilterOperator.GTE }],
        defaultLimit: DEFAULT_LIMIT,
        maxLimit: MAX_LIMIT,
      }),
    );
  });

  it.each([
    ['Escala-Retencion', 'mayúsculas'],
    ['escala_retencion', 'guion bajo'],
    ['escala--retencion', 'guion doble'],
    ['escala-retencion-', 'guion al final'],
    ['-escala', 'guion al principio'],
    ['es', 'muy corto'],
    ['escala retención', 'espacio'],
  ])('rechaza el slug %s (%s) con 400 SLUG_INVALID', async (slug) => {
    const create = jest.fn();

    await expect(
      service({ endpoints: { create } }).create(makeDto({ slug })),
    ).rejects.toBeInstanceOf(SlugInvalidError);
    expect(create).not.toHaveBeenCalled();
  });

  it('traduce el índice único de slug a 409 SLUG_TAKEN', async () => {
    const create = jest.fn().mockRejectedValue(duplicateKeyError());

    const error = await service({ endpoints: { create } })
      .create(makeDto())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SlugTakenError);
    expect((error as SlugTakenError).getResponse()).toMatchObject({ code: 'SLUG_TAKEN' });
  });

  it('no se traga otros errores del driver como si fueran de slug', async () => {
    const create = jest.fn().mockRejectedValue(new Error('connection lost'));

    await expect(service({ endpoints: { create } }).create(makeDto())).rejects.toThrow(
      'connection lost',
    );
  });

  it('rechaza defaultLimit mayor que maxLimit antes de tocar la base', async () => {
    const create = jest.fn();

    await expect(
      service({ endpoints: { create } }).create(makeDto({ defaultLimit: 300, maxLimit: 200 })),
    ).rejects.toBeInstanceOf(EndpointLimitsInvalidError);
    expect(create).not.toHaveBeenCalled();
  });

  it('rechaza un maxLimit por encima del tope global MAX_LIMIT', async () => {
    const create = jest.fn();

    await expect(
      service({ endpoints: { create } }).create(makeDto({ maxLimit: MAX_LIMIT + 1 })),
    ).rejects.toBeInstanceOf(EndpointLimitsInvalidError);
    expect(create).not.toHaveBeenCalled();
  });

  it('toma los límites por defecto de la configuración si el body no los manda', async () => {
    const create = jest.fn().mockResolvedValue(makeDefinition());
    const dto = makeDto({ defaultLimit: undefined, maxLimit: undefined });

    await service({ endpoints: { create } }).create(dto);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT }),
    );
  });

  it('exige datasetId si followLatest es false', async () => {
    const dto = makeDto({ datasetId: undefined });

    await expect(service().create(dto)).rejects.toBeInstanceOf(EndpointDatasetRequiredError);
  });

  it('no exige datasetId con followLatest, que es opcional por contrato', async () => {
    const create = jest
      .fn()
      .mockResolvedValue(makeDefinition({ datasetId: undefined, followLatest: true }));
    const dto = makeDto({ datasetId: undefined, followLatest: true });

    await expect(service({ endpoints: { create } }).create(dto)).resolves.toBeDefined();
  });

  it('crea la definición con followLatest aunque la fuente todavía no publicó nada', async () => {
    // Es un estado legítimo: una fuente recién registrada. La definición queda y se valida
    // sola cuando aparezca la primera publicación.
    const create = jest.fn().mockResolvedValue(makeDefinition());
    const findLatestPublished = jest.fn().mockResolvedValue(null);

    await expect(
      service({ endpoints: { create }, datasets: { findLatestPublished } }).create(
        makeDto({ datasetId: undefined, followLatest: true }),
      ),
    ).resolves.toBeDefined();
  });

  it('rechaza un datasetId inexistente con 404, sin guardarlo', async () => {
    const create = jest.fn();
    const findById = jest.fn().mockResolvedValue(null);

    await expect(
      service({ endpoints: { create }, datasets: { findById } }).create(makeDto()),
    ).rejects.toBeInstanceOf(EndpointDatasetNotFoundError);
    expect(create).not.toHaveBeenCalled();
  });

  it('rechaza un datasetId de otra source con 422 SCHEMA_MISMATCH', async () => {
    const create = jest.fn();
    const findById = jest.fn().mockResolvedValue(makeDataset({ sourceId: OTHER_SOURCE_ID }));

    const error = await service({ endpoints: { create }, datasets: { findById } })
      .create(makeDto())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EndpointSourceMismatchError);
    expect((error as SchemaMismatchError).getResponse()).toMatchObject({ code: 'SCHEMA_MISMATCH' });
    expect(create).not.toHaveBeenCalled();
  });

  it('rechaza con 422 una columna que el dataset no tiene, diciendo dónde', async () => {
    const create = jest.fn();
    const findById = jest.fn().mockResolvedValue(makeDataset());

    const error = await service({ endpoints: { create }, datasets: { findById } })
      .create(
        makeDto({
          fields: ['tramo', 'alicuota'],
          filters: [{ field: 'retencion', op: FilterOperator.GTE }],
          sort: [{ field: 'alicuota', dir: 'asc' }],
        }),
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SchemaMismatchError);
    expect((error as SchemaMismatchError).getResponse()).toMatchObject({
      code: 'SCHEMA_MISMATCH',
      details: {
        unknownFields: [
          { where: 'fields[1]', field: 'alicuota', reason: 'not in dataset schema' },
          { where: 'filters[0].field', field: 'retencion', reason: 'not in dataset schema' },
          { where: 'sort[0].field', field: 'alicuota', reason: 'not in dataset schema' },
        ],
      },
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('EndpointsService.findAll', () => {
  it('devuelve la página con el meta de paginación y propaga los filtros', async () => {
    const findAll = jest.fn().mockResolvedValue({ items: [makeDefinition()], total: 1 });

    const page = await service({ endpoints: { findAll } }).findAll({
      sourceId: SOURCE_ID,
      enabled: true,
      page: { page: 1, limit: 50 },
    });

    expect(findAll).toHaveBeenCalledWith({
      sourceId: SOURCE_ID,
      enabled: true,
      page: { page: 1, limit: 50 },
    });
    expect(page.meta).toEqual({ total: 1, count: 1, page: 1, limit: 50, pages: 1 });
  });

  it('omite los filtros ausentes en vez de mandarlos como undefined', async () => {
    const findAll = jest.fn().mockResolvedValue({ items: [], total: 0 });

    await service({ endpoints: { findAll } }).findAll({ page: { page: 1, limit: 50 } });

    expect(findAll).toHaveBeenCalledWith({ page: { page: 1, limit: 50 } });
  });
});

describe('EndpointsService.findOne', () => {
  it('incluye resolved con el dataset que usaría ahora', async () => {
    const detail = await service().findOne(ENDPOINT_ID);

    expect(detail.resolved).toEqual({
      datasetId: DATASET_ID,
      version: 1,
      status: DatasetStatus.PUBLISHED,
      rowCount: 1,
    });
    expect(detail.resolvedReason).toBeNull();
  });

  it('con followLatest resuelve contra la source, no contra el dataset guardado', async () => {
    const findById = jest.fn().mockResolvedValue(makeDataset({ id: DATASET_ID, version: 1 }));
    const findLatestPublished = jest
      .fn()
      .mockResolvedValue(makeDataset({ id: '66f1a1b2c3d4e5f607182999', version: 7 }));

    const detail = await service({
      endpoints: {
        findById: jest
          .fn()
          .mockResolvedValue(makeDefinition({ followLatest: true, datasetId: undefined })),
      },
      datasets: { findById, findLatestPublished },
    }).findOne(ENDPOINT_ID);

    expect(detail.resolved?.datasetId).toBe('66f1a1b2c3d4e5f607182999');
    expect(detail.resolved?.version).toBe(7);
    expect(findById).not.toHaveBeenCalled();
  });

  it('no es 404 si la definición existe pero no resuelve: devuelve resolved null con motivo', async () => {
    const findLatestPublished = jest.fn().mockResolvedValue(null);

    const detail = await service({
      endpoints: {
        findById: jest
          .fn()
          .mockResolvedValue(makeDefinition({ followLatest: true, datasetId: undefined })),
      },
      datasets: { findLatestPublished },
    }).findOne(ENDPOINT_ID);

    expect(detail.resolved).toBeNull();
    expect(detail.resolvedReason).toContain('publicado');
  });

  it('distingue el dataset inexistente de la fuente sin publicaciones', async () => {
    const findById = jest.fn().mockResolvedValue(null);

    const detail = await service({ datasets: { findById } }).findOne(ENDPOINT_ID);

    expect(detail.resolvedReason).toContain('no existe');
  });

  it('muestra el dataset archivado en resolved en vez de ocultarlo', async () => {
    const findById = jest.fn().mockResolvedValue(makeDataset({ status: DatasetStatus.ARCHIVED }));

    const detail = await service({ datasets: { findById } }).findOne(ENDPOINT_ID);

    expect(detail.resolved?.status).toBe(DatasetStatus.ARCHIVED);
  });

  it('404 si la definición no existe', async () => {
    await expect(
      service({ endpoints: { findById: jest.fn().mockResolvedValue(null) } }).findOne('nope'),
    ).rejects.toBeInstanceOf(EndpointNotFoundError);
  });
});

describe('EndpointsService.update', () => {
  const update = (dto: UpdateEndpointDto, overrides: Parameters<typeof service>[0] = {}) =>
    service({
      ...overrides,
      endpoints: { update: jest.fn().mockResolvedValue(makeDefinition()), ...overrides.endpoints },
    }).update(ENDPOINT_ID, dto);

  it('revalida contra el schema cuando cambia el allowlist de filtros', async () => {
    const repoUpdate = jest.fn().mockResolvedValue(makeDefinition());

    await expect(
      update(
        { filters: [{ field: 'alicuota', op: FilterOperator.GTE }] },
        { endpoints: { update: repoUpdate } },
      ),
    ).rejects.toBeInstanceOf(SchemaMismatchError);
    expect(repoUpdate).not.toHaveBeenCalled();
  });

  it('revalida cuando cambia la proyección', async () => {
    const repoUpdate = jest.fn().mockResolvedValue(makeDefinition());

    await expect(
      update({ fields: ['tramo'] }, { endpoints: { update: repoUpdate } }),
    ).resolves.toBeDefined();
    expect(repoUpdate).toHaveBeenCalledWith(
      ENDPOINT_ID,
      expect.objectContaining({ fields: ['tramo'] }),
    );
  });

  it('no toca el dataset si sólo cambia el nombre', async () => {
    const findById = jest.fn().mockResolvedValue(makeDataset());
    const repoUpdate = jest.fn().mockResolvedValue(makeDefinition());

    await update(
      { name: 'Nuevo nombre' },
      { endpoints: { update: repoUpdate }, datasets: { findById } },
    );

    expect(findById).not.toHaveBeenCalled();
    expect(repoUpdate).toHaveBeenCalledWith(ENDPOINT_ID, { name: 'Nuevo nombre' });
  });

  it('hereda el límite guardado para validar la relación entre los dos', async () => {
    // La definición guardada tiene maxLimit 200; mandar defaultLimit 300 contra ella es
    // inconsistente aunque el body no mentione maxLimit.
    const repoUpdate = jest.fn().mockResolvedValue(makeDefinition());

    await expect(
      update({ defaultLimit: 300 }, { endpoints: { update: repoUpdate } }),
    ).rejects.toBeInstanceOf(EndpointLimitsInvalidError);
  });

  it('revalida al reapuntar a otro dataset, que puede tener otro schema', async () => {
    const repoUpdate = jest.fn().mockResolvedValue(makeDefinition());

    await expect(
      service({
        endpoints: { update: repoUpdate },
        datasets: {
          // El dataset nuevo no tiene `importe_desde`, que la definición sí declara.
          findById: jest.fn().mockResolvedValue(
            makeDataset({
              id: '66f1a1b2c3d4e5f607182999',
              schema: [{ key: 'codigo', label: 'Codigo', type: 'string', nullable: false }],
            }),
          ),
        },
      }).update(ENDPOINT_ID, { datasetId: '66f1a1b2c3d4e5f607182999' }),
    ).rejects.toBeInstanceOf(SchemaMismatchError);
    expect(repoUpdate).not.toHaveBeenCalled();
  });

  it('404 si la definición desapareció entre la lectura y el update', async () => {
    const repoUpdate = jest.fn().mockResolvedValue(null);

    await expect(
      service({ endpoints: { update: repoUpdate } }).update(ENDPOINT_ID, { name: 'Nuevo' }),
    ).rejects.toBeInstanceOf(EndpointNotFoundError);
  });
});

describe('EndpointsService.validate', () => {
  it('informa valid true cuando todo cierra', async () => {
    await expect(service().validate(ENDPOINT_ID)).resolves.toEqual({
      valid: true,
      datasetId: DATASET_ID,
      version: 1,
      status: DatasetStatus.PUBLISHED,
      unknownFields: [],
      reason: null,
    });
  });

  it('informa valid false con las columnas huérfanas de una reingesta', async () => {
    const definition = makeDefinition({
      filters: [{ field: 'importe_desde', op: FilterOperator.GTE }],
      sort: [{ field: 'alicuota', dir: 'asc' }],
    });

    const report = await service({
      endpoints: { findById: jest.fn().mockResolvedValue(definition) },
    }).validate(ENDPOINT_ID);

    expect(report.valid).toBe(false);
    expect(report.unknownFields).toEqual([
      { where: 'sort[0].field', field: 'alicuota', reason: 'not in dataset schema' },
    ]);
  });

  it('informa valid false si la fuente todavía no publicó nada, sin inventar columnas', async () => {
    const findLatestPublished = jest.fn().mockResolvedValue(null);

    const report = await service({
      endpoints: {
        findById: jest
          .fn()
          .mockResolvedValue(makeDefinition({ followLatest: true, datasetId: undefined })),
      },
      datasets: { findLatestPublished },
    }).validate(ENDPOINT_ID);

    expect(report).toMatchObject({ valid: false, version: null, unknownFields: [] });
    expect(report.reason).toContain('publicado');
  });

  it('informa valid false con el motivo cuando el dataset está archivado', async () => {
    const findById = jest.fn().mockResolvedValue(makeDataset({ status: DatasetStatus.ARCHIVED }));

    const report = await service({ datasets: { findById } }).validate(ENDPOINT_ID);

    expect(report.valid).toBe(false);
    expect(report.reason).toContain('archivado');
  });

  it('404 si la definición no existe', async () => {
    await expect(
      service({ endpoints: { findById: jest.fn().mockResolvedValue(null) } }).validate('nope'),
    ).rejects.toBeInstanceOf(EndpointNotFoundError);
  });
});

describe('EndpointsService.remove', () => {
  it('hard-delete de la definición', async () => {
    const remove = jest.fn().mockResolvedValue(true);

    await expect(
      service({ endpoints: { delete: remove } }).remove(ENDPOINT_ID),
    ).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith(ENDPOINT_ID);
  });

  it('404 si no había nada que borrar', async () => {
    const remove = jest.fn().mockResolvedValue(false);

    await expect(
      service({ endpoints: { delete: remove } }).remove(ENDPOINT_ID),
    ).rejects.toBeInstanceOf(EndpointNotFoundError);
  });
});

describe('EndpointsService.disableBySourceId', () => {
  it('delega en el repositorio y devuelve cuántos endpoints se apagaron', async () => {
    const disable = jest.fn().mockResolvedValue(2);

    await expect(
      service({ endpoints: { disableBySourceId: disable } }).disableBySourceId(SOURCE_ID),
    ).resolves.toBe(2);
    expect(disable).toHaveBeenCalledWith(SOURCE_ID);
  });
});
