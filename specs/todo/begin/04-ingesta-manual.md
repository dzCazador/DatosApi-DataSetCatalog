# Fase 04 — Ingesta manual + API externa

> **Objetivo:** el motor de ingesta funcionando para `manual` (JSON/CSV) y `api`
> (JSON externo), con normalización compartida, versionado y control de concurrencia.

**Spec de referencia:** [`ingestion.md`](../../ingestion.md) §2, §3, §4.1, §4.2, §6, §7
(normativo), [`api-contract.md`](../../api-contract.md) §3.

---

## 0. Preguntas y permisos (obligatorio antes de empezar)

### Preguntas

1. **Límites por defecto.** Default: `INGEST_TIMEOUT_MS=30000`, `INGEST_MAX_BYTES=10485760`
   (10 MB), `INGEST_MAX_ROWS=50000`.
2. **¿`POST /ingest` devuelve `202` (el trabajo corre en el request) o `200`?** Default:
   `202`, según [`api-contract.md`](../../api-contract.md) §1.4.
3. **¿Se guardan los payloads manuales?** Default: **no**; sólo se persiste el dataset
   normalizado.
4. **¿`PATCH /sources/:id` acepta un `config` que no corresponda al `type`?** Default: no,
   `400 SOURCE_CONFIG_INVALID`.
5. **`DELETE /sources/:id` y endpoints asociados.** Default: se deja el hueco para la fase 07.

### Permisos a solicitar

- [x] `pnpm install` (agrega `csv-parse`).
- [x] `pnpm test` y `pnpm build`.
- [x] `docker compose up -d mongo` para el e2e.

### Valores por defecto si no hay respuesta

- Los defaults de arriba.

---

## 1. Módulo `ingestion`

- [x] `src/ingestion/ingestion.module.ts`: registra las strategies y exporta
  `IngestorFactory`.
- [x] `ingestor.factory.ts`: `resolve(type)` devuelve la strategy o lanza
  `SourceConfigInvalidError`. No un `BadRequestException` genérico: el contrato exige el
  `code` `SOURCE_CONFIG_INVALID` de [`api-contract.md`](../../api-contract.md) §1.2.
- [x] `ingestion.types.ts`: `IngestStrategy`, `DownloadedBody`, token `INGEST_STRATEGIES`.
  `IngestContext` e `IngestResult` viven en `@datosapi/common` desde la fase 03: son parte del
  contrato de ingesta, no de una app en particular.
- [x] `helpers/downloader.ts`: descarga con `AbortSignal.timeout` (también durante la lectura
  del cuerpo), `INGEST_USER_AGENT`, corte en `INGEST_MAX_BYTES` por `content-length` **y** por
  chunks acumulados con `reader.cancel()`, y `502` con snippet de 200 chars.
- [x] `helpers/json-payload.ts`: `assertConfig`, `resolveJsonPath` (segmento por segmento, con
  `hasOwnProperty` en vez de acceso directo) y `parseJsonPayload`.
- [x] `errors/ingestion.errors.ts`: los errores de [`ingestion.md`](../../ingestion.md) §7 con
  su `code`, su HTTP y el texto que va a `lastError`, derivados del mismo lugar para que no
  puedan divergir del mensaje que ve el usuario.

## 2. Normalizador compartido (`tabular-normalizer.ts`)

> Todo origen pasa por acá. Es lo que garantiza que el `schema` se calcula igual para todos.

- [x] `normalizeHeaders(raw: string[]): string[]` según
  [`ingestion.md`](../../ingestion.md) §6.1 (snake_case, sin tildes, desambiguación, `col_N`).
  El sufijo desambiguado se reserva contra las claves ya emitidas: sin eso
  `['Monto','Monto','Monto 2']` producía `monto_2` dos veces y rompía el esquema uniforme de
  [`data-model.md`](../../data-model.md) §3.1 regla 5 desde el encabezado.
- [x] `parseNumberEsAr(raw: string): ParseNumberResult` → `{ value, ambiguous }`. No devuelve
  `number | null` como decía el checkpoint: la ambiguidad necesita distinguir "no es número"
  de "es número pero no sabés cuál", y con `null` ambas cosas se reportan como texto.
  `"1.234"` → `{ value: null, ambiguous: true }`.
- [x] `normalizeCell(raw, onWarning?)` (vacíos, `%` → fracción, booleanos, fechas ISO, espacios).
- [x] `inferSchema(rows, headers): ColumnSchema[]` con degradación a `string` + warning
  `mixed-types` ante tipos mezclados, y `decimalScale` del máximo de decimales vistos.
- [x] `flattenJson(obj, prefix?): Row` une los niveles con `_` (`tramo_desde`), que es lo que
  muestra §6.4. Los arrays quedan como celda `json` en vez de expandirse a filas.
- [x] `headersFromRows` y `maxWidthOf`: encabezados derivados de las filas, para JSON libre y
  para CSV sin fila de encabezado.
- [x] Test unitarios por cada regla, **incluyendo los casos ambiguos** (36 tests).

## 3. Strategies

- [x] `manual.strategy.ts`: `format: 'json' | 'csv'` con `csv-parse/sync` (`bom: true`,
  `relax_column_count`, `columns: false` siempre, para poder distinguir el encabezado de los
  datos y avisar las filas con menos celdas). El `json` acepta array plano, objeto que envuelve
  un array y objeto único.
- [x] `api.strategy.ts`: `fetch` (GET/POST), validar `res.ok` (`502` si no), `content-type`
  (`422`), resolver `jsonPath` **segmento por segmento** (prohibido `eval`), exigir array
  (`422` si no).
- [x] Tests unitarios con `fetch` stubbeado: 200 con array, 404 del origen, JSON inválido,
  `jsonPath` inexistente, `jsonPath` sobre `__proto__`, timeout.

## 4. `SourcesService.ingest()`

- [x] `POST /api/v1/sources` (crea con `status: pending`, valida `config` según `type`).
- [x] `POST /api/v1/sources/:id/ingest`:
  1. `compareAndSetStatus(pending|ready|error → processing)`; si falla ⇒ `409 INGEST_ALREADY_RUNNING`.
  2. `nextVersion(sourceId)`.
  3. `factory.resolve(type).ingest(config, ctx)`.
  4. `rowCount > INGEST_MAX_ROWS` ⇒ `422 ROWS_LIMIT_EXCEEDED` (no truncar).
  5. Crear `Dataset { status: draft }`, actualizar `Source.lastDatasetId` y `status: ready`.
  6. `catch` ⇒ `status: error` + `lastError` mapeado según
     [`ingestion.md`](../../ingestion.md) §7. `finally` ⇒ siempre resolver el estado.
- [x] `GET /sources`, `GET /sources/:id`, `PATCH /sources/:id` (no cambia `type`),
  `GET /sources/:id/datasets`, `DELETE /sources/:id` (lógico). El deshabilitado de los
  endpoints asociados queda como `TODO(fase 07)`: hoy no hay ningún endpoint publicado.
- [x] `PATCH /sources/:id` rechaza con `400 SOURCE_CONFIG_INVALID` un `config` que no corresponda
  al `type` actual, para no dejar la fuente con un config que sólo se descubre inválido al
  ingerir.
- [x] DTOs con `class-validator` + `forbidNonWhitelisted`.
- [x] Filtro global de excepciones con la forma de
  [`api-contract.md`](../../api-contract.md) §1.1 y los `code` de §1.2. Además ahora respeta el
  `status` de los errores de `body-parser`, que antes terminaban como `500`.
- [x] Borde de serialización `id → _id`: el dominio llama `id` a la clave primaria y la API
  expone `_id`. La traducción ocurre sólo en el presenter, no en la entidad.

## 5. Criterios de aceptación

- [x] Crear source manual (CSV) → ingerir → devuelve `datasetId`, `version: 1`, `rowCount`.
- [x] Reingerar ⇒ `version: 2` y el `dataset` v1 **intacto** (verificado en Mongo).
- [x] Doble ingesta simultánea ⇒ una recibe `409` y la otra `202`.
- [x] Source inexistente ⇒ `404`. Config inválida ⇒ `400`.
- [x] Origen 404 ⇒ `502 UPSTREAM_ERROR`. JSON inválido ⇒ `422`.
- [x] `rowCount > INGEST_MAX_ROWS` ⇒ `422 ROWS_LIMIT_EXCEEDED` sin persistir nada.
- [x] Test e2e del flujo completo manual (crear → ingerir → listar datasets): 17 tests.
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` en verde (138 tests).

## 6. Commit y push

Directo en `main`, según [`AGENTS.md`](../../../AGENTS.md) §4 (decisión del owner del
2026-10-01: no hay ramas por fase ni PR).

```bash
git checkout main
git pull --ff-only
git add -A
git commit -m "feat: phase 04 — manual and api ingestion"
git push origin main
```

## 7. Estado y decisiones

- **Fecha de ejecución:** 2026-10-01.
- **Límites:** los defaults de §0, sin cambios (`INGEST_TIMEOUT_MS=30000`,
  `INGEST_MAX_BYTES=10485760`, `INGEST_MAX_ROWS=50000`).
- **`POST /ingest` devuelve `202`**, según [`api-contract.md`](../../api-contract.md) §1.4.
- **Payloads manuales:** no se persisten copias. El `payload` queda en `Source.config` y sólo
  se guarda el dataset normalizado.
- **Desvío: `Row` incluye `Date`.** La fase 03 la había definido sin `Date`, lo que contradice
  `ColumnType` (que admite `'date'`), [`data-model.md`](../../data-model.md) §1 ("todas las
  fechas se guardan como `Date`") e [`ingestion.md`](../../ingestion.md) §6.2 (`"2026-07-01"` →
  `Date`). Sin `Date` en la unión, una columna declarada `date` no puede cumplir su propio
  tipo y habría que mentir con casts.
- **Desvío: `parseNumberEsAr` devuelve `{ value, ambiguous }`** y no `number | null`, para poder
  distinguir "no es número" de "es número y hay dos lecturas posibles".
- **Body parser.** El default de Express (100kb) era menor que `INGEST_MAX_BYTES` (10MB), así
  que una carga manual grande moría antes de llegar a la ingesta. Ahora el parser usa
  `INGEST_MAX_BYTES`, y el e2e monta la app con la misma función que `main.ts`.
- **`DELETE /sources/:id` no deshabilita endpoints:** no hay ninguno publicado hasta la fase 07.
  El `TODO` está en `apps/api/src/sources/sources.service.ts`.
- **Sin strategies `url` ni `pdf`:** son de la fase 05. `IngestorFactory.resolve` devuelve
  `400 SOURCE_CONFIG_INVALID` para esos tipos hasta entonces, que es el comportamiento
  especificado para un `type` sin strategy registrada.
- **Pendiente para la fase 05:** `tabularNormalizer` ya expone `maxWidthOf` y
  `slugifyColumnKey` para que el extractor de PDF reutilice la normalización en vez de
  duplicarla ([`ingestion.md`](../../ingestion.md) §5).