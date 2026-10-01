import type { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';

/**
 * El body de `POST /sources` transporta el `payload` manual, así que el tope del parser tiene
 * que ser el mismo `INGEST_MAX_BYTES` que usa la ingesta. Con el default de Express (100kb) una
 * carga manual mayor moría con un error del parser antes de llegar a la ingesta.
 *
 * Vive acá y no en `main.ts` para que los e2e monten la app igual que producción: un test que
 * arma la app a mano sin esto pasa con cargas que en el servidor real fallan.
 */
export function useIngestSizedBodyParser(app: INestApplication, maxBytes: number): void {
  app.use(json({ limit: maxBytes }));
  app.use(urlencoded({ extended: true, limit: maxBytes }));
}