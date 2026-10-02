# Fase 06 — Datasets versionados, publicación y catálogo

> **Objetivo:** completar el CRUD de datasets con publicación, archivado, preview y
> endpoints de catálogo.

**Spec de referencia:** [`api-contract.md`](../../api-contract.md) §4 (normativo),
[`data-model.md`](../../data-model.md) §3, §7.

---

## 0. Preguntas y permisos (obligatorio antes de empezar)

### Preguntas

1. **¿`GET /datasets/:id` devuelve todas las filas o un preview?** Default: preview de
   `PREVIEW_ROWS` (20) con `meta.previewTruncated`, y `?full=true` sólo si
   `rowCount ≤ INGEST_MAX_ROWS`.
2. **¿Publicar (`publish`) es reversible desde `published`?** Default: no; sólo a
   `archived`.
3. **¿Se expone el binario original descargado?** Default: **no** (fuera de alcance).

### Permisos a solicitar

- [ ] Nada fuera del repo local (sólo `pnpm dev` / tests).

### Valores por defecto si no hay respuesta

- Los defaults de arriba.

---

## 1. `DatasetsService`

- [ ] `findAll(query)`: filtros `sourceId`, `status` + paginación. **Sin `rows`** (peso).
- [ ] `findOne(id)`: con preview según decisión 1.
- [ ] `getSchema(id)`: sólo `schema`.
- [ ] `publish(id)`: `draft → published`, setea `publishedAt`; `409` si ya está
  `published` o `archived`.
- [ ] `archive(id)`: `published → archived`. `DELETE /datasets/:id` es alias de archive.
- [ ] `findLatestPublished(sourceId)`: query indexada `{ status, sourceId, version: -1 }`.
- [ ] Mapeo explícito documento → respuesta (nunca devolver el doc crudo; ver
  [`conventions.md`](../../conventions.md) §3).

## 2. Controller `datasets`

- [ ] `GET /api/v1/datasets`
- [ ] `GET /api/v1/datasets/:id` (con `?full`)
- [ ] `GET /api/v1/datasets/:id/schema`
- [ ] `POST /api/v1/datasets/:id/publish`
- [ ] `POST /api/v1/datasets/:id/archive`
- [ ] `DELETE /api/v1/datasets/:id`

## 3. Documentar la transición a `dataset_rows`

- [ ] Comentar en el repositorio de datasets la interfaz que permite migrar a una colección
  `dataset_rows` sin tocar los services (ver
  [`data-model.md`](../../data-model.md) §3.3).
- [ ] Anotar el disparador concreto en el código: `rowCount > 100_000`.
- [ ] **No** implementar la migración en el MVP.

## 4. Tests

- [ ] Unitario: `publish` sobre `draft` ⇒ `published`; sobre `published` ⇒ `409`.
- [ ] Unitario: `findLatestPublished` devuelve la versión mayor entre las `published`.
- [ ] Unitario: preview con `rowCount = 100` y `PREVIEW_ROWS = 20` ⇒ 20 filas +
  `previewTruncated: true`.
- [ ] E2e: ingesta (fase 04) → `publish` → `GET /datasets/:id` devuelve el dataset.

## 5. Criterios de aceptación

- [ ] Todo el §4 verde.
- [ ] `GET /datasets` responde rápido y **no** incluye `rows` (verificarlo en la respuesta).
- [ ] Un dataset `published` no se modifica por ninguna vía de la API.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` en verde.

## 6. Commit y push

```bash
git checkout -b fase/06-datasets-catalogo
git add -A
git commit -m "feat(datasets): add versioning, publish and catalog endpoints"
git push -u origin fase/06-datasets-catalogo
```

Abrir PR hacia `main`.

## 7. Estado y decisiones

- Fecha de ejecución: **2026-10-02**
- **Alcance:** completo. Los repositorios de datasets ya tenían `publish`/`archive`/
  `findLatestPublished` (fase 03); esta fase agregó la capa HTTP (`DatasetsService`,
  `DatasetsController`, 6 rutas) y el preview acotado.
- **Decisión 1 — preview:** confirmado el default. `GET /datasets/:id` devuelve `PREVIEW_ROWS`
  (20) filas con `meta.previewTruncated`. El recorte se hace con un `$slice` en la proyección
  de Mongo, no con `rows.slice()` en memoria: traer el dataset entero para descartar el 99%
  se pagaba en cada preview del panel. `rowCount` sigue siendo el total real, así que
  `previewTruncated` se deduce comparando `rowCount` contra `rows.length`, sin un segundo
  request. `?full=true` se honra sólo si `rowCount <= INGEST_MAX_ROWS`; si alguna vez no se
  cumpliera, la respuesta degrada a preview en vez de mandar un body sin cota.
- **Decisión 2 — `publish` irreversible:** confirmado. Publicar un `published` o un
  `archived` es `409`, no un no-op. `archive` sólo acepta `published`; archivar un `draft` es
  `409` porque no es una transición del modelo (`data-model.md` §3). `DELETE /datasets/:id` es
  alias de `archive` y por lo tanto devuelve el mismo `409` en un draft.
- **Decisión 3 — sin descarga del binario:** confirmado. El PDF original queda en
  `storage/<sourceId>/<ts>.pdf`, gitignored, y no se expone por HTTP.
- **Desvío del spec — código de error nuevo.** `api-contract.md` §1.2 no tenía código para
  "transición de estado inválida sobre un dataset", y los `409` existentes (`SLUG_TAKEN`,
  `INGEST_ALREADY_RUNNING`, `VERSION_CONFLICT`) no corresponden. Se agregó
  `DATASET_INVALID_STATE` (409) al contrato y a `ErrorCode`, con `details` =
  `{ operation, current, expectedFrom, expectedTo }` para que el cliente sepa qué hacer.
  El gap era del contrato, no del código.
- **Desvío del spec — transiciones atómicas.** El spec pide `409` si el estado no admite la
  transición, pero leer el estado y después actualizar abre una carrera. `publish` y `archive`
  filtran por `status` dentro del `findOneAndUpdate`; el `null` devuelto se desambigua con una
  relectura que separa `404` de `409`. Hay un e2e de dos publicaciones concurrentes que
  comprueba que exactamente una gana.
- **Bug preexistente corregido.** `src/common/body-parser.ts` importa `json`/`urlencoded` de
  `express`, que era dependencia transitiva de `@nestjs/platform-express`. Con el
  `node_modules` estricto de pnpm el `require` fallaba y **la API no arrancaba**
  (`pnpm dev` y `start:prod` rotos desde la fase 02; los e2e no lo detectaban porque corren
  por ts-jest contra `src`). Se agregó `express@^5.2.1` como dependencia directa de
  `@datosapi/api`.
- **Bug de conversión implícita encontrado por e2e.** Declarar `?full` como `boolean`
  hacía que `enableImplicitConversion` lo convirtiese con `Boolean(valor)`: `?full=false`,
  `?full=0` y hasta `?full=no` devolvían el dataset **entero** (50k filas en vez de 20). Un
  `@Transform` explícito no lo evita, porque la conversión implícita corre antes. El campo se
  declara `string` con `@IsIn(['true','false','1','0'])` y se interpreta en el controller, y un
  valor fuera del conjunto es `400 VALIDATION_ERROR` en vez de una decisión en silencio.
- **Pendiente para fases siguientes:**
  - Fase 07 debe llamar a `disableBySourceId` en `SourcesService.remove`: hoy la baja de una
    fuente marca `error` con `lastError` pero deja los endpoints publicados tal cual. El
    `TODO(fase 07)` sigue en `apps/api/src/sources/sources.service.ts:134`.
  - `findLatestPublished` ya está expuesto en el service; lo consume el `followLatest` de los
    endpoints dinámicos.