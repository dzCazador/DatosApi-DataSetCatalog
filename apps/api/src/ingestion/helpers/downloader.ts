import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { IngestContext } from '../ingestion.types';
import { PayloadTooLargeError, UpstreamError, UpstreamTimeoutError } from '../errors/ingestion.errors';

/** Cabeceras que se envían siempre: identidad del cliente y pedido de JSON. */
const BASE_HEADERS: Readonly<Record<string, string>> = {
  accept: 'application/json, text/csv, text/plain;q=0.9, application/pdf;q=0.9, */*;q=0.5',
};

export interface DownloadedBody {
  body: Buffer;
  /** `content-type` sin `; charset=...` y en minúsculas; vacío si el origen no lo manda. */
  contentType: string;
}

export interface DownloadOptions {
  url: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  requestHeaders?: Record<string, string>;
}

/**
 * Descarga HTTP compartida por `api`, `url` y `pdf` (ingestion.md §4.2 a §4.4).
 *
 * Dos límites son no negociables y por eso viven acá y no en cada strategy: el timeout por
 * `AbortSignal.timeout` y el corte por tamaño acumulado. El segundo se implementa leyendo
 * el `content-length` cuando el origen lo declara **y** cortando al acumular los chunks,
 * porque un origen que no lo declara igual puede entregar un cuerpo gigante.
 */
@Injectable()
export class Downloader {
  constructor(
    private readonly config: ConfigService<{ INGEST_USER_AGENT: string }, true>,
  ) {}

  async download(options: DownloadOptions, ctx: IngestContext): Promise<DownloadedBody> {
    const { url, method = 'GET', body, requestHeaders } = options;

    const headers: Record<string, string> = {
      ...BASE_HEADERS,
      'user-agent': this.config.getOrThrow('INGEST_USER_AGENT'),
      ...requestHeaders,
    };

    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(ctx.limits.timeoutMs) };

    if (method === 'POST' && body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw this.translateFetchError(error, ctx.limits.timeoutMs);
    }

    if (!response.ok) {
      const snippet = await this.readSnippet(response);
      throw new UpstreamError(response.status, snippet);
    }

    const declaredLength = this.readDeclaredLength(response);

    if (declaredLength !== null && declaredLength > ctx.limits.maxBytes) {
      throw new PayloadTooLargeError(ctx.limits.maxBytes);
    }

    return {
      body: await this.readBounded(response, ctx.limits.maxBytes, ctx.limits.timeoutMs),
      contentType: this.readContentType(response),
    };
  }

  /** Traduce los dos únicos fallos esperables de `fetch` a errores con diagnóstico distinto. */
  private translateFetchError(error: unknown, timeoutMs: number): Error {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return new UpstreamTimeoutError(timeoutMs);
    }

    const reason = error instanceof Error ? error.message : String(error);
    return new UpstreamError(0, reason);
  }

  private readContentType(response: Response): string {
    return (response.headers.get('content-type') ?? '')
      .split(';')[0]!
      .trim()
      .toLowerCase();
  }

  private readDeclaredLength(response: Response): number | null {
    const header = response.headers.get('content-length');

    if (header === null) return null;

    const parsed = Number(header);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async readSnippet(response: Response): Promise<string> {
    try {
      const text = await response.text();
      // ingestion.md §7 pide "los primeros 200 chars del body": el cuerpo de un error puede
      // ser una página HTML de varios cientos de KB y no debe acabar en `lastError`.
      return text.slice(0, 200);
    } catch {
      return '<sin cuerpo>';
    }
  }

  /**
   * Lee el cuerpo acumulando chunks y abortando en cuanto se pasa del límite. No se confía
   * en el `content-length`: es opcional y el origen puede mentir.
   */
  private async readBounded(response: Response, maxBytes: number, timeoutMs: number): Promise<Buffer> {
    if (response.body === null) {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > maxBytes) throw new PayloadTooLargeError(maxBytes);
      return buffer;
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;

    try {
      for (;;) {
        const { done, value } = await reader.read();

        if (done) break;
        if (value === undefined) continue;

        total += value.byteLength;
        if (total > maxBytes) {
          // Se cancela el stream: si no, seguiría consumiendo ancho de banda del origen
          // después de haber decidido que la respuesta es inaceptable.
          await reader.cancel();
          throw new PayloadTooLargeError(maxBytes);
        }

        chunks.push(Buffer.from(value));
      }
    } catch (error) {
      if (error instanceof PayloadTooLargeError) throw error;
      throw this.translateStreamError(error, timeoutMs);
    } finally {
      reader.releaseLock();
    }

    return Buffer.concat(chunks);
  }

  /**
   * La señal de timeout sigue armada durante la lectura del cuerpo, así que también puede
   * vencer acá: se traduce igual que en la conexión para no reportarlo como error del origen.
   */
  private translateStreamError(error: unknown, timeoutMs: number): Error {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return new UpstreamTimeoutError(timeoutMs);
    }

    return new UpstreamError(0, error instanceof Error ? error.message : String(error));
  }
}