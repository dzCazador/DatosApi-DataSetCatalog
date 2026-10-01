# 📊 DatosApi — Motor de Datos a Endpoints

### La capa de publicación que convierte cualquier fuente en un endpoint REST propio

Plataforma que **ingiere datos heterogéneos** publicados por terceros (AFIP, INDEC, bancos,
organismos), los **normaliza y versiona**, y los expone mediante **endpoints REST dinámicos
definidos por configuración**, no por código.

> **DatosApi NO es un data warehouse ni un ETL genérico.** No replica bases de terceros ni
> resuelve joins. Es un catálogo personal de datasets versionados con su propia API de
> consulta: el usuario aporta la fuente y obtiene un endpoint documentado, filtrable y
> estable.

[![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com)
[![Mongoose](https://img.shields.io/badge/Mongoose-8-880000?style=for-the-badge&logo=mongoose&logoColor=white)](https://mongoosejs.com)
[![pnpm](https://img.shields.io/badge/pnpm-9-F69220?style=for-the-badge&logo=pnpm&logoColor=white)](https://pnpm.io)
[![Turborepo](https://img.shields.io/badge/Turborepo-2-FF1E56?style=for-the-badge&logo=turborepo&logoColor=white)](https://turbo.build)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com)

---

## 🎯 Objetivo y posicionamiento

| Pregunta | Respuesta |
|---|---|
| ¿Publica datos de terceros? | **Sí.** Es su único propósito. |
| ¿Es un data warehouse? | **No.** No replica ni indexa bases externas. |
| ¿Es un ETL genérico? | **No.** El flujo es lineal: fuente → dataset → endpoint. |
| ¿Qué resuelve? | Datos publicados en PDF/planillas/HTML que hoy se scrapean o copian a mano. |
| ¿Para quién? | Desarrolladores y equipos que necesitan un endpoint propio, estable y versionado. |

---

## 🧩 Módulos core del MVP

```text
┌────────────────────────────── INGESTA ──────────────────────────────┐
│  URL / PDF            API externa           Manual (JSON / CSV)      │
│  Descarga + parsing   fetch + jsonPath      Payload inline           │
└───────────────────────────────┬────────────────────────────────────┘
                                ▼
┌──────────────────── DATASET · TRAZABILIDAD ────────────────────────┐
│  Versionado inmutable · schema tipado · warnings de extracción       │
│  meta: url de origen, fetchedAt, método, duración                    │
└───────┬─────────────────────────────────────────────┬───────────────┘
        ▼                                             ▼
┌───────────────┐                        ┌──────────────────────────┐
│  CATÁLOGO     │  publica               │  ENDPOINT DINÁMICO       │
│  datasets     ├───────────────────────▶│  GET /api/v1/e/:slug     │
│  draft/pub/   │  EndpointDefinition    │  filtros · sort · paging │
│  archive      │  slug + allowlist      │  { data, meta }          │
└───────────────┘                        └──────────────────────────┘
```

| # | Módulo | Qué incluye |
|:-:|---|---|
| 0 | **Fuentes y ingesta** | Registro de orígenes (`manual`/`api`/`url`/`pdf`); motor de ingesta **Strategy + Factory**; descarga con timeout y límite de tamaño. |
| 1 | **Normalización y parsing** | Reconstrucción de tablas desde PDF por coordenadas; parseo CSV/JSON; inferencia de `schema`; `warnings` explícitos. |
| 2 | **Datasets versionados** | Cada ingesta crea `version + 1` **sin destruir** la anterior; `schema` como fuente de verdad; publicación y archivado. |
| 3 | **Definiciones de endpoints** | `slug` único, proyección de campos, **allowlist** de filtros y orden, límites de paginación, `followLatest`. |
| 4 | **Endpoint dinámico** | Un solo controller `GET /e/:slug` con validación estricta del query: lo no permitido es `400`, nunca se ignora. |
| 5 | **Observabilidad de la ingesta** | `meta` con URL, timestamp, content-type, bytes, duración, páginas, filas crías y advertencias. |

---

## 🏗️ Arquitectura

```text
                          ┌──────────────────────────────────────┐
                          │     Consumidor: app, script, Excel    │
                          └───────────────────┬──────────────────┘
                                              │ HTTPS
                                              ▼
                    ┌──────────────────────────────────────────────┐
                    │      apps/api  (NestJS 11)                    │
                    │  Controllers → Services → Repositories        │
                    │        │              │           │           │
                    │        ▼              ▼           ▼           │
                    │  DynamicController  Ingestor   EndpointDef   │
                    │   GET /e/:slug      Factory    Service       │
                    └────┬──────────────────┬─────────────┬────────┘
                         │                  │             │
                         │      ┌───────────▼───────────┐ │      ┌──────────────┐
                         │      │  Ingestion Strategies │ │      │   MongoDB 7  │
                         │      ├──────────────────────┤ │      │  (única DB)  │
                         │      │ manual  api  url  pdf │ │      │  sources     │
                         │      └───────────┬───────────┘ │      │  datasets    │
                         │                  │             │      │  endpoints   │
                         │      ┌───────────▼───────────┐ │      └──────┬───────┘
                         │      │  pdfjs-dist           │ │             │
                         │      │  csv-parse · fetch    │ │             │
                         └──────┴───────────────────────┴─┴─────────────┘
                                                    │
                                                    ▼
                              ┌─────────────────────────────────────────┐
                              │  Fuentes externas (AFIP, INDEC, APIs)  │
                              └─────────────────────────────────────────┘
```

| App | Rol | Tecnología | Puerto |
|---|---|---|---|
| `apps/api` | Ingesta, normalización, catálogo y endpoint dinámico | NestJS + Mongoose + Swagger | `3001` |
| `apps/web` | Panel de administración (fase 09) | Next.js + React + Tailwind CSS | `3000` |

| Paquete | Rol | Tecnología |
|---|---|---|
| `packages/common` | Enums, tipos, contratos de strategies y DTOs compartidos | TypeScript puro |
| `packages/database` | Conexión Mongoose, esquemas y repositorios base | Mongoose 8 |

| Servicio | Rol | Tecnología | Puerto |
|---|---|---|---|
| `mongo` | Persistencia (fuente de verdad) | MongoDB 7 | `27017` |

> **Una única conexión Mongoose.** Los binarios descargados (PDF/CSV) se escriben en
> `storage/` para trazabilidad y **nunca** se versionan en el repo.

---

## 📦 Estructura del monorepo (objetivo)

```text
DatosApi/
├── apps/
│   ├── api/              # Backend NestJS (ingesta, datasets, endpoint dinámico)
│   └── web/              # Panel de administración (Next.js, fase 09)
├── packages/
│   ├── common/           # Tipos, enums y contratos compartidos
│   └── database/         # Conexión Mongoose, esquemas y repositorios
├── specs/                # Documentación normativa (fuente única de verdad)
│   ├── architecture.md
│   ├── stack.md
│   ├── data-model.md
│   ├── ingestion.md
│   ├── api-contract.md
│   ├── conventions.md
│   ├── frontend.md
│   └── todo/begin/       # Puesta en marcha por fases (para agentes)
├── storage/              # Descargas en runtime (gitignored)
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── AGENTS.md
```

---

## 🚀 Puesta en marcha

### Requisitos

- **Node.js** 22 LTS → `node -v`
- **pnpm** 9+ → `pnpm -v` (o `corepack enable`)
- **Docker** + **Compose v2** → `docker compose version`
- **Git**

```bash
git clone <url-del-repo>
cd DatosApi
pnpm install
cp .env.example .env
pnpm infra:up      # MongoDB
pnpm dev           # api en :3001
```

> El arranque real se construye por fases. Empezá por
> [`specs/todo/begin/00-kickoff.md`](specs/todo/begin/00-kickoff.md).

### Ejemplo de uso (escala de retención AFIP)

```text
1) POST /api/v1/sources          { type: "pdf", config: { url: <PDF de AFIP> } }
2) POST /api/v1/sources/:id/ingest   →  { datasetId, version: 1, rowCount: 12 }
3) POST /api/v1/datasets/:id/publish
4) POST /api/v1/endpoints        { slug: "escala-retencion-4ta-categoria", followLatest: true }
5) GET  /api/v1/e/escala-retencion-4ta-categoria?importe_desde=50000&limit=10
```

El PDF de referencia:
[`Tabla Art. 94 LIG — jul/dic 2026`](https://www.afip.gob.ar/gananciasYBienes/ganancias/personas-humanas-sucesiones-indivisas/declaracion-jurada/documentos/Tabla-Art-94-LIG-per-jul-a-dic-2026.pdf)

---

## 🖥️ Frontend

`apps/web` es el **panel de administración**: permite crear fuentes, disparar ingestas,
revisar el `schema` y los `warnings`, publicar datasets, definir endpoints y probar
`GET /e/:slug` sin `curl`. Es un **consumidor de la API pública**: no accede a MongoDB ni
duplica reglas de negocio.

La UI está **inspirada en**
[Horizon UI Tailwind CSS NextJS](https://github.com/horizon-ui/horizon-tailwind-react-nextjs)
(sidebar fijo + navbar superior, escala de espaciado y tokens, modo claro/oscuro, tablas y
badges de estado). **No se clona ni se vendoriza el template**: los componentes son
propios, lo que además evita la licencia comercial de Horizon UI / Simmmple.

Detalle normativo: [`specs/frontend.md`](specs/frontend.md). Implementación: fase 09.

| Pantalla | Qué hace |
|---|---|
| Dashboard | Estado de la API, fuentes por estado, ingesta reciente, endpoints publicados |
| Fuentes | Alta por tipo, disparo de ingesta, diagnóstico de `lastError`, versiones |
| Datasets | `schema`, preview de filas, `warnings`, publicar/archivar, trazabilidad |
| Endpoints | Editor de la definición con filtros y orden atados al `schema`, validar |
| Playground | Consulta `GET /e/:slug` con el `curl` equivalente copiable |

---

## 🗺️ Roadmap por fases

Cada fase es **autónoma**, está pensada para que un agente la ejecute de principio a fin,
**pregunta y pide permisos al inicio**, y **commitea directo en `main`** al cerrar (sin ramas
por fase ni Pull Requests).

| Fase | Entregable | Estado |
|:---:|---|:---:|
| **00** | Kickoff: decisiones, repo y Git | ✅ 2026-10-01 |
| **01** | Monorepo + infraestructura Docker (MongoDB) | ✅ 2026-10-01 |
| **02** | Backend base: NestJS, config, Swagger, salud | ⬜ |
| **03** | Esquemas Mongoose y repositorios | ⬜ |
| **04** | Ingesta manual + API externa | ⬜ |
| **05** | Ingesta PDF por coordenadas + caso AFIP | ⬜ |
| **06** | Datasets versionados, publicación y catálogo | ⬜ |
| **07** | Endpoints dinámicos (filtros, orden, paginación) | ⬜ |
| **08** | Calidad, tests y verificación end-to-end | ⬜ |
| **09** | Frontend: panel de administración (Next.js + Tailwind) | ⬜ |

---

## 📚 Documentación normativa

La carpeta [`specs/`](specs/README.md) es la **fuente única de verdad**. Si el código
contradice un spec, manda el spec.

| Documento | Contenido |
|---|---|
| [`architecture.md`](specs/architecture.md) | Capas, flujo de ingesta, versionado y límites del MVP |
| [`stack.md`](specs/stack.md) | Tecnologías, versiones y matriz de decisiones |
| [`data-model.md`](specs/data-model.md) | Colecciones MongoDB, índices e integridad |
| [`ingestion.md`](specs/ingestion.md) | Strategies, parsing, normalización y errores |
| [`api-contract.md`](specs/api-contract.md) | Contrato REST completo y códigos de error |
| [`conventions.md`](specs/conventions.md) | Convenciones de código |
| [`frontend.md`](specs/frontend.md) | Panel de administración: stack, estructura y reglas de UI |
| [`todo/begin/`](specs/todo/begin/) | Fases de puesta en marcha (00–09) |

Guía operativa para agentes: [`AGENTS.md`](AGENTS.md).

---

## 🔒 Seguridad y trazabilidad

- **Allowlist estricta** de filtros, orden y proyección declarada por endpoint: lo no
  permitido devuelve `400`, nunca se ignora en silencio.
- **Una única conexión Mongoose** y ninguna construcción de consultas por concatenación de
  strings recibidas del usuario.
- Timeouts y **límite de tamaño** en toda descarga saliente; los errores de origen se
  distinguen (`502`/`504`) de los de contenido (`422`).
- **Trazabilidad total** de cada ingesta: URL de origen, timestamp, content-type, método,
  duración y `warnings` de extracción.
- Secretos sólo en variables de entorno validadas con Joi al arranque; jamás en el repo.

---

## 📄 Licencia

Proyecto **propietario**. Todos los derechos reservados.