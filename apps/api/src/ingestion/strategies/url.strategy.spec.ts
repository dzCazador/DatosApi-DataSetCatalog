import type { ConfigService } from '@nestjs/config';

import type { IngestContext } from '../ingestion.types';
import { Downloader } from '../helpers/downloader';
import { buildProsePdf, buildSimpleTablePdf } from '../pdf/__fixtures__/make-fixture';
import { UrlIngestStrategy } from './url.strategy';

const URL_UNDER_TEST = 'https://origen.test/tabla';

function stubFetch(response: { status?: number; contentType?: string; body?: string | Buffer }): {
  calls: { url: string; init: RequestInit }[];
  restore: () => void;
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });

    return new Response(response.body ?? '', {
      status: response.status ?? 200,
      headers: response.contentType === undefined ? {} : { 'content-type': response.contentType },
    });
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function ctx(): IngestContext {
  return {
    now: new Date('2026-10-01T12:00:00.000Z'),
    storageDir: './storage',
    sourceId: '68b1c2f0a1b2c3d4e5f60718',
    limits: { timeoutMs: 30_000, maxBytes: 10_485_760, maxRows: 50_000 },
  };
}

function strategy(): UrlIngestStrategy {
  const config = { getOrThrow: () => 'datosapi-test' };

  return new UrlIngestStrategy(
    new Downloader(config as unknown as ConfigService<{ INGEST_USER_AGENT: string }, true>),
  );
}

describe('UrlIngestStrategy', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('validateConfig', () => {
    it('rechaza un config que no sea de tipo url', () => {
      expect(() => strategy().validateConfig({ format: 'csv', payload: 'a,b' })).toThrow(
        /no corresponde a un source de tipo 'url'/,
      );
    });

    it('rechaza protocols que no son http/https', () => {
      expect(() => strategy().validateConfig({ url: 'ftp://origen.test/x' })).toThrow(
        /Sólo se admiten http\/https/,
      );
    });
  });

  describe('despacho por content-type', () => {
    it('application/pdf delega en la lógica de PDF', async () => {
      stubFetch({ contentType: 'application/pdf', body: buildSimpleTablePdf() });

      const result = await strategy().ingest({ url: URL_UNDER_TEST }, ctx());

      expect(result.meta.method).toBe('url-pdf');
      expect(result.meta).toMatchObject({ pageCount: 1, tableCount: 1, sourceUrl: URL_UNDER_TEST });
      expect(result.rows).toHaveLength(6);
      expect(result.schema.map((column) => column.key)).toEqual(['codigo', 'importe', 'alicuota']);
    });

    it('json usa la misma normalización que api', async () => {
      stubFetch({
        contentType: 'application/json',
        body: JSON.stringify([{ tramo: 'A', monto: '1.234,56' }]),
      });

      const result = await strategy().ingest({ url: URL_UNDER_TEST }, ctx());

      expect(result.meta.method).toBe('url-json');
      expect(result.rows).toEqual([{ tramo: 'A', monto: 1234.56 }]);
      expect(result.schema[1]!.type).toBe('number');
    });

    it('json que no es array es 422 y no un 400 con forma adivinada', async () => {
      stubFetch({ contentType: 'application/json', body: JSON.stringify({ total: 12 }) });

      await expect(strategy().ingest({ url: URL_UNDER_TEST }, ctx())).rejects.toMatchObject({
        status: 422,
      });
    });

    it('text/csv usa la misma normalización que manual/csv', async () => {
      stubFetch({
        contentType: 'text/csv',
        body: 'codigo,descripcion,activo\nA01,Producto A,true',
      });

      const result = await strategy().ingest({ url: URL_UNDER_TEST }, ctx());

      expect(result.meta.method).toBe('url-csv');
      expect(result.rows).toEqual([{ codigo: 'A01', descripcion: 'Producto A', activo: true }]);
    });

    it('text/plain intenta CSV', async () => {
      stubFetch({ contentType: 'text/plain', body: 'codigo,monto\nA01,10' });

      const result = await strategy().ingest({ url: URL_UNDER_TEST }, ctx());

      expect(result.meta.method).toBe('url-csv');
      expect(result.rows).toEqual([{ codigo: 'A01', monto: 10 }]);
    });

    it('un content-type desconocido es 415 con el tipo recibido', async () => {
      stubFetch({ contentType: 'text/html', body: '<html></html>' });

      await expect(strategy().ingest({ url: URL_UNDER_TEST }, ctx())).rejects.toMatchObject({
        status: 415,
        response: { message: expect.stringContaining('text/html') },
      });
    });
  });

  describe('cuando el origen no declara bien su tipo', () => {
    it('el contentTypeHint del config manda si el content-type no sirve', async () => {
      stubFetch({ contentType: 'application/octet-stream', body: buildSimpleTablePdf() });

      const result = await strategy().ingest(
        { url: URL_UNDER_TEST, contentTypeHint: 'application/pdf' },
        ctx(),
      );

      expect(result.meta.method).toBe('url-pdf');
    });

    it('la extensión de la URL es el último recurso', async () => {
      stubFetch({ contentType: 'application/octet-stream', body: buildSimpleTablePdf() });

      const result = await strategy().ingest({ url: 'https://origen.test/tabla.pdf' }, ctx());

      expect(result.meta.method).toBe('url-pdf');
    });

    it('sin ninguna pista el PDF sale 415, no una extracción adivinada', async () => {
      stubFetch({ contentType: 'application/octet-stream', body: buildProsePdf() });

      await expect(
        strategy().ingest({ url: 'https://origen.test/download', contentTypeHint: '' }, ctx()),
      ).rejects.toMatchObject({ status: 415 });
    });
  });

  describe('errores', () => {
    it('un 404 del origen es 502', async () => {
      stubFetch({ status: 404, body: 'no existe' });

      await expect(strategy().ingest({ url: URL_UNDER_TEST }, ctx())).rejects.toMatchObject({
        status: 502,
      });
    });

    it('un PDF sin tabla reconocible es 422 no tabular region detected', async () => {
      stubFetch({ contentType: 'application/pdf', body: buildProsePdf() });

      await expect(strategy().ingest({ url: URL_UNDER_TEST }, ctx())).rejects.toThrow(
        'no tabular region detected',
      );
    });
  });
});
