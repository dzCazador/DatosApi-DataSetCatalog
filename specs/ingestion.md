# Ingesta — DatosApi

> Documento **NORMATIVO**. Estrategias, parsing, normalización y control de errores.

---

## 1. Principio

Una ingesta es una **transformación determinista y auditable**:

```text
config → bytes → filas crudas → filas normalizadas + schema + warnings → Dataset
```

Cada paso es explícito. Lo que no se puede determinar con certeza **no se inventa**: se deja
`null` y se registra un `warning`.

---

## 2. Concurrencia y versionado

Dos ingesta simultáneas sobre la misma `source` producirían `version` duplicada. Estrategia:

1. `POST /sources/:id/ingest` pone `Source.status = processing` **conCompare-and-swap**: el
   update sólo aplica si `status !== processing`. Si ya lo está → `409 Conflict`.
2. Se calcula `version = (última del source) + 1`.
3. El índice único `{ sourceId, version }` es la **garantía final**: si dos procesos pasan el
   CAS, uno falla al insertar con `E11000` y devuelve `409`.
4. En `finally`, `Source.status` vuelve a `ready` o `error`.

**Idempotencia:** reingerar la misma source **no** pisa el dataset anterior. Crea `version + 1`.
Es seguro reintentar un `POST /ingest` fallido.

---

## 3. Contrato de las strategies

```ts
interface IngestStrategy {
  readonly type: SourceType;
  validateConfig(config: SourceConfig): void;   // lanza BadRequest si no corresponde
  ingest(config: SourceConfig, ctx: IngestContext): Promise<IngestResult>;
}

interface IngestContext {
  now: Date;
  storageDir: string;
  sourceId: string;   // atribuye el binario persistido por §4.4
  limits: { timeoutMs: number; maxBytes: number; maxRows: number };
}

interface IngestResult {
  rows: Row[];
  schema: ColumnSchema[];
  meta: ExtractionMeta;
  warnings: string[];
}

class IngestorFactory {
  static resolve(type: SourceType): IngestStrategy;
}
```

`IngestorFactory.resolve` lanza `BadRequest` si el `type` no tiene strategy registrada.

---

## 4. Strategies

### 4.1 `manual` — carga manual

```ts
{ format: 'json' | 'csv', payload: string, delimiter?: string, hasHeaderRow?: boolean }
```

- **`json`**: `JSON.parse`. Acepta array plano (`[{...}]`) u objeto con una clave que
  contenga un array. Si es un objeto único → una fila. Si viene anidado, se aplana con
  `a.b` como clave (ver §6.4).
- **`csv`**: `csv-parse/sync` con `delimiter`, `bom: true`, `columns: hasHeaderRow` o
  `relax_column_count: true` para CSVs con filas de distinto largo.

Sin red. `meta.method = 'manual-json' | 'csv-parse'`.

**Casos de uso:** pegar una tabla de una web, corregir a mano una fila mal extraída, cargar un
JSON propio.

### 4.2 `api` — API externa

```ts
{ url: string, method: 'GET' | 'POST', body?: unknown, jsonPath?: string, requestHeaders?: Record<string,string> }
```

1. `fetch` con `AbortSignal.timeout(INGEST_TIMEOUT_MS)`, `method`, `headers`, y `body` sólo si
   es `POST` (`JSON.stringify` + `content-type: application/json`).
2. Validar `res.ok`; si no, lanzar con el status y los primeros 200 chars del body.
3. Verificar `content-type` incluye `json`; si no, intentar `JSON.parse` del texto y si falla,
   `422` explicando el problema.
4. Resolver `jsonPath` con evaluación de path **segmento por segmento** (nunca `eval`):
   `"data.resultados"` → `body.data.resultados`.
5. Si el resultado no es array → `422`.

`meta.method = 'api-json'`, `meta.sourceUrl = url`.

### 4.3 `url` — descarga con despacho por content-type

```ts
{ url: string, requestHeaders?: Record<string,string>, contentTypeHint?: string }
```

1. Descargar con timeout y **límite de tamaño**: acumular chunks y cortar en
   `INGEST_MAX_BYTES` con `413 Payload Too Large`.
2. Determinar tipo por `content-type` (o `contentTypeHint`, o extensión de la URL):
   - `application/pdf` → delegar en la lógica de `pdf.strategy`.
   - `json`, `text/json` → misma normalización que `api`.
   - `text/csv` → misma normalización que `manual/csv`.
   - `text/plain` → intentar CSV; si no, `422`.
   - otro → `415 Unsupported Media Type` con el content-type recibido.

`meta.method = 'url-pdf' | 'url-json' | 'url-csv'`.

### 4.4 `pdf` — extracción de tablas

```ts
{ url: string, pages?: number[], tableIndex?: number, headerHints?: string[] }
```

**Por qué `pdfjs-dist`.** Un PDF no tiene "tablas": tiene fragmentos de texto con posición.
Para recomponer la tabla hay que agrupar por coordenada Y (filas) y separar por coordenada X
(columnas). `pdfjs-dist` expone esa información; `pdf-parse` no.

#### Algoritmo

```text
1. Descargar el PDF (timeout + límite de tamaño).
2. pdfjs.getDocument({ data }) → page.getTextContent()
3. Por cada página (o las de `pages`):
   a. Por cada item de texto → { str, x, y, width, height }
   b. Calcular y redondear la línea: agrupar items cuyo |y − yItem| ≤ tolerancia (0.5 * lineHeight)
   c. Ordenar los items de la línea por x
   d. Calcular columnas: agglomerar los gaps horizontales entre items consecutivos
      (gap > umbral ⇒ nuevo separador de columna). Usar mediana de gaps para el umbral.
4. Descartar páginas sin ≥ 2 columnas (portada, encabezado institucional).
5. Identificar la fila de encabezado:
   - la fila cuyos items son en su mayoría NO numéricos, y
   - tiene ≥ 2 columnas no vacías, y
   - (si hay `headerHints`) alguna celda contiene alguno de los hints
6. A partir del encabezado, cada fila posterior con el mismo nº de columnas es una fila de datos.
7. Descartar filas: totalmente vacías, sólo con separadores/puntos, o que sean un pie de página
   (heurística: tipografía menor o texto conocido).
8. Si ninguna fila parece encabezado → warning 'no-header-detected' y claves genéricas col_1..col_n.
```

**Claves de columna.** Del encabezado: minúsculas, sin tildes, snake_case. Desambiguar
duplicados con sufijo (`monto`, `monto_2`). Si no hay encabezado: `col_1`, `col_2`, …

**Normalización numérica (es-CR).** `"1.234,56"` → `1234.56`; `"12%"` → `0.12`;
`"$ 1.000"` → `1000`. Regla: si hay coma **y** punto, el último separador es el decimal; si
sólo hay coma y está al final con 1–2 dígitos, es decimal; si sólo hay punto con exactamente
3 dígitos tras el punto y hay otro separador de miles, es miles. Ante ambigüedad real
(`"1.234"`), se registra `warning: ambiguous-number '1.234'` y se deja `string`.

**Filas con nº de columnas distinto.** Se rellenan con `null` hasta completar y se emite
`warning: row {n} had {m} cells, expected {k}`.

`meta.method = 'pdfjs-text-coords'`, con `pageCount`, `tableCount`, `rawRowCount`.

**Guardado del binario.** El PDF descargado se persiste en `STORAGE_DIR/<sourceId>/<timestamp>.pdf`
para trazabilidad. **Nunca** se commitea al repo; `storage/` está en `.gitignore`.

**Columnas por proyección.** Las columnas se detectan proyectando los fragmentos sobre el eje X
y agrupando las regiones contiguas cubiertas, no comparando bordes izquierdos: las columnas
numéricas suelen estar alineadas a la derecha, así que dos valores de la misma columna pueden
empezar lejos y aun así solaparse, mientras que valores de columnas vecinas nunca solapan.

**Encabezado de varias líneas.** El encabezado de una tabla real no suele ser una sola línea, y
el de AFIP son cinco. Se lee como un bloque hacia arriba desde la primera fila de datos,
mientras las líneas sean mayoritariamente no numéricas y estén a distancia de tabla; cada
columna se nombra con todos los fragmentos que caen en ella, de arriba hacia abajo. Un rótulo
que abarca varias columnas se asigna a todas las que toca y el desambiguado de duplicados las
distingue (`..._2`), en lugar de dejar esas columnas como `col_N`.

---

## 5. Fusión de estrategias

`url` y `pdf` comparten la lógica de extracción tabular. Se implementa como un módulo interno
`pdfTableExtractor` reutilizado por ambas strategies, no como código duplicado.

Lo mismo con la normalización JSON/CSV: un módulo `tabularNormalizer` que recibe
`{ headers, rows }` y devuelve `{ rows, schema, warnings }`. Todas las strategies pasan por
ahí, lo que garantiza que el `schema` se calcula **de la misma forma** para todos los orígenes.

---

## 6. Normalización (común a todas las strategies)

### 6.1 Encabezados → claves

```
"Importe Desde ($)"  →  "importe_desde"
"Alícuota %"         →  "alicuota"
"Tramo  "           →  "tramo"
"Monto / Total"     →  "monto_total"
"Columna 1"         →  "columna_1"
```

1. `trim`, colapsar espacios, quitar tildes (`NFKD` + strip diacritics).
2. Sustituir cualquier secuencia no alfanumérica por `_`.
3. Colapsar `_` repetidos, quitar `_` del inicio/fin.
4. Si queda vacío → `col_N`.
5. Prefijar con `col_` si empieza con dígito.
6. Desambiguar duplicados con sufijo numérico.

### 6.2 Valores

| Entrada | Salida |
|---|---|
| `""`, `"-"`, `"—"`, `"N/A"`, `"null"` | `null` |
| `"1.234,56"` | `1234.56` (number) |
| `"35%"` | `0.35` (number) |
| `"2026-07-01"` | `Date` (date) |
| `"true"` / `"sí"` / `"SI"` | `true` (boolean) |
| texto con espacios múltiples | texto con espacios colapsados |

### 6.3 Nulos

`null` sólo para **celdas realmente ausentes o marcadores de vacío**. Un `"0"` es `0`, no
`null`. Un texto `"No"` en una columna de texto es `"No"`, no `false`.

### 6.4 Aplanado de JSON anidado

```json
{ "tramo": { "desde": 0, "hasta": 8334 }, "alicuota": 0.35 }
```
→
```json
{ "tramo_desde": 0, "tramo_hasta": 8334, "alicuota": 0.35 }
```

Arrays de objetos dentro de una celda se conservan como `json` (tipo `json` en el schema). No
se expanden a filas.

### 6.5 Detección de tipos

Ver [`data-model.md`](data-model.md) §6. Regla de degradación: tipo mezclado → `string` +
`warning`.

---

## 7. Errores

| Situación | HTTP | `Source.status` | `lastError` |
|---|---|---|---|
| `config` no corresponde al `type` | `400` | `pending` (no se toca) | — |
| Ingesta ya en curso | `409` | `processing` | — |
| Descarga: timeout | `504` | `error` | `timeout after 30000ms` |
| Descarga: `403`/`404` del origen | `502` | `error` | `upstream responded 404` |
| Descarga: excede `INGEST_MAX_BYTES` | `413` | `error` | `payload exceeds 10485760 bytes` |
| Content-type no soportado | `415` | `error` | `unsupported content-type: text/html` |
| JSON inválido | `422` | `error` | `unexpected token } at position 412` |
| PDF sin tabla reconocible | `422` | `error` | `no tabular region detected` |
| `rowCount > INGEST_MAX_ROWS` | `422` | `error` | `extracted 120000 rows, limit 50000` |
| Índice duplicado `{sourceId, version}` | `409` | `error` | `version conflict` |
| Origen inexistente | `404` | — | — |

**Regla:** un `422` significa "los datos de origen no se pudieron interpretar"; un `502`/`504`
significa "el origen no respondió". No se confunden: son diagnósticos distintos para el usuario.

---

## 8. Observabilidad

Cada ingesta deja en `ExtractionMeta`:

- `sourceUrl`, `fetchedAt`, `contentType`, `bytes`, `durationMs`.
- `method`, `pageCount`, `tableCount`, `rawRowCount`.

Combinado con `warnings[]`, responde: **de dónde salió, cuándo, cómo se procesó y qué dudas
hubo**. Sin esto, un dataset publicado es indistinguible de uno parseado mal.

---

## 9. Casos de referencia

### 9.1 Escala de retención AFIP (Art. 94 LIG)

```http
POST /api/v1/sources
{
  "name": "Escala Retención Ganancias 4ta Cat — jul-dic 2026",
  "type": "pdf",
  "config": {
    "url": "https://www.afip.gob.ar/gananciasYBienes/ganancias/personas-humanas-sucesiones-indivisas/declaracion-jurada/documentos/Tabla-Art-94-LIG-per-jul-a-dic-2026.pdf",
    "headerHints": ["Tramo", "Importe", "Alícuota", "Retención"]
  }
}
```

Luego `POST /api/v1/sources/:id/ingest` y, con el `datasetId` devuelto,
`POST /api/v1/endpoints` con `followLatest: true`.

Resultado esperado: un dataset de ~12 filas con `schema` de 5 columnas numéricas
(`tramo`, `importe_desde`, `importe_hasta`, `alicuota`, `retencion`) y `warnings: []`.
Si `warnings` trae `no-header-detected`, el parser **no encontró la tabla**: eso es un bug de
la fase 05, no un dato válido.

### 9.2 API JSON externa

```http
POST /api/v1/sources
{
  "name": "Dolar oficial BCRA",
  "type": "api",
  "config": {
    "url": "https://api.example.com/dolar",
    "method": "GET",
    "jsonPath": "data.quotas"
  }
}
```

### 9.3 Carga manual

```http
POST /api/v1/sources
{
  "name": "Listado interno — prueba",
  "type": "manual",
  "config": {
    "format": "csv",
    "hasHeaderRow": true,
    "payload": "codigo,descripcion,activo\nA01,Producto A,true\nB02,Producto B,false"
  }
}
```