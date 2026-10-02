import { DatasetStatus, FilterOperator } from '@datosapi/common';
import type { ColumnSchema, DatasetEntity, EndpointDefinitionEntity, Row } from '@datosapi/common';
import type { DatasetsRepository, EndpointsRepository } from '@datosapi/database';

import { DynamicService } from './dynamic.service';
import {
  DatasetNotPublishedError,
  DatasetUnresolvedError,
  SlugNotFoundError,
} from './endpoints.errors';
import { InMemoryQueryEngine } from './query-engine';
import type { QueryEngine } from './query-engine';

const SCHEMA: ColumnSchema[] = [
  { key: 'tramo', label: 'Tramo', type: 'string', nullable: false },
  { key: 'importe_desde', label: 'Desde', type: 'number', nullable: false, decimalScale: 2 },
];

const ROWS: Row[] = [
  { tramo: '1', importe_desde: 0 },
  { tramo: '5', importe_desde: 54785.28 },
];

const SOURCE_ID = '66f0a1b2c3d4e5f607182930';
const DATASET_ID = '66f1a1b2c3d4e5f607182930';

function makeDataset(overrides: Partial<DatasetEntity> = {}): DatasetEntity {
  return {
    id: DATASET_ID,
    sourceId: SOURCE_ID,
    version: 1,
    name: 'Escala',
    status: DatasetStatus.PUBLISHED,
    schema: SCHEMA,
    rows: ROWS,
    rowCount: ROWS.length,
    columnsCount: SCHEMA.length,
    warnings: [],
    meta: { method: 'pdfjs-text-coords', rawRowCount: ROWS.length },
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeDefinition(
  overrides: Partial<EndpointDefinitionEntity> = {},
): EndpointDefinitionEntity {
  return {
    id: '66f2a1b2c3d4e5f607182930',
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

function makeService(
  endpoints: Partial<EndpointsRepository>,
  datasets: Partial<DatasetsRepository> = { findById: jest.fn().mockResolvedValue(makeDataset()) },
  engine: QueryEngine = new InMemoryQueryEngine(),
) {
  return new DynamicService(
    endpoints as EndpointsRepository,
    datasets as DatasetsRepository,
    engine,
  );
}

describe('DynamicService.execute', () => {
  it('sirve las filas con el meta.dataset que identifica la versión', async () => {
    const service = makeService({
      findBySlug: jest.fn().mockResolvedValue(makeDefinition()),
    });

    const { payload } = await service.execute('escala-retencion', {});

    expect(payload.data).toEqual(ROWS);
    expect(payload.meta).toEqual({
      total: 2,
      count: 2,
      page: 1,
      limit: 50,
      pages: 1,
      dataset: {
        id: DATASET_ID,
        version: 1,
        sourceId: SOURCE_ID,
        updatedAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
  });

  it('aplica el filtro declarado y refleja el total filtrado', async () => {
    const service = makeService({
      findBySlug: jest.fn().mockResolvedValue(makeDefinition()),
    });

    const { payload } = await service.execute('escala-retencion', { importe_desde: '50000' });

    expect(payload.data).toEqual([{ tramo: '5', importe_desde: 54785.28 }]);
    expect(payload.meta.total).toBe(1);
  });

  it('404 si el slug no existe', async () => {
    const service = makeService({ findBySlug: jest.fn().mockResolvedValue(null) });

    await expect(service.execute('no-existe', {})).rejects.toBeInstanceOf(SlugNotFoundError);
  });

  it('da el mismo 404 si el endpoint existe pero está deshabilitado', async () => {
    // Distinguirlos le confirmaría al consumidor que el slug existe, que es información de la
    // que no debería depender (api-contract.md §6).
    const service = makeService({
      findBySlug: jest.fn().mockResolvedValue(makeDefinition({ enabled: false })),
    });

    const error = await service.execute('escala-retencion', {}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SlugNotFoundError);
    expect((error as SlugNotFoundError).getResponse()).toMatchObject({ code: 'SLUG_NOT_FOUND' });
  });

  it('422 si el dataset existe pero no está published', async () => {
    const service = makeService(
      { findBySlug: jest.fn().mockResolvedValue(makeDefinition()) },
      { findById: jest.fn().mockResolvedValue(makeDataset({ status: DatasetStatus.DRAFT })) },
    );

    const error = await service.execute('escala-retencion', {}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DatasetNotPublishedError);
    expect((error as DatasetNotPublishedError).getResponse()).toMatchObject({
      code: 'SCHEMA_MISMATCH',
      details: { status: DatasetStatus.DRAFT },
    });
  });

  it('422 si el dataset declarado ya no existe', async () => {
    const service = makeService(
      { findBySlug: jest.fn().mockResolvedValue(makeDefinition()) },
      { findById: jest.fn().mockResolvedValue(null) },
    );

    const error = await service.execute('escala-retencion', {}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DatasetUnresolvedError);
    expect((error as DatasetUnresolvedError).getResponse()).toMatchObject({
      code: 'SCHEMA_MISMATCH',
      details: { reason: 'dataset-not-found' },
    });
  });

  it('422 con otro motivo si lo que falta es la primera publicación de la source', async () => {
    const service = makeService(
      { findBySlug: jest.fn().mockResolvedValue(makeDefinition({ followLatest: true })) },
      { findLatestPublished: jest.fn().mockResolvedValue(null) },
    );

    const error = await service.execute('escala-retencion', {}).catch((caught: unknown) => caught);

    expect((error as DatasetUnresolvedError).getResponse()).toMatchObject({
      details: { reason: 'no-published' },
    });
  });

  it('con followLatest sirve la última publicada sin tocar la definición', async () => {
    const latest = makeDataset({ id: '66f1a1b2c3d4e5f607182999', version: 4 });
    const findLatestPublished = jest.fn().mockResolvedValue(latest);
    const findById = jest.fn().mockResolvedValue(makeDataset());
    const service = makeService(
      { findBySlug: jest.fn().mockResolvedValue(makeDefinition({ followLatest: true })) },
      { findLatestPublished, findById },
    );

    const { payload } = await service.execute('escala-retencion', {});

    expect(payload.meta.dataset).toMatchObject({ id: '66f1a1b2c3d4e5f607182999', version: 4 });
    // La definición apunta a la v1 y `findById` no se consulta: con `followLatest` manda la
    // última publicada, no el id guardado.
    expect(findById).not.toHaveBeenCalled();
  });

  it('no toca la definición ni el dataset para resolver el query', async () => {
    const definition = makeDefinition();
    const dataset = makeDataset();
    const findBySlug = jest.fn().mockResolvedValue(definition);
    const findById = jest.fn().mockResolvedValue(dataset);
    const service = makeService({ findBySlug }, { findById });

    await service.execute('escala-retencion', { importe_desde: '1' });

    expect(findBySlug).toHaveBeenCalledTimes(1);
    expect(findById).toHaveBeenCalledTimes(1);
  });
});

describe('DynamicService: ETag', () => {
  const build = (dataset: DatasetEntity) =>
    makeService(
      { findBySlug: jest.fn().mockResolvedValue(makeDefinition()) },
      { findById: jest.fn().mockResolvedValue(dataset) },
    );

  it('es el mismo para el mismo query venga en cualquier orden', async () => {
    const service = build(makeDataset());

    const first = await service.execute('escala-retencion', { limit: '1', page: '1' });
    const second = await service.execute('escala-retencion', { page: '1', limit: '1' });

    expect(first.etag).toBe(second.etag);
  });

  it('difiere cuando cambia el query', async () => {
    const service = build(makeDataset());

    const first = await service.execute('escala-retencion', { importe_desde: '1' });
    const second = await service.execute('escala-retencion', { importe_desde: '2' });

    expect(first.etag).not.toBe(second.etag);
  });

  it('difiere entre versiones del mismo dataset, porque version entra en el hash', async () => {
    const v1 = await build(makeDataset({ version: 1 })).execute('escala-retencion', {});
    const v2 = await build(makeDataset({ version: 2 })).execute('escala-retencion', {});

    expect(v1.etag).not.toBe(v2.etag);
  });

  it('difiere entre datasets distintos aunque tengas la misma versión', async () => {
    const other = makeDataset({ id: '66f1a1b2c3d4e5f607182999' });

    const first = await build(makeDataset()).execute('escala-retencion', {});
    const second = await build(other).execute('escala-retencion', {});

    expect(first.etag).not.toBe(second.etag);
  });

  it('viene entre comillas, como exige la cabecera HTTP', async () => {
    const { etag } = await build(makeDataset()).execute('escala-retencion', {});

    expect(etag).toMatch(/^"[0-9a-f]+"$/);
  });
});

describe('DynamicService: el motor se inyecta', () => {
  it('delega la ejecución en el QueryEngine, sin conocer sus operadores', async () => {
    const execute = jest
      .fn()
      .mockReturnValue({ data: [], meta: { total: 0, count: 0, page: 1, limit: 50, pages: 0 } });
    const engine: QueryEngine = { execute };
    const service = makeService(
      { findBySlug: jest.fn().mockResolvedValue(makeDefinition()) },
      { findById: jest.fn().mockResolvedValue(makeDataset()) },
      engine,
    );

    await service.execute('escala-retencion', { page: '2', limit: '5' });

    expect(execute).toHaveBeenCalledWith(
      ROWS,
      SCHEMA,
      expect.objectContaining({ page: 2, limit: 5 }),
    );
  });

  it('propaga el error del motor sin envolverlo, para que el 400 llegue intacto', async () => {
    const engine: QueryEngine = {
      execute: () => {
        throw new Error('boom');
      },
    };
    const service = makeService(
      { findBySlug: jest.fn().mockResolvedValue(makeDefinition()) },
      { findById: jest.fn().mockResolvedValue(makeDataset()) },
      engine,
    );

    await expect(service.execute('escala-retencion', {})).rejects.toThrow('boom');
  });
});
