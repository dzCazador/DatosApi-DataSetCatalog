import { ConfigService } from '@nestjs/config';

import { DatasetStatus } from '@datosapi/common';
import type { ColumnSchema, DatasetEntity, Row } from '@datosapi/common';
import type { DatasetsRepository } from '@datosapi/database';

import { DatasetInvalidStateError, DatasetNotFoundError } from './datasets.errors';
import { DatasetsService } from './datasets.service';

const PREVIEW_ROWS = 20;
const INGEST_MAX_ROWS = 100_000;

const SCHEMA: ColumnSchema[] = [
  { key: 'importe_desde', label: 'Desde', type: 'number', nullable: false, decimalScale: 2 },
];

function makeDataset(overrides: Partial<DatasetEntity> = {}): DatasetEntity {
  const rows: Row[] = [{ importe_desde: 1000 }, { importe_desde: 54785.28 }];

  return {
    id: '66f0a1b2c3d4e5f60718293a',
    sourceId: '66f0a1b2c3d4e5f607182930',
    version: 1,
    name: 'Escala de retención',
    status: DatasetStatus.DRAFT,
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

function makeService(repo: Partial<DatasetsRepository>) {
  const datasets = repo as DatasetsRepository;
  const config = {
    getOrThrow: (key: string) =>
      key === 'PREVIEW_ROWS'
        ? PREVIEW_ROWS
        : key === 'INGEST_MAX_ROWS'
          ? INGEST_MAX_ROWS
          : undefined,
  } as unknown as ConfigService<{ PREVIEW_ROWS: number; INGEST_MAX_ROWS: number }, true>;

  return new DatasetsService(datasets, config);
}

describe('DatasetsService', () => {
  describe('findOne', () => {
    it('acota las filas a PREVIEW_ROWS y marca previewTruncated', async () => {
      const rows = Array.from({ length: 100 }, (_, i) => ({ importe_desde: i }));
      const findById = jest
        .fn()
        .mockResolvedValue(makeDataset({ rows: rows.slice(0, PREVIEW_ROWS), rowCount: 100 }));

      const detail = await makeService({ findById }).findOne('66f0a1b2c3d4e5f60718293a');

      expect(detail.rows).toHaveLength(PREVIEW_ROWS);
      expect(detail.rowCount).toBe(100);
      expect(detail.meta.previewTruncated).toBe(true);
      expect(findById).toHaveBeenCalledWith('66f0a1b2c3d4e5f60718293a', {
        rowsLimit: PREVIEW_ROWS,
      });
    });

    it('no marca previewTruncated cuando el dataset entra entero en el preview', async () => {
      const findById = jest.fn().mockResolvedValue(makeDataset());

      const detail = await makeService({ findById }).findOne('66f0a1b2c3d4e5f60718293a');

      expect(detail.meta.previewTruncated).toBe(false);
    });

    it('con ?full=true pide hasta INGEST_MAX_ROWS, no PREVIEW_ROWS', async () => {
      const findById = jest.fn().mockResolvedValue(makeDataset());

      await makeService({ findById }).findOne('66f0a1b2c3d4e5f60718293a', { full: true });

      expect(findById).toHaveBeenCalledWith('66f0a1b2c3d4e5f60718293a', {
        rowsLimit: INGEST_MAX_ROWS,
      });
    });

    it('lanza 404 DATASET_NOT_FOUND si el id no existe', async () => {
      const findById = jest.fn().mockResolvedValue(null);

      await expect(makeService({ findById }).findOne('nope')).rejects.toBeInstanceOf(
        DatasetNotFoundError,
      );
    });
  });

  describe('getSchema', () => {
    it('devuelve sólo el schema', async () => {
      const findById = jest.fn().mockResolvedValue(makeDataset());

      await expect(makeService({ findById }).getSchema('id')).resolves.toEqual(SCHEMA);
    });
  });

  describe('publish', () => {
    it('publica un draft y setea publishedAt', async () => {
      const published = makeDataset({
        status: DatasetStatus.PUBLISHED,
        publishedAt: new Date('2026-10-02T00:00:00.000Z'),
      });
      const publish = jest.fn().mockResolvedValue(published);

      await expect(makeService({ publish }).publish('id')).resolves.toBe(published);
      expect(publish).toHaveBeenCalledTimes(1);
    });

    it('rechaza publicar un dataset ya published', async () => {
      const publish = jest.fn().mockResolvedValue(null);
      const findById = jest
        .fn()
        .mockResolvedValue(makeDataset({ status: DatasetStatus.PUBLISHED }));

      await expect(makeService({ publish, findById }).publish('id')).rejects.toBeInstanceOf(
        DatasetInvalidStateError,
      );
    });

    it('rechaza publicar un dataset archivado', async () => {
      const publish = jest.fn().mockResolvedValue(null);
      const findById = jest.fn().mockResolvedValue(makeDataset({ status: DatasetStatus.ARCHIVED }));

      const error = await makeService({ publish, findById })
        .publish('id')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DatasetInvalidStateError);
      expect((error as DatasetInvalidStateError).message).toContain('archived');
    });

    it('distingue 404 de 409 cuando el update guardado no aplica', async () => {
      const publish = jest.fn().mockResolvedValue(null);
      const findById = jest.fn().mockResolvedValue(null);

      await expect(makeService({ publish, findById }).publish('id')).rejects.toBeInstanceOf(
        DatasetNotFoundError,
      );
    });
  });

  describe('archive', () => {
    it('archiva un published', async () => {
      const archived = makeDataset({ status: DatasetStatus.ARCHIVED });
      const archive = jest.fn().mockResolvedValue(archived);

      await expect(makeService({ archive }).archive('id')).resolves.toBe(archived);
    });

    it('rechaza archivar un draft', async () => {
      const archive = jest.fn().mockResolvedValue(null);
      const findById = jest.fn().mockResolvedValue(makeDataset({ status: DatasetStatus.DRAFT }));

      await expect(makeService({ archive, findById }).archive('id')).rejects.toBeInstanceOf(
        DatasetInvalidStateError,
      );
    });
  });

  describe('findLatestPublished', () => {
    it('devuelve la versión publicada más alta', async () => {
      const latest = makeDataset({ version: 3, status: DatasetStatus.PUBLISHED });
      const findLatestPublished = jest.fn().mockResolvedValue(latest);

      await expect(
        makeService({ findLatestPublished }).findLatestPublished('source-1'),
      ).resolves.toBe(latest);
      expect(findLatestPublished).toHaveBeenCalledWith('source-1');
    });

    it('devuelve null si la source no tiene nada publicado', async () => {
      const findLatestPublished = jest.fn().mockResolvedValue(null);

      await expect(
        makeService({ findLatestPublished }).findLatestPublished('source-1'),
      ).resolves.toBeNull();
    });
  });

  describe('findAll', () => {
    it('devuelve los datasets sin rows y con el meta de paginación', async () => {
      const { rows: _rows, ...listItem } = makeDataset();
      const findAll = jest.fn().mockResolvedValue({ items: [listItem], total: 1 });

      const page = await makeService({ findAll }).findAll({ page: 1, limit: 50 });

      expect(page.meta).toEqual({ total: 1, count: 1, page: 1, limit: 50, pages: 1 });
      expect(page.data).toHaveLength(1);
      expect(page.data[0]).not.toHaveProperty('rows');
    });

    it('propaga los filtros sourceId y status al repositorio', async () => {
      const findAll = jest.fn().mockResolvedValue({ items: [], total: 0 });

      await makeService({ findAll }).findAll({
        page: 2,
        limit: 10,
        sourceId: 'source-1',
        status: DatasetStatus.PUBLISHED,
      });

      expect(findAll).toHaveBeenCalledWith({
        sourceId: 'source-1',
        status: DatasetStatus.PUBLISHED,
        page: { page: 2, limit: 10 },
      });
    });

    it('devuelve pages 0 y no NaN cuando no hay resultados', async () => {
      const findAll = jest.fn().mockResolvedValue({ items: [], total: 0 });

      const page = await makeService({ findAll }).findAll({ page: 1, limit: 50 });

      expect(page.meta.pages).toBe(0);
    });
  });
});
