import { describe, expect, it } from 'vitest';

import { buildCurl, buildDynamicQuery, controlFor, normalizeFilterValue, operatorHint } from './dynamic-query';
import type { ColumnSchema, FilterDef, SortDef } from './types';

const SCHEMA: ColumnSchema[] = [
  { key: 'tramo', label: 'Tramo', type: 'string', nullable: false },
  { key: 'importe_desde', label: 'Importe desde', type: 'number', nullable: false, decimalScale: 2 },
  { key: 'vigencia_desde', label: 'Vigencia desde', type: 'date', nullable: true },
  { key: 'activo', label: 'Activo', type: 'boolean', nullable: false },
];

const FILTERS: FilterDef[] = [
  { field: 'tramo', op: 'eq' },
  { field: 'importe_desde', op: 'gte' },
  { field: 'vigencia_desde', op: 'gt' },
];

const SORT: SortDef[] = [{ field: 'importe_desde', dir: 'asc' }];

function build(values: Record<string, string>, extra: Partial<Parameters<typeof buildDynamicQuery>[0]> = {}) {
  return buildDynamicQuery({ filters: FILTERS, sort: SORT, values, schema: SCHEMA, ...extra });
}

describe('buildDynamicQuery por operador', () => {
  it('eq manda el escalar tal cual', () => {
    expect(build({ tramo: 'A' }).params.get('tramo')).toBe('A');
  });

  it('gt/gte sobre una columna number manda el número, sin comillas ni formato local', () => {
    const { params, problems } = build({ importe_desde: '50000' });
    expect(params.get('importe_desde')).toBe('50000');
    expect(params.get('importe_desde')).not.toContain(',');
    expect(problems).toEqual([]);
  });

  it('gt/gte sobre una columna date exige AAAA-MM-DD', () => {
    expect(build({ vigencia_desde: '2026-07-01' }).params.get('vigencia_desde')).toBe('2026-07-01');
    expect(build({ vigencia_desde: '01/07/2026' }).problems).toEqual(['vigencia_desde: La fecha va como AAAA-MM-DD.']);
  });

  it('in manda CSV sin espacios sobrantes', () => {
    const query = (raw: string) =>
      buildDynamicQuery({ filters: [{ field: 'tramo', op: 'in' }], sort: [], values: { tramo: raw }, schema: SCHEMA });

    expect(query(' A , B ,C ').params.get('tramo')).toBe('A,B,C');
    expect(query('A,,B').params.get('tramo')).toBe('A,B');
    expect(query(' , ').problems).toEqual(['tramo: Indicá al menos un valor (CSV).']);
  });

  it('between manda a,b y no normaliza el rango invertido', () => {
    const range = (raw: string) =>
      buildDynamicQuery({ filters: [{ field: 'importe_desde', op: 'between' }], sort: [], values: { importe_desde: raw }, schema: SCHEMA });

    expect(range('100,500').params.get('importe_desde')).toBe('100,500');
    // `a > b` no matchea nada y la API no lo corrige: el panel tampoco.
    expect(range('500,100').params.get('importe_desde')).toBe('500,100');
  });

  it('between con dates valida los dos extremos', () => {
    const { params, problems } = buildDynamicQuery({
      filters: [{ field: 'vigencia_desde', op: 'between' }],
      sort: [],
      values: { vigencia_desde: '2026-07-01,2026-12-31' },
      schema: SCHEMA,
    });
    expect(params.get('vigencia_desde')).toBe('2026-07-01,2026-12-31');
    expect(problems).toEqual([]);

    const invalid = buildDynamicQuery({
      filters: [{ field: 'vigencia_desde', op: 'between' }],
      sort: [],
      values: { vigencia_desde: '2026-07-01' },
      schema: SCHEMA,
    });
    expect(invalid.problems).toHaveLength(1);
  });

  it('between con un solo extremo es un problema, no un rango', () => {
    const { problems } = buildDynamicQuery({
      filters: [{ field: 'importe_desde', op: 'between' }],
      sort: [],
      values: { importe_desde: '100' },
      schema: SCHEMA,
    });
    expect(problems).toEqual(['importe_desde: El rango se escribe a,b con los dos extremos.']);
  });

  it('contains y starts_with van como texto, sin castear', () => {
    const { params, problems } = buildDynamicQuery({
      filters: [
        { field: 'tramo', op: 'contains' },
        { field: 'tramo', op: 'starts_with' },
        { field: 'vigencia_desde', op: 'contains' },
      ],
      sort: [],
      values: {},
      schema: SCHEMA,
    });
    expect(params.getAll('tramo')).toEqual([]);
    expect(problems).toEqual([]);

    const filled = buildDynamicQuery({
      filters: [{ field: 'tramo', op: 'contains' }],
      sort: [],
      values: { tramo: 'Pro' },
      schema: SCHEMA,
    });
    expect(filled.params.get('tramo')).toBe('Pro');
  });
});

describe('normalizeFilterValue', () => {
  it('rechaza un numero no numerico en gte', () => {
    expect(normalizeFilterValue('gte', SCHEMA[1], 'cincuenta')).toEqual({ problem: 'Tiene que ser un número.' });
  });

  it('acepta decimales', () => {
    expect(normalizeFilterValue('gte', SCHEMA[1], '54785.28')).toEqual({ value: '54785.28' });
  });

  it('un boolean exige true o false en eq', () => {
    const column = SCHEMA[3];
    expect(column).toBeDefined();
    if (column === undefined) return;
    expect(normalizeFilterValue('eq', column, 'sí')).toEqual({ problem: 'Tiene que ser true o false.' });
    expect(normalizeFilterValue('eq', column, 'true')).toEqual({ value: 'true' });
  });

  it('un texto vacio o con espacios cuenta como ausente', () => {
    expect(normalizeFilterValue('eq', SCHEMA[0], '   ')).toEqual({ value: '' });
  });
});

describe('buildDynamicQuery: paginación, sort y proyección', () => {
  it('siempre manda page y limit explicitos', () => {
    const { params } = build({}, { page: 3, limit: 10 });
    expect(params.get('page')).toBe('3');
    expect(params.get('limit')).toBe('10');
  });

  it('sort va como campo:dir y se repite si hay varios', () => {
    const { params } = buildDynamicQuery({
      filters: [],
      sort: [
        { field: 'importe_desde', dir: 'asc' },
        { field: 'tramo', dir: 'desc' },
      ],
      values: {},
      schema: SCHEMA,
    });
    expect(params.getAll('sort')).toEqual(['importe_desde:asc', 'tramo:desc']);
  });

  it('fields es un CSV y solo se manda si hay selección', () => {
    expect(build({}, { fields: ['tramo', 'importe_desde'] }).params.get('fields')).toBe('tramo,importe_desde');
    expect(build({}, { fields: [] }).params.get('fields')).toBeNull();
    expect(build({}, { fields: null }).params.get('fields')).toBeNull();
  });

  it('no manda filtros vacíos: un parametro en blanco no existe', () => {
    const { params } = build({ tramo: '', importe_desde: '  ' });
    expect(params.has('tramo')).toBe(false);
    expect(params.has('importe_desde')).toBe(false);
  });

  it('detecta los filtros required que faltan antes de consultar', () => {
    const { missingRequired } = buildDynamicQuery({
      filters: [{ field: 'tramo', op: 'eq', required: true }],
      sort: [],
      values: {},
      schema: SCHEMA,
    });
    expect(missingRequired).toEqual(['tramo']);
  });

  it('acumula un problema por filtro invalido y sigue con los validos', () => {
    const { params, problems } = build({ tramo: 'A', importe_desde: 'no-numero', vigencia_desde: '2026-13-99' });
    expect(params.get('tramo')).toBe('A');
    expect(problems).toHaveLength(2);
  });
});

describe('buildCurl', () => {
  it('reproduce exactamente la consulta que se ejecutó', () => {
    const { params } = build({ importe_desde: '50000' }, { page: 1, limit: 10 });
    expect(buildCurl('http://localhost:3001/api/v1/', 'escala-retencion', params)).toBe(
      "curl -sS 'http://localhost:3001/api/v1/e/escala-retencion?importe_desde=50000&sort=importe_desde%3Aasc&page=1&limit=10'",
    );
  });

  it('sin query no deja un ? colgando', () => {
    expect(buildCurl('http://x/api/v1', 'slug', new URLSearchParams())).toBe("curl -sS 'http://x/api/v1/e/slug'");
  });
});

describe('controlFor y operatorHint', () => {
  it('el control depende del op y del tipo de la columna', () => {
    expect(controlFor('between', SCHEMA[1])).toBe('range');
    expect(controlFor('in', SCHEMA[0])).toBe('csv');
    expect(controlFor('gte', SCHEMA[1])).toBe('number');
    expect(controlFor('gte', SCHEMA[2])).toBe('date');
    expect(controlFor('eq', SCHEMA[3])).toBe('select');
    expect(controlFor('eq', SCHEMA[0])).toBe('text');
    expect(controlFor('contains', SCHEMA[0])).toBe('text');
  });

  it('cada operador explica su formato de query', () => {
    expect(operatorHint('in')).toContain('CSV');
    expect(operatorHint('between')).toContain('a,b');
    expect(operatorHint('starts_with')).toContain('empieza');
  });
});