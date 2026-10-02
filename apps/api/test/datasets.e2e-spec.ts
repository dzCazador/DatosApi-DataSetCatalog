import { HttpStatus, ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import request from 'supertest';

import { DATASETS_REPOSITORY, SOURCES_REPOSITORY, SourceType } from '@datosapi/common';
import type { DatasetsRepository, SourcesRepository } from '@datosapi/database';

import { AppModule } from '../src/app.module';
import { useIngestSizedBodyParser } from '../src/common/body-parser';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

/**
 * Ciclo de vida del catálogo de datasets contra el Mongo real (api-contract.md §4,
 * data-model.md §3). No puede ser unitario: las transiciones van en un `findOneAndUpdate`
 * guardado por `status`, y que ese filtro funcione es exactamente lo que hay que probar —
 * un doble de repositorio probaría la rama del `if`, no la garantía de atomicidad.
 */
describe('datasets (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let connection: Connection;
  let sources: SourcesRepository;
  let datasets: DatasetsRepository;
  let sourceId: string;

  // Encabezados con mayúsculas y amounts con 2 decimales a propósito: el `key` del schema
  // es `snake_case` derivado del encabezado, pero el `label` preserva el texto original
  // (data-model.md §1 y §6). Es la distinción de la que depende el panel al armar la tabla.
  const CSV = [
    'Codigo,Descripcion,Importe,Activo',
    ...Array.from({ length: 40 }, (_, i) => `A${i},Producto ${i},"${i + 1},25",true`),
  ].join('\n');

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    useIngestSizedBodyParser(
      app,
      moduleRef
        .get<ConfigService<{ INGEST_MAX_BYTES: number }, true>>(ConfigService)
        .getOrThrow('INGEST_MAX_BYTES'),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());

    await app.init();

    connection = moduleRef.get<Connection>(getConnectionToken());
    sources = moduleRef.get<SourcesRepository>(SOURCES_REPOSITORY);
    datasets = moduleRef.get<DatasetsRepository>(DATASETS_REPOSITORY);
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  beforeEach(async () => {
    await connection.dropDatabase();
    await Promise.all(Object.values(connection.models).map((model) => model.syncIndexes()));

    const created = await request(app.getHttpServer())
      .post('/api/v1/sources')
      .send({
        name: 'Listado interno — catálogo',
        type: SourceType.MANUAL,
        config: { format: 'csv', hasHeaderRow: true, payload: CSV },
      })
      .expect(HttpStatus.CREATED);

    sourceId = created.body._id as string;
  });

  async function ingest(): Promise<{ datasetId: string; version: number }> {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/sources/${sourceId}/ingest`)
      .expect(HttpStatus.ACCEPTED);

    return {
      datasetId: response.body.datasetId as string,
      version: response.body.version as number,
    };
  }

  describe('GET /api/v1/datasets', () => {
    it('no incluye rows en el listado de catálogo', async () => {
      await ingest();

      const response = await request(app.getHttpServer())
        .get('/api/v1/datasets')
        .expect(HttpStatus.OK);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).not.toHaveProperty('rows');
      expect(response.body.data[0]).toMatchObject({
        sourceId,
        version: 1,
        status: 'draft',
        rowCount: 40,
        columnsCount: 4,
      });
      expect(response.body.meta).toEqual({
        total: 1,
        count: 1,
        page: 1,
        limit: 50,
        pages: 1,
      });
    });

    it('filtra por sourceId y por status', async () => {
      await ingest();

      const bySource = await request(app.getHttpServer())
        .get('/api/v1/datasets')
        .query({ sourceId })
        .expect(HttpStatus.OK);
      expect(bySource.body.meta.total).toBe(1);

      const other = '66f0a1b2c3d4e5f607182930';
      const byOtherSource = await request(app.getHttpServer())
        .get('/api/v1/datasets')
        .query({ sourceId: other })
        .expect(HttpStatus.OK);
      expect(byOtherSource.body.meta.total).toBe(0);

      const published = await request(app.getHttpServer())
        .get('/api/v1/datasets')
        .query({ status: 'published' })
        .expect(HttpStatus.OK);
      expect(published.body.meta.total).toBe(0);

      const drafts = await request(app.getHttpServer())
        .get('/api/v1/datasets')
        .query({ status: 'draft' })
        .expect(HttpStatus.OK);
      expect(drafts.body.meta.total).toBe(1);
    });

    it('pagina', async () => {
      await ingest();
      await request(app.getHttpServer()).post(`/api/v1/sources/${sourceId}/ingest`).expect(202);

      const first = await request(app.getHttpServer())
        .get('/api/v1/datasets')
        .query({ limit: 1, page: 1 })
        .expect(HttpStatus.OK);
      expect(first.body.data).toHaveLength(1);
      expect(first.body.meta).toEqual({
        total: 2,
        count: 1,
        page: 1,
        limit: 1,
        pages: 2,
      });

      const second = await request(app.getHttpServer())
        .get('/api/v1/datasets')
        .query({ limit: 1, page: 2 })
        .expect(HttpStatus.OK);
      expect(second.body.data).toHaveLength(1);
      expect(second.body.data[0]._id).not.toBe(first.body.data[0]._id);
    });

    it('rechaza un status inválido con 400 VALIDATION_ERROR', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/datasets')
        .query({ status: 'inventado' })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/datasets/:id', () => {
    it('devuelve el preview con previewTruncated cuando hay más filas que PREVIEW_ROWS', async () => {
      const { datasetId } = await ingest();

      const response = await request(app.getHttpServer())
        .get(`/api/v1/datasets/${datasetId}`)
        .expect(HttpStatus.OK);

      const previewRows = moduleRef
        .get<ConfigService<{ PREVIEW_ROWS: number }, true>>(ConfigService)
        .getOrThrow('PREVIEW_ROWS');

      expect(response.body.rows).toHaveLength(previewRows);
      expect(response.body.rowCount).toBe(40);
      expect(response.body.meta.previewTruncated).toBe(true);
    });

    it('?full=true devuelve todas las filas y previewTruncated false', async () => {
      const { datasetId } = await ingest();

      const response = await request(app.getHttpServer())
        .get(`/api/v1/datasets/${datasetId}`)
        .query({ full: true })
        .expect(HttpStatus.OK);

      expect(response.body.rows).toHaveLength(40);
      expect(response.body.meta.previewTruncated).toBe(false);
    });

    it('trata ?full=false como preview, no como full', async () => {
      const { datasetId } = await ingest();

      const response = await request(app.getHttpServer())
        .get(`/api/v1/datasets/${datasetId}`)
        .query({ full: false })
        .expect(HttpStatus.OK);

      expect(response.body.rows.length).toBeLessThan(40);
      expect(response.body.meta.previewTruncated).toBe(true);
    });

    it('no trunca un dataset que entra entero en el preview', async () => {
      const small = 'codigo,descripcion\nA01,Producto A';
      const source = await request(app.getHttpServer())
        .post('/api/v1/sources')
        .send({
          name: 'Chico',
          type: SourceType.MANUAL,
          config: { format: 'csv', hasHeaderRow: true, payload: small },
        })
        .expect(HttpStatus.CREATED);

      const ingested = await request(app.getHttpServer())
        .post(`/api/v1/sources/${source.body._id}/ingest`)
        .expect(HttpStatus.ACCEPTED);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/datasets/${ingested.body.datasetId}`)
        .expect(HttpStatus.OK);

      expect(response.body.rows).toHaveLength(1);
      expect(response.body.meta.previewTruncated).toBe(false);
    });

    it('400 si ?full no es un valor reconocible, en vez de decidir en silencio', async () => {
      const { datasetId } = await ingest();

      const response = await request(app.getHttpServer())
        .get(`/api/v1/datasets/${datasetId}`)
        .query({ full: 'banana' })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('404 DATASET_NOT_FOUND con id inexistente', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/datasets/66f0a1b2c3d4e5f60718293a')
        .expect(HttpStatus.NOT_FOUND);

      expect(response.body.code).toBe('DATASET_NOT_FOUND');
    });
  });

  describe('GET /api/v1/datasets/:id/schema', () => {
    it('devuelve sólo el schema, sin rows', async () => {
      const { datasetId } = await ingest();

      const response = await request(app.getHttpServer())
        .get(`/api/v1/datasets/${datasetId}/schema`)
        .expect(HttpStatus.OK);

      expect(response.body.schema).toEqual([
        { key: 'codigo', label: 'Codigo', type: 'string', nullable: false, source: 'manual' },
        {
          key: 'descripcion',
          label: 'Descripcion',
          type: 'string',
          nullable: false,
          source: 'manual',
        },
        {
          key: 'importe',
          label: 'Importe',
          type: 'number',
          nullable: false,
          decimalScale: 2,
          source: 'manual',
        },
        { key: 'activo', label: 'Activo', type: 'boolean', nullable: false, source: 'manual' },
      ]);
      expect(response.body).not.toHaveProperty('rows');
    });

    it('404 si el dataset no existe', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/datasets/66f0a1b2c3d4e5f60718293a/schema')
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  describe('POST /api/v1/datasets/:id/publish', () => {
    it('publica un draft y setea publishedAt', async () => {
      const { datasetId } = await ingest();

      const response = await request(app.getHttpServer())
        .post(`/api/v1/datasets/${datasetId}/publish`)
        .expect(HttpStatus.OK);

      expect(response.body.status).toBe('published');
      expect(response.body.publishedAt).toBeDefined();
    });

    it('409 si ya está published', async () => {
      const { datasetId } = await ingest();
      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${datasetId}/publish`)
        .expect(HttpStatus.OK);

      const second = await request(app.getHttpServer())
        .post(`/api/v1/datasets/${datasetId}/publish`)
        .expect(HttpStatus.CONFLICT);

      expect(second.body.code).toBe('DATASET_INVALID_STATE');
      expect(second.body.details).toMatchObject({ operation: 'publish', current: 'published' });
    });

    it('409 si ya está archived', async () => {
      const { datasetId } = await ingest();
      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${datasetId}/publish`)
        .expect(HttpStatus.OK);
      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${datasetId}/archive`)
        .expect(HttpStatus.OK);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/datasets/${datasetId}/publish`)
        .expect(HttpStatus.CONFLICT);

      expect(response.body.code).toBe('DATASET_INVALID_STATE');
    });

    it('404 si el dataset no existe', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/datasets/66f0a1b2c3d4e5f60718293a/publish')
        .expect(HttpStatus.NOT_FOUND);

      expect(response.body.code).toBe('DATASET_NOT_FOUND');
    });

    it('dos publicaciones concurrentes: sólo una gana', async () => {
      const { datasetId } = await ingest();

      const results = await Promise.all([
        request(app.getHttpServer()).post(`/api/v1/datasets/${datasetId}/publish`),
        request(app.getHttpServer()).post(`/api/v1/datasets/${datasetId}/publish`),
      ]);

      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([HttpStatus.OK, HttpStatus.CONFLICT]);
    });

    it('no muta el contenido del dataset al publicarlo', async () => {
      const { datasetId } = await ingest();

      const before = await request(app.getHttpServer())
        .get(`/api/v1/datasets/${datasetId}`)
        .query({ full: true });
      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${datasetId}/publish`)
        .expect(HttpStatus.OK);
      const after = await request(app.getHttpServer())
        .get(`/api/v1/datasets/${datasetId}`)
        .query({ full: true });

      expect(after.body.rows).toEqual(before.body.rows);
      expect(after.body.schema).toEqual(before.body.schema);
      expect(after.body.rowCount).toBe(before.body.rowCount);
    });
  });

  describe('POST /api/v1/datasets/:id/archive', () => {
    it('archiva un published', async () => {
      const { datasetId } = await ingest();
      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${datasetId}/publish`)
        .expect(HttpStatus.OK);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/datasets/${datasetId}/archive`)
        .expect(HttpStatus.OK);

      expect(response.body.status).toBe('archived');
    });

    it('409 si el dataset está en draft', async () => {
      const { datasetId } = await ingest();

      const response = await request(app.getHttpServer())
        .post(`/api/v1/datasets/${datasetId}/archive`)
        .expect(HttpStatus.CONFLICT);

      expect(response.body.code).toBe('DATASET_INVALID_STATE');
      expect(response.body.details).toMatchObject({ operation: 'archive', current: 'draft' });
    });

    it('409 si ya está archived', async () => {
      const { datasetId } = await ingest();
      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${datasetId}/publish`)
        .expect(HttpStatus.OK);
      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${datasetId}/archive`)
        .expect(HttpStatus.OK);

      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${datasetId}/archive`)
        .expect(HttpStatus.CONFLICT);
    });
  });

  describe('DELETE /api/v1/datasets/:id', () => {
    it('es alias de archive y responde 204', async () => {
      const { datasetId } = await ingest();
      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${datasetId}/publish`)
        .expect(HttpStatus.OK);

      await request(app.getHttpServer())
        .delete(`/api/v1/datasets/${datasetId}`)
        .expect(HttpStatus.NO_CONTENT);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/datasets/${datasetId}`)
        .expect(HttpStatus.OK);
      expect(response.body.status).toBe('archived');
    });

    it('409 si el dataset está en draft, igual que archive', async () => {
      const { datasetId } = await ingest();

      const response = await request(app.getHttpServer())
        .delete(`/api/v1/datasets/${datasetId}`)
        .expect(HttpStatus.CONFLICT);

      expect(response.body.code).toBe('DATASET_INVALID_STATE');
    });
  });

  describe('findLatestPublished', () => {
    it('devuelve la versión publicada más alta, ignorando drafts posteriores', async () => {
      const first = await ingest();
      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${first.datasetId}/publish`)
        .expect(HttpStatus.OK);

      const second = await ingest();
      const third = await ingest();

      const latest = await datasets.findLatestPublished(sourceId);
      expect(latest).not.toBeNull();
      expect(latest?.id).toBe(first.datasetId);
      expect(latest?.version).toBe(1);
      expect(latest?.rows).toHaveLength(40);

      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${second.datasetId}/publish`)
        .expect(HttpStatus.OK);

      const after = await datasets.findLatestPublished(sourceId);
      expect(after?.id).toBe(second.datasetId);
      expect(after?.version).toBe(2);
      // La v3 existe pero sigue en `draft`: no debe ganarle a la v2 publicada.
      expect(third.version).toBe(3);
      expect(after?.version).toBeLessThan(third.version);
    });

    it('devuelve null si la source no tiene nada publicado', async () => {
      await ingest();

      expect(await datasets.findLatestPublished(sourceId)).toBeNull();
    });
  });

  describe('integridad', () => {
    it('una version nueva no toca la anterior', async () => {
      const first = await ingest();
      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${first.datasetId}/publish`)
        .expect(HttpStatus.OK);

      const second = await ingest();

      const firstAfter = await datasets.findById(first.datasetId);
      expect(firstAfter?.version).toBe(1);
      expect(firstAfter?.status).toBe('published');
      expect(second.version).toBe(2);
    });

    it('la source queda con lastDatasetId apuntando a la última versión', async () => {
      await ingest();

      const source = await sources.findById(sourceId);
      expect(source?.status).toBe('ready');
      expect(source?.lastDatasetId).toBeDefined();
    });

    it('el listado de la source sigue exponiendo los datasets sin rows', async () => {
      await ingest();

      const response = await request(app.getHttpServer())
        .get(`/api/v1/sources/${sourceId}/datasets`)
        .expect(HttpStatus.OK);

      expect(response.body.meta.total).toBe(1);
      expect(response.body.data[0]).not.toHaveProperty('rows');
    });
  });
});
