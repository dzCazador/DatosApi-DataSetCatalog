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

### Permisos a solicitar

- [ ] `pnpm install` (agrega `csv-parse`).

### Valores por defecto si no hay respuesta

- Los defaults de arriba.

---

## 1. Módulo `ingestion`

- [ ] `src/ingestion/ingestion.module.ts`: registra las strategies y exporta
  `IngestorFactory`.
- [ ] `ingestor.factory.ts`: `resolve(type)` devuelve la strategy o lanza `BadRequestException`.
- [ ] `types.ts`: `IngestStrategy`, `IngestContext`, `IngestResult`.
- [ ] `downloader.ts`: helper de descarga HTTP con `AbortSignal.timeout`,
  `INGEST_USER_AGENT`, acumulador de chunks que corta en `INGEST_MAX_BYTES` con
  `PayloadTooLargeException`, y chequeo de `content-type`.

## 2. Normalizador compartido (`tabular-normalizer.ts`)

> Todo origen pasa por acá. Es lo que garantiza que el `schema` se calcula igual para todos.

- [ ] `normalizeHeaders(raw: string[]): string[]` según
  [`ingestion.md`](../../ingestion.md) §6.1 (snake_case, sin tildes, desambiguación, `col_N`).
- [ ] `parseNumberEsAr(value: string): number | null` con warning `ambiguous-number` para
  `"1.234"`.
- [ ] `normalizeCell(raw: string): string | number | boolean | Date | null` (vacíos, `%`,
  booleanos, fechas, espacios).
- [ ] `inferSchema(rows, headers): ColumnSchema[]` con degradación a `string` + warning ante
  tipos mezclados.
- [ ] `flattenJson(obj, prefix?): Row` para anidar con `a.b` (máscara `key`).
- [ ] Test unitarios por cada regla, **incluyendo los casos ambiguos**.

## 3. Strategies

- [ ] `manual.strategy.ts`: `format: 'json' | 'csv'` con `csv-parse/sync`
  (`bom: true`, `relax_column_count`), devuelve por el normalizador.
- [ ] `api.strategy.ts`: `fetch` (GET/POST), validar `res.ok` (`502` si no), validar
  `content-type` (`422`), resolver `jsonPath` **segmento por segmento** (prohibido `eval`),
  exigir array (`422` si no).
- [ ] Tests unitarios con `fetch` stubbeado: 200 con array, 404 del origen, json inválido,
  `jsonPath` inexistente.

## 4. `SourcesService.ingest()`

- [ ] `POST /api/v1/sources` (crea con `status: pending`, valida `config` según `type`).
- [ ] `POST /api/v1/sources/:id/ingest`:
  1. `compareAndSetStatus(pending|ready|error → processing)`; si falla ⇒ `409 INGEST_ALREADY_RUNNING`.
  2. `nextVersion(sourceId)`.
  3. `factory.resolve(type).ingest(config, ctx)`.
  4. `rowCount > INGEST_MAX_ROWS` ⇒ `422 ROWS_LIMIT_EXCEEDED` (no truncar).
  5. Crear `Dataset { status: draft }`, actualizar `Source.lastDatasetId` y `status: ready`.
  6. `catch` ⇒ `status: error` + `lastError` mapeado según
     [`ingestion.md`](../../ingestion.md) §7. `finally` ⇒ siempre resolver el estado.
- [ ] `GET /sources`, `GET /sources/:id`, `PATCH /sources/:id` (no cambia `type`),
  `GET /sources/:id/datasets`, `DELETE /sources/:id` (lógico: deshabilita endpoints
  asociados).
- [ ] DTOs con `class-validator` + `forbidNonWhitelisted`.
- [ ] Filtro global de excepciones con la forma de
  [`api-contract.md`](../../api-contract.md) §1.1 y los `code` de §1.2.

## 5. Criterios de aceptación

- [ ] Crear source manual (CSV) → ingerir → devuelve `datasetId`, `version: 1`, `rowCount`.
- [ ] Reingerar ⇒ `version: 2` y el `dataset` v1 **intacto** (verificarlo en Mongo).
- [ ] Doble ingesta simultánea ⇒ una recibe `409`.
- [ ] Source inexistente ⇒ `404`. Config inválida ⇒ `400`.
- [ ] Origen 404 ⇒ `502 UPSTREAM_ERROR`. JSON inválido ⇒ `422`.
- [ ] Test e2e del flujo completo manual (crear → ingerir → listar datasets).
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` en verde.

## 6. Commit y push

```bash
git checkout -b fase/04-ingesta-manual
git add -A
git commit -m "feat(ingestion): add manual and api ingest strategies"
git push -u origin fase/04-ingesta-manual
```

Abrir PR hacia `main`.

## 7. Estado y decisiones

- Fecha de ejecución: **<AGREGAR>**
- `<AGREGAR: límites, código HTTP elegido, desvíos>`