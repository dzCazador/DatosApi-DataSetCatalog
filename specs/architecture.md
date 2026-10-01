# Arquitectura — DatosApi

> Documento **NORMATIVO**. Define el qué y el cómo macro del sistema.

---

## 1. Visión del sistema

DatosApi resuelve un problema concreto: hay datos publicados por terceros (AFIP, INDEC,
bancos, organismos) en formatos que no son consumibles programáticamente (PDF, planillas,
HTML), y cada consumidor los vuelve a scrapear o copiar a mano.

El sistema **ingerir**, **normaliza**, **versiona** y **publica** esos datos como endpoints
REST propios, definidos por configuración.

---

## 2. Decisión de diseño central

El dominio se modela como **tres entidades encadenadas**:

```text
Source  ──1:N──▶  Dataset  ──1:N──▶  EndpointDefinition
(origen)         (versión inmutable)  (endpoint publicado)
```

| Entidad | Responde a |
|---|---|
| `Source` | ¿De dónde vienen los datos y en qué estado está esa ingesta? |
| `Dataset` | ¿Qué datos tengo, con qué esquema y qué tan confiable es la extracción? |
| `EndpointDefinition` | ¿Cómo los expongo al mundo (slug, campos, filtros, orden)? |

**Por qué esta separación:**

- Reingerir una fuente no destruye nada: crea una versión nueva del dataset.
- Un mismo dataset puede servirse en **varios endpoints** con filtros distintos.
- Un endpoint puede apuntar a una versión **concreta** (pinneado) o seguir "la última
  publicada" (ver §7).
- Agregar endpoints, cambiar filtros o republicar es **operación de datos**, no de código.

---

## 3. Estructura del monorepo

```text
DatosApi/
├─ apps/
│  └─ api/                    # NestJS 11 — única app del MVP
│     ├─ src/
│     │  ├─ main.ts           # bootstrap + ValidationPipe global
│     │  ├─ app.module.ts
│     │  ├─ config/           # configuración por entorno + Joi
│     │  ├─ health/           # health check
│     │  ├─ sources/          # módulo sources
│     │  ├─ ingestion/        # motor de ingesta (strategies)
│     │  │  ├─ strategies/
│     │  │  │  ├─ manual.strategy.ts
│     │  │  │  ├─ api.strategy.ts
│     │  │  │  ├─ url.strategy.ts
│     │  │  │  └─ pdf.strategy.ts
│     │  │  ├─ ingestor.factory.ts
│     │  │  └─ parser/        # normalización compartida
│     │  ├─ datasets/         # módulo datasets + repos
│     │  ├─ endpoints/        # módulo endpoints (CRUD)
│     │  └─ dynamic/          # controller genérico /e/:slug
│     └─ test/
├─ packages/
│  ├─ common/                 # enums, tipos, DTOs, utils (sin deps pesadas)
│  └─ database/               # conexión Mongoose + esquemas + repos base
├─ specs/
├─ storage/                   # descargas runtime (gitignored)
├─ docker-compose.yml
├─ pnpm-workspace.yaml
├─ turbo.json
└─ package.json
```

> **Por qué `packages/`?** `common` y `database` son compartidos y no deben depender de la
> capa HTTP. El MVP tiene una sola app, pero separar desde el inicio evita reescritura
> cuando se agregue un worker o un front.

---

## 4. Capas

| Capa | Ubicación | Responsabilidad |
|---|---|---|
| **Presentation** | `apps/api/src/*/**.controller.ts` | HTTP: validar DTO, delegar, serializar. Cero lógica de negocio. |
| **Application** | `*.service.ts` | Casos de uso: crear source, ingerir, publicar, consultar. |
| **Domain** | `packages/common/src/**` | Tipos, enums, contratos de las strategies. Sin infraestructura. |
| **Infrastructure** | `database/`, `ingestion/strategies/` | Mongoose, HTTP saliente, parsing de PDF/CSV/JSON. |

Regla de dependencia: **presentation → application → domain**. La infrastructure se inyecta
en application; domain no importa nada.

---

## 5. Patrones

### 5.1 Strategy + Factory (ingesta)

Cada tipo de `Source` tiene una strategy que sabe transformarla en filas normalizadas.

```ts
interface IngestStrategy {
  readonly type: SourceType;
  canHandle(config: SourceConfig): boolean;
  ingest(config: SourceConfig, ctx: IngestContext): Promise<IngestResult>;
}

interface IngestResult {
  rows: Row[];
  schema: ColumnSchema[];
  meta: ExtractionMeta;
  warnings: string[];
}
```

`IngestorFactory.resolve(sourceType)` devuelve la strategy correspondiente. Agregar un
origen nuevo (HTML, XLSX, Google Sheets) es **una strategy nueva + un caso en el factory**,
sin tocar el resto.

`SourceConfig` es un **union discriminada** por `SourceType`: cada strategy valida y estrecha
su propia variante. Nunca `Record<string, unknown>` en la frontera.

### 5.2 Repository (persistencia)

`MongooseModule.forRoot` una única vez. Los repos encapsulan queries de Mongoose y exponen
métodos de dominio. Los services no conocen la API de Mongoose.

### 5.3 Routing dinámico

Un solo controller (`DynamicController`) atiende `GET /e/:slug`. Resuelve el
`EndpointDefinition` por slug y ejecuta la consulta sobre el `Dataset`. **No se generan rutas
en runtime ni se usa un router dinámico**: una ruta estática y estable es más simple de
documentar, cachear y proteger.

---

## 6. Flujo de ingesta (end-to-end)

```text
1. POST /sources            → crea Source (status=pending)
2. POST /sources/:id/ingest → status=processing
3. Factory.resolve(type)    → strategy.ingest(config)
      ├─ descarga (fetch, timeout, user-agent, content-type)
      ├─ parseo (pdf | json | csv | text)
      ├─ normalización (headers → snake_case, tipos, números, vacíos)
      └─ inferencia de schema
4. DatasetsService.createVersion() → Dataset { version: n+1, rows, schema, meta }
5. Source.status = ready | error (+ error message)
6. (opcional) POST /endpoints → EndpointDefinition apuntando al dataset
```

**Idempotencia:** reingerir la misma fuente **no** pisa el dataset anterior; crea
`version + 1`. Esto hace la ingesta segura de reintentar.

**Errores:** cualquier fallo deja `Source.status = error` con `lastError` y **no** crea un
dataset a medio construir. Un dataset jamás se persiste con `status != published` y filas
incompletas sin advertencia explícita.

---

## 7. Versionado y publicación

Dos modos de vincular un endpoint a un dataset:

| Modo | Campo | Comportamiento |
|---|---|---|
| **Pinneado** | `datasetId` fijo | El endpoint sirve siempre esa versión. Ideal para reproducibilidad. |
| **Seguimiento** | `followLatest = true` | El endpoint resuelve el último dataset `published` del `sourceId`. Ideal para tablas que se actualizan (AFIP publica por período). |

`followLatest` se resuelve en **tiempo de request** con una query indexada
(`sourceId + status + version desc`), sin necesidad de un job de re-publicación.

---

## 8. Base de datos: MongoDB

### 8.1 Por qué NoSQL

| Necesidad | Cómo la resuelve MongoDB |
|---|---|
| Columnas **distintas por origen** | Documentos con esquema flexible; el `schema` del dataset es metadato, no migración |
| Evolución sin downtime | Agregar un campo a un documento no requiere migración |
| Filas tabulares + metadatos | Un documento por dataset con `rows[]`, o un documento por fila si el volumen lo exige |
| Versionado natural | `sourceId + version` es un índice trivial |
| Consultas por filtro sobre campos declarados | Índice compuesto sobre los campos del `EndpointDefinition` (post-MVP) |

### 8.2 Cuándo **no** es la opción correcta

Si un dataset supera ~**100k filas** o la consulta necesita agregaciones complejas
(`group by`, joins, ranking), el modelo de "rows en un documento" se queda corto. El spec
deja explícita esa frontera (§10) para que la decisión se tome con datos, no por
anticipación.

### 8.3 Almacenamiento de las filas

El MVP guarda `rows: Row[]` embebido en el documento del dataset. Es simple y basta para
tablas como la de AFIP (decenas de filas). La fase 06 deja documentada la transición a
**colección `dataset_rows` separada** cuando el volumen lo justifique, manteniendo el mismo
contrato de API.

---

## 9. Endpoint dinámico

`GET /api/v1/e/:slug` ejecuta, en este orden:

1. Resolver `EndpointDefinition` por `slug` (índice único) y `enabled === true`.
2. Resolver el dataset: `datasetId` directo, o último `published` si `followLatest`.
3. **Validar el query contra el allowlist** del `EndpointDefinition`:
   - `page` (1-based), `limit` (≤ `maxLimit`, default `defaultLimit`).
   - Filtros: sólo campos declarados en `filters[]`, con operador declarado.
   - `sort`: sólo campos declarados.
   - Cualquier clave no reconocida → `400` (no se ignora en silencio).
4. Aplicar proyección (`fields`), filtros, orden y paginación **en memoria** (el MVP trabaja
   sobre arrays; el motor es reemplazable).
5. Responder `{ data, meta }` con `meta.total`, `meta.page`, `meta.limit`, `meta.count`.

**Contrato de error:** `404` si el slug no existe o está deshabilitado; `400` si el query es
inválido. Nunca `500` por un query mal formado.

---

## 10. Límites conocidos del MVP

| Límite | Por qué | Mitigación prevista |
|---|---|---|
| `rows` embebido | Simplicidad | Migrar a `dataset_rows` si >100k filas (fase 06 lo documenta) |
| Consultas en memoria | No requiere índices | Repasar aAggregationPipeline cuando el volumen lo exija |
| Ingesta síncrona | Evita infraestructura de colas | `POST /ingest` con timeout; un job BullMQ es post-MVP |
| Sin auth | Foco en el dominio | Estructura de módulos lista; auth es una fase futura |
| Sin cache | Volumen bajo esperado | `Cache-Control` + ETag derivados del `datasetId` |

Cada límite tiene un disparador concreto, no una excusa.

---

## 11. Requisitos funcionales

| ID | Requisito |
|---|---|
| RF-01 | Registrar una `Source` de tipo `manual`, `api`, `url` o `pdf` |
| RF-02 | Ingerir una source y producir un `Dataset` normalizado |
| RF-03 | Versionar: cada ingesta crea `version + 1` sin destruir la anterior |
| RF-04 | Inferir y exponer el `schema` (columnas y tipos) del dataset |
| RF-05 | Registrar `warnings` de extracción cuando el parser tenga dudas |
| RF-06 | Crear/editar/eliminar `EndpointDefinition` (slug, campos, filtros, orden, límites) |
| RF-07 | Servir `GET /api/v1/e/:slug` con filtros, orden y paginación |
| RF-08 | Rechazar queries fuera del allowlist con `400` |
| RF-09 | Seguir la última versión publicada (`followLatest`) |
| RF-10 | Preview del dataset (primeras N filas) para revisión manual |

## 12. Requisitos no funcionales

| ID | Requisito |
|---|---|
| RNF-01 | TypeScript estricto, sin `any` explícito |
| RNF-02 | Una única conexión Mongoose |
| RNF-03 | Timeouts en toda descarga saliente; límite de tamaño de payload |
| RNF-04 | Errores uniformes con `code` + `message` + `details` |
| RNF-05 | Todo el stack corre en Docker Compose con `pnpm dev` |
| RNF-06 | Cada fase del plan es ejecutable de inicio a fin por un agente |

## 13. Fuera de alcance (MVP)

- Autenticación y multi-tenancy.
- Webhooks y subscriptions.
- Scraping de HTML con JavaScript (puppeteer/playwright).
- Transformaciones arbitrarias entre datasets (join, pivot).
- Exportaciones (CSV/Excel) desde el endpoint.
- Frontend de administración.