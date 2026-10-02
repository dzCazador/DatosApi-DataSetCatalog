import { describe, expect, it } from 'vitest';

import {
  EMPTY_CELL,
  formatBoolean,
  formatBytes,
  formatCell,
  formatCount,
  formatDate,
  formatDateTime,
  formatDay,
  formatDuration,
  formatJson,
  formatNumber,
  isPercentScale,
} from './index';
import type { ColumnSchema } from '../api/types';

function column(partial: Partial<ColumnSchema>): ColumnSchema {
  return { key: 'k', label: 'L', type: 'string', nullable: true, ...partial };
}

describe('formatNumber', () => {
  it('usa el decimalScale del schema: 54785.28 con scale 2', () => {
    expect(formatNumber(54785.28, 2)).toBe('54.785,28');
    expect(formatNumber(54785.28, 0)).toBe('54.785');
    expect(formatNumber(54785.28, 3)).toBe('54.785,280');
  });

  it('el caso ambiguo: decimalScale 4 es un porcentaje, no un número de 4 decimales', () => {
    // `alicuota` de la escala de retención viene como 0.15 y se lee 15 %.
    expect(formatNumber(0.15, 4)).toBe('15 %');
    expect(formatNumber(0.225, 4)).toBe('22,5 %');
    expect(formatNumber(0, 4)).toBe('0 %');
    expect(isPercentScale(4)).toBe(true);
    expect(isPercentScale(2)).toBe(false);
    expect(isPercentScale(undefined)).toBe(false);
  });

  it('sin decimalScale explicito usa 2 decimales, no los del Number', () => {
    expect(formatNumber(1)).toBe('1,00');
    expect(formatNumber(1.5)).toBe('1,50');
  });

  it('no inventa ceros de más en columnas sin escala', () => {
    expect(formatNumber(109570.56, 2)).toBe('109.570,56');
    expect(formatNumber(-3.5, 2)).toBe('-3,50');
  });

  it('un numero no finito no es un numero: se muestra como vacio', () => {
    expect(formatNumber(Number.NaN, 2)).toBe(EMPTY_CELL);
    expect(formatNumber(Number.POSITIVE_INFINITY, 2)).toBe(EMPTY_CELL);
  });
});

describe('formatDate / formatDateTime / formatDay', () => {
  it('formatDate va a dd/mm/aaaa', () => {
    expect(formatDate('2026-01-15T12:00:00.000Z')).toBe('15/01/2026');
  });

  it('formatDay no corre de zona: un YYYY-MM-DD se muestra tal cual', () => {
    expect(formatDay('2026-07-01')).toBe('01/07/2026');
    expect(formatDay('2026-12-31T23:59:59.000Z')).toBe('31/12/2026');
  });

  it('un valor ausente o invalido es guion largo, no la epoch', () => {
    expect(formatDate(undefined)).toBe(EMPTY_CELL);
    expect(formatDate(null)).toBe(EMPTY_CELL);
    expect(formatDate('')).toBe(EMPTY_CELL);
    expect(formatDate('no-es-fecha')).toBe(EMPTY_CELL);
    expect(formatDay(undefined)).toBe(EMPTY_CELL);
  });

  it('formatDateTime incluye la hora', () => {
    expect(formatDateTime('2026-01-15T12:00:00.000Z')).toMatch(/\d{2}\/\d{2}\/\d{4},?\s?\d{2}:\d{2}/);
  });
});

describe('formatBoolean, formatCount, formatDuration, formatBytes', () => {
  it('boolean sale como Si/No y null como guion', () => {
    expect(formatBoolean(true)).toBe('Sí');
    expect(formatBoolean(false)).toBe('No');
    expect(formatBoolean(null)).toBe(EMPTY_CELL);
    expect(formatBoolean(undefined)).toBe(EMPTY_CELL);
  });

  it('un contador ausente no se muestra como 0', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(12)).toBe('12');
    expect(formatCount(undefined)).toBe(EMPTY_CELL);
    expect(formatCount(null)).toBe(EMPTY_CELL);
  });

  it('duracion legible desde milisegundos', () => {
    expect(formatDuration(450)).toBe('450 ms');
    expect(formatDuration(1840)).toBe('1,8 s');
    expect(formatDuration(90_000)).toBe('1 min 30 s');
    expect(formatDuration(undefined)).toBe(EMPTY_CELL);
  });

  it('bytes con unidad', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2,0 kB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5,0 MB');
    expect(formatBytes(null)).toBe(EMPTY_CELL);
  });
});

describe('formatJson', () => {
  it('una celda json llega como texto y se muestra tal cual', () => {
    expect(formatJson('{"a":1}')).toBe('{"a":1}');
    expect(formatJson({ a: 1 })).toBe('{"a":1}');
  });

  it('trunca lo largo', () => {
    const text = formatJson('{"key":"' + 'x'.repeat(300) + '"}', 40);
    expect(text.length).toBe(40);
    expect(text.endsWith('…')).toBe(true);
  });

  it('un string vacío no es un dato', () => {
    expect(formatJson('')).toBe(EMPTY_CELL);
  });
});

describe('formatCell', () => {
  it('delega en el type de la columna, no en el typeof del valor', () => {
    // `alicuota` con scale 4 se muestra como porcentaje aunque el valor sea 0.15.
    expect(formatCell(column({ key: 'alicuota', type: 'number', decimalScale: 4 }), 0.15)).toBe('15 %');
    expect(formatCell(column({ key: 'importe', type: 'number', decimalScale: 2 }), 54785.28)).toBe('54.785,28');
    expect(formatCell(column({ key: 'vigencia', type: 'date' }), '2026-07-01')).toBe('01/07/2026');
    expect(formatCell(column({ key: 'activo', type: 'boolean' }), true)).toBe('Sí');
    expect(formatCell(column({ key: 'meta', type: 'json' }), '{"a":1}')).toBe('{"a":1}');
    expect(formatCell(column({ key: 'tramo', type: 'string' }), '1')).toBe('1');
  });

  it('null y undefined son guion largo, nunca 0 ni cadena vacia', () => {
    expect(formatCell(column({ key: 'importe', type: 'number', decimalScale: 2 }), null)).toBe(EMPTY_CELL);
    expect(formatCell(column({ key: 'importe', type: 'number', decimalScale: 2 }), undefined)).toBe(EMPTY_CELL);
    expect(formatCell(column({ key: 'vigencia', type: 'date' }), null)).toBe(EMPTY_CELL);
    expect(formatCell(column({ key: 'activo', type: 'boolean' }), null)).toBe(EMPTY_CELL);
    // Un 0 real sí se muestra: la diferencia entre "no vino" y "valía cero" se respeta.
    expect(formatCell(column({ key: 'importe', type: 'number', decimalScale: 2 }), 0)).toBe('0,00');
    expect(formatCell(column({ key: 'activo', type: 'boolean' }), false)).toBe('No');
    // Una celda de string vacía es un hueco, no un dato.
    expect(formatCell(column({ key: 'tramo', type: 'string' }), '')).toBe(EMPTY_CELL);
  });
});