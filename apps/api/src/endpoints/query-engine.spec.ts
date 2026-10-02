import { FilterOperator } from '@datosapi/common';
import type { ColumnSchema, EndpointDefinitionEntity, Row } from '@datosapi/common';

import {
  FilterNotAllowedError,
  InvalidPaginationError,
  SchemaMismatchError,
  SortNotAllowedError,
  ValueCastError,
} from './endpoints.errors';
import { InMemoryQueryEngine, canonicalizeQuery, parseQuery } from './query-engine';
import type { ParsedFilter } from './query-engine';

const SCHEMA: ColumnSchema[] = [
  { key: 'tramo', label: 'Tramo', type: 'string', nullable: false },
  { key: 'importe_desde', label: 'Importe desde', type: 'number', nullable: true, decimalScale: 2 },
  {
    key: 'importe_hasta',
    label: 'Importe hasta',
    type: 'number',
    nullable: false,
    decimalScale: 2,
  },
  { key: 'alicuota', label: 'Alícuota', type: 'number', nullable: false, decimalScale: 4 },
  { key: 'descripcion', label: 'Descripción', type: 'string', nullable: true },
  { key: 'activo', label: 'Activo', type: 'boolean', nullable: false },
  { key: 'vigencia', label: 'Vigencia', type: 'date', nullable: false },
];

function makeDefinition(
  overrides: Partial<EndpointDefinitionEntity> = {},
): EndpointDefinitionEntity {
  return {
    id: '66f2a1b2c3d4e5f60718293a',
    name: 'Escala de retención',
    slug: 'escala-retencion-4ta-categoria',
    sourceId: '66f0a1b2c3d4e5f607182930',
    followLatest: true,
    filters: [
      { field: 'tramo', op: FilterOperator.EQ },
      { field: 'importe_desde', op: FilterOperator.GTE },
      { field: 'importe_hasta', op: FilterOperator.LTE },
      { field: 'descripcion', op: FilterOperator.CONTAINS },
    ],
    sort: [
      { field: 'importe_desde', dir: 'asc' },
      { field: 'tramo', dir: 'asc' },
    ],
    defaultLimit: 50,
    maxLimit: 500,
    enabled: true,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

const ROWS: Row[] = [
  {
    tramo: '1',
    importe_desde: 0,
    importe_hasta: 54785.28,
    alicuota: 0.15,
    descripcion: 'Hasta 54.785,28',
    activo: true,
    vigencia: new Date('2026-07-01T00:00:00.000Z'),
  },
  {
    tramo: '5',
    importe_desde: 54785.28,
    importe_hasta: 109570.56,
    alicuota: 0.15,
    descripcion: 'De 54.785,29 a 109.570,56',
    activo: true,
    vigencia: new Date('2026-07-01T00:00:00.000Z'),
  },
  {
    tramo: '9',
    importe_desde: 328711.69,
    importe_hasta: 657423.38,
    alicuota: 0.23,
    descripcion: 'De 328.711,69 a 657.423,38',
    activo: false,
    vigencia: new Date('2027-01-01T00:00:00.000Z'),
  },
  // `importe_desde` y `descripcion` en `null`: la columna es `nullable`, y sirve para probar
  // que los `null` no se cuelan en las comparaciones.
  {
    tramo: 'sin-dato',
    importe_desde: null,
    importe_hasta: 0,
    alicuota: 0,
    descripcion: null,
    activo: true,
    vigencia: new Date('2026-07-01T00:00:00.000Z'),
  },
];

const engine = new InMemoryQueryEngine();

function run(query: Record<string, unknown>, overrides: Partial<EndpointDefinitionEntity> = {}) {
  const definition = makeDefinition(overrides);

  return engine.execute(ROWS, SCHEMA, parseQuery(query, definition, SCHEMA));
}

function tramos(result: { data: Row[] }): unknown[] {
  return result.data.map((row) => row['tramo']);
}

/** `noUncheckedIndexedAccess` está activo: el primer filtro se lee con un chequeo explícito. */
function onlyFilterValue(parsed: { filters: ParsedFilter[] }): ParsedFilter['value'] {
  const filter = parsed.filters[0];

  if (filter === undefined) throw new Error('se esperaba exactamente un filtro');

  return filter.value;
}

function keysOf(row: Row | undefined): string[] {
  return row === undefined ? [] : Object.keys(row);
}

describe('canonicalizeQuery', () => {
  it('ordena las claves para que el mismo query produzca siempre el mismo hash', () => {
    expect(canonicalizeQuery({ b: '2', a: '1' })).toBe(canonicalizeQuery({ a: '1', b: '2' }));
    expect(canonicalizeQuery({ a: '1', b: '2' })).toBe('a=1&b=2');
  });

  it('normaliza un parámetro repetido sin perder el orden de aparición', () => {
    expect(canonicalizeQuery({ sort: ['a:asc', 'b:desc'] })).toBe('sort=a:asc|b:desc');
  });
});

describe('parseQuery: paginación', () => {
  it('usa page 1 y defaultLimit cuando no viene nada', () => {
    const parsed = parseQuery({}, makeDefinition(), SCHEMA);

    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(50);
  });

  it('rechaza limit mayor que maxLimit con 400 INVALID_PAGINATION, sin clampar', () => {
    expect(() => parseQuery({ limit: '9999' }, makeDefinition({ maxLimit: 500 }), SCHEMA)).toThrow(
      InvalidPaginationError,
    );
  });

  it('acepta limit igual a maxLimit', () => {
    const parsed = parseQuery({ limit: '500' }, makeDefinition({ maxLimit: 500 }), SCHEMA);

    expect(parsed.limit).toBe(500);
  });

  it('rechaza limit 0, negativo o no entero', () => {
    for (const limit of ['0', '-1', '1.5', 'abc', '']) {
      expect(() => parseQuery({ limit }, makeDefinition(), SCHEMA)).toThrow(InvalidPaginationError);
    }
  });

  it('rechaza page 0 o negativa', () => {
    for (const page of ['0', '-3']) {
      expect(() => parseQuery({ page }, makeDefinition(), SCHEMA)).toThrow(InvalidPaginationError);
    }
  });
});

describe('parseQuery: allowlist', () => {
  it('rechaza un parámetro que no está en filters[], sort[] ni en los de control', () => {
    const error = catchError(() => parseQuery({ retencion: '100' }, makeDefinition(), SCHEMA));

    expect(error).toBeInstanceOf(FilterNotAllowedError);
    expect((error as FilterNotAllowedError).getResponse()).toMatchObject({
      code: 'FILTER_NOT_ALLOWED',
      details: { param: 'retencion' },
    });
  });

  it('rechaza cualquier clave desconocida, aunque se parezca a un filtro', () => {
    expect(() => parseQuery({ foo: '1' }, makeDefinition(), SCHEMA)).toThrow(FilterNotAllowedError);
  });

  it('no ignora en silencio: sin el filtro, total sería el de todo el dataset', () => {
    // Si el parámetro desconocido se descartara, el filtro `importe_desde` no arrives nunca y
    // el total sería 4 en vez de 2: el cliente no se enteraría de que no filtró nada.
    expect(run({ importe_desde: '50000' }).meta.total).toBe(2);
  });

  it('exige el parámetro de un filtro required', () => {
    const definition = makeDefinition({
      filters: [{ field: 'tramo', op: FilterOperator.EQ, required: true }],
    });

    const error = catchError(() => parseQuery({}, definition, SCHEMA));

    expect(error).toBeInstanceOf(FilterNotAllowedError);
    expect((error as FilterNotAllowedError).getResponse()).toMatchObject({
      details: { param: 'tramo', field: 'tramo' },
    });
  });

  it('ignora en cambio un filtro opcional ausente', () => {
    const parsed = parseQuery({}, makeDefinition(), SCHEMA);

    expect(parsed.filters).toEqual([]);
  });

  it('422 si un filtro declarado referencia una columna que la reingesta eliminó', () => {
    const schema = SCHEMA.filter((column) => column.key !== 'tramo');
    const definition = makeDefinition({
      sort: [],
      filters: [{ field: 'tramo', op: FilterOperator.EQ }],
    });

    // Ignorarla devolvería 200 con el dataset entero y el cliente creería que filtró por
    // `tramo`: el 422 dice que hay que corregir la definición.
    const error = catchError(() => parseQuery({ tramo: '5' }, definition, schema));

    expect(error).toBeInstanceOf(SchemaMismatchError);
    expect((error as SchemaMismatchError).getResponse()).toMatchObject({
      code: 'SCHEMA_MISMATCH',
      details: {
        unknownFields: [
          { where: 'filters[0].field', field: 'tramo', reason: 'not in dataset schema' },
        ],
      },
    });
  });
});

describe('parseQuery: orden', () => {
  it('422 si sort[] referencia una columna que ya no está en el schema', () => {
    const schema = SCHEMA.filter((column) => column.key !== 'importe_desde');
    const definition = makeDefinition({ sort: [{ field: 'importe_desde', dir: 'asc' }] });

    // No es SORT_NOT_ALLOWED: la columna sí está en el allowlist, lo que falta es la columna.
    expect(catchError(() => parseQuery({}, definition, schema))).toBeInstanceOf(
      SchemaMismatchError,
    );
  });

  it('422 si fields[] referencia una columna que ya no está en el schema', () => {
    const schema = SCHEMA.filter((column) => column.key !== 'alicuota');
    const definition = makeDefinition({ fields: ['tramo', 'alicuota'] });

    expect(catchError(() => parseQuery({}, definition, schema))).toBeInstanceOf(
      SchemaMismatchError,
    );
  });

  it('rechaza ordenar por una columna fuera de sort[] con 400 SORT_NOT_ALLOWED', () => {
    const error = catchError(() =>
      parseQuery({ sort: 'retencion:desc' }, makeDefinition(), SCHEMA),
    );

    expect(error).toBeInstanceOf(SortNotAllowedError);
    expect((error as SortNotAllowedError).getResponse()).toMatchObject({
      code: 'SORT_NOT_ALLOWED',
      details: { field: 'retencion', allowed: ['importe_desde', 'tramo'] },
    });
  });

  it('rechaza una dirección que no sea asc ni desc', () => {
    expect(() => parseQuery({ sort: 'importe_desde:sideways' }, makeDefinition(), SCHEMA)).toThrow(
      SortNotAllowedError,
    );
  });

  it('acepta varios criterios, con el orden en que llegan mandando', () => {
    const parsed = parseQuery(
      { sort: ['tramo:desc', 'importe_desde:asc'] },
      makeDefinition(),
      SCHEMA,
    );

    expect(parsed.sort).toEqual([
      { field: 'tramo', dir: 'desc' },
      { field: 'importe_desde', dir: 'asc' },
    ]);
  });

  it('asume asc si el criterio viene sin dirección, que es lo cómodo de escribir', () => {
    expect(parseQuery({ sort: 'importe_desde' }, makeDefinition(), SCHEMA).sort).toEqual([
      { field: 'importe_desde', dir: 'asc' },
    ]);
  });
});

describe('parseQuery: cast de valores', () => {
  it('castea un número de columna numérica antes de comparar', () => {
    // El bug que hace fallar esto es comparar `'50000'` (string) contra `54785.28` (number):
    // el filtro parecería no filtrar nunca.
    const parsed = parseQuery({ importe_desde: '50000' }, makeDefinition(), SCHEMA);

    expect(onlyFilterValue(parsed)).toBe(50000);
  });

  it('devuelve 400 VALIDATION_ERROR si el número no se puede castear', () => {
    const error = catchError(() =>
      parseQuery({ importe_desde: 'mucho' }, makeDefinition(), SCHEMA),
    );

    expect(error).toBeInstanceOf(ValueCastError);
    expect((error as ValueCastError).getResponse()).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { field: 'importe_desde' },
    });
  });

  it('castea booleanos desde true/false/1/0', () => {
    const definition = makeDefinition({
      filters: [{ field: 'activo', op: FilterOperator.EQ }],
    });

    expect(onlyFilterValue(parseQuery({ activo: 'false' }, definition, SCHEMA))).toBe(false);
    expect(onlyFilterValue(parseQuery({ activo: '1' }, definition, SCHEMA))).toBe(true);
    expect(() => parseQuery({ activo: 'quizá' }, definition, SCHEMA)).toThrow(ValueCastError);
  });

  it('castea fechas ISO a Date', () => {
    const definition = makeDefinition({
      filters: [{ field: 'vigencia', op: FilterOperator.GTE }],
    });

    expect(onlyFilterValue(parseQuery({ vigencia: '2026-07-01' }, definition, SCHEMA))).toEqual(
      new Date('2026-07-01T00:00:00.000Z'),
    );
  });

  it('rechaza una fecha que no es ISO completa, que Date.parse aceptaría', () => {
    const definition = makeDefinition({
      filters: [{ field: 'vigencia', op: FilterOperator.GTE }],
    });

    // `Date.parse('2026')` no es NaN: sin la validación de formato, `2026` compararía como
    // enero de 2026 y el filtro devolvería filas que el cliente no pidió.
    expect(() => parseQuery({ vigencia: '2026' }, definition, SCHEMA)).toThrow(ValueCastError);
  });

  it('parte in en una lista de valores del tipo de la columna', () => {
    const definition = makeDefinition({
      filters: [{ field: 'tramo', op: FilterOperator.IN }],
    });

    expect(onlyFilterValue(parseQuery({ tramo: '1,5,9' }, definition, SCHEMA))).toEqual([
      '1',
      '5',
      '9',
    ]);
  });

  it('rechaza between con un solo extremo en vez de inventar un infinito', () => {
    const definition = makeDefinition({
      filters: [{ field: 'importe_desde', op: FilterOperator.BETWEEN }],
    });

    expect(() => parseQuery({ importe_desde: '100' }, definition, SCHEMA)).toThrow(ValueCastError);
  });
});

describe('parseQuery: proyección', () => {
  it('usa definition.fields como proyección por defecto, no todas las columnas', () => {
    // Declarar `fields` es la forma de exponer menos columnas de las que tiene el dataset:
    // si el query no lo sobreescribe, la respuesta sale recortada.
    const definition = makeDefinition({ fields: ['tramo', 'alicuota'] });

    expect(parseQuery({}, definition, SCHEMA).fields).toEqual(['tramo', 'alicuota']);
    expect(
      Object.keys(engine.execute(ROWS, SCHEMA, parseQuery({}, definition, SCHEMA)).data[0] ?? {}),
    ).toEqual(['tramo', 'alicuota']);
  });

  it('permite pedir un subconjunto de definition.fields', () => {
    const definition = makeDefinition({ fields: ['tramo', 'importe_desde', 'alicuota'] });
    const parsed = parseQuery({ fields: 'tramo,alicuota' }, definition, SCHEMA);

    expect(parsed.fields).toEqual(['tramo', 'alicuota']);
  });

  it('rechaza pedir una columna fuera de definition.fields', () => {
    const definition = makeDefinition({ fields: ['tramo', 'importe_desde'] });
    const error = catchError(() => parseQuery({ fields: 'tramo,descripcion' }, definition, SCHEMA));

    expect(error).toBeInstanceOf(FilterNotAllowedError);
  });

  it('permite cualquier columna del schema si la definición no declara fields', () => {
    expect(parseQuery({ fields: 'tramo,activo' }, makeDefinition(), SCHEMA).fields).toEqual([
      'tramo',
      'activo',
    ]);
  });
});

describe('InMemoryQueryEngine: operadores', () => {
  const one = (
    query: Record<string, unknown>,
    op: FilterOperator,
    field: string,
    extra: Partial<EndpointDefinitionEntity> = {},
  ) => run(query, { filters: [{ field, op }], ...extra });

  it('eq compara estricto, sin castear el string de la celda', () => {
    expect(tramos(one({ tramo: '5' }, FilterOperator.EQ, 'tramo'))).toEqual(['5']);
    expect(tramos(one({ tramo: '05' }, FilterOperator.EQ, 'tramo'))).toEqual([]);
  });

  it('ne incluye las celdas null, porque "no es 5" también es cierto sin dato', () => {
    const result = one({ tramo: '5' }, FilterOperator.NE, 'tramo');

    expect(tramos(result)).toEqual(['1', '9', 'sin-dato']);
  });

  it('gt y gte usan la comparación estricta del límite', () => {
    expect(tramos(one({ importe_desde: '54785.28' }, FilterOperator.GT, 'importe_desde'))).toEqual([
      '9',
    ]);
    expect(tramos(one({ importe_desde: '54785.28' }, FilterOperator.GTE, 'importe_desde'))).toEqual(
      ['5', '9'],
    );
  });

  it('lt y lte son inclusivos en el borde igual que gt y gte en el suyo', () => {
    // `importe_hasta` vale 0, 54785.28, 109570.56 y 657423.38: el mismo valor de corte
    // devuelve una fila más con `lte` que con `lt`, y esa fila es la del borde exacto.
    expect(
      tramos(one({ importe_hasta: '109570.56' }, FilterOperator.LTE, 'importe_hasta')),
    ).toEqual(['1', '5', 'sin-dato']);
    expect(tramos(one({ importe_hasta: '109570.56' }, FilterOperator.LT, 'importe_hasta'))).toEqual(
      ['1', 'sin-dato'],
    );
  });

  it('gt excluye las filas sin dato en vez de devolverlas', () => {
    const result = one({ importe_desde: '0' }, FilterOperator.GT, 'importe_desde');

    expect(tramos(result)).not.toContain('sin-dato');
  });

  it('in matchea cualquiera de los valores de la lista', () => {
    expect(tramos(one({ tramo: '1,9' }, FilterOperator.IN, 'tramo'))).toEqual(['1', '9']);
  });

  it('between es inclusivo en los dos extremos', () => {
    const result = one({ importe_desde: '0,109570.56' }, FilterOperator.BETWEEN, 'importe_desde');

    expect(tramos(result)).toEqual(['1', '5']);
  });

  it('between con los extremos invertidos no matchea nada, en vez de normalizar el rango', () => {
    const result = one({ importe_desde: '100,10' }, FilterOperator.BETWEEN, 'importe_desde');

    expect(result.meta.total).toBe(0);
  });

  it('contains es case-insensitive y no matchea null', () => {
    expect(
      tramos(one({ descripcion: 'AFIP' }, FilterOperator.CONTAINS, 'descripcion')),
    ).toHaveLength(0);

    const definition = makeDefinition();
    const result = run({ descripcion: 'de 328' }, definition);

    expect(tramos(result)).toEqual(['9']);
  });

  it('starts_with matchea el prefijo, no cualquier substring', () => {
    const result = one({ descripcion: 'hasta' }, FilterOperator.STARTS_WITH, 'descripcion');

    expect(tramos(result)).toEqual(['1']);
  });

  it('aplica varios filtros en conjunto', () => {
    const definition = makeDefinition({
      filters: [
        { field: 'importe_desde', op: FilterOperator.GTE },
        { field: 'alicuota', op: FilterOperator.EQ },
      ],
    });

    const result = run({ importe_desde: '1000', alicuota: '0.23' }, definition);

    expect(tramos(result)).toEqual(['9']);
  });
});

describe('InMemoryQueryEngine: orden, paginación y proyección', () => {
  it('ordena ascendente y deja los null al final', () => {
    const result = run({ sort: 'importe_desde:asc' });

    expect(tramos(result)).toEqual(['1', '5', '9', 'sin-dato']);
  });

  it('ordena descendente sin mandar los null al principio', () => {
    const result = run({ sort: 'importe_desde:desc' });

    expect(tramos(result)).toEqual(['9', '5', '1', 'sin-dato']);
  });

  it('ordena por varios criterios en cascada', () => {
    const result = run(
      { sort: ['alicuota:desc', 'importe_desde:asc'] },
      {
        sort: [
          { field: 'alicuota', dir: 'desc' },
          { field: 'importe_desde', dir: 'asc' },
        ],
      },
    );

    expect(tramos(result)).toEqual(['9', '1', '5', 'sin-dato']);
  });

  it('es estable: sin criterio de orden devuelve las filas en su orden original', () => {
    expect(tramos(run({}))).toEqual(['1', '5', '9', 'sin-dato']);
  });

  it('total cuenta las filas filtradas antes de paginar', () => {
    const result = run({ importe_desde: '50000', limit: '1' });

    expect(result.meta).toMatchObject({ total: 2, count: 1, page: 1, limit: 1, pages: 2 });
    expect(result.data).toHaveLength(1);
  });

  it('devuelve páginas 0 y no NaN cuando nada matchea', () => {
    const result = run({ tramo: 'no-existe' });

    expect(result.meta).toMatchObject({ total: 0, count: 0, pages: 0 });
  });

  it('una página más allá del total devuelve vacío sin total negativo', () => {
    const result = run({ page: '5', limit: '10' });

    expect(result.meta).toMatchObject({ total: 4, count: 0, pages: 1 });
  });

  it('proyecta todas las columnas del schema si no hay override', () => {
    expect(keysOf(run({}).data[0])).toEqual(SCHEMA.map((column) => column.key));
  });

  it('proyecta sólo las columnas pedidas, en el orden pedido', () => {
    const result = run(
      { fields: 'alicuota,tramo' },
      { fields: ['tramo', 'importe_desde', 'alicuota'] },
    );

    expect(keysOf(result.data[0])).toEqual(['alicuota', 'tramo']);
  });

  it('deja en null la columna del schema que la fila no trae, en vez de omitir la clave', () => {
    const rows: Row[] = [{ tramo: '1' }];
    const schema: ColumnSchema[] = [
      { key: 'tramo', label: 'Tramo', type: 'string', nullable: false },
      { key: 'importe_desde', label: 'Desde', type: 'number', nullable: true },
    ];

    const definition = makeDefinition({ filters: [], sort: [] });

    expect(engine.execute(rows, schema, parseQuery({}, definition, schema)).data[0]).toEqual({
      tramo: '1',
      importe_desde: null,
    });
  });

  it('no muta las filas del dataset', () => {
    const rows: Row[] = [{ tramo: '1', importe_desde: 10 }];
    const before = structuredClone(rows);

    engine.execute(
      rows,
      SCHEMA,
      parseQuery({ sort: 'importe_desde:asc' }, makeDefinition(), SCHEMA),
    );

    expect(rows).toEqual(before);
  });
});

function catchError(run: () => unknown): unknown {
  try {
    run();

    return undefined;
  } catch (error) {
    return error;
  }
}
