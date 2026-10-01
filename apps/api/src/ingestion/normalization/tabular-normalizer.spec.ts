import {
  flattenJson,
  normalizeCell,
  normalizeHeaders,
  normalizeTable,
  parseNumberEsAr,
} from './tabular-normalizer';

describe('normalizeHeaders', () => {
  it('aplica las reglas de ingestion.md §6.1', () => {
    expect(normalizeHeaders(['Importe Desde ($)', 'Alícuota %', 'Tramo  ', 'Monto / Total'])).toEqual([
      'importe_desde',
      'alicuota',
      'tramo',
      'monto_total',
    ]);
  });

  it('quita tildes y eñes', () => {
    expect(normalizeHeaders(['Alícuota', 'N° de documento', 'Añio'])).toEqual([
      'alicuota',
      'n_de_documento',
      'anio',
    ]);
  });

  it('colapsa separadores repetidos y recorta extremos', () => {
    expect(normalizeHeaders(['  --Monto---Total--  '])).toEqual(['monto_total']);
  });

  it('cae a col_N cuando el encabezado queda vacío', () => {
    expect(normalizeHeaders(['ok', '', '***'])).toEqual(['ok', 'col_2', 'col_3']);
  });

  it('prefija col_ cuando la clave empieza con dígito', () => {
    expect(normalizeHeaders(['2026', '1er Tramo'])).toEqual(['col_2026', 'col_1er_tramo']);
  });

  it('desambigua duplicados con sufijo numérico', () => {
    expect(normalizeHeaders(['Monto', 'Monto', 'Monto'])).toEqual(['monto', 'monto_2', 'monto_3']);
  });

  it('evita colisiones cuando el sufijo generado pisa una clave existente', () => {
    // Sin esto `Monto 2` y el duplicado de `Monto` producirían la misma clave y el
    // esquema uniforme de data-model.md §3.1 regla 5 quedaría roto desde el encabezado.
    expect(normalizeHeaders(['Monto', 'Monto', 'Monto 2'])).toEqual([
      'monto',
      'monto_2',
      'monto_2_2',
    ]);
  });
});

describe('parseNumberEsAr', () => {
  it('lee coma como decimal cuando está al final con 1-2 dígitos', () => {
    expect(parseNumberEsAr('1.234,56')).toEqual({ value: 1234.56, ambiguous: false });
    expect(parseNumberEsAr('12,5')).toEqual({ value: 12.5, ambiguous: false });
  });

  it('usa el último separador como decimal cuando hay coma y punto', () => {
    expect(parseNumberEsAr('1.234.567,89')).toEqual({ value: 1234567.89, ambiguous: false });
    expect(parseNumberEsAr('1,234.56')).toEqual({ value: 1234.56, ambiguous: false });
  });

  it('trata la coma con 3 dígitos como separador de miles', () => {
    expect(parseNumberEsAr('1,234')).toEqual({ value: 1234, ambiguous: false });
    expect(parseNumberEsAr('1,234,567')).toEqual({ value: 1234567, ambiguous: false });
  });

  it('marca "1.234" como ambiguo en vez de inventar (ingestion.md §4.4)', () => {
    expect(parseNumberEsAr('1.234')).toEqual({ value: null, ambiguous: true });
  });

  it('no es ambiguo un decimal con 1 o 2 dígitos tras el punto', () => {
    expect(parseNumberEsAr('1.5')).toEqual({ value: 1.5, ambiguous: false });
    expect(parseNumberEsAr('1.50')).toEqual({ value: 1.5, ambiguous: false });
  });

  it('descarta símbolos de moneda y espacios', () => {
    expect(parseNumberEsAr('$ 1.000')).toEqual({ value: null, ambiguous: true });
    expect(parseNumberEsAr('$ 1.000,50')).toEqual({ value: 1000.5, ambiguous: false });
  });

  it('entiende paréntesis y signo como negativo', () => {
    expect(parseNumberEsAr('-1.234,5')).toEqual({ value: -1234.5, ambiguous: false });
    expect(parseNumberEsAr('(1.234,5)')).toEqual({ value: -1234.5, ambiguous: false });
  });

  it('rechaza texto que no es número', () => {
    expect(parseNumberEsAr('hola')).toEqual({ value: null, ambiguous: false });
    expect(parseNumberEsAr('1.2.3')).toEqual({ value: null, ambiguous: true });
  });
});

describe('normalizeCell', () => {
  it('mapea marcadores de vacío a null', () => {
    for (const token of ['', '  ', '-', '—', 'N/A', 'null', 'Sin dato']) {
      expect(normalizeCell(token)).toBeNull();
    }
  });

  it('NO convierte "0" en null (ingestion.md §6.3)', () => {
    expect(normalizeCell('0')).toBe(0);
    expect(normalizeCell('0,00')).toBe(0);
  });

  it('convierte porcentaje a fracción', () => {
    expect(normalizeCell('35%')).toBe(0.35);
    expect(normalizeCell('12,5%')).toBe(0.125);
  });

  it('parsea fechas ISO a Date', () => {
    const cell = normalizeCell('2026-07-01');
    expect(cell).toBeInstanceOf(Date);
    expect((cell as Date).toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('parsea booleanos textuales', () => {
    expect(normalizeCell('true')).toBe(true);
    expect(normalizeCell('SI')).toBe(true);
    expect(normalizeCell('sí')).toBe(true);
    expect(normalizeCell('false')).toBe(false);
  });

  it('no convierte "No" en false cuando es texto ambiguo', () => {
    expect(normalizeCell('No')).toBe(false);
    expect(normalizeCell('No aplica')).toBe('No aplica');
    expect(normalizeCell('Nada')).toBe('Nada');
  });

  it('colapsa espacios múltiples', () => {
    expect(normalizeCell('  producto   A  ')).toBe('producto A');
  });

  it('deja el texto tal cual y avisa cuando el número es ambiguo', () => {
    const warnings: string[] = [];
    expect(normalizeCell('1.234', (w) => warnings.push(w))).toBe('1.234');
    expect(warnings).toEqual(["ambiguous-number \"1.234\""]);
  });
});

describe('flattenJson', () => {
  it('aplana objetos anidados con notación de punto', () => {
    expect(flattenJson({ tramo: { desde: 0, hasta: 8334 }, alicuota: 0.35 })).toEqual({
      tramo_desde: 0,
      tramo_hasta: 8334,
      alicuota: 0.35,
    });
  });

  it('conserva arrays como celda json en vez de expandirlos', () => {
    const flattened = flattenJson({ tags: ['a', 'b'], total: 2 });
    expect(flattened.tags).toBe('["a","b"]');
    expect(flattened.total).toBe(2);
  });

  it('aplana tres niveles', () => {
    expect(flattenJson({ a: { b: { c: 'x' } } })).toEqual({ a_b_c: 'x' });
  });

  it('lanza si la entrada no es un objeto', () => {
    expect(() => flattenJson('texto')).toThrow(TypeError);
  });
});

describe('normalizeTable', () => {
  it('normaliza encabezados, valores y calcula el schema en una pasada', () => {
    const result = normalizeTable(
      ['Codigo', 'Descripcion', 'Precio', 'Activo'],
      [
        ['A01', 'Producto A', '1.234,56', 'true'],
        ['B02', 'Producto B', '99,00', 'false'],
      ],
      { source: 'manual' },
    );

    expect(result.schema.map((column) => [column.key, column.type, column.nullable])).toEqual([
      ['codigo', 'string', false],
      ['descripcion', 'string', false],
      ['precio', 'number', false],
      ['activo', 'boolean', false],
    ]);
    expect(result.schema[2]!.decimalScale).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(result.rows[0]!).toEqual({
      codigo: 'A01',
      descripcion: 'Producto A',
      precio: 1234.56,
      activo: true,
    });
  });

  it('marca nullable cuando alguna celda falta', () => {
    const result = normalizeTable(
      ['a', 'b'],
      [
        ['1', 'x'],
        ['2', ''],
      ],
      { source: 'manual' },
    );

    expect(result.schema.find((column) => column.key === 'b')?.nullable).toBe(true);
    expect(result.rows[1]!.b).toBeNull();
  });

  it('degrada a string con warning ante tipos mezclados', () => {
    const result = normalizeTable(
      ['monto'],
      [
        ['100'],
        ['no aplica'],
      ],
      { source: 'manual' },
    );

    expect(result.schema[0]!.type).toBe('string');
    expect(result.schema[0]!.decimalScale).toBeUndefined();
    expect(result.warnings).toEqual(["mixed-types column 'monto': number, string -> string"]);
  });

  it('degrada a string sin romper la fila cuando el número es ambiguo', () => {
    const result = normalizeTable(
      ['monto'],
      [
        ['1.000'],
        ['2.000'],
      ],
      { source: 'manual' },
    );

    expect(result.schema[0]!.type).toBe('string');
    expect(result.warnings).toEqual([
      "row 1 column 'monto': ambiguous-number \"1.000\"",
      "row 2 column 'monto': ambiguous-number \"2.000\"",
    ]);
  });

  it('detecta columnas de fecha', () => {
    const result = normalizeTable(
      ['vigencia'],
      [
        ['2026-07-01'],
        ['2026-12-31'],
      ],
      { source: 'manual' },
    );

    expect(result.schema[0]!.type).toBe('date');
  });

  it('respeta jsonKeys declarados sin degradarlos a string', () => {
    const result = normalizeTable(
      ['tags'],
      [
        ['["a","b"]'],
        ['[]'],
      ],
      { source: 'manual', jsonKeys: new Set(['tags']) },
    );

    expect(result.schema[0]!.type).toBe('json');
    expect(result.warnings).toEqual([]);
  });

  it('rellena con null las celdas ausentes sin romper el esquema uniforme', () => {
    const result = normalizeTable(
      ['a', 'b', 'c'],
      [['1', '2']],
      { source: 'manual' },
    );

    expect(result.rows[0]!).toEqual({ a: 1, b: 2, c: null });
    expect(result.schema.map((column) => column.nullable)).toEqual([false, false, true]);
  });

  it('usa el encabezado original como label', () => {
    const result = normalizeTable(['Importe Desde ($)'], [['1.000,00']], { source: 'manual' });
    expect(result.schema[0]!.label).toBe('Importe Desde ($)');
    expect(result.schema[0]!.source).toBe('manual');
  });

  it('acepta filas ya aplanadas en forma de objeto', () => {
    const result = normalizeTable(
      ['codigo', 'monto'],
      [
        { codigo: 'A', monto: '10,50' },
        { codigo: 'B', monto: '20,75' },
      ],
      { source: 'api' },
    );

    expect(result.rows).toEqual([
      { codigo: 'A', monto: 10.5 },
      { codigo: 'B', monto: 20.75 },
    ]);
    expect(result.schema[1]!.type).toBe('number');
  });
});