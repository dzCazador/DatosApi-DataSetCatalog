import type { IngestContext, IngestResult, SourceConfig, SourceType } from '@datosapi/common';

/**
 * Contrato de una estrategia de ingesta (ingestion.md §3). `validateConfig` y `ingest` lanzan
 * excepciones de dominio: el service no interpreta errores, sólo los traduce a HTTP.
 */
export interface IngestStrategy {
  readonly type: SourceType;
  validateConfig(config: SourceConfig): void;
  ingest(config: SourceConfig, ctx: IngestContext): Promise<IngestResult>;
}

export type { IngestContext, IngestResult };

/** Bytes descargados con su content-type y el momento de la descarga. */
export interface DownloadedPayload {
  body: Uint8Array;
  contentType: string;
  bytes: number;
  fetchedAt: Date;
  sourceUrl: string;
}

/** Token de inyección del mapa de strategies registradas. */
export const INGEST_STRATEGIES = Symbol('INGEST_STRATEGIES');

/**
 * El `config` llega del cliente como `Record<string, unknown>` y se valida contra el `type`
 * de la fuente antes de usarse. El cast no es un atajo: es el punto donde la validación deja
 * de ser un tipo y pasa a ser una aserción en runtime que hace la strategy.
 */
export function toSourceConfig(raw: Record<string, unknown>): SourceConfig {
  return raw as unknown as SourceConfig;
}