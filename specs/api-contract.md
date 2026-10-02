# Contrato de API — DatosApi

> Documento **NORMATIVO**. Superficie HTTP pública. Prefijo por defecto: `/api/v1`
> (configurable con `API_PREFIX`).

---

## 1. Convenciones

### 1.1 Formato de error (uniforme en toda la API)

```json
{
  "statusCode": 404,
  "code": "SLUG_NOT_FOUND",
  "message": "No existe un endpoint con slug 'no-existe'",
  "details": null,
  "path": "/api/v1/e/no-existe",
  "timestamp": "2026-01-15T12:00:00.000Z"
}
```

`code` es un string estable y **programático** (el cliente puede ramificar con él);
`message` es humano. Los filtros de excepción de Nest deben emitir esta forma.

### 1.2 Códigos de error

| `code` | HTTP | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 400 | DTO inválido |
| `SOURCE_CONFIG_INVALID` | 400 | `config` no corresponde al `type` |
| `SLUG_INVALID` | 400 | El slug no cumple `^[a-z0-9]+(-[a-z0-9]+)*$` |
| `SLUG_TAKEN` | 409 | Slug ya existente |
| `INGEST_ALREADY_RUNNING` | 409 | Ingesta en curso sobre esa source |
| `VERSION_CONFLICT` | 409 | Índice único `{sourceId, version}` |
| `SOURCE_NOT_FOUND` | 404 | |
| `DATASET_NOT_FOUND` | 404 | |
| `DATASET_INVALID_STATE` | 409 | Transición de estado no permitida sobre un dataset (publicar uno ya `published`/`archived`, archivar un `draft`) |
| `ENDPOINT_NOT_FOUND` | 404 | |
| `SLUG_NOT_FOUND` | 404 | Slug inexistente **o deshabilitado** (no se distingue) |
| `PAYLOAD_TOO_LARGE` | 413 | Descarga excede `INGEST_MAX_BYTES` |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Content-type no soportado |
| `UNPROCESSABLE_CONTENT` | 422 | Datos de origen no interpretables |
| `ROWS_LIMIT_EXCEEDED` | 422 | `rowCount > INGEST_MAX_ROWS` |
| `FILTER_NOT_ALLOWED` | 400 | Filtro fuera del allowlist |
| `SORT_NOT_ALLOWED` | 400 | Orden fuera del allowlist |
| `INVALID_PAGINATION` | 400 | `page`/`limit` inválidos o `limit > maxLimit` |
| `SCHEMA_MISMATCH` | 422 | Endpoint referencia campos inexistentes en el dataset |
| `UPSTREAM_ERROR` | 502 | El origen respondió con error |
| `UPSTREAM_TIMEOUT` | 504 | Timeout descargando |

### 1.3 Paginación

Petición: `?page=<1..n>&limit=<1..maxLimit>`, ambos opcionales.

Respuesta:

```json
{
  "data": [ /* filas */ ],
  "meta": { "total": 12, "count": 12, "page": 1, "limit": 50, "pages": 1 }
}
```

`total` es el total **después de aplicar filtros**, antes de paginar.

### 1.4 Verbos

| Verbo | Uso |
|---|---|
| `POST /sources/:id/ingest` | Acción: dispara ingesta (no es CRUD puro). Idempotente en el sentido de que no pisa datos. |
| `POST /endpoints/:id/validate` | Acción: revalida el endpoint contra el schema del dataset. |
| `PATCH` | Actualización parcial. |
| `DELETE` | Borrado lógico (disable) salvo donde se dice hard-delete. |

---

## 2. Salud

### `GET /health`

```json
{ "status": "ok", "uptime": 1234, "database": { "status": "up", "ping": 3 } }
```

`503` si MongoDB no responde.

---

## 3. Sources

### `POST /api/v1/sources`

```json
{
  "name": "Escala Retención Ganancias 4ta Cat — jul-dic 2026",
  "type": "pdf",
  "description": "Publicación semestral de AFIP (Art. 94 LIG)",
  "config": {
    "url": "https://www.afip.gob.ar/gananciasYBienes/ganancias/personas-humanas-sucesiones-indivisas/declaracion-jurada/documentos/Tabla-Art-94-LIG-per-jul-a-dic-2026.pdf",
    "headerHints": ["Tramo", "Importe", "Alícuota", "Retención"]
  },
  "metadata": { "organismo": "AFIP", "vigencia": "2026-07-01/2026-12-31" }
}
```

- `201` con el source creado. `status` inicial = `pending`.
- `400 SOURCE_CONFIG_INVALID` si `config` no corresponde al `type`.
- **No** dispara la ingesta: ingesta y registro son pasos separados y explícitos.

### `GET /api/v1/sources`

Query: `type`, `status`, `page`, `limit`.

```json
{ "data": [ /* sources */ ], "meta": { "total": 3, "count": 3, "page": 1, "limit": 50, "pages": 1 } }
```

### `GET /api/v1/sources/:id`

Devuelve el source con `config` incluido.

### `PATCH /api/v1/sources/:id`

Actualiza `name`, `description`, `config`, `metadata`. **No** cambia `type` (eso alteraría la
semántica del `config`; para cambiarla, crear otra source).

### `POST /api/v1/sources/:id/ingest`

Dispara la ingesta. Respuesta `202 Accepted` (el trabajo ocurre en el request, pero el
contrato es asíncrono para no atar al cliente a la duración):

```json
{
  "sourceId": "66f0…",
  "datasetId": "66f1…",
  "version": 1,
  "rowCount": 12,
  "columnsCount": 5,
  "warnings": [],
  "meta": { "method": "pdfjs-text-coords", "durationMs": 1840, "sourceUrl": "https://…" }
}
```

- `409 INGEST_ALREADY_RUNNING` si hay una ingesta en curso.
- `404 SOURCE_NOT_FOUND`.
- Errores de ingesta según [`ingestion.md`](ingestion.md) §7 (`422`, `502`, `504`, `413`,
  `415`).

### `GET /api/v1/sources/:id/datasets`

Lista los datasets de esa source, versión descendente.

### `DELETE /api/v1/sources/:id`

Borrado **lógico**: deshabilita (`enabled = false`) los endpoints asociados y marca el source
con `status = error` y `lastError` explicando la dependencia. **No** borra datasets (ver
[`data-model.md`](data-model.md) §5). `204`.

---

## 4. Datasets

### `GET /api/v1/datasets`

Query: `sourceId`, `status`, `page`, `limit`. **No** incluye `rows` (son pesadas).

```json
{
  "data": [
    {
      "_id": "66f1…",
      "sourceId": "66f0…",
      "version": 1,
      "name": "Escala Retención Ganancias 4ta Cat — jul-dic 2026",
      "status": "published",
      "schema": [ /* ColumnSchema[] */ ],
      "rowCount": 12,
      "columnsCount": 5,
      "warnings": [],
      "meta": { "method": "pdfjs-text-coords", "pageCount": 1, "tableCount": 1 }
    }
  ],
  "meta": { "total": 1, "count": 1, "page": 1, "limit": 50, "pages": 1 }
}
```

### `GET /api/v1/datasets/:id`

Dataset completo **incluyendo `rows`**, con el body acotado por `PREVIEW_ROWS` (20) y un
`meta.previewTruncated: true` si había más filas. Para volcar todo: `?full=true` (sólo si
`rowCount ≤ INGEST_MAX_ROWS`).

### `GET /api/v1/datasets/:id/schema`

Sólo el `schema`, sin filas. Es lo que consume el front para construir filtros.

### `POST /api/v1/datasets/:id/publish`

`draft` → `published`, setea `publishedAt`. `200` con el dataset. `409` si ya está
`published` o `archived`.

### `POST /api/v1/datasets/:id/archive`

`published` → `archived`. Los endpoints que lo apuntan quedan con `422 SCHEMA_MISMATCH` al
consultar, salvo que usen `followLatest`.

### `DELETE /api/v1/datasets/:id`

Alias de `archive`. `204`.

---

## 5. Endpoints (definiciones)

### `POST /api/v1/endpoints`

```json
{
  "name": "Escala de Retención Ganancias 4ª Categoría",
  "slug": "escala-retencion-4ta-categoria",
  "description": "Tramos y alícuotas de retención, jul-dic 2026",
  "sourceId": "66f0…",
  "datasetId": "66f1…",
  "followLatest": false,
  "fields": ["tramo", "importe_desde", "importe_hasta", "alicuota", "retencion"],
  "filters": [
    { "field": "tramo", "op": "eq" },
    { "field": "importe_desde", "op": "gte" },
    { "field": "importe_hasta", "op": "lte" }
  ],
  "sort": [{ "field": "importe_desde", "dir": "asc" }],
  "defaultLimit": 50,
  "maxLimit": 500,
  "enabled": true
}
```

- `201` con la definición.
- `400 SLUG_INVALID` / `409 SLUG_TAKEN`.
- `422 SCHEMA_MISMATCH` si algún `field` de `filters`, `sort` o `fields` no existe en el
  schema del dataset resuelto. `details.unknownFields` dice dónde está cada referencia
  (`filters[1].field`).
- Si `followLatest: true`, `datasetId` es opcional y se usa el último `published`. Si es
  `false`, `datasetId` es obligatorio: omitirlo es `400 VALIDATION_ERROR`.
- `404 DATASET_NOT_FOUND` si el `datasetId` no existe, y `422 SCHEMA_MISMATCH` si pertenece a
  otra `sourceId` que la de la definición.
- `defaultLimit` y `maxLimit` se omiten para usar `DEFAULT_LIMIT` y `MAX_LIMIT`. Un
  `maxLimit` mayor que `MAX_LIMIT`, o un `defaultLimit` mayor que el `maxLimit`, es
  `400 VALIDATION_ERROR` con `details.ceiling`: el `ValidationPipe` no puede aplicar el tope
  porque sale de la configuración, así que lo valida el service.

### `GET /api/v1/endpoints`

Lista las definiciones (sin resolución de dataset). Query: `sourceId`, `enabled`, `page`,
`limit`.

### `GET /api/v1/endpoints/:id`

Detalle de la definición **con** un campo `resolved` que informa qué dataset usaría ahora:

```json
{
  "_id": "66f2…",
  "slug": "escala-retencion-4ta-categoria",
  "followLatest": true,
  "resolved": {
    "datasetId": "66f1…",
    "version": 1,
    "status": "published",
    "rowCount": 12
  },
  "createdAt": "2026-01-15T12:00:00.000Z"
}
```

Cuando no resuelve —el `datasetId` declarado ya no existe, o la `sourceId` todavía no tiene
ningún `published`— `resolved` es `null` y `resolvedReason` trae el motivo en texto. Nunca es
`404`: la definición existe y el panel tiene que poder mostrarla. `status` puede ser
`archived`; la definición se muestra igual porque el panel necesita ver contra qué apunta.

### `PATCH /api/v1/endpoints/:id`

Actualización parcial. Revalida contra el schema si cambian `fields`, `filters`, `sort`,
`datasetId` o `followLatest`. El `slug` no se puede cambiar: rompería las URLs ya publicadas,
y mandarlo es `400 VALIDATION_ERROR`. `200`.

### `POST /api/v1/endpoints/:id/validate`

Revalida contra el schema actual y devuelve el detalle:

```json
{
  "valid": false,
  "datasetId": "66f1…",
  "version": 1,
  "status": "published",
  "unknownFields": [
    { "where": "filters[1].field", "field": "importe_desde", "reason": "not in dataset schema" }
  ],
  "reason": null
}
```

`200` siempre (es un reporte, no un fallo). Útil tras cambiar el schema con una reingesta.
`valid` es `false` también cuando el dataset resuelto no se puede consultar: `status` y
`reason` dicen cuál de los dos casos es (`draft`, `archived`, sin dataset resuelto) y en ese
caso `unknownFields` viene vacío.

### `DELETE /api/v1/endpoints/:id`

`204`. Hard-delete de la definición (los datasets quedan intactos).

---

## 6. Endpoint dinámico

### `GET /api/v1/e/:slug`

Único punto de acceso a los datos publicados.

**Query params:**

| Param | Formato | Regla |
|---|---|---|
| `page` | entero ≥ 1 | default 1 |
| `limit` | entero ≥ 1 | default `defaultLimit`; ≤ `maxLimit`; si excede → `400 INVALID_PAGINATION` (no se clampa en silencio) |
| `sort` | `campo:asc` o `campo:desc`, múltiple por `sort=a:asc&sort=b:desc` | campos deben estar en `sort[]` |
| `<field>` | valor según el operador declarado en `filters[]` | campos fuera del allowlist → `400 FILTER_NOT_ALLOWED` |
| `fields` | lista CSV de columnas | override de la proyección; debe ser un **subconjunto** de `fields[]` |

La proyección por defecto es la que declara la definición en `fields[]`; si no la declara, son
todas las columnas del schema. `?fields=` la sobreescribe pero no la amplía: pedir una columna
fuera de `fields[]` es `400 FILTER_NOT_ALLOWED`.

**Semántica de operadores** (`filters[].op`):

| `op` | Query | Ejemplo | Match |
|---|---|---|---|
| `eq` | escalar | `?tramo=A` | igualdad estricta; una celda `null` nunca es igual a un valor |
| `ne` | escalar | `?tramo=B` | desigualdad; una celda `null` sí es distinta |
| `gt`/`gte`/`lt`/`lte` | número o fecha | `?importe_desde=50000` | comparación; el valor se castea al tipo del schema. Una celda `null` no satisface ninguna |
| `in` | CSV | `?tramo=A,B,C` | pertenencia |
| `contains` | texto | `?descripcion=abc` | substring, case-insensitive |
| `starts_with` | texto | `?descripcion=Pro` | prefijo, case-insensitive |
| `between` | `a,b` | `?importe_desde=100,500` | intervalo inclusive. `a > b` no matchea nada; no se normaliza el rango |

Si el filtro es `required: true` y no viene el param → `400` (`FILTER_NOT_ALLOWED` con
`details.field`). Cualquier otro parámetro no reconocido —incluido un typo en el nombre de un
filtro— también es `400 FILTER_NOT_ALLOWED` con `details.param`: nada se ignora en silencio.

**Respuesta `200`:**

```http
GET /api/v1/e/escala-retencion-4ta-categoria?importe_desde=50000&limit=10&sort=importe_desde:asc
```

```json
{
  "data": [
    { "tramo": "5", "importe_desde": 54785.28, "importe_hasta": 109570.56, "alicuota": 0.15, "retencion": 8217.79 }
  ],
  "meta": {
    "total": 6,
    "count": 6,
    "page": 1,
    "limit": 10,
    "pages": 1,
    "dataset": { "id": "66f1…", "version": 1, "sourceId": "66f0…", "updatedAt": "2026-01-15T12:00:00.000Z" }
  }
}
```

`meta.dataset` es lo que permite al consumidor saber **qué versión** está leyendo.

**Errores:**

| Situación | HTTP | `code` |
|---|---|---|
| Slug inexistente o `enabled: false` | 404 | `SLUG_NOT_FOUND` |
| Dataset resuelto inexistente / archivado / en `draft` | 422 | `SCHEMA_MISMATCH` |
| La definición referencia una columna que el dataset no tiene | 422 | `SCHEMA_MISMATCH` |
| Campo de filtro no permitido | 400 | `FILTER_NOT_ALLOWED` |
| Parámetro de query no reconocido | 400 | `FILTER_NOT_ALLOWED` |
| `fields` fuera de la proyección permitida | 400 | `FILTER_NOT_ALLOWED` |
| `limit > maxLimit` o `< 1` | 400 | `INVALID_PAGINATION` |
| `sort` por campo no permitido | 400 | `SORT_NOT_ALLOWED` |
| Filtro `required` ausente | 400 | `FILTER_NOT_ALLOWED` |
| Valor no casteable al tipo del schema | 400 | `VALIDATION_ERROR` |

Un `draft` da el mismo `422` que un `archived` —con `details.status` para distinguirlos— porque
el slug existe y está habilitado: lo que falta es la publicación, que es un paso deliberado
del flujo, no una avería. Sólo se sirven datasets `published`.

Lo mismo pasa si una reingesta le quitó al dataset una columna que la definición declara en
`fields[]`, `filters[]` o `sort[]`: es `422 SCHEMA_MISMATCH` con
`details.unknownFields`, no un filtro descartado. El allowlist y el schema son listas
distintas —`filters[]` decide *qué se puede filtrar*, el schema decide *sobre qué datos*— y
declarar una columna que no existe es un error de configuración de la definición, no del
cliente. `POST /endpoints/:id/validate` es la vía para detectarlo y corregirlo.

**Headers de cache:** `ETag` derivado de `datasetId + version + query` canónico (las claves
ordenadas, así que `?a=1&b=2` y `?b=2&a=1` dan el mismo `ETag`). Permite `If-None-Match` →
`304` sin body.

---

## 7. OpenAPI

Swagger en `GET /docs` (JSON en `/docs-json`). El endpoint dinámico `GET /e/:slug` se
documenta con un ejemplo genérico, ya que su forma depende del dataset: cada
`EndpointDefinition` incluye en su descripción el ejemplo de un `GET /e/{slug}` con su
respuesta real.

---

## 8. Ejemplo end-to-end

```text
1) POST /api/v1/sources
   { name, type: "pdf", config: { url: <AFIP pdf>, headerHints: [...] } }
   → 201 { _id: "66f0…" }

2) POST /api/v1/sources/66f0…/ingest
   → 202 { datasetId: "66f1…", version: 1, rowCount: 12, warnings: [] }

3) POST /api/v1/datasets/66f1…/publish
   → 200

4) POST /api/v1/endpoints
   { name, slug: "escala-retencion-4ta-categoria", sourceId: "66f0…", followLatest: true, … }
   → 201

5) GET /api/v1/e/escala-retencion-4ta-categoria?importe_desde=50000&limit=10
   → 200 { data: [...], meta: { total, count, page, limit, pages, dataset } }
```