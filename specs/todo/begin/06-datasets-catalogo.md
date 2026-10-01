# Fase 06 — Datasets versionados, publicación y catálogo

> **Objetivo:** completar el CRUD de datasets con publicación, archivado, preview y
> endpoints de catálogo.

**Spec de referencia:** [`api-contract.md`](../../api-contract.md) §4 (normativo),
[`data-model.md`](../../data-model.md) §3, §7.

---

## 0. Preguntas y permisos (obligatorio antes de empezar)

### Preguntas

1. **¿`GET /datasets/:id` devuelve todas las filas o un preview?** Default: preview de
   `PREVIEW_ROWS` (20) con `meta.previewTruncated`, y `?full=true` sólo si
   `rowCount ≤ INGEST_MAX_ROWS`.
2. **¿Publicar (`publish`) es reversible desde `published`?** Default: no; sólo a
   `archived`.
3. **¿Se expone el binario original descargado?** Default: **no** (fuera de alcance).

### Permisos a solicitar

- [ ] Nada fuera del repo local (sólo `pnpm dev` / tests).

### Valores por defecto si no hay respuesta

- Los defaults de arriba.

---

## 1. `DatasetsService`

- [ ] `findAll(query)`: filtros `sourceId`, `status` + paginación. **Sin `rows`** (peso).
- [ ] `findOne(id)`: con preview según decisión 1.
- [ ] `getSchema(id)`: sólo `schema`.
- [ ] `publish(id)`: `draft → published`, setea `publishedAt`; `409` si ya está
  `published` o `archived`.
- [ ] `archive(id)`: `published → archived`. `DELETE /datasets/:id` es alias de archive.
- [ ] `findLatestPublished(sourceId)`: query indexada `{ status, sourceId, version: -1 }`.
- [ ] Mapeo explícito documento → respuesta (nunca devolver el doc crudo; ver
  [`conventions.md`](../../conventions.md) §3).

## 2. Controller `datasets`

- [ ] `GET /api/v1/datasets`
- [ ] `GET /api/v1/datasets/:id` (con `?full`)
- [ ] `GET /api/v1/datasets/:id/schema`
- [ ] `POST /api/v1/datasets/:id/publish`
- [ ] `POST /api/v1/datasets/:id/archive`
- [ ] `DELETE /api/v1/datasets/:id`

## 3. Documentar la transición a `dataset_rows`

- [ ] Comentar en el repositorio de datasets la interfaz que permite migrar a una colección
  `dataset_rows` sin tocar los services (ver
  [`data-model.md`](../../data-model.md) §3.3).
- [ ] Anotar el disparador concreto en el código: `rowCount > 100_000`.
- [ ] **No** implementar la migración en el MVP.

## 4. Tests

- [ ] Unitario: `publish` sobre `draft` ⇒ `published`; sobre `published` ⇒ `409`.
- [ ] Unitario: `findLatestPublished` devuelve la versión mayor entre las `published`.
- [ ] Unitario: preview con `rowCount = 100` y `PREVIEW_ROWS = 20` ⇒ 20 filas +
  `previewTruncated: true`.
- [ ] E2e: ingesta (fase 04) → `publish` → `GET /datasets/:id` devuelve el dataset.

## 5. Criterios de aceptación

- [ ] Todo el §4 verde.
- [ ] `GET /datasets` responde rápido y **no** incluye `rows` (verificarlo en la respuesta).
- [ ] Un dataset `published` no se modifica por ninguna vía de la API.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` en verde.

## 6. Commit y push

```bash
git checkout -b fase/06-datasets-catalogo
git add -A
git commit -m "feat(datasets): add versioning, publish and catalog endpoints"
git push -u origin fase/06-datasets-catalogo
```

Abrir PR hacia `main`.

## 7. Estado y decisiones

- Fecha de ejecución: **<AGREGAR>**
- `<AGREGAR: decisiones tomadas, desvíos>`