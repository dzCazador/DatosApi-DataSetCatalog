import { getConnectionToken } from '@nestjs/mongoose';
import type { TestingModule } from '@nestjs/testing';
import type { Connection } from 'mongoose';

import { DatasetStatus, SourceStatus, SourceType } from '@datosapi/common';
import type { ColumnSchema, Row } from '@datosapi/common';
import { DATASETS_REPOSITORY, SOURCES_REPOSITORY } from '@datosapi/common';
import type { DatasetsRepository, SourcesRepository } from '@datosapi/database';

import { clearTestDatabase, createPersistenceTestingModule } from './persistence-testing-module';

const SCHEMA: ColumnSchema[] = [
  { key: 'tramo', label: 'Tramo', type: 'string', nullable: false },
  {
    key: 'importe_desde',
    label: 'Importe desde',
    type: 'number',
    nullable: false,
    decimalScale: 2,
  },
];

const ROWS: Row[] = [{ tramo: '1', importe_desde: 0 }];

const META = { method: 'csv-parse', rawRowCount: 1 };

function newSource(name = 'Escala AFIP') {
  return {
    name,
    type: SourceType.PDF,
    config: { url: 'https://example.test/a.pdf' },
  };
}

describe('persistencia de datasets y sources', () => {
  let moduleRef: TestingModule;
  let connection: Connection;
  let sources: SourcesRepository;
  let datasets: DatasetsRepository;
  let sourceId: string;

  beforeAll(async () => {
    moduleRef = await createPersistenceTestingModule();
    connection = moduleRef.get<Connection>(getConnectionToken());
    sources = moduleRef.get<SourcesRepository>(SOURCES_REPOSITORY);
    datasets = moduleRef.get<DatasetsRepository>(DATASETS_REPOSITORY);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await clearTestDatabase(moduleRef);
    sourceId = (await sources.create(newSource())).id;
  });

  describe('datasets: versionado', () => {
    it('nextVersion arranca en 1 y sigue al último dataset', async () => {
      await expect(datasets.nextVersion(sourceId)).resolves.toBe(1);

      await datasets.create({
        sourceId,
        version: 1,
        name: 'v1',
        schema: SCHEMA,
        rows: ROWS,
        meta: META,
      });
      await expect(datasets.nextVersion(sourceId)).resolves.toBe(2);

      await datasets.create({
        sourceId,
        version: 2,
        name: 'v2',
        schema: SCHEMA,
        rows: ROWS,
        meta: META,
      });
      await expect(datasets.nextVersion(sourceId)).resolves.toBe(3);
    });

    it('la versión es única por source: la repetida falla con E11000', async () => {
      await datasets.create({
        sourceId,
        version: 1,
        name: 'v1',
        schema: SCHEMA,
        rows: ROWS,
        meta: META,
      });

      await expect(
        datasets.create({
          sourceId,
          version: 1,
          name: 'otra',
          schema: SCHEMA,
          rows: ROWS,
          meta: META,
        }),
      ).rejects.toMatchObject({ code: 11_000 });
    });

    it('el mismo número de versión sí puede repetirse en otra source', async () => {
      const other = await sources.create(newSource('otra'));
      await datasets.create({
        sourceId,
        version: 1,
        name: 'v1',
        schema: SCHEMA,
        rows: ROWS,
        meta: META,
      });

      await expect(
        datasets.create({
          sourceId: other.id,
          version: 1,
          name: 'v1',
          schema: SCHEMA,
          rows: ROWS,
          meta: META,
        }),
      ).resolves.toMatchObject({ version: 1 });
    });

    it('crea en draft y calcula rowCount y columnsCount desde rows y schema', async () => {
      const created = await datasets.create({
        sourceId,
        version: 1,
        name: 'v1',
        schema: SCHEMA,
        rows: ROWS,
        meta: META,
      });

      expect(created.status).toBe(DatasetStatus.DRAFT);
      expect(created.rowCount).toBe(ROWS.length);
      expect(created.columnsCount).toBe(SCHEMA.length);
      expect(created.publishedAt).toBeUndefined();
      expect(created.warnings).toEqual([]);
    });
  });

  describe('datasets: publicación y archivado', () => {
    it('findLatestPublished devuelve la mayor versión publicada, no la mayor en general', async () => {
      const v1 = await datasets.create({
        sourceId,
        version: 1,
        name: 'v1',
        schema: SCHEMA,
        rows: ROWS,
        meta: META,
      });
      const v2 = await datasets.create({
        sourceId,
        version: 2,
        name: 'v2',
        schema: SCHEMA,
        rows: ROWS,
        meta: META,
      });
      const v3 = await datasets.create({
        sourceId,
        version: 3,
        name: 'v3',
        schema: SCHEMA,
        rows: ROWS,
        meta: META,
      });

      await datasets.publish(v1.id, new Date('2026-01-01T00:00:00.000Z'));
      await datasets.publish(v2.id, new Date('2026-02-01T00:00:00.000Z'));

      const latest = await datasets.findLatestPublished(sourceId);

      expect(latest?.id).toBe(v2.id);
      expect(latest?.version).toBe(2);
      expect(v3.status).toBe(DatasetStatus.DRAFT);
    });

    it('no encuentra nada mientras no haya ninguna publicada', async () => {
      await datasets.create({
        sourceId,
        version: 1,
        name: 'v1',
        schema: SCHEMA,
        rows: ROWS,
        meta: META,
      });

      await expect(datasets.findLatestPublished(sourceId)).resolves.toBeNull();
    });

    it('archivar saca el dataset de la última publicada sin borrarlo', async () => {
      const created = await datasets.create({
        sourceId,
        version: 1,
        name: 'v1',
        schema: SCHEMA,
        rows: ROWS,
        meta: META,
      });
      await datasets.publish(created.id, new Date('2026-01-01T00:00:00.000Z'));

      await expect(datasets.archive(created.id)).resolves.toMatchObject({
        id: created.id,
        status: DatasetStatus.ARCHIVED,
      });
      await expect(datasets.findLatestPublished(sourceId)).resolves.toBeNull();
      await expect(datasets.findById(created.id)).resolves.toMatchObject({
        status: DatasetStatus.ARCHIVED,
      });
    });
  });

  describe('datasets: listado sin rows', () => {
    it('findAll no trae rows y ordena por versión descendente', async () => {
      for (const version of [1, 2, 3]) {
        await datasets.create({
          sourceId,
          version,
          name: `v${version}`,
          schema: SCHEMA,
          rows: ROWS,
          meta: META,
        });
      }

      const page = await datasets.findAll({ sourceId, page: { page: 1, limit: 2 } });

      expect(page.total).toBe(3);
      expect(page.items.map((item) => item.version)).toEqual([3, 2]);
      expect(page.items[0]).not.toHaveProperty('rows');
    });

    it('filtra por status', async () => {
      const v1 = await datasets.create({
        sourceId,
        version: 1,
        name: 'v1',
        schema: SCHEMA,
        rows: ROWS,
        meta: META,
      });
      await datasets.create({
        sourceId,
        version: 2,
        name: 'v2',
        schema: SCHEMA,
        rows: ROWS,
        meta: META,
      });
      await datasets.publish(v1.id, new Date('2026-01-01T00:00:00.000Z'));

      const published = await datasets.findAll({
        sourceId,
        status: DatasetStatus.PUBLISHED,
        page: { page: 1, limit: 50 },
      });

      expect(published.items.map((item) => item.version)).toEqual([1]);
    });
  });

  describe('sources: CAS de status', () => {
    it('sólo gana el primer pending -> processing', async () => {
      const [first, second] = await Promise.all([
        sources.compareAndSetStatus(sourceId, SourceStatus.PENDING, SourceStatus.PROCESSING),
        sources.compareAndSetStatus(sourceId, SourceStatus.PENDING, SourceStatus.PROCESSING),
      ]);

      expect([first, second].filter(Boolean)).toHaveLength(1);
      await expect(sources.findById(sourceId)).resolves.toMatchObject({
        status: SourceStatus.PROCESSING,
      });
    });

    it('falla si el status actual no es el esperado', async () => {
      await sources.compareAndSetStatus(sourceId, SourceStatus.PENDING, SourceStatus.PROCESSING);

      await expect(
        sources.compareAndSetStatus(sourceId, SourceStatus.PENDING, SourceStatus.ERROR),
      ).resolves.toBe(false);
    });
  });

  describe('sources: ciclo de ingesta', () => {
    it('markIngested pasa a ready, guarda el dataset y borra el error anterior', async () => {
      await sources.markFailed(sourceId, 'falló la descarga');
      const dataset = await datasets.create({
        sourceId,
        version: 1,
        name: 'v1',
        schema: SCHEMA,
        rows: ROWS,
        meta: META,
      });
      const at = new Date('2026-10-01T12:00:00.000Z');

      const source = await sources.markIngested(sourceId, dataset.id, at);

      expect(source).toMatchObject({
        status: SourceStatus.READY,
        lastDatasetId: dataset.id,
        lastIngestAt: at,
      });
      expect(source?.lastError).toBeUndefined();
    });

    it('markFailed deja el motivo consultable', async () => {
      await expect(sources.markFailed(sourceId, 'HTTP 502 del origen')).resolves.toMatchObject({
        status: SourceStatus.ERROR,
        lastError: 'HTTP 502 del origen',
      });
    });
  });

  describe('sources: listado y actualización', () => {
    it('filtra por type y por status y pagina', async () => {
      await sources.create({
        name: 'manual',
        type: SourceType.MANUAL,
        config: { format: 'json', payload: '[]' },
      });
      await sources.create({
        name: 'api',
        type: SourceType.API,
        config: { url: 'https://example.test', method: 'GET' },
      });

      const byType = await sources.findAll({ type: SourceType.API, page: { page: 1, limit: 50 } });
      const byStatus = await sources.findAll({
        status: SourceStatus.PENDING,
        page: { page: 1, limit: 50 },
      });

      expect(byType.items.map((item) => item.name)).toEqual(['api']);
      expect(byStatus.total).toBe(3);
    });

    it('update no toca el status ni el type', async () => {
      await sources.markFailed(sourceId, 'falló');

      const updated = await sources.update(sourceId, { name: 'renombrada' });

      expect(updated).toMatchObject({ name: 'renombrada', type: SourceType.PDF });
      expect(updated?.status).toBe(SourceStatus.ERROR);
    });
  });

  it('la colección de datasets se llama datasets', async () => {
    await datasets.create({
      sourceId,
      version: 1,
      name: 'v1',
      schema: SCHEMA,
      rows: ROWS,
      meta: META,
    });

    const db = connection.db;
    if (!db) throw new Error('conexión sin db');
    const names = (await db.listCollections().toArray()).map((c) => c.name);

    expect(names).toEqual(expect.arrayContaining(['sources', 'datasets']));
  });
});
