import { HttpStatus } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import request from 'supertest';
import type { Response } from 'supertest';

import { DATASETS_REPOSITORY, SOURCES_REPOSITORY, SourceStatus, SourceType } from '@datosapi/common';
import type { DatasetsRepository, SourcesRepository } from '@datosapi/database';

import { AppModule } from '../src/app.module';
import { useIngestSizedBodyParser } from '../src/common/body-parser';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

/**
 * Flujo e2e de la ingesta manual contra el Mongo real (ingestion.md §2 y §4.1).
 *
 * No puede ser unitario por dos motivos que no se pueden falsear con dobles: el índice único
 * `{sourceId, version}` que resuelve la carrera de versiones, y el compare-and-swap de
 * `Source.status` que serializa ingesta concurrente. Los dos existen sólo en el servidor.
 */
describe('ingesta manual (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let connection: Connection;
  let sources: SourcesRepository;
  let datasets: DatasetsRepository;

  const CSV = 'codigo,descripcion,precio,activo\nA01,Producto A,"1.234,56",true\nB02,Producto B,99,false';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // Igual que `main.ts`: el body parser tiene que admitir lo que la ingesta acepta.
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
    // La base se borra antes de cerrar la app: `app.close()` cierra la conexión de Mongoose y
    // un `dropDatabase()` posterior se queda esperando sobre un socket muerto.
    await connection.dropDatabase();
    await app.close();
  });

  beforeEach(async () => {
    await connection.dropDatabase();
    await Promise.all(Object.values(connection.models).map((model) => model.syncIndexes()));
  });

  async function createManualSource(payload = CSV): Promise<Response> {
    return request(app.getHttpServer())
      .post('/api/v1/sources')
      .send({
        name: 'Listado interno — prueba',
        type: SourceType.MANUAL,
        config: { format: 'csv', hasHeaderRow: true, payload },
      });
  }

  it('crea una fuente manual en pending sin disparar la ingesta', async () => {
    const response = await createManualSource();

    expect(response.status).toBe(HttpStatus.CREATED);
    expect(response.body).toMatchObject({
      type: SourceType.MANUAL,
      status: SourceStatus.PENDING,
      name: 'Listado interno — prueba',
    });

    // api-contract.md §3: registrar e ingerir son pasos separados.
    const datasetsAfterCreate = await datasets.findAll({
      sourceId: response.body._id,
      page: { page: 1, limit: 10 },
    });
    expect(datasetsAfterCreate.total).toBe(0);
  });

  it('ingiere el CSV y devuelve datasetId, version y rowCount', async () => {
    const created = await createManualSource();
    const { _id: sourceId } = created.body;

    const response = await request(app.getHttpServer()).post(`/api/v1/sources/${sourceId}/ingest`);

    expect(response.status).toBe(HttpStatus.ACCEPTED);
    expect(response.body).toMatchObject({ sourceId, version: 1, rowCount: 2, columnsCount: 4 });
    expect(response.body.warnings).toEqual([]);
    expect(response.body.meta).toMatchObject({ method: 'csv-parse' });

    const source = await sources.findById(sourceId);
    expect(source?.status).toBe(SourceStatus.READY);
    expect(source?.lastDatasetId).toBe(response.body.datasetId);

    const dataset = await datasets.findById(response.body.datasetId);
    expect(dataset?.rows).toEqual([
      { codigo: 'A01', descripcion: 'Producto A', precio: 1234.56, activo: true },
      { codigo: 'B02', descripcion: 'Producto B', precio: 99, activo: false },
    ]);
    expect(dataset?.schema.find((column) => column.key === 'precio')).toMatchObject({
      type: 'number',
      decimalScale: 2,
      nullable: false,
    });
  });

  it('reingerar crea la version 2 y deja intacta la version 1', async () => {
    const created = await createManualSource();
    const { _id: sourceId } = created.body;

    const first = await request(app.getHttpServer()).post(`/api/v1/sources/${sourceId}/ingest`);
    const second = await request(app.getHttpServer()).post(`/api/v1/sources/${sourceId}/ingest`);

    expect(first.body.version).toBe(1);
    expect(second.body.version).toBe(2);
    expect(second.body.datasetId).not.toBe(first.body.datasetId);

    // La garantía de versionado inmutable: el dataset v1 sigue exactamente igual.
    const v1 = await datasets.findById(first.body.datasetId);
    expect(v1?.version).toBe(1);
    expect(v1?.rows).toHaveLength(2);

    const all = await datasets.findAll({ sourceId, page: { page: 1, limit: 10 } });
    expect(all.total).toBe(2);
    expect(all.items.map((item) => item.version)).toEqual([2, 1]);
  });

  it('devuelve 409 si hay una ingesta en curso', async () => {
    const created = await createManualSource();
    const { _id: sourceId } = created.body;

    // Se fuerza `processing` como si otra ingesta estuviera viva: el `409` tiene que venir
    // del compare-and-swap y no de una condición previa sobre el status leído.
    await sources.compareAndSetStatus(sourceId, SourceStatus.PENDING, SourceStatus.PROCESSING);

    const response = await request(app.getHttpServer()).post(`/api/v1/sources/${sourceId}/ingest`);

    expect(response.status).toBe(HttpStatus.CONFLICT);
    expect(response.body).toMatchObject({ code: 'INGEST_ALREADY_RUNNING' });

    const source = await sources.findById(sourceId);
    expect(source?.status).toBe(SourceStatus.PROCESSING);
  });

  it('sólo una de dos ingestas simultáneas gana el CAS', async () => {
    const created = await createManualSource();
    const { _id: sourceId } = created.body;

    const responses = await Promise.all([
      request(app.getHttpServer()).post(`/api/v1/sources/${sourceId}/ingest`),
      request(app.getHttpServer()).post(`/api/v1/sources/${sourceId}/ingest`),
    ]);

    const accepted = responses.filter((response) => response.status === HttpStatus.ACCEPTED);
    const conflicts = responses.filter((response) => response.status === HttpStatus.CONFLICT);

    expect(accepted).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.body.code).toBe('INGEST_ALREADY_RUNNING');
  });

  it('devuelve 404 al ingerir una fuente inexistente', async () => {
    const response = await request(app.getHttpServer()).post(
      '/api/v1/sources/66f000000000000000000000/ingest',
    );

    expect(response.status).toBe(HttpStatus.NOT_FOUND);
    expect(response.body.code).toBe('SOURCE_NOT_FOUND');
  });

  it('devuelve 400 si el config no corresponde al type', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/sources').send({
      name: 'Incoherente',
      type: SourceType.MANUAL,
      config: { url: 'https://api.test/dolar', method: 'GET' },
    });

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body.code).toBe('SOURCE_CONFIG_INVALID');
  });

  it('devuelve 422 y deja la fuente en error si el payload no se puede interpretar', async () => {
    const created = await request(app.getHttpServer()).post('/api/v1/sources').send({
      name: 'JSON roto',
      type: SourceType.MANUAL,
      config: { format: 'json', payload: '[{"tramo": ]}' },
    });

    const response = await request(app.getHttpServer()).post(
      `/api/v1/sources/${created.body._id}/ingest`,
    );

    expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(response.body.code).toBe('UNPROCESSABLE_CONTENT');
    expect(response.body.message).toContain('invalid JSON');

    // ingestion.md §7: un 422 deja la fuente en `error` con el motivo.
    const source = await sources.findById(created.body._id);
    expect(source?.status).toBe(SourceStatus.ERROR);
    expect(source?.lastError).toContain('invalid JSON');
  });

  it('rechaza con 400 un config que ya no corresponde al type de la fuente', async () => {
    const created = await createManualSource();
    const { _id: sourceId } = created.body;

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/sources/${sourceId}`)
      .send({ config: { url: 'https://api.test/dolar', method: 'GET' } });

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body.code).toBe('SOURCE_CONFIG_INVALID');
  });

  it('rechaza un PATCH que manda type', async () => {
    const created = await createManualSource();
    const { _id: sourceId } = created.body;

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/sources/${sourceId}`)
      .send({ type: SourceType.API });

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('lista las fuentes con paginación y filtros', async () => {
    await createManualSource();
    await request(app.getHttpServer()).post('/api/v1/sources').send({
      name: 'Dolar oficial',
      type: SourceType.API,
      config: { url: 'https://api.test/dolar', method: 'GET', jsonPath: 'data.quotas' },
    });

    const all = await request(app.getHttpServer()).get('/api/v1/sources');
    expect(all.status).toBe(HttpStatus.OK);
    expect(all.body.data).toHaveLength(2);
    expect(all.body.meta).toMatchObject({ total: 2, count: 2, page: 1, limit: 50, pages: 1 });

    const filtered = await request(app.getHttpServer()).get('/api/v1/sources?type=api');
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].name).toBe('Dolar oficial');

    const paged = await request(app.getHttpServer()).get('/api/v1/sources?limit=1&page=2');
    expect(paged.body.data).toHaveLength(1);
    expect(paged.body.meta).toMatchObject({ total: 2, count: 1, page: 2, pages: 2 });
  });

  it('lista los datasets de la fuente en orden descendente de versión', async () => {
    const created = await createManualSource();
    const { _id: sourceId } = created.body;

    await request(app.getHttpServer()).post(`/api/v1/sources/${sourceId}/ingest`);
    await request(app.getHttpServer()).post(`/api/v1/sources/${sourceId}/ingest`);

    const response = await request(app.getHttpServer()).get(`/api/v1/sources/${sourceId}/datasets`);

    expect(response.status).toBe(HttpStatus.OK);
    expect(response.body.data.map((item: { version: number }) => item.version)).toEqual([2, 1]);
    expect(response.body.meta.total).toBe(2);
    // El listado no incluye `rows`: son pesadas (api-contract.md §4).
    expect(response.body.data[0].rows).toBeUndefined();
  });

  it('da de baja una fuente sin borrar sus datasets', async () => {
    const created = await createManualSource();
    const { _id: sourceId } = created.body;
    const ingest = await request(app.getHttpServer()).post(`/api/v1/sources/${sourceId}/ingest`);

    const response = await request(app.getHttpServer()).delete(`/api/v1/sources/${sourceId}`);
    expect(response.status).toBe(HttpStatus.NO_CONTENT);

    const source = await sources.findById(sourceId);
    expect(source?.status).toBe(SourceStatus.ERROR);
    expect(source?.lastError).toContain('dada de baja');

    const dataset = await datasets.findById(ingest.body.datasetId);
    expect(dataset).not.toBeNull();
  });

  it('rechaza una ingesta que excede INGEST_MAX_ROWS sin truncar', async () => {
    const created = await request(app.getHttpServer()).post('/api/v1/sources').send({
      name: 'Gigante',
      type: SourceType.MANUAL,
      config: { format: 'json', payload: JSON.stringify(overSizedRows()) },
    });

    const response = await request(app.getHttpServer()).post(
      `/api/v1/sources/${created.body._id}/ingest`,
    );

    expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(response.body.code).toBe('ROWS_LIMIT_EXCEEDED');

    // No se persiste nada: data-model.md §3.1 regla 2 falla en vez de truncar.
    const source = await sources.findById(created.body._id);
    expect(source?.status).toBe(SourceStatus.ERROR);
    const all = await datasets.findAll({
      sourceId: created.body._id,
      page: { page: 1, limit: 10 },
    });
    expect(all.total).toBe(0);
  });

  it('respepta el límite configurado en INGEST_MAX_ROWS', async () => {
    const rows = [{ codigo: 'A' }];
    const created = await request(app.getHttpServer()).post('/api/v1/sources').send({
      name: 'Chico',
      type: SourceType.MANUAL,
      config: { format: 'json', payload: JSON.stringify(rows) },
    });

    const response = await request(app.getHttpServer()).post(
      `/api/v1/sources/${created.body._id}/ingest`,
    );

    expect(response.status).toBe(HttpStatus.ACCEPTED);
    expect(response.body.rowCount).toBe(1);
  });
});

/** `INGEST_MAX_ROWS + 1` filas: una sola más que el límite ya falla. */
function overSizedRows(): Array<{ codigo: string }> {
  return Array.from({ length: 50_001 }, (_, index) => ({ codigo: `A${index}` }));
}
