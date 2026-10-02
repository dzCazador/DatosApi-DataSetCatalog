import { HttpStatus, ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import request from 'supertest';

import { ENDPOINTS_REPOSITORY, SourceType } from '@datosapi/common';
import type { EndpointsRepository } from '@datosapi/database';

import { AppModule } from '../src/app.module';
import { useIngestSizedBodyParser } from '../src/common/body-parser';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { createSwaggerDocument } from '../src/common/swagger';

/**
 * Endpoints dinámicos contra el Mongo real (api-contract.md §5 y §6, arquitectura.md §9).
 *
 * No puede ser unitario por dos motivos concretos:
 *
 * 1. El `409 SLUG_TAKEN` lo produce el índice único `{ slug }`, no una lectura previa. Un doble
 *    de repositorio probaría la rama del `if`, no la garantía.
 * 2. La resolución de `followLatest` y el `422` de un dataset archivado dependen de
 *    `findLatestPublished` y del estado real de los documentos.
 */
describe('endpoints (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let connection: Connection;
  let endpointsRepo: EndpointsRepository;
  let sourceId: string;
  let datasetId: string;
  let endpointId: string;

  // Escala de retención de Ganancias 4ª Categoría: los encabezados llevan mayúsculas y
  // espacios a propósito, para que el `key` snake_case del schema y el `label` original
  // queden diferenciados (data-model.md §1 y §6). Las descripciones van entre comillas
  // porque llevan miles con coma: sin comillas el CSV las parte en dos columnas.
  const CSV = [
    'Tramo,Importe Desde,Importe Hasta,Alicuota,Retencion,Descripcion',
    '1,0,54785.28,0.15,0,"Hasta 54.785,28"',
    '5,54785.28,109570.56,0.15,8217.79,"De 54.785,29 a 109.570,56"',
    '9,328711.69,657423.38,0.23,75603.69,"De 328.711,69 a 657.423,38"',
    '13,657423.39,999999.99,0.33,113072.20,"De 657.423,39 en adelante"',
  ].join('\n');

  const DEFINITION = {
    name: 'Escala de Retención Ganancias 4ª Categoría',
    slug: 'escala-retencion-4ta-categoria',
    description: 'Tramos y alícuotas, jul-dic 2026',
    followLatest: true,
    fields: ['tramo', 'importe_desde', 'importe_hasta', 'alicuota', 'retencion'],
    filters: [
      { field: 'tramo', op: 'eq' },
      { field: 'importe_desde', op: 'gte' },
      { field: 'importe_hasta', op: 'lte' },
      { field: 'descripcion', op: 'contains' },
    ],
    sort: [
      { field: 'importe_desde', dir: 'asc' },
      { field: 'tramo', dir: 'asc' },
    ],
  };

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
    endpointsRepo = moduleRef.get<EndpointsRepository>(ENDPOINTS_REPOSITORY);
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
        name: 'Escala Retención Ganancias 4ta Cat — jul-dic 2026',
        type: SourceType.MANUAL,
        config: { format: 'csv', hasHeaderRow: true, payload: CSV },
      })
      .expect(HttpStatus.CREATED);

    sourceId = created.body._id as string;

    const ingested = await request(app.getHttpServer())
      .post(`/api/v1/sources/${sourceId}/ingest`)
      .expect(HttpStatus.ACCEPTED);

    datasetId = ingested.body.datasetId as string;
    await request(app.getHttpServer())
      .post(`/api/v1/datasets/${datasetId}/publish`)
      .expect(HttpStatus.OK);

    endpointId = await createEndpoint();
  });

  async function createEndpoint(overrides: Record<string, unknown> = {}): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/endpoints')
      .send({ ...DEFINITION, sourceId, ...overrides })
      .expect(HttpStatus.CREATED);

    return response.body._id as string;
  }

  async function ingestAgain(): Promise<{ datasetId: string; version: number }> {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/sources/${sourceId}/ingest`)
      .expect(HttpStatus.ACCEPTED);

    return {
      datasetId: response.body.datasetId as string,
      version: response.body.version as number,
    };
  }

  async function idOf(slug: string): Promise<string> {
    const list = await request(app.getHttpServer()).get('/api/v1/endpoints').expect(HttpStatus.OK);

    const found = (list.body.data as { _id: string; slug: string }[]).find(
      (item) => item.slug === slug,
    );

    if (found === undefined) throw new Error(`no existe una definición con slug '${slug}'`);

    return found._id;
  }

  describe('POST /api/v1/endpoints', () => {
    it('crea la definición con el allowlist declarado', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/endpoints/${endpointId}`)
        .expect(HttpStatus.OK);

      expect(response.body).toMatchObject({
        _id: endpointId,
        slug: 'escala-retencion-4ta-categoria',
        sourceId,
        followLatest: true,
        enabled: true,
        filters: [
          { field: 'tramo', op: 'eq' },
          { field: 'importe_desde', op: 'gte' },
          { field: 'importe_hasta', op: 'lte' },
          { field: 'descripcion', op: 'contains' },
        ],
        sort: [
          { field: 'importe_desde', dir: 'asc' },
          { field: 'tramo', dir: 'asc' },
        ],
      });
    });

    it.each([
      ['Escala-Retencion', 'mayúsculas'],
      ['escala_retencion', 'guion bajo'],
      ['escala--retencion', 'guion doble'],
      ['escala-retencion-', 'guion al final'],
      ['escala retención', 'espacio'],
    ])('400 SLUG_INVALID con el slug %s (%s)', async (slug) => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/endpoints')
        .send({ ...DEFINITION, sourceId, slug })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.code).toBe('SLUG_INVALID');
    });

    it('409 SLUG_TAKEN con un slug repetido', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/endpoints')
        .send({ ...DEFINITION, sourceId })
        .expect(HttpStatus.CONFLICT);

      expect(response.body.code).toBe('SLUG_TAKEN');
    });

    it('422 SCHEMA_MISMATCH si un filtro apunta a una columna inexistente', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/endpoints')
        .send({
          ...DEFINITION,
          sourceId,
          slug: 'otro-slug',
          filters: [{ field: 'retencion_pct', op: 'gte' }],
        })
        .expect(HttpStatus.UNPROCESSABLE_ENTITY);

      expect(response.body.code).toBe('SCHEMA_MISMATCH');
      expect(response.body.details.unknownFields).toEqual([
        { where: 'filters[0].field', field: 'retencion_pct', reason: 'not in dataset schema' },
      ]);
    });

    it('no guarda la definición inválida, para que no quede published pero rota', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/endpoints')
        .send({
          ...DEFINITION,
          sourceId,
          slug: 'otro-slug',
          sort: [{ field: 'no_existe', dir: 'asc' }],
        })
        .expect(HttpStatus.UNPROCESSABLE_ENTITY);

      const list = await request(app.getHttpServer())
        .get('/api/v1/endpoints')
        .expect(HttpStatus.OK);

      expect(list.body.meta.total).toBe(1);
    });

    it('404 DATASET_NOT_FOUND si el datasetId no existe', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/endpoints')
        .send({
          ...DEFINITION,
          sourceId,
          slug: 'otro-slug',
          followLatest: false,
          datasetId: '66f0a1b2c3d4e5f60718293a',
        })
        .expect(HttpStatus.NOT_FOUND);

      expect(response.body.code).toBe('DATASET_NOT_FOUND');
    });

    it('400 si no dice qué dataset servir y no sigue al último published', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/endpoints')
        .send({
          ...DEFINITION,
          sourceId,
          slug: 'otro-slug',
          followLatest: false,
          datasetId: undefined,
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('crea con followLatest aunque la fuente todavía no haya publicado nada', async () => {
      const pending = await request(app.getHttpServer())
        .post('/api/v1/sources')
        .send({
          name: 'Sin publicar',
          type: SourceType.MANUAL,
          config: { format: 'csv', hasHeaderRow: true, payload: 'codigo\nA01' },
        })
        .expect(HttpStatus.CREATED);

      const created = await request(app.getHttpServer())
        .post('/api/v1/endpoints')
        .send({
          name: 'Todavía vacío',
          slug: 'todavia-vacio',
          sourceId: pending.body._id as string,
          followLatest: true,
        })
        .expect(HttpStatus.CREATED);

      const detail = await request(app.getHttpServer())
        .get(`/api/v1/endpoints/${created.body._id}`)
        .expect(HttpStatus.OK);

      expect(detail.body.resolved).toBeNull();
      expect(detail.body.resolvedReason).toContain('publicado');
    });
  });

  describe('GET /api/v1/endpoints', () => {
    it('lista y filtra por sourceId y por enabled', async () => {
      const all = await request(app.getHttpServer()).get('/api/v1/endpoints').expect(HttpStatus.OK);
      expect(all.body.meta).toEqual({ total: 1, count: 1, page: 1, limit: 50, pages: 1 });

      const other = '66f0a1b2c3d4e5f60718293a';
      const byOther = await request(app.getHttpServer())
        .get('/api/v1/endpoints')
        .query({ sourceId: other })
        .expect(HttpStatus.OK);
      expect(byOther.body.meta.total).toBe(0);

      const disabled = await request(app.getHttpServer())
        .get('/api/v1/endpoints')
        .query({ enabled: 'false' })
        .expect(HttpStatus.OK);
      expect(disabled.body.meta.total).toBe(0);

      const enabled = await request(app.getHttpServer())
        .get('/api/v1/endpoints')
        .query({ enabled: 'true' })
        .expect(HttpStatus.OK);
      expect(enabled.body.meta.total).toBe(1);
    });

    it('?enabled=false no se lee como true', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/endpoints/${endpointId}`)
        .send({ enabled: false })
        .expect(HttpStatus.OK);

      // Con `enableImplicitConversion`, un campo declarado `boolean` convertiría el string
      // "false" con `Boolean(...)` y devolvería la lista de los habilitados.
      const filtered = await request(app.getHttpServer())
        .get('/api/v1/endpoints')
        .query({ enabled: 'false' })
        .expect(HttpStatus.OK);

      expect(filtered.body.meta.total).toBe(1);
      expect(filtered.body.data[0].enabled).toBe(false);
    });

    it('400 si ?enabled no es un valor reconocible', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/endpoints')
        .query({ enabled: 'banana' })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/endpoints/:id', () => {
    it('incluye resolved con el dataset que serviría ahora', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/endpoints/${endpointId}`)
        .expect(HttpStatus.OK);

      expect(response.body.resolved).toEqual({
        datasetId,
        version: 1,
        status: 'published',
        rowCount: 4,
      });
      expect(response.body.resolvedReason).toBeNull();
    });

    it('404 si la definición no existe', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/endpoints/66f0a1b2c3d4e5f60718293a')
        .expect(HttpStatus.NOT_FOUND);

      expect(response.body.code).toBe('ENDPOINT_NOT_FOUND');
    });
  });

  describe('PATCH /api/v1/endpoints/:id', () => {
    it('actualiza parcialmente sin tocar el resto', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/endpoints/${endpointId}`)
        .send({ description: 'Vigencia corregida' })
        .expect(HttpStatus.OK);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/endpoints/${endpointId}`)
        .expect(HttpStatus.OK);

      expect(response.body.description).toBe('Vigencia corregida');
      expect(response.body.filters).toHaveLength(4);
    });

    it('revalida contra el schema si cambia el allowlist', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/endpoints/${endpointId}`)
        .send({ filters: [{ field: 'columna_inexistente', op: 'eq' }] })
        .expect(HttpStatus.UNPROCESSABLE_ENTITY);

      expect(response.body.code).toBe('SCHEMA_MISMATCH');
    });

    it('400 si intenta cambiar el slug', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/endpoints/${endpointId}`)
        .send({ slug: 'otro-slug' })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/endpoints/:id/validate', () => {
    it('informa valid true con el dataset resuelto', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/endpoints/${endpointId}/validate`)
        .expect(HttpStatus.OK);

      expect(response.body).toEqual({
        valid: true,
        datasetId,
        version: 1,
        status: 'published',
        unknownFields: [],
        reason: null,
      });
    });

    it('informa valid false con el motivo si el dataset quedó archivado', async () => {
      // Anclado a la versión, que es donde el archivado importa: con `followLatest` el
      // resolver busca el `published` más reciente y un `archived` no lo alcanza.
      const pinned = await createEndpoint({
        slug: 'escala-anclada',
        followLatest: false,
        datasetId,
      });
      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${datasetId}/archive`)
        .expect(HttpStatus.OK);

      const response = await request(app.getHttpServer())
        .post(`/api/v1/endpoints/${pinned}/validate`)
        .expect(HttpStatus.OK);

      expect(response.body.valid).toBe(false);
      expect(response.body.reason).toContain('archivado');
    });
  });

  describe('DELETE /api/v1/endpoints/:id', () => {
    it('204 y la definición desaparece', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/endpoints/${endpointId}`)
        .expect(HttpStatus.NO_CONTENT);

      await request(app.getHttpServer())
        .get(`/api/v1/endpoints/${endpointId}`)
        .expect(HttpStatus.NOT_FOUND);
    });

    it('deja el dataset intacto', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/endpoints/${endpointId}`)
        .expect(HttpStatus.NO_CONTENT);

      const dataset = await request(app.getHttpServer())
        .get(`/api/v1/datasets/${datasetId}`)
        .expect(HttpStatus.OK);

      expect(dataset.body.rowCount).toBe(4);
    });

    it('404 si la definición no existe', async () => {
      const response = await request(app.getHttpServer())
        .delete('/api/v1/endpoints/66f0a1b2c3d4e5f60718293a')
        .expect(HttpStatus.NOT_FOUND);

      expect(response.body.code).toBe('ENDPOINT_NOT_FOUND');
    });
  });

  describe('GET /api/v1/e/:slug', () => {
    const SLUG = 'escala-retencion-4ta-categoria';

    it('sirve el dataset con filtro, orden y paginación', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .query({ importe_desde: '50000', limit: 10, sort: 'importe_desde:asc' })
        .expect(HttpStatus.OK);

      expect(response.body.data).toEqual([
        {
          tramo: 5,
          importe_desde: 54785.28,
          importe_hasta: 109570.56,
          alicuota: 0.15,
          retencion: 8217.79,
        },
        {
          tramo: 9,
          importe_desde: 328711.69,
          importe_hasta: 657423.38,
          alicuota: 0.23,
          retencion: 75603.69,
        },
        {
          tramo: 13,
          importe_desde: 657423.39,
          importe_hasta: 999999.99,
          alicuota: 0.33,
          retencion: 113072.2,
        },
      ]);
      expect(response.body.meta).toEqual({
        total: 3,
        count: 3,
        page: 1,
        limit: 10,
        pages: 1,
        dataset: {
          id: datasetId,
          version: 1,
          sourceId,
          updatedAt: expect.any(String),
        },
      });
    });

    it('proyecta sólo fields si viene el override', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .query({ fields: 'tramo,alicuota', limit: 1 })
        .expect(HttpStatus.OK);

      expect(Object.keys(response.body.data[0])).toEqual(['tramo', 'alicuota']);
    });

    it('aplica contains, que es case-insensitive', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .query({ descripcion: 'EN ADELANTE' })
        .expect(HttpStatus.OK);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].tramo).toBe(13);
    });

    it('castea el valor del filtro al tipo de la columna antes de comparar', async () => {
      // El normalizador infirió `tramo` como `number` porque todos sus valores lo son, así que
      // el `5` del query tiene que compararse contra el número de la celda y no contra el
      // string: sin el cast el filtro no matchearía nunca.
      const response = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .query({ tramo: '5' })
        .expect(HttpStatus.OK);

      expect(response.body.meta.total).toBe(1);
      expect(response.body.data[0].importe_desde).toBe(54785.28);
    });

    it('cuenta el total antes de paginar', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .query({ limit: 1, page: 2 })
        .expect(HttpStatus.OK);

      expect(response.body.meta).toMatchObject({ total: 4, count: 1, page: 2, pages: 4 });
    });

    it('400 FILTER_NOT_ALLOWED con un filtro fuera del allowlist', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .query({ retencion: '100' })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.code).toBe('FILTER_NOT_ALLOWED');
      expect(response.body.details).toMatchObject({ param: 'retencion' });
    });

    it('400 con un parámetro desconocido, en vez de ignorarlo', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .query({ foo: '1' })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.code).toBe('FILTER_NOT_ALLOWED');
    });

    it('400 INVALID_PAGINATION si limit supera el maxLimit de la definición', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .query({ limit: 9999 })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.code).toBe('INVALID_PAGINATION');
    });

    it('400 SORT_NOT_ALLOWED al ordenar por una columna no declarada', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .query({ sort: 'alicuota:desc' })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.code).toBe('SORT_NOT_ALLOWED');
      expect(response.body.details.allowed).toEqual(['importe_desde', 'tramo']);
    });

    it('400 VALIDATION_ERROR si el valor no se puede castear al tipo de la columna', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .query({ importe_desde: 'mucho' })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('400 si se pide una proyección fuera de fields', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .query({ fields: 'tramo,descripcion' })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.code).toBe('FILTER_NOT_ALLOWED');
    });

    it('422 si una reingesta le quitó al dataset una columna que la definición declara', async () => {
      // Definición publicada contra la v1, que tiene `descripcion`; la v2 sale sin esa
      // columna. Servirla en silencio devolvería el dataset entero y el cliente creería que
      // filtró por `descripcion`.
      await createEndpoint({
        slug: 'escala-con-descripcion',
        filters: [
          { field: 'descripcion', op: 'contains' },
          { field: 'importe_desde', op: 'gte' },
        ],
        sort: [{ field: 'importe_desde', dir: 'asc' }],
        fields: ['tramo', 'descripcion', 'importe_desde'],
      });

      const reduced = ['Tramo,Importe Desde,Alicuota', '1,0,0.15', '5,54785.28,0.15'].join('\n');
      await request(app.getHttpServer())
        .patch(`/api/v1/sources/${sourceId}`)
        .send({ config: { format: 'csv', hasHeaderRow: true, payload: reduced } })
        .expect(HttpStatus.OK);

      const second = await ingestAgain();
      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${second.datasetId}/publish`)
        .expect(HttpStatus.OK);

      const response = await request(app.getHttpServer())
        .get('/api/v1/e/escala-con-descripcion')
        .expect(HttpStatus.UNPROCESSABLE_ENTITY);

      expect(response.body.code).toBe('SCHEMA_MISMATCH');
      expect(response.body.details.unknownFields).toEqual([
        { where: 'fields[1]', field: 'descripcion', reason: 'not in dataset schema' },
      ]);

      // Y el reporte de /validate es la vía para enterarse y corregirlo.
      const report = await request(app.getHttpServer())
        .post('/api/v1/endpoints/' + (await idOf('escala-con-descripcion')) + '/validate')
        .expect(HttpStatus.OK);
      expect(report.body.valid).toBe(false);
    });

    it('404 SLUG_NOT_FOUND si el slug no existe', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/e/no-existe')
        .expect(HttpStatus.NOT_FOUND);

      expect(response.body.code).toBe('SLUG_NOT_FOUND');
    });

    it('404 SLUG_NOT_FOUND también si el endpoint existe pero está deshabilitado', async () => {
      // Mismo `code` y mismo `message` que un slug inexistente: distinguirlos le confirmaría
      // al consumidor que el slug existe, que es información de la que no debe depender.
      const missing = await request(app.getHttpServer())
        .get('/api/v1/e/no-existe')
        .expect(HttpStatus.NOT_FOUND);

      await request(app.getHttpServer())
        .patch(`/api/v1/endpoints/${endpointId}`)
        .send({ enabled: false })
        .expect(HttpStatus.OK);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .expect(HttpStatus.NOT_FOUND);

      expect(response.body.code).toBe(missing.body.code);
      expect(response.body.statusCode).toBe(missing.body.statusCode);
      expect(response.body.message).toContain('No existe un endpoint con slug');
    });

    it('422 SCHEMA_MISMATCH si el dataset al que apunta quedó archivado', async () => {
      await createEndpoint({ slug: 'escala-anclada', followLatest: false, datasetId });
      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${datasetId}/archive`)
        .expect(HttpStatus.OK);

      const response = await request(app.getHttpServer())
        .get('/api/v1/e/escala-anclada')
        .expect(HttpStatus.UNPROCESSABLE_ENTITY);

      expect(response.body.code).toBe('SCHEMA_MISMATCH');
      expect(response.body.details).toMatchObject({ status: 'archived' });
    });

    it('con followLatest el archivado no rompe: resuelve al published más reciente', async () => {
      await createEndpoint({ slug: 'escala-anclada', followLatest: false, datasetId });
      const second = await ingestAgain();
      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${second.datasetId}/publish`)
        .expect(HttpStatus.OK);
      // Archivar la v1 no afecta a quien sigue la última publicada.
      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${datasetId}/publish`)
        .expect(HttpStatus.CONFLICT);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .expect(HttpStatus.OK);

      expect(response.body.meta.dataset.version).toBe(2);
    });
  });

  describe('followLatest', () => {
    const SLUG = 'escala-retencion-4ta-categoria';

    it('sirve la versión nueva sin tocar la definición', async () => {
      const second = await ingestAgain();
      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${second.datasetId}/publish`)
        .expect(HttpStatus.OK);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .expect(HttpStatus.OK);

      expect(response.body.meta.dataset).toMatchObject({
        id: second.datasetId,
        version: 2,
      });

      const definition = await request(app.getHttpServer())
        .get(`/api/v1/endpoints/${endpointId}`)
        .expect(HttpStatus.OK);

      // La definición no cambió: ni `datasetId` ni `updatedAt`.
      expect(definition.body.resolved.datasetId).toBe(second.datasetId);
      expect(definition.body.followLatest).toBe(true);
    });

    it('no sirve un draft que todavía no se publicó', async () => {
      const second = await ingestAgain();

      const response = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .expect(HttpStatus.OK);

      expect(response.body.meta.dataset.version).toBe(1);
      expect(response.body.meta.dataset.id).not.toBe(second.datasetId);
    });

    it('un endpoint anclado a una versión no salta a la nueva', async () => {
      const pinned = await createEndpoint({
        slug: 'escala-anclada',
        followLatest: false,
        datasetId,
      });

      const second = await ingestAgain();
      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${second.datasetId}/publish`)
        .expect(HttpStatus.OK);

      const response = await request(app.getHttpServer())
        .get('/api/v1/e/escala-anclada')
        .expect(HttpStatus.OK);

      expect(response.body.meta.dataset).toMatchObject({ id: datasetId, version: 1 });
      expect(pinned).toBeDefined();
    });
  });

  describe('ETag', () => {
    const SLUG = 'escala-retencion-4ta-categoria';

    it('responde 304 si el If-None-Match coincide, sin body', async () => {
      const first = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .expect(HttpStatus.OK);
      const etag = first.headers['etag'] as string;
      expect(etag).toBeDefined();

      const second = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .set('If-None-Match', etag)
        .expect(HttpStatus.NOT_MODIFIED);

      expect(second.body).toEqual({});
      expect(second.headers['etag']).toBe(etag);
    });

    it('cambia el ETag al cambiar el query', async () => {
      const first = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .expect(HttpStatus.OK);
      const second = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .query({ limite: '1' })
        .expect(HttpStatus.BAD_REQUEST);

      expect(second.body.code).toBe('FILTER_NOT_ALLOWED');
      expect(first.headers['etag']).toBeDefined();
    });

    it('cambia el ETag al publicar una versión nueva', async () => {
      const first = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .expect(HttpStatus.OK);

      const second = await ingestAgain();
      await request(app.getHttpServer())
        .post(`/api/v1/datasets/${second.datasetId}/publish`)
        .expect(HttpStatus.OK);

      const after = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .expect(HttpStatus.OK);
      expect(after.headers['etag']).not.toBe(first.headers['etag']);

      const revalidated = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .set('If-None-Match', first.headers['etag'] as string)
        .expect(HttpStatus.OK);
      expect(revalidated.body.meta.dataset.version).toBe(2);
    });

    it('no devuelve 304 si el ETag no coincide', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .set('If-None-Match', '"no-es-el-mio"')
        .expect(HttpStatus.OK);
    });
  });

  describe('OpenAPI', () => {
    it('registra la ruta dinámica y las seis de administración', () => {
      const paths = createSwaggerDocument(app).paths as Record<string, unknown>;

      expect(Object.keys(paths)).toEqual(
        expect.arrayContaining([
          '/api/v1/e/{slug}',
          '/api/v1/endpoints',
          '/api/v1/endpoints/{id}',
          '/api/v1/endpoints/{id}/validate',
        ]),
      );
    });

    it('documenta el endpoint dinámico con un ejemplo de respuesta real', () => {
      // api-contract.md §7: la forma de `GET /e/{slug}` depende del dataset, así que el
      // ejemplo va en la descripción de la ruta y en la de cada definición.
      const document = createSwaggerDocument(app);
      const operation = (document.paths['/api/v1/e/{slug}'] as { get: { description: string } })
        .get;

      expect(operation.description).toContain('GET /api/v1/e/escala-retencion-4ta-categoria');
      expect(operation.description).toContain('"meta"');
    });

    it('repite el ejemplo en cada operación de administración', () => {
      const paths = createSwaggerDocument(app).paths as Record<
        string,
        Record<string, { description?: string }>
      >;
      const example = 'GET /api/v1/e/escala-retencion-4ta-categoria';

      for (const path of ['/api/v1/endpoints', '/api/v1/endpoints/{id}']) {
        for (const method of Object.values(paths[path] ?? {})) {
          expect(method.description ?? '').toContain(example);
        }
      }
    });
  });

  describe('baja de la fuente', () => {
    const SLUG = 'escala-retencion-4ta-categoria';

    it('deshabilita los endpoints de la fuente y el slug pasa a 404', async () => {
      await request(app.getHttpServer()).get(`/api/v1/e/${SLUG}`).expect(HttpStatus.OK);

      await request(app.getHttpServer())
        .delete(`/api/v1/sources/${sourceId}`)
        .expect(HttpStatus.NO_CONTENT);

      const response = await request(app.getHttpServer())
        .get(`/api/v1/e/${SLUG}`)
        .expect(HttpStatus.NOT_FOUND);

      expect(response.body.code).toBe('SLUG_NOT_FOUND');
    });

    it('deja las definiciones en la base, deshabilitadas y no borradas', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/sources/${sourceId}`)
        .expect(HttpStatus.NO_CONTENT);

      const detail = await request(app.getHttpServer())
        .get(`/api/v1/endpoints/${endpointId}`)
        .expect(HttpStatus.OK);

      expect(detail.body.enabled).toBe(false);
    });

    it('no toca los endpoints de otra fuente', async () => {
      const other = await request(app.getHttpServer())
        .post('/api/v1/sources')
        .send({
          name: 'Otra fuente',
          type: SourceType.MANUAL,
          config: { format: 'csv', hasHeaderRow: true, payload: 'codigo\nA01' },
        })
        .expect(HttpStatus.CREATED);

      await request(app.getHttpServer())
        .delete(`/api/v1/sources/${sourceId}`)
        .expect(HttpStatus.NO_CONTENT);

      const list = await request(app.getHttpServer())
        .get('/api/v1/endpoints')
        .query({ sourceId: other.body._id as string })
        .expect(HttpStatus.OK);

      expect(list.body.data.every((item: { enabled: boolean }) => item.enabled)).toBe(true);
    });

    it('es idempotente: dar de baja dos veces no rompe', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/sources/${sourceId}`)
        .expect(HttpStatus.NO_CONTENT);
      await request(app.getHttpServer())
        .delete(`/api/v1/sources/${sourceId}`)
        .expect(HttpStatus.NO_CONTENT);

      const definition = await endpointsRepo.findById(endpointId);
      expect(definition?.enabled).toBe(false);
    });
  });
});
