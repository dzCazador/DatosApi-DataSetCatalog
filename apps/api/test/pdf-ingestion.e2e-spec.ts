import { HttpStatus } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Connection } from 'mongoose';
import request from 'supertest';
import type { Response } from 'supertest';

import {
  DATASETS_REPOSITORY,
  SOURCES_REPOSITORY,
  SourceStatus,
  SourceType,
} from '@datosapi/common';
import type { DatasetsRepository, SourcesRepository } from '@datosapi/database';

import { AppModule } from '../src/app.module';
import { useIngestSizedBodyParser } from '../src/common/body-parser';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { buildSimpleTablePdf } from '../src/ingestion/pdf/__fixtures__/make-fixture';

/**
 * Flujo e2e de la ingesta `pdf` contra el Mongo real (ingestion.md §4.4 y §7).
 *
 * El PDF se sirve desde un servidor HTTP real en localhost porque la strategy descarga por
 * `fetch`: no alcanza con un doble de `fetch` si además se quiere verificar el `413` por
 * tamaño, que depende de cómo el origen declara el `content-length`.
 *
 * El PDF real de AFIP **no** se usa acá: los tests no pueden depender de la red. La verificación
 * contra el documento real es el smoke test de la fase 05, no un test.
 */
describe('ingesta pdf (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let connection: Connection;
  let sources: SourcesRepository;
  let datasets: DatasetsRepository;
  let storageDir: string;
  let origin: string;
  let closeOrigin: () => Promise<void>;

  const PDF_PATH = '/tabla.pdf';

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'datosapi-e2e-pdf-'));
    process.env.STORAGE_DIR = storageDir;

    const pdf = buildSimpleTablePdf();

    // `http.createServer` en vez de un doble de `fetch`: es lo que permite que `Downloader`
    //znegue `content-length` y que el corte por tamaño se pruebe de verdad.
    const server = await startOrigin({
      '/tabla.pdf': { status: 200, type: 'application/pdf', body: pdf },
      '/tabla.txt': { status: 200, type: 'text/plain', body: 'codigo,monto\nA01,10' },
      '/roto.pdf': { status: 200, type: 'application/pdf', body: Buffer.from('no soy un pdf') },
      // Ruta sin extensión que responde algo que no es texto ni PDF ni JSON: es el caso del
      // `415` de ingestion.md §4.3.
      '/descarga': { status: 200, type: 'application/x-msdownload', body: Buffer.from('binario') },
    });

    origin = server.origin;
    closeOrigin = server.close;

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
    await closeOrigin();
    await connection.dropDatabase();
    await app.close();
    delete process.env.STORAGE_DIR;
  });

  beforeEach(async () => {
    await connection.dropDatabase();
    await Promise.all(Object.values(connection.models).map((model) => model.syncIndexes()));
  });

  async function createPdfSource(
    config: Record<string, unknown> = { url: `${origin}${PDF_PATH}` },
  ): Promise<Response> {
    return request(app.getHttpServer()).post('/api/v1/sources').send({
      name: 'Escala Retención Ganancias 4ta Cat — prueba',
      type: SourceType.PDF,
      config,
    });
  }

  it('registra una fuente pdf en pending y la ingesta deja version 1', async () => {
    const created = await createPdfSource();

    expect(created.status).toBe(HttpStatus.CREATED);
    expect(created.body).toMatchObject({
      type: SourceType.PDF,
      status: SourceStatus.PENDING,
    });

    const response = await request(app.getHttpServer()).post(
      `/api/v1/sources/${created.body._id}/ingest`,
    );

    expect(response.status).toBe(HttpStatus.ACCEPTED);
    expect(response.body).toMatchObject({
      sourceId: created.body._id,
      version: 1,
      rowCount: 6,
      columnsCount: 3,
    });
    expect(response.body.warnings).toEqual([]);
    expect(response.body.meta).toMatchObject({
      method: 'pdfjs-text-coords',
      sourceUrl: `${origin}${PDF_PATH}`,
      contentType: 'application/pdf',
      pageCount: 1,
      tableCount: 1,
    });

    const source = await sources.findById(created.body._id);
    expect(source?.status).toBe(SourceStatus.READY);

    const listed = await request(app.getHttpServer()).get(
      `/api/v1/sources/${created.body._id}/datasets`,
    );
    expect(listed.body.meta.total).toBe(1);
    expect(listed.body.data[0]).toMatchObject({ version: 1, rowCount: 6 });

    const dataset = await datasets.findById(response.body.datasetId);
    expect(dataset?.schema.map((column) => [column.key, column.type])).toEqual([
      ['codigo', 'string'],
      ['importe', 'number'],
      ['alicuota', 'number'],
    ]);
    expect(dataset?.rows[0]).toEqual({ codigo: 'A01', importe: 1234.56, alicuota: 0.35 });
  });

  it('persiste el PDF descargado bajo STORAGE_DIR/<sourceId>', async () => {
    const created = await createPdfSource();
    const sourceId = created.body._id as string;

    await request(app.getHttpServer()).post(`/api/v1/sources/${sourceId}/ingest`);

    const files = await readdir(join(storageDir, sourceId));

    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.pdf$/);
  });

  it('una URL inexistente es 502 y deja la fuente en error', async () => {
    const created = await createPdfSource({ url: `${origin}/no-existe.pdf` });

    const response = await request(app.getHttpServer()).post(
      `/api/v1/sources/${created.body._id}/ingest`,
    );

    expect(response.status).toBe(HttpStatus.BAD_GATEWAY);
    expect(response.body.code).toBe('UPSTREAM_ERROR');

    const source = await sources.findById(created.body._id);
    expect(source?.status).toBe(SourceStatus.ERROR);
  });

  it('un PDF que no tiene tabla es 422 y no deja dataset', async () => {
    const created = await createPdfSource({ url: `${origin}/roto.pdf` });

    const response = await request(app.getHttpServer()).post(
      `/api/v1/sources/${created.body._id}/ingest`,
    );

    expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(response.body.code).toBe('UNPROCESSABLE_CONTENT');

    const listed = await datasets.findAll({
      sourceId: created.body._id,
      page: { page: 1, limit: 10 },
    });
    expect(listed.total).toBe(0);
  });

  it('devuelve 400 si el config no corresponde al type pdf', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/sources')
      .send({
        name: 'Incoherente',
        type: SourceType.PDF,
        config: { format: 'csv', payload: 'a,b' },
      });

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(response.body.code).toBe('SOURCE_CONFIG_INVALID');
  });

  describe('source type url', () => {
    it('despacha por content-type y guarda el dataset con method url-csv', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/sources')
        .send({
          name: 'Listado remoto — prueba',
          type: SourceType.URL,
          config: { url: `${origin}/tabla.txt` },
        });

      expect(created.status).toBe(HttpStatus.CREATED);

      const response = await request(app.getHttpServer()).post(
        `/api/v1/sources/${created.body._id}/ingest`,
      );

      expect(response.status).toBe(HttpStatus.ACCEPTED);
      expect(response.body).toMatchObject({ rowCount: 1, version: 1 });
      expect(response.body.meta).toMatchObject({ method: 'url-csv', contentType: 'text/plain' });

      const dataset = await datasets.findById(response.body.datasetId);
      expect(dataset?.rows).toEqual([{ codigo: 'A01', monto: 10 }]);
    });

    it('un content-type no soportado es 415', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/sources')
        .send({
          name: 'Página web — prueba',
          type: SourceType.URL,
          config: { url: `${origin}/tabla.pdf`, contentTypeHint: 'text/html' },
        });

      // La extensión `.pdf` gana sobre el hint, así que se sirve una ruta sin extensión para
      // que el único tipo conocido sea el hint.
      const forced = await request(app.getHttpServer())
        .post('/api/v1/sources')
        .send({
          name: 'Página web — prueba 2',
          type: SourceType.URL,
          config: { url: `${origin}/descarga`, contentTypeHint: 'text/html' },
        });

      expect(forced.status).toBe(HttpStatus.CREATED);
      expect(created.status).toBe(HttpStatus.CREATED);

      const response = await request(app.getHttpServer()).post(
        `/api/v1/sources/${forced.body._id}/ingest`,
      );

      expect(response.status).toBe(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
      expect(response.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });
  });
});

interface OriginRoute {
  status: number;
  type: string;
  body: Buffer | string;
}

/** Servidor HTTP mínimo para servir los fixtures y poder probar el corte por tamaño. */
async function startOrigin(
  routes: Record<string, OriginRoute>,
): Promise<{ origin: string; close: () => Promise<void> }> {
  const { createServer } = await import('node:http');

  const server = createServer((request, response) => {
    const route = routes[request.url ?? ''];

    if (route === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
      return;
    }

    const body = Buffer.isBuffer(route.body) ? route.body : Buffer.from(route.body, 'utf8');

    response.writeHead(route.status, {
      'content-type': route.type,
      'content-length': String(body.byteLength),
    });
    response.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('El servidor de test no quedó escuchando en un puerto');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}
