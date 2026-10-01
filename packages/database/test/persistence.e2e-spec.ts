import { getConnectionToken } from '@nestjs/mongoose';
import type { TestingModule } from '@nestjs/testing';
import type { Connection } from 'mongoose';

import { SourceType } from '@datosapi/common';
import { ENDPOINTS_REPOSITORY, SOURCES_REPOSITORY } from '@datosapi/common';
import type { EndpointsRepository, SourcesRepository } from '@datosapi/database';
import type { EndpointDefinitionEntity } from '@datosapi/common';

import { clearTestDatabase, createPersistenceTestingModule } from './persistence-testing-module';

const SOURCE_ID = '66f0a1b2c3d4e5f6a7b8c9e1';

function newEndpoint(
  slug: string,
  overrides: Partial<Parameters<EndpointsRepository['create']>[0]> = {},
) {
  return { name: slug, slug, sourceId: SOURCE_ID, defaultLimit: 50, maxLimit: 500, ...overrides };
}

// Requiere el MongoDB de `pnpm infra:up`: los índices únicos y el CAS de status sólo existen
// contra el servidor; un doble no probaría nada de lo que esta suite verifica.
describe('persistencia de endpoints y sources', () => {
  let moduleRef: TestingModule;
  let connection: Connection;
  let sources: SourcesRepository;
  let endpoints: EndpointsRepository;

  beforeAll(async () => {
    moduleRef = await createPersistenceTestingModule();
    connection = moduleRef.get<Connection>(getConnectionToken());
    sources = moduleRef.get<SourcesRepository>(SOURCES_REPOSITORY);
    endpoints = moduleRef.get<EndpointsRepository>(ENDPOINTS_REPOSITORY);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await clearTestDatabase(moduleRef);
  });

  describe('índice único de slug', () => {
    it('rechaza el segundo endpoint con el mismo slug (E11000)', async () => {
      await endpoints.create(newEndpoint('escala-retencion-4ta-categoria'));

      await expect(
        endpoints.create(newEndpoint('escala-retencion-4ta-categoria')),
      ).rejects.toMatchObject({ code: 11_000 });
    });

    it('permite slugs distintos y conserva ambos', async () => {
      await endpoints.create(newEndpoint('escala-retencion'));
      await endpoints.create(newEndpoint('escala-retencion-4ta-categoria'));

      const { total } = await endpoints.findAll({ page: { page: 1, limit: 50 } });

      expect(total).toBe(2);
    });
  });

  describe('findBySlug', () => {
    it('resuelve por slug y devuelve null si no existe', async () => {
      const created = await endpoints.create(newEndpoint('escala-retencion'));

      await expect(endpoints.findBySlug('escala-retencion')).resolves.toMatchObject({
        id: created.id,
        slug: 'escala-retencion',
        enabled: true,
      });
      await expect(endpoints.findBySlug('no-existe')).resolves.toBeNull();
    });

    it('no filtra por enabled: el contrato no distingue slug inexistente de deshabilitado', async () => {
      await endpoints.create(newEndpoint('escala-retencion', { enabled: false }));

      await expect(endpoints.findBySlug('escala-retencion')).resolves.toMatchObject({
        enabled: false,
      });
    });
  });

  describe('findAll', () => {
    it('ordena por slug y pagina', async () => {
      for (const slug of ['c-endpoint', 'a-endpoint', 'b-endpoint']) {
        await endpoints.create(newEndpoint(slug));
      }

      const page = await endpoints.findAll({ page: { page: 2, limit: 2 } });

      expect(page.total).toBe(3);
      expect(page.items.map((item) => item.slug)).toEqual(['c-endpoint']);
    });

    it('filtra por enabled', async () => {
      await endpoints.create(newEndpoint('a-endpoint'));
      await endpoints.create(newEndpoint('b-endpoint', { enabled: false }));

      const enabled = await endpoints.findAll({ enabled: true, page: { page: 1, limit: 50 } });
      const disabled = await endpoints.findAll({ enabled: false, page: { page: 1, limit: 50 } });

      expect(enabled.items.map((item) => item.slug)).toEqual(['a-endpoint']);
      expect(disabled.items.map((item) => item.slug)).toEqual(['b-endpoint']);
    });

    it('filtra por sourceId', async () => {
      const other = await sources.create({
        name: 'otra',
        type: SourceType.PDF,
        config: { url: 'https://example.test/a.pdf' },
      });

      await endpoints.create(newEndpoint('a-endpoint'));
      await endpoints.create(newEndpoint('b-endpoint', { sourceId: other.id }));

      const mine = await endpoints.findAll({ sourceId: SOURCE_ID, page: { page: 1, limit: 50 } });

      expect(mine.items.map((item) => item.slug)).toEqual(['a-endpoint']);
    });
  });

  describe('disableBySourceId', () => {
    it('deshabilita los endpoints de la source y deja los de otra', async () => {
      const other = await sources.create({
        name: 'otra',
        type: SourceType.PDF,
        config: { url: 'https://example.test/a.pdf' },
      });

      const mine = await endpoints.create(newEndpoint('a-endpoint'));
      await endpoints.create(newEndpoint('b-endpoint'));
      const foreign = await endpoints.create(
        newEndpoint('endpoint-de-otra-source', { sourceId: other.id }),
      );

      await expect(endpoints.disableBySourceId(SOURCE_ID)).resolves.toBe(2);
      await expect(endpoints.findById(mine.id)).resolves.toMatchObject({ enabled: false });
      await expect(endpoints.findById(foreign.id)).resolves.toMatchObject({ enabled: true });
    });

    it('es idempotente: la segunda llamada no modifica nada', async () => {
      await endpoints.create(newEndpoint('a-endpoint'));

      await endpoints.disableBySourceId(SOURCE_ID);

      await expect(endpoints.disableBySourceId(SOURCE_ID)).resolves.toBe(0);
    });
  });

  describe('update', () => {
    it('cambia los campos editables y deja intacto el slug', async () => {
      const created = await endpoints.create(newEndpoint('a-endpoint'));

      const updated = await endpoints.update(created.id, { name: 'renombrado', maxLimit: 100 });

      expect(updated).toMatchObject({ name: 'renombrado', maxLimit: 100, slug: 'a-endpoint' });
    });

    it('rechaza un maxLimit inválido con runValidators', async () => {
      const created = await endpoints.create(newEndpoint('a-endpoint'));

      await expect(endpoints.update(created.id, { maxLimit: 0 })).rejects.toThrow();
    });

    it('devuelve null si el endpoint no existe', async () => {
      await expect(endpoints.update('66f0a1b2c3d4e5f6a7b8c9ff', { name: 'x' })).resolves.toBeNull();
    });
  });

  describe('delete', () => {
    it('borra el documento y devuelve false si ya no existe', async () => {
      const created = await endpoints.create(newEndpoint('a-endpoint'));

      await expect(endpoints.delete(created.id)).resolves.toBe(true);
      await expect(endpoints.delete(created.id)).resolves.toBe(false);
    });
  });

  it('las colecciones se llaman como las del data-model, no como las clases', async () => {
    await sources.create({
      name: 'x',
      type: SourceType.PDF,
      config: { url: 'https://example.test/a.pdf' },
    });
    await endpoints.create(newEndpoint('a-endpoint'));

    const db = connection.db;
    if (!db) throw new Error('conexión sin db');
    const names = (await db.listCollections().toArray()).map((c) => c.name);

    expect(names).toEqual(expect.arrayContaining(['sources', 'endpoint_definitions']));
  });

  it('persistir un endpoint devuelve la entidad con ids como string', async () => {
    const created: EndpointDefinitionEntity = await endpoints.create(newEndpoint('a-endpoint'));

    expect(typeof created.id).toBe('string');
    expect(created.sourceId).toBe(SOURCE_ID);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.filters).toEqual([]);
    expect(created.sort).toEqual([]);
  });
});
