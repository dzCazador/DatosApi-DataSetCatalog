import { describe, expect, it } from 'vitest';

import {
  allowedFromDetails,
  datasetStateFromDetails,
  httpError,
  messageByCode,
  paramFromDetails,
  presentError,
  transportError,
  unknownFieldsFromDetails,
  validationMessagesFromDetails,
} from './errors';
import { ERROR_CODES, type ErrorCode } from './types';

describe('messageByCode', () => {
  it('tiene un mensaje propio para cada code del contrato', () => {
    for (const code of ERROR_CODES) {
      const message = messageByCode(code);
      expect(message).toBeTypeOf('string');
      expect(message.length).toBeGreaterThan(0);
      // `HTTP_ERROR` es el propio genérico, así que es el único que puede coincidir consigo mismo.
      if (code !== 'HTTP_ERROR') expect(message).not.toBe(messageByCode('HTTP_ERROR'));
    }
  });

  it('un code desconocido cae en el generico, nunca en undefined', () => {
    const unknown = 'CODE_INVENTADO' as ErrorCode;
    expect(messageByCode(unknown)).toBe(messageByCode('HTTP_ERROR'));
  });

  it('distingue los errores cuyo problema es el origen, no el panel', () => {
    expect(messageByCode('UPSTREAM_ERROR')).toContain('origen');
    expect(messageByCode('UPSTREAM_TIMEOUT')).toContain('origen');
  });
});

describe('presentError para errores http', () => {
  it('SLUG_TAKEN explica que el slug es la URL pública', () => {
    const error = httpError('SLUG_TAKEN', 409, 'Ya existe', { slug: 'x' }, '/endpoints');
    const shown = presentError(error);
    expect(shown.title).toBe(messageByCode('SLUG_TAKEN'));
    expect(shown.hint).toContain('URL pública');
  });

  it('VALIDATION_ERROR del ValidationPipe muestra la lista de mensajes', () => {
    const error = httpError('VALIDATION_ERROR', 400, 'Datos inválidos', ['name debe ser string', 'type inválido'], '/sources');
    expect(presentError(error).detail).toBe('name debe ser string · type inválido');
  });

  it('SCHEMA_MISMATCH lista los where de cada campo desconocido', () => {
    const error = httpError(
      'SCHEMA_MISMATCH',
      422,
      'No coincide',
      {
        unknownFields: [{ where: 'filters[1].field', field: 'importe_desde', reason: 'not in dataset schema' }],
      },
      '/e/x',
    );
    const shown = presentError(error);
    expect(shown.detail).toContain('filters[1].field');
    expect(shown.detail).toContain('importe_desde');
    expect(shown.hint).toContain('validate');
  });

  it('SORT_NOT_ALLOWED muestra el allowlist de campos', () => {
    const error = httpError('SORT_NOT_ALLOWED', 400, 'No permitido', { field: 'x', allowed: ['tramo', 'importe_desde'] }, '/e/x');
    expect(presentError(error).hint).toBe('Orden permitido: tramo, importe_desde');
  });

  it('FILTER_NOT_ALLOWED nombra el parametro rechazado', () => {
    const error = httpError('FILTER_NOT_ALLOWED', 400, 'No permitido', { param: 'trampa' }, '/e/x');
    expect(presentError(error).detail).toBe('Parámetro rechazado: trampa');
  });

  it('DATASET_INVALID_STATE dice la transicion valida', () => {
    const error = httpError(
      'DATASET_INVALID_STATE',
      409,
      'No se puede',
      { operation: 'publish', current: 'archived', expectedFrom: 'draft', expectedTo: 'published' },
      '/datasets/x/publish',
    );
    const shown = presentError(error);
    expect(shown.hint).toContain('archived');
    expect(shown.hint).toContain('draft');
  });
});

describe('presentError cuando la API no responde', () => {
  it('transport dice que revise la API y no deja pantalla en blanco', () => {
    const shown = presentError(transportError('unreachable', 'fetch failed', '/sources'));
    expect(shown.title).toContain('API');
    expect(shown.detail).toBe('fetch failed');
    expect(shown.hint).toContain('pnpm dev');
  });

  it('un timeout y un cancelación se distinguen', () => {
    expect(presentError(transportError('timeout', 'timeout', '/x')).title).toContain('tardó demasiado');
    expect(presentError(transportError('aborted', 'abort', '/x')).title).toContain('cancelada');
  });
});

describe('lectores de details', () => {
  it('toleran details de cualquier forma sin romper', () => {
    expect(unknownFieldsFromDetails(null)).toEqual([]);
    expect(unknownFieldsFromDetails({})).toEqual([]);
    expect(unknownFieldsFromDetails({ unknownFields: 'no' })).toEqual([]);
    expect(unknownFieldsFromDetails({ unknownFields: [{ where: 'fields[0]', field: 'a', reason: 'r' }] })).toHaveLength(1);

    expect(validationMessagesFromDetails('nope')).toEqual([]);
    expect(validationMessagesFromDetails([1, 'a'])).toEqual(['a']);

    expect(paramFromDetails(null)).toBeNull();
    expect(paramFromDetails({ param: 'x' })).toBe('x');

    expect(allowedFromDetails({ allowed: ['a', 2] })).toEqual(['a']);
    expect(allowedFromDetails({})).toEqual([]);

    expect(datasetStateFromDetails({ operation: 'publish' })).toBeNull();
    expect(datasetStateFromDetails({ operation: 'p', current: 'draft', expectedFrom: 'draft', expectedTo: 'published' }))
      .toEqual({ operation: 'p', current: 'draft', expectedFrom: 'draft', expectedTo: 'published' });
  });
});