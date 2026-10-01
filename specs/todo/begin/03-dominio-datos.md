# Fase 03 — Esquemas Mongoose y repositorios

> **Objetivo:** modelar el dominio en MongoDB (`sources`, `datasets`,
> `endpoint_definitions`) con repositorios encapsulados.

**Spec de referencia:** [`data-model.md`](../../data-model.md) (normativo completo),
[`conventions.md`](../../conventions.md) §5.

**Estado:** ✅ completada el **2026-10-01**.

---

## 0. Preguntas y permisos (obligatorio antes de empezar)

### Preguntas

1. **¿`rows` embebido o colección `dataset_rows` desde el inicio?** Default: **embebido**
   (ver [`data-model.md`](../../data-model.md) §3.1 y `architecture.md` §8.3).
2. **¿Nombres de colección en inglés o español?** Default: inglés
   (`sources`, `datasets`, `endpoint_definitions`).
3. **¿Soft delete de datasets?** Default: sí, vía `status: archived` (no se borra documento).

### Permisos a solicitar

- [x] `pnpm install` en `packages/common` y `packages/database`.
- [x] Conectar al MongoDB local y crear los índices (automático con `autoIndex: true`).
- [x] `dropDatabase()` sobre la base de desarrollo al terminar, para no dejar datos de prueba.

### Valores por defecto si no hay respuesta

- Los tres defaults de arriba.

---

## 1. `packages/common`

- [x] `package.json` con alias `@datosapi/common`, `main: dist/index.js`, `types`.
- [x] `src/enums.ts`: `SourceType`, `SourceStatus`, `DatasetStatus`, `ColumnType`,
  `FilterOperator`.
- [x] `src/types.ts`: `ColumnSchema`, `Row`, `ExtractionMeta`, `FilterDef`, `SortDef`,
  `SourceConfig` (union discriminada por `type`), `IngestResult`, `Paginated<T>`.
- [x] `src/keys.ts`: tokens de inyección (`MONGO_CONNECTION`, repositorios).
- [x] `src/index.ts` barrel sólo de tipos y valores puros.
- [x] `tsconfig.json` propio; `pnpm build` emite `dist/` + `.d.ts`.

## 2. `packages/database`

- [x] `package.json` con alias `@datosapi/database`; deps `mongoose`, `@nestjs/mongoose`,
  `@datosapi/common`.
- [x] `src/database.module.ts` con `MongooseModule.forRootAsync` leyendo `MONGODB_URI`,
  **una sola conexión** en toda la app.
- [x] `src/schemas/source.schema.ts`, `dataset.schema.ts`, `endpoint-definition.schema.ts`
  con `timestamps: true`, `versionKey: false`, `strict: true`, `toJSON: { virtuals: false }`.
- [x] Índices según [`data-model.md`](../../data-model.md): único `{ slug }` en endpoints,
  único `{ sourceId, version }` en datasets, `{ type, status }` y `{ status, sourceId, version }`.
- [x] `src/repositories/base.repository.ts`: helpers comunes (findById, paginate) **sin lógica de
  negocio**.
- [x] Exportar todo en `src/index.ts`.

## 3. Módulo `sources` (solo persistencia)

- [x] `entities/source.entity.ts`: tipo de dominio + `toDomain(doc)`.
- [x] `repositories/sources.repository.ts`: interface + `MongooseSourcesRepository`
  (crear, listar con filtros `type`/`status` + paginación, findById, actualizar,
  `compareAndSetStatus` para el CAS de la fase 04).
- [x] `sources.module.ts` exportando el repo; sin controller todavía.

## 4. Módulo `datasets`

- [x] `entities/dataset.entity.ts`.
- [x] `repositories/datasets.repository.ts`: crear, listar por `sourceId`, findById,
  `findLatestPublished(sourceId)`, `nextVersion(sourceId)` (max + 1), publicar, archivar.

## 5. Módulo `endpoints`

- [x] `entities/endpoint-definition.entity.ts`.
- [x] `repositories/endpoints.repository.ts`: crear, listar, findById, **findBySlug**,
  actualizar, delete, `disableBySourceId`.

## 6. Criterios de aceptación

- [x] La app arranca y los 3 esquemas se registran (colecciones creadas al primer insert).
- [x] `pnpm typecheck` en verde: los tipos de `common` se usan en `database` sin `any`.
- [x] Test unitario del repositorio de endpoints: insertar dos con el mismo `slug` ⇒ la
  segunda falla con `E11000` (índice único funcionando).
- [x] Ningún service/controller escrito todavía.

## 7. Commit y push

```bash
git checkout main
git pull --ff-only
git add -A
git commit -m "feat: phase 03 — mongoose schemas and repositories"
git push origin main
```

Sin rama `fase/03-*` ni Pull Request: por la decisión del owner (2026-10-01) cada fase se
commitea directo en `main`.

## 8. Estado y decisiones

- Fecha de ejecución: **2026-10-01**
- Las tres preguntas se resolvieron con los **defaults de la fase**: `rows` embebido (con la
  interfaz del repositorio preparada para `dataset_rows`), colecciones en inglés
  (`sources`, `datasets`, `endpoint_definitions`) y soft delete de datasets vía
  `status: archived`.
- **`packages/common` nuevo**: enums (`SourceType`, `SourceStatus`, `DatasetStatus`,
  `ColumnType`, `FilterOperator`), tipos (`ColumnSchema`, `Row`, `ExtractionMeta`, `FilterDef`,
  `SortDef`, `SourceConfig`, `IngestResult`, `Paginated<T>` y las entidades de dominio) y los
  tokens de inyección. Cero dependencias de runtime; el barrel sólo reexporta.
- **Los tokens de inyección viven en `@datosapi/common`** (`SOURCES_REPOSITORY`,
  `DATASETS_REPOSITORY`, `ENDPOINTS_REPOSITORY`) y no en `packages/database`: quien consume el
  repositorio es el service, y ese service vive en `apps/api`. La interface de cada repositorio
  también se exporta desde `common`-land vía el paquete `database`, así que el acoplamiento de
  `apps/api` es sólo con el token.
- **`BaseRepository<TDoc>` es genérica sobre el documento, no sobre la entidad**: el mapper
  (`entities/*.entity.ts`) hace la conversión a dominio, así el repositorio nunca devuelve un
  documento crudo y `_id` se convierte a `string` en la frontera. `toPageMeta`/`skipOf` viven
  ahí porque los usan la fase 06 (catálogo) y la fase 07 (endpoint dinámico).
- **Los módulos son `*PersistenceModule`** (`SourcesPersistenceModule`, etc.) y exportan sólo el
  token del repositorio. Se parsan en `AppModule` para que los esquemas se registren al arrancar
  (criterio de aceptación §6). Los services de las fases siguientes los consumirán por token.
- **Índices declarados con `Schema.index()` después de `SchemaFactory.createForClass()`**, no en
  el decorador `@Schema({ indexes: [...] })`: `SchemaOptions` de Mongoose 8 no tiene esa clave y
  el typecheck la rechaza. Los índices se crean solos con `autoIndex: true`; verificado contra
  el Mongo real (`sources`: `name`, `type+status`, `createdAt`; `datasets`:
  `sourceId+version` UNIQUE, `status+sourceId+version`, `createdAt`, `rowCount`;
  `endpoint_definitions`: `slug` UNIQUE, `sourceId`, `enabled`, `createdAt`).
- **`schema`, `rows` y `warnings` de `datasets` son `Mixed`, no `[Object]`/`[String]`.** Es el
  desvío más importante de la fase: un path llamado `schema` sombrea
  `Document.prototype.schema`, y entonces `SchemaArray.cast` termina leyendo
  `doc.schema.indexedPaths()` sobre el array del campo y falla con
  `Cannot read properties of undefined (reading 'indexedPaths')` **siempre que el array esté
  vacío** (un dataset sin filas, `warnings: []`). El nombre del campo lo fija
  [`data-model.md`](../../data-model.md) §3, así que se relajó el tipo y no el nombre; la forma
  de `Row` y de `ColumnSchema` la garantiza la ingesta.
- **`createdAt` / `updatedAt` declarados explícitamente** con `@Prop({ type: Date })` además de
  `timestamps: true`: `InferSchemaType` sí los agrega, pero los mappers trabajan contra la clase
  del esquema y sin esas props el typecheck falla. `createdAt` va `immutable: true`, que es lo
  que hace Mongoose por su cuenta.
- **`filters[]` y `sort[]` de `endpoint_definitions` van con `_id: false`** y `required` sin
  default: son subdocumentos, y Mongoose les agregaba un `_id` autogenerado y un `required:
  false` que el mapper devolvía como ruido en la entidad de dominio. El mapper los proyecta a
  objetos planos (`toFilterDef`/`toSortDef`).
- **`nextVersion(sourceId)` es `max(version) + 1` y no es atómico**: la carrera se resuelve por
  el índice único `{ sourceId, version }`, que la fase 06 traduce a `VERSION_CONFLICT` (409).
- **`compareAndSetStatus` es lo que serializa ingestas concurrentes**: dos `POST /ingest`
  simultáneos sobre la misma source, sólo el que gana el `pending → processing` sigue. La fase 04
  lo usa para el `409 INGEST_ALREADY_RUNNING`.
- **`markIngested` hace `$unset` de `lastError`** en vez de `null`: el error anterior dejó de ser
  cierto y `conventions.md` §6 manda `null` sobre `''` pero el campo simplemente no debe estar.
- **Los tests de repositorio corren contra el Mongo real** (`test/*.e2e-spec.ts`, base
  `datosapi_test`): índices únicos y CAS no existen en un doble. El helper
  `test/persistence-testing-module.ts` levanta los tres módulos con **una sola conexión** y
  recrea los índices después de cada `dropDatabase()` (sin eso, `dropDatabase` se los lleva y el
  `E11000` no se reproduce). Config en `packages/database/jest.config.json`, con
  `testTimeout: 30000` porque levantar la conexión no entra en los 5 s por defecto de Jest.
- **`tsconfig.json` vs `tsconfig.build.json` en `packages/database`**: `rootDir`/`outDir` están
  sólo en el de build. Con los `paths` de la raíz, el typecheck (`--noEmit`) arrastra el `src` de
  `@datosapi/common` al programa y un `rootDir` acotado a `src` lo marca como TS6059. Además el
  de build lleva su propio `include: ["src/**/*.ts"]` para no compilar `test/`.
- **`strictPropertyInitialization: false` también en `packages/database`**: mismo motivo que en
  `apps/api`; las clases de esquema se llenan por Mongoose, no por constructor.
- Los tests de `packages/database` corren con `pnpm test` desde la raíz (turbo `test`), contra
  el Mongo de `pnpm infra:up`. Igual que el e2e de health, la fase 08 tendrá que decidir entre
  un service container o `mongodb-memory-server`.

### Tests agregados

| Suite | Qué cubre |
|---|---|
| `src/schemas/schemas.spec.ts` | Índices declarados de las tres colecciones, defaults (`pending`, `draft`, `warnings: []`), enums de `type`/`status`, `config` como `Mixed`, `strict`/`versionKey`/`toJSON`, `Mixed` en `schema`/`rows`/`warnings`, `min` de `version`/`rowCount` |
| `src/entities/endpoint-definition.entity.spec.ts` | Mapper: `ObjectId` → `string`, opcionales ausentes no aparecen, `filters[]`/`sort[]` planos sin `_id`, allowlist de `FilterOperator` |
| `test/persistence.e2e-spec.ts` | Índice único de `slug` (`E11000`), `findBySlug` no filtra por `enabled`, `findAll` por `sourceId`/`enabled` y paginación por `slug`, `disableBySourceId` (e idempotente), `update` con `runValidators`, `delete`, nombres de colección reales |
| `test/datasets.e2e-spec.ts` | `nextVersion`, unicidad de `{sourceId, version}`, `findLatestPublished` (ignora drafts), archivar sin borrar, `findAll` sin `rows`, CAS de `status` con dos `Promise.all`, `markIngested`/`markFailed`, `update` que no toca `status` ni `type` |

### Pendientes para la fase 04

- No hay ningún service ni controller todavía: la ingesta arranca por el service de sources.
- El `409` de `E11000` (slug tomado, conflicto de versión) lo traduce el service, no el
  repositorio: los repositorios propagan el error del driver tal cual.
- `apps/api/src/common/errors/error-code.ts` ya tiene `INGEST_ALREADY_RUNNING`,
  `SOURCE_CONFIG_INVALID`, `VERSION_CONFLICT` y `ROWS_LIMIT_EXCEEDED`: la fase 04 los conecta.
- Sigue pendiente el `chore: format root files` que quedó anotado en la fase 02
  (`pnpm format:check` marca 5 archivos de las fases 00/01).