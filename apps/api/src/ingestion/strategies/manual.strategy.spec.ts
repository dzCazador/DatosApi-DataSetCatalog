import type { IngestContext } from '../ingestion.types';
import { ManualIngestStrategy } from './manual.strategy';

function ctx(): IngestContext {
  return {
    now: new Date(),
    storageDir: './storage',
    sourceId: '68b1c2f0a1b2c3d4e5f60718',
    limits: { timeoutMs: 30_000, maxBytes: 10_485_760, maxRows: 50_000 },
  };
}

describe('ManualIngestStrategy — csv', () => {
  const strategy = new ManualIngestStrategy();

  it('parsea el ejemplo de ingestion.md §9.3', async () => {
    const result = await strategy.ingest(
      {
        format: 'csv',
        hasHeaderRow: true,
        payload: 'codigo,descripcion,activo\nA01,Producto A,true\nB02,Producto B,false',
      },
      ctx(),
    );

    expect(result.meta.method).toBe('csv-parse');
    expect(result.schema.map((column) => [column.key, column.type])).toEqual([
      ['codigo', 'string'],
      ['descripcion', 'string'],
      ['activo', 'boolean'],
    ]);
    expect(result.rows).toEqual([
      { codigo: 'A01', descripcion: 'Producto A', activo: true },
      { codigo: 'B02', descripcion: 'Producto B', activo: false },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('respeta el BOM', async () => {
    const result = await strategy.ingest(
      { format: 'csv', hasHeaderRow: true, payload: '\uFEFFcodigo,monto\nA01,10,50' },
      ctx(),
    );

    expect(result.schema[0]!.key).toBe('codigo');
  });

  it('acepta CSVs con filas de distinto largo y avisa', async () => {
    const result = await strategy.ingest(
      { format: 'csv', hasHeaderRow: true, payload: 'a,b,c\n1,2,3\n4,5\n6,7,8' },
      ctx(),
    );

    expect(result.rows).toEqual([
      { a: 1, b: 2, c: 3 },
      { a: 4, b: 5, c: null },
      { a: 6, b: 7, c: 8 },
    ]);
    expect(result.warnings).toEqual(['row 2 had 2 cells, expected 3']);
  });

  it('genera col_N cuando no hay fila de encabezado', async () => {
    const result = await strategy.ingest(
      { format: 'csv', hasHeaderRow: false, payload: '1,2,3\n4,5,6' },
      ctx(),
    );

    expect(result.schema.map((column) => column.key)).toEqual(['col_1', 'col_2', 'col_3']);
    expect(result.rows).toEqual([
      { col_1: 1, col_2: 2, col_3: 3 },
      { col_1: 4, col_2: 5, col_3: 6 },
    ]);
  });

  it('usa el delimitador explícito', async () => {
    const result = await strategy.ingest(
      { format: 'csv', hasHeaderRow: true, delimiter: ';', payload: 'a;b\n1;2' },
      ctx(),
    );

    expect(result.rows).toEqual([{ a: 1, b: 2 }]);
  });

  it('normaliza números es-AR y porcentajes', async () => {
    const result = await strategy.ingest(
      { format: 'csv', hasHeaderRow: true, payload: 'monto,alicuota,vigencia\n"1.234,56","35%","2026-07-01"' },
      ctx(),
    );

    expect(result.rows[0]).toEqual({
      monto: 1234.56,
      alicuota: 0.35,
      vigencia: new Date('2026-07-01T00:00:00.000Z'),
    });
    expect(result.schema[0]!.decimalScale).toBe(2);
  });
});

describe('ManualIngestStrategy — json', () => {
  const strategy = new ManualIngestStrategy();

  it('acepta un array plano', async () => {
    const result = await strategy.ingest(
      { format: 'json', payload: '[{"tramo":"A","monto":10}]' },
      ctx(),
    );

    expect(result.meta.method).toBe('manual-json');
    expect(result.rows).toEqual([{ tramo: 'A', monto: 10 }]);
  });

  it('acepta un objeto que envuelve un array', async () => {
    const result = await strategy.ingest(
      { format: 'json', payload: '{"resultados":[{"tramo":"A"},{"tramo":"B"}]}' },
      ctx(),
    );

    expect(result.rows).toEqual([{ tramo: 'A' }, { tramo: 'B' }]);
  });

  it('aplana objetos anidados (ingestion.md §6.4)', async () => {
    const result = await strategy.ingest(
      {
        format: 'json',
        payload: '[{"tramo":{"desde":0,"hasta":8334},"alicuota":0.35}]',
      },
      ctx(),
    );

    expect(result.rows).toEqual([{ tramo_desde: 0, tramo_hasta: 8334, alicuota: 0.35 }]);
    expect(result.schema.map((column) => column.key)).toEqual([
      'tramo_desde',
      'tramo_hasta',
      'alicuota',
    ]);
  });

  it('conserva un array como celda json y lo declara en el schema', async () => {
    const result = await strategy.ingest(
      { format: 'json', payload: '[{"tags":["a","b"],"total":2}]' },
      ctx(),
    );

    expect(result.rows[0]!.tags).toBe('["a","b"]');
    expect(result.schema[0]!.type).toBe('json');
    expect(result.schema[1]!.type).toBe('number');
  });

  it('trata un objeto único como una fila', async () => {
    const result = await strategy.ingest({ format: 'json', payload: '{"tramo":"A"}' }, ctx());

    expect(result.rows).toEqual([{ tramo: 'A' }]);
  });

  it('rechaza JSON inválido con 422', async () => {
    await expect(strategy.ingest({ format: 'json', payload: '{roto}' }, ctx())).rejects.toMatchObject(
      { status: 422, message: expect.stringContaining('invalid JSON') },
    );
  });

  it('rechaza un array vacío', async () => {
    await expect(strategy.ingest({ format: 'json', payload: '[]' }, ctx())).rejects.toMatchObject(
      { status: 422 },
    );
  });
});

describe('ManualIngestStrategy — validateConfig', () => {
  const strategy = new ManualIngestStrategy();

  it('acepta json y csv', () => {
    expect(() => strategy.validateConfig({ format: 'csv', payload: 'a,b' })).not.toThrow();
    expect(() => strategy.validateConfig({ format: 'json', payload: '[]' })).not.toThrow();
  });

  it('rechaza un config de otro tipo con 400', () => {
    expect(() =>
      strategy.validateConfig({ url: 'https://x.test', method: 'GET' }),
    ).toThrow('El config no corresponde a un source de tipo');
  });

  it('rechaza payload vacío', () => {
    expect(() => strategy.validateConfig({ format: 'csv', payload: '   ' })).toThrow(
      'El payload CSV está vacío',
    );
  });
});