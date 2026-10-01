# Fase 03 — Esquemas Mongoose y repositorios

> **Objetivo:** modelar el dominio en MongoDB (`sources`, `datasets`,
> `endpoint_definitions`) con repositorios encapsulados.

**Spec de referencia:** [`data-model.md`](../../data-model.md) (normativo completo),
[`conventions.md`](../../conventions.md) §5.

---

## 0. Preguntas y permisos (obligatorio antes de empezar)

### Preguntas

1. **¿`rows` embebido o colección `dataset_rows` desde el inicio?** Default: **embebido**
   (ver [`data-model.md`](../../data-model.md) §8.3 y `architecture.md` §8.3).
2. **¿Nombres de colección en inglés o español?** Default: inglés
   (`sources`, `datasets`, `endpoint_definitions`).
3. **¿Soft delete de datasets?** Default: sí, vía `status: archived` (no se borra documento).

### Permisos a solicitar

- [ ] Crear índices sobre MongoDB local (automático al levantar la app).

### Valores por defecto si no hay respuesta

- Los tres defaults de arriba.

---

## 1. `packages/common`

- [ ] `package.json` con alias `@datosapi/common`, `main: dist/index.js`, `types`.
- [ ] `src/enums.ts`: `SourceType`, `SourceStatus`, `DatasetStatus`, `ColumnType`,
  `FilterOperator`.
- [ ] `src/types.ts`: `ColumnSchema`, `Row`, `ExtractionMeta`, `FilterDef`, `SortDef`,
  `SourceConfig` (union discriminada por `type`), `IngestResult`, `Paginated<T>`.
- [ ] `src/keys.ts`: tokens de inyección (`MONGO_CONNECTION`, repositorios).
- [ ] `src/index.ts` barrel sólo de tipos y valores puros.
- [ ] `tsconfig.json` propio; `pnpm build` emite `dist/` + `.d.ts`.

## 2. `packages/database`

- [ ] `package.json` con alias `@datosapi/database`; deps `mongoose`, `@nestjs/mongoose`,
  `@datosapi/common`.
- [ ] `src/database.module.ts` con `MongooseModule.forRootAsync` leyendo `MONGODB_URI`,
  **una sola conexión** en toda la app.
- [ ] `src/schemas/source.schema.ts`, `dataset.schema.ts`, `endpoint-definition.schema.ts`
  con `timestamps: true`, `versionKey: false`, `strict: true`, `toJSON: { virtuals: false }`.
- [ ] Índices según [`data-model.md`](../../data-model.md): único `{ slug }` en endpoints,
  único `{ sourceId, version }` en datasets, `{ type, status }` y `{ status, sourceId, version }`.
- [ ] `src/repositories/base.repository.ts`: helpers comunes (findById, paginate) **sin lógica de
  negocio**.
- [ ] Exportar todo en `src/index.ts`.

## 3. Módulo `sources` (solo persistencia)

- [ ] `entities/source.entity.ts`: tipo de dominio + `toDomain(doc)`.
- [ ] `repositories/sources.repository.ts`: interface + `MongooseSourcesRepository`
  (crear, listar con filtros `type`/`status` + paginación, findById, actualizar,
  `compareAndSetStatus` para el CAS de la fase 04).
- [ ] `sources.module.ts` exportando el repo; sin controller todavía.

## 4. Módulo `datasets`

- [ ] `entities/dataset.entity.ts`.
- [ ] `repositories/datasets.repository.ts`: crear, listar por `sourceId`, findById,
  `findLatestPublished(sourceId)`, `nextVersion(sourceId)` (max + 1), publicar, archivar.

## 5. Módulo `endpoints`

- [ ] `entities/endpoint-definition.entity.ts`.
- [ ] `repositories/endpoints.repository.ts`: crear, listar, findById, **findBySlug**,
  actualizar, delete, `disableBySourceId`.

## 6. Criterios de aceptación

- [ ] La app arranca y los 3 esquemas se registran (colecciones creadas al primer insert).
- [ ] `pnpm typecheck` en verde: los tipos de `common` se usan en `database` sin `any`.
- [ ] Test unitario del repositorio de endpoints: insertar dos con el mismo `slug` ⇒ la
  segunda falla con `E11000` (índice único funcionando).
- [ ] Ningún service/controller escrito todavía.

## 7. Commit y push

```bash
git checkout -b fase/03-dominio-datos
git add -A
git commit -m "feat(db): add mongo schemas and repositories"
git push -u origin fase/03-dominio-datos
```

Abrir PR hacia `main`.

## 8. Estado y decisiones

- Fecha de ejecución: **<AGREGAR>**
- `<AGREGAR: decisión sobre rows embebido, desvíos>`