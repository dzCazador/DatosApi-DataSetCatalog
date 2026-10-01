import { model, Types } from 'mongoose';

import { DatasetStatus, SourceStatus, SourceType } from '@datosapi/common';

import { toSourceDomain } from '../entities/source.entity';
import { EndpointDefinitionSchema } from '../schemas/endpoint-definition.schema';
import { DatasetSchema } from '../schemas/dataset.schema';
import { SourceSchema } from '../schemas/source.schema';

const SourceModel = model('SourceDocTest', SourceSchema);

describe('SourceSchema', () => {
  it('declara los índices del data-model §2.2', () => {
    expect(SourceSchema.indexes()).toEqual(
      expect.arrayContaining([
        [{ name: 1 }, { background: true }],
        [{ type: 1, status: 1 }, { background: true }],
        [{ createdAt: -1 }, { background: true }],
      ]),
    );
  });

  it('nace en status pending', () => {
    const document = new SourceModel({ name: 'x', type: SourceType.PDF, config: { url: 'u' } });

    expect(document.status).toBe(SourceStatus.PENDING);
  });

  it('acepta sólo los tipos de fuente conocidos', () => {
    const valid = new SourceModel({
      name: 'x',
      type: SourceType.PDF,
      config: { url: 'u' },
    });
    const invalid = new SourceModel({ name: 'x', type: 'ftp', config: { url: 'u' } });

    expect(valid.validateSync()).toBeUndefined();
    expect(invalid.validateSync()?.errors['type']).toBeDefined();
  });

  it('acepta cualquier status de la enum', () => {
    for (const status of Object.values(SourceStatus)) {
      const document = new SourceModel({ name: 'x', type: SourceType.MANUAL, config: {}, status });

      expect(document.validateSync()).toBeUndefined();
    }
  });

  it('guarda config como objeto libre: su forma depende del type', () => {
    // `Mixed`: el esquema no puede describir una union discriminada por `type`, y la
    // validación de la forma correcta ocurre en la ingesta (data-model §2.1).
    expect(SourceSchema.path('config').instance).toBe('Mixed');
  });

  it('no expone virtuals al serializar y no versiona', () => {
    expect(SourceSchema.get('toJSON')).toEqual({ virtuals: false });
    expect(SourceSchema.get('toObject')).toEqual({ virtuals: false });
    expect(SourceSchema.get('strict')).toBe(true);
    expect(SourceSchema.get('versionKey')).toBe(false);
    expect(SourceSchema.get('timestamps')).toBe(true);
  });

  it('el mapper proyecta la config según el type declarado', () => {
    const entity = toSourceDomain(
      SourceModel.hydrate({
        _id: new Types.ObjectId('66f0a1b2c3d4e5f6a7b8c9d0'),
        name: 'Escala AFIP',
        type: SourceType.PDF,
        config: { url: 'https://example.test/a.pdf', headerHints: ['Tramo'] },
        status: SourceStatus.PENDING,
        createdAt: new Date('2026-10-01T12:00:00.000Z'),
        updatedAt: new Date('2026-10-01T12:00:00.000Z'),
      }),
    );

    expect(entity.id).toBe('66f0a1b2c3d4e5f6a7b8c9d0');
    expect(entity.type).toBe(SourceType.PDF);
    expect(entity.config).toEqual({
      url: 'https://example.test/a.pdf',
      headerHints: ['Tramo'],
    });
    expect(entity.description).toBeUndefined();
    expect(entity.lastDatasetId).toBeUndefined();
  });
});

describe('DatasetSchema', () => {
  it('declara version única por source y los índices del data-model §3.2', () => {
    expect(DatasetSchema.indexes()).toEqual(
      expect.arrayContaining([
        [
          { sourceId: 1, version: -1 },
          { unique: true, background: true },
        ],
        [{ status: 1, sourceId: 1, version: -1 }, { background: true }],
        [{ createdAt: -1 }, { background: true }],
        [{ rowCount: -1 }, { background: true }],
      ]),
    );
  });

  it('nace en status draft y sin warnings', () => {
    const DatasetModel = model('DatasetDocTest', DatasetSchema);
    const document = new DatasetModel({
      sourceId: new Types.ObjectId('66f0a1b2c3d4e5f6a7b8c9e1'),
      version: 1,
      name: 'x',
      schema: [],
      rows: [],
      rowCount: 0,
      columnsCount: 0,
      meta: { method: 'csv-parse', rawRowCount: 0 },
    });

    expect(document.status).toBe(DatasetStatus.DRAFT);
    expect(document.warnings).toEqual([]);
    expect(document.rows).toEqual([]);
  });

  it('usa Mixed en schema/rows/warnings: un path llamado schema rompe el cast de arrays vacíos', () => {
    // Mongoose sombrea `Document.prototype.schema` y `SchemaArray.cast` termina leyendo
    // `doc.schema.indexedPaths()`. Con `[Object]` un dataset sin filas no se puede insertar.
    for (const path of ['schema', 'rows', 'warnings']) {
      expect(DatasetSchema.path(path)?.instance).toBe('Mixed');
    }
  });

  it('exige version >= 1 y rowCount >= 0', () => {
    const DatasetModel = model('DatasetDocTestV', DatasetSchema);
    const document = new DatasetModel({
      sourceId: new Types.ObjectId('66f0a1b2c3d4e5f6a7b8c9e1'),
      version: 0,
      name: 'x',
      schema: [],
      rows: [],
      rowCount: -1,
      columnsCount: 0,
      meta: { method: 'csv-parse', rawRowCount: 0 },
    });

    const errors = document.validateSync()?.errors ?? {};
    expect(errors['version']).toBeDefined();
    expect(errors['rowCount']).toBeDefined();
  });
});

describe('EndpointDefinitionSchema', () => {
  it('el nombre de la colección no lo decide el nombre de la clase', () => {
    expect(EndpointDefinitionSchema.get('collection')).toBe('endpoint_definitions');
  });
});
