# Fase 07 — Endpoints dinámicos

> **Objetivo:** CRUD de `EndpointDefinition` y el endpoint público `GET /e/:slug` con
> validación estricta del query, filtros, orden, paginación y `ETag`.

**Spec de referencia:** [`api-contract.md`](../../api-contract.md) §5, §6 (normativo),
[`architecture.md`](../../architecture.md) §9.

---

## 0. Preguntas y permisos (obligatorio antes de empezar)

### Preguntas

1. **¿El motor de consulta filtra en memoria o con `Aggregation Pipeline`?** Default:
   **en memoria** (los datasets del MVP son chicos; el motor queda detrás de una interfaz
   intercambiable). Si el volumen real resulta grande, se cambia en esta fase.
2. **`limit > maxLimit`: ¿clampar o rechazar?** Default: **rechazar** con `400
   INVALID_PAGINATION` (clampar en silencio esconde errores del cliente).
3. **¿Caché HTTP desde el MVP?** Default: sí, `ETag` = hash de
   `datasetId + version + query` (barato y sin estado).

### Permisos a solicitar

- [ ] Nada fuera del repo local.

### Valores por defecto si no hay respuesta

- Los defaults de arriba.

---

## 1. `EndpointsService`

- [x] `create(dto)`: validar slug (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, 3–80), unicidad
  (`409 SLUG_TAKEN`), resolver dataset y **validar que cada `field` de `fields`, `filters` y
  `sort` exista en el schema** (`422 SCHEMA_MISMATCH`). Si `followLatest`, `datasetId` es
  opcional.
- [x] `findAll`, `findOne` (con `resolved`: qué dataset usaría ahora), `update`
  (revalida si cambian `fields`/`filters`/`sort`), `remove` (hard-delete de la definición).
- [x] `validate(id)`: devuelve `{ valid, datasetId, version, unknownFields[] }` con `200`
  siempre (es un reporte).
- [x] `disableBySourceId(sourceId)` para el borrado lógico de sources (fase 04).
- [x] Resolver dataset: `datasetId` directo, o `findLatestPublished(sourceId)` si
  `followLatest`.

## 2. Controller `endpoints`

- [x] `POST /api/v1/endpoints`
- [x] `GET /api/v1/endpoints`
- [x] `GET /api/v1/endpoints/:id`
- [x] `PATCH /api/v1/endpoints/:id`
- [x] `POST /api/v1/endpoints/:id/validate`
- [x] `DELETE /api/v1/endpoints/:id`
- [x] En la descripción de Swagger de cada endpoint, incluir el ejemplo de `GET /e/{slug}`
  con su respuesta real (ver [`api-contract.md`](../../api-contract.md) §7).

## 3. Motor de consulta (`query-engine.ts`)

> Interfaz única que el `DynamicService` consume. Si más adelante se reemplaza por
> `Aggregation Pipeline`, sólo cambia esta clase.

```ts
interface QueryEngine {
  execute(rows: Row[], schema: ColumnSchema[], query: ParsedQuery): QueryResult;
}
```

- [x] `parseQuery(query, definition, schema)`: valida **todo** antes de calcular.
  - `page` ≥ 1; `limit` en `[1, maxLimit]` ⇒ si no, `400 INVALID_PAGINATION`.
  - Cada filtro debe estar en `definition.filters[]` ⇒ si no, `400 FILTER_NOT_ALLOWED`.
    Si es `required` y falta el param ⇒ `400 FILTER_NOT_ALLOWED`.
  - `sort` debe estar en `definition.sort[]` ⇒ si no, `400 SORT_NOT_ALLOWED`.
  - **Cualquier param no reconocido ⇒ `400`.** Nada se ignora en silencio.
  - Los valores se castean al tipo del `ColumnSchema`; si no se puede ⇒ `400
    VALIDATION_ERROR` (no comparar string contra number).
- [x] Operadores según [`api-contract.md`](../../api-contract.md) §6: `eq`, `ne`, `gt`, `gte`,
  `lt`, `lte`, `in`, `contains`, `starts_with`, `between`.
- [x] Proyección por `fields` (o el override del query), orden estable, paginación.
- [x] `total` = filas tras filtrar, antes de paginar.
- [x] Tests unitarios por cada operador, incluidos valores límite y `null`.

## 4. `DynamicService` + `DynamicController`

- [x] `GET /api/v1/e/:slug`:
  1. `findBySlug` + `enabled === true` ⇒ si no, `404 SLUG_NOT_FOUND`
     (no se distingue inexistente de deshabilitado).
  2. Resolver dataset; inexistente o `archived` ⇒ `422 SCHEMA_MISMATCH`.
  3. `queryEngine.execute(...)`.
  4. Responder `{ data, meta: { total, count, page, limit, pages, dataset: { id, version, sourceId, updatedAt } } }`.
- [x] `ETag` = hash de `datasetId + version + query string`; `If-None-Match` ⇒ `304`.
- [x] Registrar la ruta en Swagger con un ejemplo genérico.

## 5. Criterios de aceptación

- [x] Crear endpoint sobre el dataset de AFIP y consultarlo con filtro
  `?importe_desde=50000&limit=10&sort=importe_desde:asc`.
- [x] Filtro no declarado (`?retencion=100`) ⇒ `400 FILTER_NOT_ALLOWED`.
- [x] `?limit=9999` con `maxLimit: 500` ⇒ `400 INVALID_PAGINATION`.
- [x] Param desconocido (`?foo=1`) ⇒ `400`.
- [x] Slug inexistente y slug deshabilitado ⇒ `404` en ambos casos.
- [x] `followLatest: true` + ingesta nueva ⇒ el endpoint sirve la `version` nueva sin tocar
  la definición.
- [x] `meta.dataset.version` refleja la versión servida.
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` en verde.

## 6. Commit y push

Commit directo en `main` (decisión del owner del 2026-10-01, ver `AGENTS.md` §4):

```bash
git checkout main
git pull --ff-only
git add -A
git commit -m "feat: phase 07 — dynamic endpoints"
git push origin main
```

## 7. Estado y decisiones

- Fecha de ejecución: **2026-10-02**
- **Alcance:** completo. Los repositorios de endpoints, `findLatestPublished` y
  `disableBySourceId` ya venían de las fases 03/06; esta fase agregó el módulo `endpoints`
  completo (7 archivos de producción + 3 specs), el motor de consulta en memoria, el endpoint
  público con `ETag`/`304`, el wiring de la baja de fuentes y 164 tests nuevos
  (109 unitarios + 55 e2e).
- **Decisión 1 — motor en memoria.** Confirmado el default. `InMemoryQueryEngine` implementa
  `QueryEngine`, y el service lo recibe por el token `QUERY_ENGINE`. La interfaz no puede ser
  el token: las interfaces no existen en runtime, así que `provide: QueryEngine` sería
  `undefined` y el arranque fallaría al resolver la dependencia. Con esta indirección, pasar
  a `Aggregation Pipeline` es cambiar un binding.
- **Decisión 2 — `limit > maxLimit` se rechaza.** Confirmado el default. `400
  INVALID_PAGINATION`, sin clampar.
- **Decisión 3 — `ETag` con query canónico.** El hash es `datasetId | version | query`, pero
  el query va con las claves ordenadas: `?a=1&b=2` y `?b=2&a=1` son la misma consulta y
  tienen que dar el mismo `ETag`, o el cliente pierde el `304` por el orden en que armó la
  URL. `updatedAt` no entra porque `version` ya cambia en cada ingesta. El `304` se decide en
  el controller y no en un interceptor porque depende del hash, que es del service.
- **Decisión 4 — `?fields=` es un override, no un escape.** Si la definición declara
  `fields`, el query sólo puede pedir un subconjunto; si no declara, cualquier columna del
  schema es admisible. Y sin `?fields=`, la proyección es la de la definición: declarar
  `fields` es justamente la forma de exponer menos columnas de las que tiene el dataset.
  Esta segunda parte no estaba en el spec y salió de un e2e: la respuesta traía `descripcion`
  aunque la definición no la declarara.
- **Decisión 5 — los límites salen de la configuración, no del DTO.** `defaultLimit` y
  `maxLimit` se omiten para usar `DEFAULT_LIMIT`/`MAX_LIMIT`, y un `maxLimit` mayor que
  `MAX_LIMIT` es `400 VALIDATION_ERROR`. El `@Max` del decorador no sirve: el tope es
  configurable por entorno, y un `@Max(200)` fijo contradiría `MAX_LIMIT=500`. Además
  `MAX_PAGE_SIZE` (200) es el tope de los *listados de administración*; el endpoint dinámico
  tenía que usar el otro, como anticipaba el comentario de `sources.dto.ts`.
- **Decisión 6 — un `draft` también es `422`.** El contrato sólo nombraba el dataset
  archivado. Servir un `draft` por `GET /e/{slug}` expondría datos sin publicar, que es
  justo lo que la publicación impide; así que `draft`, `archived` y "no resuelve" dan los tres
  `422 SCHEMA_MISMATCH`, distinguidos por `details.status`/`details.reason`. Con
  `followLatest` el archivado nunca aparece, porque el resolver busca el `published` más
  reciente.
- **Decisión 7 — `GET /endpoints/:id` nunca falla por no resolver.** `resolved` es `null` con
  `resolvedReason` en texto, y `/validate` devuelve `200` con `valid: false` y `reason`. Un
  `422` en cualquiera de los dos convertiría un reporte en un fallo y dejaría al panel sin
  forma de mostrar una definición válida cuyo dataset todavía no se publicó.
- **Decisión 8 — una definición desactualizada es `422`, no un filtro ignorado.** Si una
  reingesta le quita al dataset una columna que la definición declara en `fields[]`,
  `filters[]` o `sort[]`, `GET /e/{slug}` devuelve `422 SCHEMA_MISMATCH` con
  `details.unknownFields`. La primera versión de `parseQuery` la saltaba en silencio, y eso
  es exactamente el fallo que el spec prohíbe: el cliente mandaba `?descripcion=abc`, la
  definición lo declaraba, y recibía `200` con el dataset entero creyendo que había filtrado.
  El allowlist y el schema son listas distintas, y de la segunda sólo puede inferirse el tipo
  de la celda. Hay un e2e que reproduce el ciclo completo: definición publicada contra la v1,
  `PATCH` de la source con un CSV sin esa columna, v2 publicada, y el `GET` devuelve `422` con
  el mismo reporte que `/validate`.
- **Ampliación del contrato (documentada en `api-contract.md` §5 y §6).** Se agregaron
  `resolvedReason`, `status` y `reason` al reporte de `/validate`, la semántica de `null` en
  los operadores, la proyección por defecto, y las filas de error de `datasetId` inexistente
  (`DATASET_NOT_FOUND`), `datasetId` de otra source y `maxLimit` fuera de rango. **No se
  agregó ningún `code` nuevo**: todos reutilizan los que §1.2 ya definía.
- **Bug encontrado por los e2e — el CSV de pruebas partía las descripciones.** Las filas con
  miles con coma (`De 54.785,29 a 109.570,56`) tienen que ir entrecomilladas. Sin comillas el
  `csv-parse` las parte en dos columnas y aparece una columna `39 en adelante` fantasma. No
  era un bug del producto, sino del fixture: el primer e2e "verde" con el CSV sin comillas
  habría probado un dataset que no existe.
- **Sobre la proyección y `?fields=`:** ver Decisión 4. El allowlist se aplica en dos
  niveles —`filters[]`/`sort[]` para el query y `fields[]` para la proyección— y en los dos
  casos lo desconocido es `400`, nunca un dato de más.
- **Pendiente para fases siguientes:**
  - `apps/web` (fase 09) puede consumir `resolved`, `resolvedReason` y el reporte de
    `/validate` para mostrar el estado de cada definición sin lógica duplicada.
  - El motor en memoria carga el dataset entero por consulta. El disparador para migrar sigue
    siendo `rowCount > 100_000` (fase 06 §3), y el orden correcto para hacerlo es
    `DatasetsService` primero: el `DynamicService` pide `findById` sin `rowsLimit`, así que
    necesita la lectura paginada de `dataset_rows` que ya está señalizada en la interfaz del
    repositorio.
  - El `ETag` no cubre la URL más allá del query, así que dos peticiones idénticas a paths
    distintos (`/e/a` y `/e/b` con el mismo dataset) no comparten cache. No es un problema
    con el diseño actual: el `slug` es único por definición.
