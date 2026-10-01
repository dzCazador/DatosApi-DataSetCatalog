import { model, Types } from 'mongoose';

import { FilterOperator } from '@datosapi/common';

import { toEndpointDefinitionDomain } from './endpoint-definition.entity';
import { EndpointDefinitionSchema } from '../schemas/endpoint-definition.schema';

const NOW = new Date('2026-10-01T12:00:00.000Z');

const EndpointDefinitionTestModel = model('EndpointDefinitionDocTest', EndpointDefinitionSchema);

function buildDoc(overrides: Record<string, unknown> = {}) {
  return EndpointDefinitionTestModel.hydrate({
    _id: new Types.ObjectId('66f0a1b2c3d4e5f6a7b8c9d0'),
    name: 'Escala de retención 4ª categoría',
    slug: 'escala-retencion-4ta-categoria',
    sourceId: new Types.ObjectId('66f0a1b2c3d4e5f6a7b8c9e1'),
    followLatest: true,
    fields: ['tramo', 'importe_desde'],
    filters: [{ field: 'tramo', op: FilterOperator.EQ }],
    sort: [{ field: 'importe_desde', dir: 'asc' }],
    defaultLimit: 50,
    maxLimit: 500,
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

describe('toEndpointDefinitionDomain', () => {
  it('convierte los ObjectId a string y deja fuera lo que no está', () => {
    const entity = toEndpointDefinitionDomain(buildDoc());

    expect(entity).toEqual({
      id: '66f0a1b2c3d4e5f6a7b8c9d0',
      name: 'Escala de retención 4ª categoría',
      slug: 'escala-retencion-4ta-categoria',
      sourceId: '66f0a1b2c3d4e5f6a7b8c9e1',
      followLatest: true,
      fields: ['tramo', 'importe_desde'],
      filters: [{ field: 'tramo', op: FilterOperator.EQ }],
      sort: [{ field: 'importe_desde', dir: 'asc' }],
      defaultLimit: 50,
      maxLimit: 500,
      enabled: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(entity.description).toBeUndefined();
    expect(entity.datasetId).toBeUndefined();
    expect(entity.metadata).toBeUndefined();
  });

  it('mapea datasetId y description cuando existen', () => {
    const entity = toEndpointDefinitionDomain(
      buildDoc({
        description: 'pinneado a la versión 1',
        datasetId: new Types.ObjectId('66f0a1b2c3d4e5f6a7b8c9f2'),
      }),
    );

    expect(entity.description).toBe('pinneado a la versión 1');
    expect(entity.datasetId).toBe('66f0a1b2c3d4e5f6a7b8c9f2');
  });
});

describe('EndpointDefinitionSchema', () => {
  it('declara los índices del data-model §4.2, con slug único', () => {
    const indexes = EndpointDefinitionSchema.indexes();

    expect(indexes).toContainEqual([{ slug: 1 }, { unique: true, background: true }]);
    expect(indexes).toContainEqual([{ sourceId: 1 }, { background: true }]);
    expect(indexes).toContainEqual([{ enabled: 1 }, { background: true }]);
    expect(indexes).toContainEqual([{ createdAt: -1 }, { background: true }]);
  });

  it('usa la colección endpoint_definitions, con timestamps y sin versionKey', () => {
    expect(EndpointDefinitionSchema.get('collection')).toBe('endpoint_definitions');
    expect(EndpointDefinitionSchema.get('timestamps')).toBe(true);
    expect(EndpointDefinitionSchema.get('versionKey')).toBe(false);
    expect(EndpointDefinitionSchema.get('strict')).toBe(true);
    expect(EndpointDefinitionSchema.get('toJSON')).toEqual({ virtuals: false });
  });

  it('acepta sólo operadores de la allowlist en filters[]', () => {
    const valid = new EndpointDefinitionTestModel({
      name: 'x',
      slug: 'endpoint-valido',
      sourceId: new Types.ObjectId('66f0a1b2c3d4e5f6a7b8c9e1'),
      filters: [{ field: 'tramo', op: FilterOperator.EQ }],
      defaultLimit: 50,
      maxLimit: 500,
    });
    const invalid = new EndpointDefinitionTestModel({
      name: 'x',
      slug: 'endpoint-invalido',
      sourceId: new Types.ObjectId('66f0a1b2c3d4e5f6a7b8c9e1'),
      filters: [{ field: 'tramo', op: 'regex' }],
      defaultLimit: 50,
      maxLimit: 500,
    });

    expect(valid.validateSync()).toBeUndefined();
    expect(invalid.validateSync()?.errors['filters.0.op']).toBeDefined();
  });
});
