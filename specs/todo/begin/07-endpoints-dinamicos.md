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

- [ ] `create(dto)`: validar slug (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, 3–80), unicidad
  (`409 SLUG_TAKEN`), resolver dataset y **validar que cada `field` de `fields`, `filters` y
  `sort` exista en el schema** (`422 SCHEMA_MISMATCH`). Si `followLatest`, `datasetId` es
  opcional.
- [ ] `findAll`, `findOne` (con `resolved`: qué dataset usaría ahora), `update`
  (revalida si cambian `fields`/`filters`/`sort`), `remove` (hard-delete de la definición).
- [ ] `validate(id)`: devuelve `{ valid, datasetId, version, unknownFields[] }` con `200`
  siempre (es un reporte).
- [ ] `disableBySourceId(sourceId)` para el borrado lógico de sources (fase 04).
- [ ] Resolver dataset: `datasetId` directo, o `findLatestPublished(sourceId)` si
  `followLatest`.

## 2. Controller `endpoints`

- [ ] `POST /api/v1/endpoints`
- [ ] `GET /api/v1/endpoints`
- [ ] `GET /api/v1/endpoints/:id`
- [ ] `PATCH /api/v1/endpoints/:id`
- [ ] `POST /api/v1/endpoints/:id/validate`
- [ ] `DELETE /api/v1/endpoints/:id`
- [ ] En la descripción de Swagger de cada endpoint, incluir el ejemplo de `GET /e/{slug}`
  con su respuesta real (ver [`api-contract.md`](../../api-contract.md) §7).

## 3. Motor de consulta (`query-engine.ts`)

> Interfaz única que el `DynamicService` consume. Si más adelante se reemplaza por
> `Aggregation Pipeline`, sólo cambia esta clase.

```ts
interface QueryEngine {
  execute(rows: Row[], schema: ColumnSchema[], query: ParsedQuery): QueryResult;
}
```

- [ ] `parseQuery(query, definition, schema)`: valida **todo** antes de calcular.
  - `page` ≥ 1; `limit` en `[1, maxLimit]` ⇒ si no, `400 INVALID_PAGINATION`.
  - Cada filtro debe estar en `definition.filters[]` ⇒ si no, `400 FILTER_NOT_ALLOWED`.
    Si es `required` y falta el param ⇒ `400 FILTER_NOT_ALLOWED`.
  - `sort` debe estar en `definition.sort[]` ⇒ si no, `400 SORT_NOT_ALLOWED`.
  - **Cualquier param no reconocido ⇒ `400`.** Nada se ignora en silencio.
  - Los valores se castean al tipo del `ColumnSchema`; si no se puede ⇒ `400
    VALIDATION_ERROR` (no comparar string contra number).
- [ ] Operadores según [`api-contract.md`](../../api-contract.md) §6: `eq`, `ne`, `gt`, `gte`,
  `lt`, `lte`, `in`, `contains`, `starts_with`, `between`.
- [ ] Proyección por `fields` (o el override del query), orden estable, paginación.
- [ ] `total` = filas tras filtrar, antes de paginar.
- [ ] Tests unitarios por cada operador, incluidos valores límite y `null`.

## 4. `DynamicService` + `DynamicController`

- [ ] `GET /api/v1/e/:slug`:
  1. `findBySlug` + `enabled === true` ⇒ si no, `404 SLUG_NOT_FOUND`
     (no se distingue inexistente de deshabilitado).
  2. Resolver dataset; inexistente o `archived` ⇒ `422 SCHEMA_MISMATCH`.
  3. `queryEngine.execute(...)`.
  4. Responder `{ data, meta: { total, count, page, limit, pages, dataset: { id, version, sourceId, updatedAt } } }`.
- [ ] `ETag` = hash de `datasetId + version + query string`; `If-None-Match` ⇒ `304`.
- [ ] Registrar la ruta en Swagger con un ejemplo genérico.

## 5. Criterios de aceptación

- [ ] Crear endpoint sobre el dataset de AFIP y consultarlo con filtro
  `?importe_desde=50000&limit=10&sort=importe_desde:asc`.
- [ ] Filtro no declarado (`?retencion=100`) ⇒ `400 FILTER_NOT_ALLOWED`.
- [ ] `?limit=9999` con `maxLimit: 500` ⇒ `400 INVALID_PAGINATION`.
- [ ] Param desconocido (`?foo=1`) ⇒ `400`.
- [ ] Slug inexistente y slug deshabilitado ⇒ `404` en ambos casos.
- [ ] `followLatest: true` + ingesta nueva ⇒ el endpoint sirve la `version` nueva sin tocar
  la definición.
- [ ] `meta.dataset.version` refleja la versión servida.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` en verde.

## 6. Commit y push

```bash
git checkout -b fase/07-endpoints-dinamicos
git add -A
git commit -m "feat(api): serve datasets through dynamic endpoints"
git push -u origin fase/07-endpoints-dinamicos
```

Abrir PR hacia `main`.

## 7. Estado y decisiones

- Fecha de ejecución: **<AGREGAR>**
- `<AGREGAR: motor de consulta, decisiones sobre límites, desvíos>`