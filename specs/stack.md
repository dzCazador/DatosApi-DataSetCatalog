# Stack tecnológico — DatosApi

> Documento **NORMATIVO**. Lista detallada y versionada. Las versiones son **referencias de
> partida** y se fijan con lockfile (`pnpm-lock.yaml`) al inicializar. El stack es **similar**
> al de SueldoNext, con NoSQL y extracción de PDF como diferencias.

---

## 1. Resumen por capa

| Capa | Tecnología principal | Versión objetivo |
|---|---|---|
| Runtime | Node.js | 22 LTS |
| Lenguaje | TypeScript | 5.x (strict) |
| Backend | NestJS | 11.x |
| Base de datos | **MongoDB** | 7.x |
| ODM | Mongoose | 8.x |
| Extracción PDF | `pdfjs-dist` | 4.x |
| CSV | `csv-parse` | 5.x |
| HTTP saliente | `fetch` nativo (Node 22) / `undici` | — |
| Validación env | `joi` | 18.x |
| Documentación | `@nestjs/swagger` | 11.x |
| Paquetes | pnpm (workspaces) + Turborepo | 9.x / 2.x |
| Testing | Jest + Supertest | 29.x / 7.x |
| Calidad | ESLint + Prettier | 9.x / 3.x |
| Infra | Docker + Docker Compose | 27+ / v2 |

---

## 2. Backend — NestJS

### 2.1 Core

| Paquete | Propósito |
|---|---|
| `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express` | Núcleo del framework |
| `@nestjs/config` | Configuración por entorno |
| `@nestjs/mongoose` | Integración Mongoose |
| `@nestjs/swagger` | OpenAPI + UI en `/docs` |
| `@nestjs/terminus` | Health checks |
| `joi` | Validación de variables de entorno al arranque |
| `class-validator`, `class-transformer` | Validación y transformación de DTOs |
| `reflect-metadata`, `rxjs` | Requisitos de Nest |

### 2.2 Persistencia

| Paquete | Propósito |
|---|---|
| `mongoose` | ODM, esquemas, índices,Aggregation Pipeline |
| `mongodb` (driver) | Tipos del driver; usar `mongodb` ≥ 6 para `ObjectId` tipado |

**Sin Prisma.** Prisma no tiene soporte oficial para MongoDB estable en el flujo del MVP;
Mongoose +Aggregation Pipeline da control directo sobre documentos flexibles.

### 2.3 Ingesta y parsing

| Paquete | Propósito | Nota |
|---|---|---|
| `pdfjs-dist` | Extraer texto **con coordenadas** de PDF | Preferido sobre `pdf-parse`: permite reconstruir tablas por posición x/y |
| `csv-parse` | Parseo robusto de CSV (comillas, delimitadores, BOM) | Reemplaza cualquier parser casero |
| `node:zlib` (builtin) | Descomprimir descargas gzip | — |
| `fetch` (builtin, Node 22) | Descargas HTTP | Con `AbortSignal.timeout` |

> **Por qué `pdfjs-dist` y no `pdf-parse`?** `pdf-parse` devuelve texto plano y **pierde la
> posición de cada fragmento**, que es exactamente lo necesario para recomponer una tabla.
> `pdfjs-dist` expone `getTextContent()` con `transform` (matriz de posición), lo que permite
> agrupar fragmentos por línea (Y) y columna (X). Ver [`ingestion.md`](ingestion.md) §4.

### 2.4 Testing

| Paquete | Propósito |
|---|---|
| `jest`, `ts-jest`, `@nestjs/testing` | Tests unitarios |
| `supertest` | Tests e2e contra la app |
| `mongodb-memory-server` (opcional) | Tests de repos sin Mongo real |

---

## 3. MongoDB

| Aspecto | Decisión | Motivo |
|---|---|---|
| Imagen dev | `mongo:7` | Versión estable actual |
| Auth dev | activada (`MONGO_INITDB_ROOT_USERNAME/PASSWORD`) | Evitar instancia abierta en `:27017` |
| Puerto dev | `27017` | Estándar |
| Volumen | `mongo_data` | Persistencia entre `up`/`down` |
| Colecciones | `sources`, `datasets`, `endpoint_definitions` | Ver [`data-model.md`](data-model.md) |
| Índices | declarados en el schema, no creados a mano | Consistente entre dev y prod |

---

## 4. Monorepo

| Pieza | Configuración |
|---|---|
| Workspaces | `apps/*`, `packages/*` |
| Task runner | Turborepo (`build`, `dev`, `lint`, `typecheck`, `test`) |
| TypeScript | `tsconfig.base.json` en la raíz, extendido por cada paquete |
| Alias | `@datosapi/common`, `@datosapi/database` vía `paths` + `tsconfig-paths` |
| Versionado | Node 22, pnpm 9 (`packageManager` en el `package.json` raíz) |

---

## 5. Calidad

| Herramienta | Alcance |
|---|---|
| ESLint 9 (flat config) | `apps/*/src`, `packages/*/src`, tests |
| typescript-eslint | Rules recomendadas + `no-explicit-any: error` |
| Prettier | Formato consistente (`.prettierrc`) |
| `strict` TS | `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` |

---

## 6. Variables de entorno

Todas validadas con Joi al arranque. Sin defaults silenciosos para secretos.

```dotenv
# ── App ─────────────────────────────────────────
NODE_ENV=development
API_PORT=3001
API_PREFIX=/api/v1
CORS_ORIGINS=*

# ── Database ────────────────────────────────────
MONGO_ROOT_USER=datosapi
MONGO_ROOT_PASSWORD=change_me
MONGO_DB=datosapi
MONGODB_URI=mongodb://datosapi:change_me@localhost:27017/datosapi?authSource=admin

# ── Ingesta ─────────────────────────────────────
INGEST_TIMEOUT_MS=30000
INGEST_MAX_BYTES=10485760
INGEST_MAX_ROWS=50000
INGEST_USER_AGENT=DatosApi/0.1 (+https://localhost)
STORAGE_DIR=./storage

# ── Endpoint dinámico ───────────────────────────
DEFAULT_LIMIT=50
MAX_LIMIT=500
PREVIEW_ROWS=20
```

---

## 7. Matriz de decisiones

| Decisión | Alternativas descartadas | Motivo |
|---|---|---|
| MongoDB | PostgreSQL + Prisma, SQLite | El esquema **varía por origen**; migrar columnas por cada dataset nuevo es exactamente lo que se quiere evitar. Ver [`architecture.md`](architecture.md) §8. |
| `pdfjs-dist` | `pdf-parse`, `pdf2json`, Tesseract | Sólo `pdfjs-dist` conserva coordenadas, necesarias para tablas. Tesseract es OCR (innecesario: el PDF de AFIP tiene capa de texto). |
| `csv-parse` | parser propio | Manejo de comillas, BOM y delimitadores mixtos ya resuelto y testeado. |
| `fetch` nativo | `axios` | Node 22 ya lo trae; menos dependencias y soporte nativo de `AbortSignal.timeout`. |
| `rows[]` embebido | colección `dataset_rows` | Simplifica el MVP. La transición está especificada en [`architecture.md`](architecture.md) §8.3. |
| Query en memoria | Aggregation Pipeline | Los datasets del MVP son chicos. El motor es intercambiable tras una interfaz. |
| Ingesta síncrona | BullMQ + Redis | Evita Redis en el MVP. Si hace falta async, se agrega después sin cambiar el contrato. |
| Sin auth | JWT + RBAC | El dominio es el foco. La estructura de módulos ya permite agregar guards. |

---

## 8. Qué **no** se usa

| Paquete | Motivo |
|---|---|
| `axios` | `fetch` nativo lo reemplaza |
| `prisma` / `@prisma/client` | Sin soporte MongoDB estable en el flujo elegido |
| `redis` / `ioredis` / `bullmq` | Fuera de alcance del MVP |
| `multer` | El MVP no acepta upload de archivos binarios (la ingesta es por URL o payload inline) |
| `class-transformer` para plain objects | Se usa sólo en DTOs HTTP |