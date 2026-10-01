# Modelo de datos — DatosApi (MongoDB)

> Documento **NORMATIVO**. Colecciones, campos, índices y reglas de evolución.

---

## 1. Convenciones

- Las colecciones van en **snake_case plural**: `sources`, `datasets`, `endpoint_definitions`.
- Los campos de documento van en **camelCase** (convención Mongoose/TS).
- Las **claves de columna** dentro de `rows` van en **snake_case** (`importe_desde`), porque
  son la superficie pública del endpoint y NO deben cambiar si se renombra un campo interno.
- Todas las fechas se guardan como **`Date`** en UTC. Los campos de vigencia son
  **date-only** y se representan como `YYYY-MM-DD` en la API.
- Todo documento lleva `createdAt` / `updatedAt` (`timestamps: true`).
- Los importes y porcentajes son **números** (no strings). La normalización ocurre en la
  ingesta, nunca en la lectura.

---

## 2. `sources`

Una fuente = un origen de datos declarable por el usuario.

```ts
enum SourceType {
  MANUAL = 'manual',
  API = 'api',
  URL = 'url',
  PDF = 'pdf',
}

enum SourceStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error',
}

interface SourceDoc {
  _id: ObjectId;
  name: string;                    // "Escala Retención Ganancias 4ta Cat — Jul-Dic 2026"
  type: SourceType;                // determina la strategy de ingesta
  description?: string;
  config: SourceConfig;            // union discriminada por `type`
  status: SourceStatus;
  lastIngestAt?: Date;
  lastError?: string;
  lastDatasetId?: ObjectId;        // atajo al último dataset producido
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
```

### 2.1 `SourceConfig` (union discriminada por `type`)

```ts
interface BaseSourceConfig {
  requestHeaders?: Record<string, string>;
}

interface ManualSourceConfig extends BaseSourceConfig {
  format: 'json' | 'csv';
  payload: string;                 // JSON array u objeto, o texto CSV completo
  delimiter?: string;              // default ',' para csv
  hasHeaderRow?: boolean;          // default true
}

interface ApiSourceConfig extends BaseSourceConfig {
  url: string;
  method: 'GET' | 'POST';
  body?: unknown;
  jsonPath?: string;               // ej. "data.resultados"; default "raíz"
}

interface UrlSourceConfig extends BaseSourceConfig {
  url: string;                     // PDF, CSV, JSON o TXT
  contentTypeHint?: string;        // override si el server no manda content-type correcto
}

interface PdfSourceConfig extends BaseSourceConfig {
  url: string;                     // PDF descargable en runtime
  pages?: number[];                // 0-indexado; default todas
  tableIndex?: number;             // qué tabla tomar; default la primera "útil"
  headerHints?: string[];          // keywords para identificar la fila de encabezado
}

type SourceConfig =
  | ManualSourceConfig
  | ApiSourceConfig
  | UrlSourceConfig
  | PdfSourceConfig;
```

**Regla:** `config` se valida en la ingesta según `type`. Un `ManualSourceConfig` con `url`
es inválido y debe rechazarse con `400`.

### 2.2 Índices

```ts
{ name: 1 }                       // no único: se permiten nombres repetidos
{ type: 1, status: 1 }
{ createdAt: -1 }
```

---

## 3. `datasets`

Un dataset = una **versión inmutable** de datos normalizados.

```ts
enum DatasetStatus {
  DRAFT = 'draft',                 // parsing terminado, pendiente de revisión
  PUBLISHED = 'published',         // visible para endpoints
  ARCHIVED = 'archived',           // fuera de circulación, se conserva
}

interface ColumnSchema {
  key: string;                     // snake_case, único dentro del dataset
  label: string;                   // encabezado original, preservado
  type: ColumnType;                // 'string' | 'number' | 'boolean' | 'date' | 'json'
  nullable: boolean;
  decimalScale?: number;           // 2 para montos, 4 para alícuotas
  source?: string;                 // 'pdf' | 'api' | 'manual' | 'derived'
}

type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'json';

type Row = Record<string, string | number | boolean | null>;

interface ExtractionMeta {
  method: string;                  // 'pdfjs-text-coords' | 'csv-parse' | 'json-flatten' | ...
  pageCount?: number;
  tableCount?: number;
  rawRowCount: number;             // filas antes de limpiar
  sourceUrl?: string;
  fetchedAt?: Date;
  contentType?: string;
  bytes?: number;
  durationMs?: number;
}

interface DatasetDoc {
  _id: ObjectId;
  sourceId: ObjectId;
  version: number;                 // 1, 2, 3... estrictamente incremental por source
  name: string;
  status: DatasetStatus;
  schema: ColumnSchema[];
  rows: Row[];
  rowCount: number;                // == rows.length (desnormalizado para leer sin $size)
  columnsCount: number;            // == schema.length
  warnings: string[];              // extracción dudosa; nunca vacío sin justificación
  meta: ExtractionMeta;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### 3.1 Reglas de integridad

1. **`version` es único por `sourceId`.** Ingesta concurrente sobre la misma source se
   serializa (ver [`ingestion.md`](ingestion.md) §2).
2. **`rows` embebido** en el MVP. Si `rowCount > INGEST_MAX_ROWS` la ingesta **falla** con
   `422` en lugar de truncar silenciosamente.
3. **`rowCount` y `columnsCount`** siempre consistentes con `rows` y `schema`. Se calculan en
   la ingesta, nunca se aceptan del cliente.
4. **Un dataset `published` no se muta.** Para corregir datos: nueva ingesta → nueva versión.
   Para retirar: `status = archived`.
5. **Toda columna de `schema` existe en todas las filas** (con `null` si falta). Nunca claves
   fantasma sólo en algunas filas: el endpoint dinámico asume esquema uniforme.
6. **`warnings` obligatorio.** Si el parser tuvo dudas (columnas sin encabezado, filas con
   nº de columnas distinto al esperado, amounts no parseables), deja el motivo.

### 3.2 Índices

```ts
{ sourceId: 1, version: -1 }      // único compuesto: garantiza unicidad de versión
{ status: 1, sourceId: 1, version: -1 }   // resuelve "última publicada" (followLatest)
{ createdAt: -1 }
{ rowCount: -1 }
```

### 3.3 Transición a `dataset_rows` (fuera del MVP)

Si `rowCount` supera ~100k, migrar a una colección `dataset_rows` con
`{ datasetId, index, ...Row }` e índice `{ datasetId: 1, index: 1 }`. El contrato HTTP no
cambia. La interfaz del repositorio de datasets debe permitir hacerlo sin tocar los services.

---

## 4. `endpoint_definitions`

Un endpoint = la publicación de un dataset con reglas de consulta.

```ts
enum FilterOperator {
  EQ = 'eq',
  NE = 'ne',
  GT = 'gt',
  GTE = 'gte',
  LT = 'lt',
  LTE = 'lte',
  IN = 'in',
  CONTAINS = 'contains',
  STARTS_WITH = 'starts_with',
  BETWEEN = 'between',
}

interface FilterDef {
  field: string;                   // debe existir en el schema del dataset
  op: FilterOperator;
  required?: boolean;              // si true, sin valor -> 400
}

interface SortDef {
  field: string;
  dir: 'asc' | 'desc';
}

interface EndpointDefinitionDoc {
  _id: ObjectId;
  name: string;                    // "Escala de Retención Ganancias 4ª Categoría"
  slug: string;                    // "escala-retencion-4ta-categoria"
  description?: string;
  sourceId: ObjectId;              // permite resolver followLatest
  datasetId?: ObjectId;            // presente si es pinneado
  followLatest: boolean;           // si true ignora datasetId y usa el último published
  fields?: string[];               // columnas expuestas; vacío/ausente = todas
  filters: FilterDef[];            // allowlist; vacío = sin filtros
  sort: SortDef[];                 // allowlist de orden
  defaultLimit: number;            // default 50
  maxLimit: number;                // default 500
  enabled: boolean;                // default true
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
```

### 4.1 Reglas de integridad

1. **`slug` es único y URL-safe**: `^[a-z0-9]+(?:-[a-z0-9]+)*$`, longitud 3–80.
2. **`sourceId` es obligatorio** aunque el endpoint sea pinneado: permite validar que los
   filtros pertenezcan al esquema real y habilita `followLatest` a futuro.
3. **Toda `field` de `filters[]` y `sort[]` debe existir en el `schema` del dataset
   resuelto.** Se valida al crear/actualizar el endpoint; si el schema cambia, el endpoint
   queda marcado para revisión (fase 06 agrega la verificación).
4. **`fields[]` ⊆ `schema[].key`.** Proyectar campos inexistentes es un error de
   configuración, no un `404`.
5. **`0 < defaultLimit ≤ maxLimit ≤ MAX_LIMIT` (env).**
6. **No se puede editar `rows` ni `schema` desde el endpoint API.** El endpoint publica; los
   datos se cambian reingeriendo.
7. **`followLatest = true` sin `datasetId`** ⇒ el dataset se resuelve en cada request.

### 4.2 Índices

```ts
{ slug: 1 }                       // ÚNICO
{ sourceId: 1 }
{ enabled: 1 }
{ createdAt: -1 }
```

---

## 5. Relaciones

```text
sources (1) ──────< (N) datasets (1) ──────< (N) endpoint_definitions
   │                        │
   │                        └── latest published (followLatest)
   └── lastDatasetId (atajo, desnormalizado, reconstruible)
```

- **Borrado de source** ⇒ datasets y endpoints quedan `orphaned` hasta que se purguen
  (post-MVP). El MVP **no** borra en cascada; expone `DELETE /sources/:id` que marca
  `enabled = false` en sus endpoints y deja el source con `status = error` + `lastError`
  explicando la dependencia. Decisión deliberada: borrar datos publicados es riesgoso y en el
  MVP no hay quien lo pida.

---

## 6. Cálculo de `schema`

La inferencia ocurre **en la ingesta**, nunca en la lectura:

1. **Normalizar encabezados** → `key` snake_case + desambiguar duplicados (`monto`,
   `monto_2`).
2. **Detectar tipo por columna** recorriendo todas las filas:
   - todos numéricos → `number` (+ `decimalScale` del máximo de decimales vistos)
   - mayoría `YYYY-MM-DD` o ISO → `date`
   - `true`/`false`/`sí`/`no` → `boolean`
   - objetos/arrays anidados → `json`
   - resto → `string`
3. **`nullable = true`** si alguna fila tiene `null`, `''` o celda ausente.
4. **`label`** = encabezado original, para que la UI pueda mostrarlo sin adivinar.

Si una columna tiene tipos mezclados (números y texto), se degrada a `string` y se emite un
`warning`: es preferible devolver texto a devolver números equivocados.

---

## 7. Ejemplo: dataset de la escala de retención (AFIP Art. 94)

```json
{
  "sourceId": "66f0…",
  "version": 1,
  "name": "Escala Retención Ganancias 4ta Cat — jul-dic 2026",
  "status": "published",
  "schema": [
    { "key": "tramo",           "label": "Tramo",           "type": "string", "nullable": false, "source": "pdf" },
    { "key": "importe_desde",   "label": "Importe desde",   "type": "number", "nullable": false, "decimalScale": 2, "source": "pdf" },
    { "key": "importe_hasta",   "label": "Importe hasta",   "type": "number", "nullable": false, "decimalScale": 2, "source": "pdf" },
    { "key": "alicuota",        "label": "Alícuota",        "type": "number", "nullable": false, "decimalScale": 4, "source": "pdf" },
    { "key": "retencion",       "label": "Retención",       "type": "number", "nullable": false, "decimalScale": 2, "source": "pdf" }
  ],
  "rowCount": 12,
  "warnings": [],
  "meta": {
    "method": "pdfjs-text-coords",
    "pageCount": 1,
    "tableCount": 1,
    "rawRowCount": 14,
    "sourceUrl": "https://www.afip.gob.ar/…/Tabla-Art-94-LIG-per-jul-a-dic-2026.pdf",
    "fetchedAt": "2026-01-15T12:00:00.000Z",
    "contentType": "application/pdf",
    "durationMs": 1840
  }
}
```

Endpoint asociado:

```json
{
  "name": "Escala de Retención Ganancias 4ª Categoría",
  "slug": "escala-retencion-4ta-categoria",
  "sourceId": "66f0…",
  "followLatest": true,
  "fields": ["tramo", "importe_desde", "importe_hasta", "alicuota", "retencion"],
  "filters": [
    { "field": "tramo", "op": FilterOperator.EQ },
    { "field": "importe_desde", "op": FilterOperator.GTE },
    { "field": "importe_hasta", "op": FilterOperator.LTE }
  ],
  "sort": [{ "field": "importe_desde", "dir": "asc" }],
  "defaultLimit": 50,
  "maxLimit": 500,
  "enabled": true
}
```

Consulta resultante:

```http
GET /api/v1/e/escala-retencion-4ta-categoria?importe_desde=50000&limit=10&sort=importe_desde:asc
```