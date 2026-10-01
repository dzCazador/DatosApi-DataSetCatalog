# Fase 08 — Calidad, tests y verificación end-to-end

> **Objetivo:** endurecer el MVP — suite de tests completa, script de smoke test del flujo
> real y documentación de uso.

**Spec de referencia:** [`conventions.md`](../../conventions.md) §8, §9,
[`api-contract.md`](../../api-contract.md) §8.

---

## 0. Preguntas y permisos (obligatorio antes de empezar)

### Preguntas

1. **¿Tests e2e contra MongoDB real o `mongodb-memory-server`?** Default: **MongoDB real**
   (ya está en Docker desde la fase 01) para no agregar una dependencia binaria.
2. **¿Script de smoke en Node o shell?** Default: un script Node (`scripts/smoke.ts`) con
   `fetch`, reutilizable y legible.
3. **¿CI en GitHub Actions?** Default: **sí**, workflow mínimo (`lint` + `typecheck` +
   `test` + `build`) con el servicio MongoDB. Si no querés CI todavía, se omite y queda
   anotado.

### Permisos a solicitar

- [ ] `pnpm install --save-dev` de lo que falte.
- [ ] Acceso a red para el PDF de AFIP en el smoke test.
- [ ] (Opcional) Crear `.github/workflows/ci.yml`.

### Valores por defecto si no hay respuesta

- Los defaults de arriba.

---

## 1. Tests faltantes

- [ ] **Ingesta PDF**: test del extractor contra el fixture propio (ya cubierto en fase 05);
      agregar el caso `rowCount > INGEST_MAX_ROWS ⇒ 422`.
- [ ] **Concurrencia**: test de doble `POST /ingest` sobre la misma source ⇒ un `202` y un
      `409`.
- [ ] **Normalizador**: tests de los casos ambiguos (`"1.234"` → `string` + warning,
      `"35%"` → `0.35`, `"-"` → `null`, `"0"` → `0`).
- [ ] **Query engine**: un test por operador + `total` antes de paginar.
- [ ] **Endpoint dinámico**: test e2e del allowlist (filtro no permitido, `limit` excedido,
      param desconocido, slug deshabilitado).
- [ ] **`followLatest`**: test de que una ingesta nueva cambia la versión servida.

## 2. Script de smoke (`scripts/smoke.ts`)

Ejecuta el flujo completo contra la API local y falla con exit code ≠ 0 si algo no cuadra:

```text
1) GET  /health                                    → 200
2) POST /sources            (type: pdf, URL AFIP)  → 201
3) POST /sources/:id/ingest                         → 202, rowCount > 0, warnings == []
4) POST /datasets/:id/publish                       → 200
5) POST /endpoints       (slug: smoke-test-afip)    → 201
6) GET  /e/smoke-test-afip?limit=5                  → 200, data.length > 0
7) GET  /e/smoke-test-afip?retencion=1             → 400 (filtro no permitido)
8) DELETE /endpoints/:id                            → 204
```

- [ ] El script **no** falla si el slug de prueba ya existe: lo borra al final o usa un sufijo
      incremental.

## 3. Documentación de uso

- [ ] Sección **"Ejemplo end-to-end"** en el `README.md` con el `curl` real ya verificado.
- [ ] Sección "Consultas útiles" (listar fuentes, ver warnings, preview de dataset).
- [ ] Actualizar el **roadmap** del README: fases 00–08 con ✅ y fecha.
- [ ] Actualizar el estado de cada archivo de fase con la fecha de ejecución y las decisiones.

## 4. Verificación final

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm infra:up` + `pnpm dev` + `pnpm smoke` en verde
- [ ] `git status` limpio: no hay `.env`, `storage/` ni PDF en el índice

## 5. CI (opcional, según decisión 3)

- [ ] `.github/workflows/ci.yml`: matrix de una versión de Node (22), servicios `mongo:7`,
  pasos `pnpm install --frozen-lockfile` → `lint` → `typecheck` → `test` → `build`.

## 6. Criterios de aceptación

- [ ] Toda la suite en verde desde la raíz con un comando.
- [ ] El smoke test pasa contra el PDF real de AFIP con `warnings: []`.
- [ ] El README documenta el flujo verificado, no teórico.
- [ ] Cero pendientes `[ ]` sin justificar en las fases 00–08.

## 7. Commit y push

```bash
git checkout -b fase/08-calidad-e2e
git add -A
git commit -m "test: cover ingestion and dynamic endpoints, add smoke test"
git push -u origin fase/08-calidad-e2e
```

Abrir PR hacia `main`.

## 8. Estado y decisiones

- Fecha de ejecución: **<AGREGAR>**
- `<AGREGAR: cobertura, CI creado o no, desvíos>`