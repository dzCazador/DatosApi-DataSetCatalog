import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConfigService } from '@nestjs/config';

import type { IngestContext } from '../ingestion.types';
import { Downloader } from '../helpers/downloader';
import { buildSimpleTablePdf } from '../pdf/__fixtures__/make-fixture';
import { PdfIngestStrategy } from './pdf.strategy';

const PDF_URL = 'https://www.afip.gob.ar/tabla.pdf';

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

function ctx(overrides: Partial<IngestContext> = {}): IngestContext {
  return {
    now: new Date('2026-10-01T12:00:00.000Z'),
    storageDir: './storage',
    sourceId: '68b1c2f0a1b2c3d4e5f60718',
    limits: { timeoutMs: 30_000, maxBytes: 10_485_760, maxRows: 50_000 },
    ...overrides,
  };
}

/**
 * El `Downloader` real con un `ConfigService` mínimo: los límites por corrida (`timeoutMs`,
 * `maxBytes`) viven en el `IngestContext`, como manda ingestion.md §3, así que el config sólo
 * necesita el user-agent.
 */
function realDownloader(): Downloader {
  const config = { getOrThrow: () => 'datosapi-test' };

  return new Downloader(config as unknown as ConfigService<{ INGEST_USER_AGENT: string }, true>);
}

describe('PdfIngestStrategy', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('validateConfig', () => {
    it('rechaza un config que no sea de PDF', () => {
      const strategy = new PdfIngestStrategy(realDownloader());

      expect(() => strategy.validateConfig({ format: 'csv', payload: 'a,b' })).toThrow(
        /no corresponde a un source de tipo 'pdf'/,
      );
    });

    it('rechaza protocols que no son http/https', () => {
      const strategy = new PdfIngestStrategy(realDownloader());

      expect(() => strategy.validateConfig({ url: 'file:///etc/passwd' })).toThrow(
        /Sólo se admiten http\/https/,
      );
    });

    it('rechaza páginas que no son enteros positivos', () => {
      const strategy = new PdfIngestStrategy(realDownloader());

      expect(() => strategy.validateConfig({ url: PDF_URL, pages: [0] })).toThrow(
        /no corresponde a un source de tipo 'pdf'/,
      );
    });

    it('rechaza un tableIndex que no es entero', () => {
      const strategy = new PdfIngestStrategy(realDownloader());

      expect(() => strategy.validateConfig({ url: PDF_URL, tableIndex: 1.5 })).toThrow(
        /no corresponde a un source de tipo 'pdf'/,
      );
    });

    it('acepta el config de ingestion.md §9.1', () => {
      const strategy = new PdfIngestStrategy(realDownloader());

      expect(() =>
        strategy.validateConfig({
          url: PDF_URL,
          headerHints: ['Tramo', 'Importe', 'Alícuota', 'Retención'],
        }),
      ).not.toThrow();
    });
  });

  describe('ingest', () => {
    it('extrae la tabla y deja constar de dónde salió (ingestion.md §8)', async () => {
      const body = buildSimpleTablePdf();
      const fetchStub = stubFetch({ contentType: 'application/pdf', body });

      const result = await new PdfIngestStrategy(realDownloader()).ingest({ url: PDF_URL }, ctx());

      expect(fetchStub.calls[0]!.url).toBe(PDF_URL);
      expect(result.meta).toMatchObject({
        method: 'pdfjs-text-coords',
        sourceUrl: PDF_URL,
        contentType: 'application/pdf',
        bytes: body.byteLength,
        pageCount: 1,
        tableCount: 1,
      });
      expect(result.rows).toHaveLength(6);
      expect(result.warnings).toEqual([]);
    });

    it('manda los requestHeaders del config', async () => {
      const fetchStub = stubFetch({ contentType: 'application/pdf', body: buildSimpleTablePdf() });

      await new PdfIngestStrategy(realDownloader()).ingest(
        { url: PDF_URL, requestHeaders: { authorization: 'Bearer token' } },
        ctx(),
      );

      const headers = fetchStub.calls[0]!.init.headers as Record<string, string>;
      expect(headers.authorization).toBe('Bearer token');
    });

    it('un 404 del origen es 502 upstream, no 422', async () => {
      stubFetch({ status: 404, body: 'not found' });

      await expect(
        new PdfIngestStrategy(realDownloader()).ingest({ url: PDF_URL }, ctx()),
      ).rejects.toMatchObject({ status: 502 });
    });

    it('un PDF más grande que INGEST_MAX_BYTES es 413 antes de parsear', async () => {
      stubFetch({ contentType: 'application/pdf', body: buildSimpleTablePdf() });

      const limited = ctx({ limits: { timeoutMs: 30_000, maxBytes: 64, maxRows: 50_000 } });

      await expect(
        new PdfIngestStrategy(realDownloader()).ingest({ url: PDF_URL }, limited),
      ).rejects.toMatchObject({ status: 413 });
    });

    it('un cuerpo que no es PDF es 422 y no 502', async () => {
      // El origen respondió bien: lo que no se pudo interpretar son los datos, no el transporte.
      stubFetch({ contentType: 'application/pdf', body: '<html>error del origen</html>' });

      await expect(
        new PdfIngestStrategy(realDownloader()).ingest({ url: PDF_URL }, ctx()),
      ).rejects.toMatchObject({ status: 422 });
    });

    it('un PDF de una sola columna es 422 no tabular region detected', async () => {
      const { buildProsePdf } = await import('../pdf/__fixtures__/make-fixture');

      stubFetch({ contentType: 'application/pdf', body: buildProsePdf() });

      await expect(
        new PdfIngestStrategy(realDownloader()).ingest({ url: PDF_URL }, ctx()),
      ).rejects.toThrow('no tabular region detected');
    });
  });

  describe('persistencia del binario', () => {
    it('guarda el PDF bajo STORAGE_DIR/<sourceId>', async () => {
      const storageDir = await mkdtemp(join(tmpdir(), 'datosapi-pdf-'));
      stubFetch({ contentType: 'application/pdf', body: buildSimpleTablePdf() });

      await new PdfIngestStrategy(realDownloader()).ingest(
        { url: PDF_URL },
        ctx({ storageDir, sourceId: '68b1c2f0a1b2c3d4e5f60718' }),
      );

      const files = await readdir(join(storageDir, '68b1c2f0a1b2c3d4e5f60718'));

      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/\.pdf$/);
      // El timestamp del `ctx.now` en ISO, con `:` y `.` reemplazados por `-`.
      expect(files[0]).toBe('2026-10-01T12-00-00-000Z.pdf');
      expect(
        (await readFile(join(storageDir, '68b1c2f0a1b2c3d4e5f60718', files[0]!))).length,
      ).toBeGreaterThan(0);
    });

    it('una ingesta válida no se pierde si el disco falla', async () => {
      stubFetch({ contentType: 'application/pdf', body: buildSimpleTablePdf() });

      // `storageDir` es un archivo, no un directorio: `mkdir` falla y la ingesta sigue.
      const result = await new PdfIngestStrategy(realDownloader()).ingest(
        { url: PDF_URL },
        ctx({ storageDir: `${tmpdir()}/datosapi-no-existe-${Date.now()}` }),
      );

      expect(result.rows).toHaveLength(6);
    });
  });
});
