import type { ConfigService } from '@nestjs/config';

import { Downloader } from '../helpers/downloader';
import type { IngestContext } from '../ingestion.types';
import { ApiIngestStrategy } from './api.strategy';

interface FetchCall {
  url: string;
  init: RequestInit;
}

function stubFetch(
  response: Partial<{ ok: boolean; status: number; contentType: string; body: string }>,
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
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
    now: new Date(),
    storageDir: './storage',
    sourceId: '68b1c2f0a1b2c3d4e5f60718',
    limits: { timeoutMs: 30_000, maxBytes: 10_485_760, maxRows: 50_000 },
  };
}

describe('ApiIngestStrategy', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('ingiere un array plano y deja constar de dónde salió (ingestion.md §8)', async () => {
    const fetchStub = stubFetch({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify([{ tramo: 'A', monto: '1.234,56' }]),
    });

    const result = await new ApiIngestStrategy(realDownloader()).ingest(
      { url: 'https://api.test/dolar', method: 'GET' },
      ctx(),
    );

    expect(fetchStub.calls[0]!.url).toBe('https://api.test/dolar');
    expect(fetchStub.calls[0]!.init.method).toBe('GET');
    expect(result.meta).toMatchObject({
      method: 'api-json',
      sourceUrl: 'https://api.test/dolar',
      contentType: 'application/json',
    });
    expect(result.rows).toEqual([{ tramo: 'A', monto: 1234.56 }]);
    expect(result.schema[1]!.type).toBe('number');
  });

  it('resuelve el jsonPath segmento por segmento', async () => {
    stubFetch({
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', data: { resultados: [{ tramo: 'A' }] } }),
    });

    const result = await new ApiIngestStrategy(realDownloader()).ingest(
      { url: 'https://api.test/x', method: 'GET', jsonPath: 'data.resultados' },
      ctx(),
    );

    expect(result.rows).toEqual([{ tramo: 'A' }]);
  });

  it('envía body y content-type sólo en POST', async () => {
    const fetchStub = stubFetch({ contentType: 'application/json', body: '[]' });

    await new ApiIngestStrategy(realDownloader()).ingest(
      { url: 'https://api.test/x', method: 'POST', body: { desde: '2026-07-01' } },
      ctx(),
    ).catch(() => undefined);

    expect(fetchStub.calls[0]!.init.body).toBe('{"desde":"2026-07-01"}');
    expect((fetchStub.calls[0]!.init.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
  });

  it('devuelve 502 UPSTREAM_ERROR con el status del origen y un snippet', async () => {
    stubFetch({ status: 404, contentType: 'text/html', body: 'Not Found' });

    await expect(
      new ApiIngestStrategy(realDownloader()).ingest(
        { url: 'https://api.test/x', method: 'GET' },
        ctx(),
      ),
    ).rejects.toMatchObject({
      status: 502,
      message: 'upstream responded 404: Not Found',
    });
  });

  it('devuelve 422 si el jsonPath no existe', async () => {
    stubFetch({ contentType: 'application/json', body: JSON.stringify({ data: [] }) });

    await expect(
      new ApiIngestStrategy(realDownloader()).ingest(
        { url: 'https://api.test/x', method: 'GET', jsonPath: 'data.resultados' },
        ctx(),
      ),
    ).rejects.toMatchObject({ status: 422, message: expect.stringContaining('no existe') });
  });

  it('devuelve 422 si el resultado no es un array', async () => {
    stubFetch({ contentType: 'application/json', body: JSON.stringify({ data: { a: 1 } }) });

    await expect(
      new ApiIngestStrategy(realDownloader()).ingest(
        { url: 'https://api.test/x', method: 'GET', jsonPath: 'data' },
        ctx(),
      ),
    ).rejects.toMatchObject({ status: 422, message: expect.stringContaining('no es un array') });
  });

  it('devuelve 422 si el JSON es inválido', async () => {
    stubFetch({ contentType: 'application/json', body: '{roto}' });

    await expect(
      new ApiIngestStrategy(realDownloader()).ingest(
        { url: 'https://api.test/x', method: 'GET' },
        ctx(),
      ),
    ).rejects.toMatchObject({ status: 422, message: expect.stringContaining('invalid JSON') });
  });

  it('devuelve 504 si el origen no responde a tiempo', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    }) as typeof fetch;

    await expect(
      new ApiIngestStrategy(realDownloader()).ingest(
        { url: 'https://api.test/lento', method: 'GET' },
        ctx(),
      ),
    ).rejects.toMatchObject({ status: 504, message: 'timeout after 30000ms' });

    globalThis.fetch = original;
  });

  it('no puede alcanzar el prototipo por jsonPath', async () => {
    stubFetch({ contentType: 'application/json', body: JSON.stringify({ a: [] }) });

    await expect(
      new ApiIngestStrategy(realDownloader()).ingest(
        { url: 'https://api.test/x', method: 'GET', jsonPath: '__proto__' },
        ctx(),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('valida que la URL sea http/https', () => {
    const strategy = new ApiIngestStrategy(realDownloader());

    expect(() =>
      strategy.validateConfig({ url: 'ftp://api.test/x', method: 'GET' }),
    ).toThrow('Sólo se admiten http/https');

    expect(() => strategy.validateConfig({ url: 'no-es-url', method: 'GET' })).toThrow(
      'no es una URL válida',
    );
  });

  it('rechaza un config de tipo manual', () => {
    const strategy = new ApiIngestStrategy(realDownloader());

    expect(() => strategy.validateConfig({ format: 'csv', payload: 'a' })).toThrow(
      'El config no corresponde a un source de tipo',
    );
  });
});

/**
 * El downloader real, no un doble: la estrategia tiene que ejercitar el `fetch` stubbeado
 * (timeout, `res.ok`, `content-type`) porque de eso trata su parte de I/O. Lo único que se
 * falsea es el `ConfigService`, del que sólo se lee `INGEST_USER_AGENT`.
 */
function realDownloader(): Downloader {
  const config = {
    getOrThrow: (key: string) =>
      key === 'INGEST_USER_AGENT' ? 'DatosApi/0.1 (test)' : undefined,
  } as unknown as ConfigService<{ INGEST_USER_AGENT: string }, true>;

  return new Downloader(config);
}
