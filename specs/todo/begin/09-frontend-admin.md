# Fase 09 — Frontend: panel de administración

> **Objetivo:** construir `apps/web`, el panel que permite operar DatosApi sin llamar a la
> API a mano, con UI **inspirada en** Horizon UI y código propio.

**Spec de referencia:** [`frontend.md`](../../frontend.md), [`api-contract.md`](../../api-contract.md),
[`stack.md`](../../stack.md) §4.1.

> **Precondición:** fases 00–08 cerradas. Si el backend no está verificado, el panel se
> construye contra un contrato que después hay que corregir. Esta fase es la última a
> propósito.

---

## 0. Preguntas y permisos (obligatorio antes de empezar)

### Preguntas

1. **¿Alcance de la primera entrega?** Default: **completo pero sin auth** — dashboard,
   fuentes, datasets, endpoints y playground. Todo el alcance de
   [`frontend.md`](../../frontend.md) §1.
2. **¿Fetch desde el servidor o desde el cliente?** Default: **Server Components** para
   lectura y **Server Actions** para escritura. Sin `use client` salvo donde haga falta
   interactividad real (filtros del playground, toggle de tema).
3. **¿Tema por defecto?** Default: **claro**, con toggle a oscuro persistido en
   `localStorage`.
4. **¿Se clona Horizon UI como punto de partida?** Default: **no**. Se escriben los
   componentes desde cero (`frontend.md` §2). Si querés el template base, decilo antes:
   cambia la decisión de licencia.

### Permisos a solicitar

- [x] `pnpm install` de las dependencias de `apps/web`.
- [x] Agregar `http://localhost:3000` a `CORS_ORIGINS` en `.env.example` y `.env`.
      **Ya estaba** desde la fase 02; verificado: `Access-Control-Allow-Origin: http://localhost:3000`
      y un origen ajeno no recibe la cabecera.
- [x] Levantar la API y MongoDB (`pnpm infra:up`, `pnpm dev`) para verificar contra la API real.

### Valores por defecto si no hay respuesta

- Los defaults de arriba.

### Respuestas recibidas (owner, 2026-10-02)

- Preguntas 1–4: **los cuatro defaults confirmados**.
- Permisos: **los tres concedidos**, incluido commit directo en `main` y push.
- **Desvío autorizado:** la fase 08 (`calidad-e2e`) seguía abierta y se decidió arrancar la
  09 antes. Queda anotado en §12.

---

## 1. Bootstrap de `apps/web`

- [x] Crear `apps/web/package.json`: `next@^15`, `react@^19`, `react-dom@^19`,
      `tailwindcss@^3`, `postcss`, `autoprefixer`, `lucide-react`, `zod@^4`.
      Dev: `typescript`, `@types/react`, `@types/node`, `eslint`, `eslint-config-next`,
      `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.
- [x] `next.config.ts`, `tailwind.config.ts` con `darkMode: 'class'` y
      `content: ['./src/**/*.{ts,tsx}']`, `postcss.config.js`.
- [x] `tsconfig.json` extendido de `tsconfig.base.json` con `jsx: preserve`,
      `paths` de Next y `"strict": true`. Sin relajar reglas.
- [x] `apps/web/.env.example` con `NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1` y
      `WEB_PORT=3000`. Copiar a `.env.local` (gitignored).
- [x] `globals.css` con las tres directivas de Tailwind y los tokens de color/espaciado.
- [x] Scripts: `dev` (`next dev`), `build`, `lint`, `typecheck`, `test`.
      **Desvío:** el puerto NO va en el script (`next dev -p ${WEB_PORT:-3000}`) porque pnpm no
      corre un shell y no expande `${VAR:-default}`; se resuelve en `next.config.ts` leyendo
      `WEB_PORT`, con default `3000`. Más portable y sin sorpresas.
- [x] Verificar que `pnpm --filter @datosapi/web build` corre en verde con la página vacía.

## 2. Capa de API (`src/lib/api/`)

- [x] Un cliente por recurso (`sources`, `datasets`, `endpoints`, `health`, `dynamic`),
      tipado con los envelopes de respuesta (`{ data, meta }`).
- [x] Base URL desde `NEXT_PUBLIC_API_URL`; **sin** URL hardcodeada.
- [x] Traducción de error por `code` (`api-contract.md` §1.2), nunca por `message`. Cada
      función devuelve un discriminated union `{ ok: true, data } | { ok: false, error }`
      o lanza un error tipado; **nunca** un `any` ni un catch genérico que pierda el `code`.
- [x] `ApiError` con `code`, `status`, `message`, `details` y un mensaje para UI por `code`.

## 3. Sistema de diseño (`src/components/ui/`)

Componentes propios, cero dependencias de UI externas. Cada uno acepta `className` para
extenderlo.

- [x] `Button` (variantes `primary`/`secondary`/`ghost`/`danger`), `Input`, `Select`,
      `Textarea`, `Checkbox`, `Label`.
- [x] `Card` y `CardHeader`/`CardBody`.
- [x] `Badge` con las variantes derivadas de los estados del dominio: `pending`,
      `processing`, `ready`, `error`, `draft`, `published`, `archived`, `enabled`, `disabled`.
- [x] `DataTable`: columnas declarativas, `loading` (skeleton), `empty` (con acción),
      paginación leyendo `meta`, y `key` por `ColumnSchema.key`.
- [x] `Modal` para confirmaciones y forms; `Toast` para el resultado de una acción.
- [x] `StatCard` para el dashboard (métrica + label + estado).

> Los tokens de Tailwind se definen en `globals.css` para que el modo oscuro sea un solo
> interruptor, no condicionales por componente.

## 4. Shell y navegación

- [x] `layout.tsx` con la estructura de Horizon UI: **sidebar fijo** a la izquierda,
      **navbar superior**, contenido en tarjetas. El panel es de escritorio con sidebar
      colapsable.
- [x] Sidebar con las secciones: Dashboard, Fuentes, Datasets, Endpoints, Docs.
- [x] Marca del activo según la ruta; `Breadcrumb` en las páginas de detalle.
- [x] `NavLink` como Server Component salvo que necesite estado activo por pathname.
- [x] Navbar con el indicador de estado de la API (verde/rojo según `GET /health`) y el
      toggle de tema.

## 5. Pantallas

### 5.1 Dashboard (`/`)

- [x] Cuatro `StatCard`: fuentes totales, por estado, datasets publicados, endpoints
      habilitados.
- [x] Tabla de ingesta reciente: source, `lastIngestAt`, `rowCount`, `status`.
- [x] Listado de endpoints con su `slug` y el link al playground.
- [x] Si la API no responde, mostrar el estado caído **con el motivo**, no pantalla en blanco.

### 5.2 Fuentes (`/sources`, `/sources/[id]`)

- [x] Listado con `type`, `status`, `lastIngestAt` y paginación.
- [x] Alta: el formulario cambia según `type` (manual/api/url/pdf) y sólo pide los campos
      de la variante del `SourceConfig` correspondiente (`data-model.md` §2.1). No pedir
      `url` a una source manual.
- [x] Detalle: config en solo lectura, botón **Ingerir** (que dispara
      `POST /ingest` y muestra `rowCount`, `warnings` y `durationMs` del resultado),
      `lastError` destacado cuando `status = error`, y la lista de versiones del dataset.
- [x] Borrar con confirmación explícita, mencionando que deshabilita los endpoints
      asociados (`data-model.md` §5).

### 5.3 Datasets (`/datasets`, `/datasets/[id]`)

- [x] Listado: `version`, `status`, `rowCount`, `columnsCount`, `warnings`, `updatedAt`.
- [x] Detalle: tabla de `schema` (`key`, `label`, `type`, `nullable`, `decimalScale`) y
      preview de filas renderizado **desde el `schema`**, con el `label` como encabezado.
- [x] Acciones: **Publicar** (`draft` → `published`) y **Archivar**. Confirmación en ambas.
- [x] `warnings[]` visible como badge con el detalle ampliable; `meta` (URL de origen,
      `fetchedAt`, `method`, `durationMs`, `pageCount`) en una sección de trazabilidad.

### 5.4 Endpoints (`/endpoints`, `/endpoints/[id]`)

- [x] Listado: `name`, `slug`, `followLatest`, `enabled`, dataset resuelto.
      **Desvío:** `GET /endpoints` no resuelve datasets (`resolved` sólo viene en el detalle,
      `api-contract.md` §5). Resolverlo por fila sería un N+1 de hasta 50 requests por carga, así
      que el listado muestra el `datasetId` fijado cuando existe y "última publicación" cuando
      `followLatest`; el dataset concreto y el motivo de no resolución se ven en el detalle,
      que sí lo pide. Sin requests extra.
- [x] Editor de la definición: `slug` con validación del patrón en cliente
      (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, 3–80) y de disponibilidad (`409 SLUG_TAKEN` se muestra
      en el campo, no como error genérico).
- [x] Campos `fields`, `filters` y `sort` se editan contra el `schema` del dataset resuelto:
      un desplegable por columna, no un campo de texto libre. Esto evita el `422
      SCHEMA_MISMATCH`.
- [x] Botón **Validar** contra `POST /endpoints/:id/validate`: muestra `valid` y la lista de
      `unknownFields` con el `where` de cada una.
- [x] Toggles de `defaultLimit`/`maxLimit`/`enabled` y el interruptor `followLatest`.
      **Desvío menor:** con `followLatest` el `datasetId` no se **envía** (se manda vacío) pero
      el desplegable sigue visible, porque hace falta elegir un dataset publicado para cargar
      su `schema` y así poder configurar `fields`/`filters`/`sort` en el alta. Ocultarlo dejaría
      el editor sin columnas para elegir en el flujo más común. El hint del campo lo explica.

### 5.5 Playground (`/e/[slug]`)

- [x] Resuelve la definición por `slug` y construye el formulario de filtros **desde
      `filters[]`**, renderizando un control según el `op`: `eq`/`ne` → select o input;
      `gt`/`gte`/`lt`/`lte` → input numérico o fecha según el tipo de la columna;
      `in`/`between` → input CSV; `contains`/`starts_with` → texto.
- [x] Orden desde `sort[]`; paginación con `page`/`limit` leyendo `meta.total`/`meta.pages`.
- [x] Resultado: tabla renderizada desde `fields`/`schema`, y el `curl` equivalente
      copiable con un click, para que el usuario pueda llevar la consulta a su código.
- [x] Errores visibles por `code`: `FILTER_NOT_ALLOWED`, `SORT_NOT_ALLOWED`,
      `INVALID_PAGINATION`, `SLUG_NOT_FOUND` (estado vacío con acción), `502`/`504`
      (el problema es el origen, no el panel).

### 5.6 Docs

- [x] `/docs` redirige a `GET /docs` de la API con un botón explícito, no un iframe.

## 6. Formateo es-AR (`src/lib/format/`)

- [x] `formatNumber(value, decimalScale)` con `Intl.NumberFormat('es-AR')`:
      `54785.28` + `decimalScale: 2` → `54.785,28`; `0.15` + `decimalScale: 4` → `15 %`.
- [x] `formatDate(iso)` → `dd/mm/aaaa`; los campos `date` del schema como `YYYY-MM-DD`.
- [x] `null` → `—`. Nunca `0`, nunca `''` (`conventions.md` §6).
- [x] `boolean` → "Sí"/"No". `json` → `JSON.stringify` con truncado si es largo.

## 7. Tests (Vitest)

- [x] `formatNumber` / `formatDate`: el caso ambiguo (`decimalScale` incorrecto) y `null`.
- [x] Traducción de `code` a mensaje: los códigos de `api-contract.md` §1.2.
- [x] Construcción del query del playground desde `filters[]`/`sort[]`: cada `op` produce el
      query correcto (`in` → CSV, `between` → `a,b`).
- [x] Sin tests de snapshot: se prueba lógica, no render.

## 8. Verificación

- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` en verde desde la raíz
      (6/6, 6/6, 5/5 y 4/4 tareas de Turbo; 52 tests del panel).
- [x] `CORS_ORIGINS` incluye `http://localhost:3000` y la API responde al panel:
      `Access-Control-Allow-Origin: http://localhost:3000`; un origen ajeno no lo recibe.
- [x] Con la API y MongoDB arriba, recorrido del flujo real end-to-end. **Hecho por HTTP,
      no click a click** (no hay navegador en el entorno):
      1. `POST /sources` con el PDF de AFIP real → ingesta `202`, `rowCount: 9`,
         `columnsCount: 5`, `warnings: ["mixed-types column '…_2': number, string -> string"]`,
         `durationMs: 1337`, `pageCount: 4`.
      2. `GET /datasets/:id/schema` → 5 columnas con `decimalScale` inferido.
      3. Publicar → `200`. `POST /endpoints` → `201`. `POST /endpoints/:id/validate` →
         `{ valid: true, unknownFields: [] }`.
      4. Playground del panel contra `?ganancia_neta_imponible_acumulada=100000&limit=3`: la
         tabla renderiza `2.168.491,89 | 108.424,59 | 9,00 | 2.168.491,89`, idéntica a la del
         `curl` que la propia pantalla muestra copiable.
      5. Formato de porcentaje verificado con un dataset de alícuotas de 4 decimales:
         `decimalScale: 4` → `5,25 %`, `9,25 %`, `19,25 %`.
      Todas las rutas del panel respondieron `200` (`/`, `/sources`, `/sources/[id]`,
      `/datasets`, `/datasets/[id]`, `/endpoints`, `/endpoints/[id]`, `/e/[slug]`, `/docs`,
      `/e/<slug-inexistente>`).
- [x] Con la API **apagada**, el panel muestra el estado caído **con el motivo** en navbar y
      cuerpo: "No se pudo contactar la API. Verificá que esté levantada y que
      `NEXT_PUBLIC_API_URL` sea correcta." + `fetch failed` + la pista de `pnpm dev`.
- [x] Tema oscuro: verificado en el CSS servido (bloque `.dark` con los 15 tokens
      redefinidos, `:focus-visible` presente, cero clases de columna hardcodeadas) y en el
      HTML (script anti-FOUC `datosapi-theme` + toggle). **No se hizo una revisión visual**,
      que requiere navegador.
- [x] `git status` limpio: ni `.env.local` ni `.next/` en el índice (`apps/web/.gitignore`
      los cubre, más el `.gitignore` raíz).

## 9. Documentación

- [x] Sección "Frontend" en el `README.md` raíz: qué es, cómo correrlo, puerto.
- [x] `specs/frontend.md` §5 contrastado con lo implementado; corregir el spec si la
      realidad difiere (el spec manda, pero un spec falso es peor que ningún spec).
- [x] Roadmap del `README.md` con la fase 09 marcada.

## 10. Criterios de aceptación

- [x] El flujo completo se puede hacer **sin `curl`**.
- [x] Cero paquetes `@horizon-ui/*` en `package.json` y cero código copiado del template.
- [x] Ninguna columna hardcodeada: todo sale del `schema`.
- [x] Ningún filtro hardcodeado: todo sale de `filters[]`/`sort[]`.
- [x] `pnpm dev` levanta api y web en paralelo desde la raíz.

## 11. Commit y push

Este bloque quedó **obsoleto**: [`AGENTS.md`](../../../AGENTS.md) §4 (decisión del owner del
2026-10-01) prohíbe las ramas por fase y los Pull Requests. La fase se commitea y pushea
directo en `main`.

```bash
git checkout main
git pull --ff-only
git add -A
git commit -m "feat: phase 09 — frontend admin panel"
git push origin main
```

## 12. Estado y decisiones

- **Fecha de ejecución:** 2026-10-02

### Alcance real

- Los 68 checkpoints de la fase están marcados y cumplidos, con cinco desvíos documentados
  en el punto donde aparecen (§1 puerto, §5.4 dataset resuelto y `followLatest`, §8 recorrido
  sin navegador, §9 y §11).
- Sin autenticación (fuera de alcance por `frontend.md` §1), sin exportación a Excel, sin
  edición de `rows`/`schema` desde la UI.

### Decisiones

1. **Componentes propios, cero paquetes `@horizon-ui/*`.** Se adopta la *estructura* del
   template (sidebar fijo + navbar + tarjetas) y nada más: cero código copiado, cero assets.
   Verificado: `package.json` de `apps/web` sin ninguna dependencia de Horizon UI.
2. **Los tipos del contrato se duplican, no se importan de `@datosapi/common`.** El panel es
   cliente de la API pública: lo que viaja por el cable es la forma serializada (`_id` en vez
   de `id`, fechas ISO en vez de `Date`), que no es el tipo del dominio. Duplicarlo en
   `src/lib/api/types.ts` hace que un cambio de contrato rompa la compilación del panel, que
   es justo lo que se busca. Duplicar *tipos* no es duplicar *reglas de negocio*.
3. **El error es un union de tres motivos**, no una excepción: `http` (con `code`, `status` y
   `details`), `transport` (la API no respondió) y `parse` (2xx con body inesperado). Todas
   las funciones devuelven `{ ok: true, data } | { ok: false, error }` y nunca lanzan: el
   `code` llega intacto hasta la pantalla, que es el requisito de `api-contract.md` §1.1.
4. **`decimalScale: 4` significa porcentaje.** Es la regla del spec (`frontend.md` §6.3) y la
   que hace legible la escala de retención: `0.1525` → `15,25 %`. Verificado contra un
   dataset real.
5. **El playground es un `<form method="get">` sin JavaScript.** La URL de la pantalla *es* la
   consulta, así que el `curl` que muestra es exactamente lo que se ejecutó y se puede
   compartir. La única interactividad del panel está en el tema, el sidebar y los modales.
6. **Cero `any`.** El panel hereda la config de ESLint de la raíz (`no-explicit-any` como
   error, sin `console`) y le suma las reglas de Next (`next/core-web-vitals`,
   `next/typescript`) mediante `FlatCompat`, porque `eslint-config-next` 15 sigue en formato
   eslintrc. No se relaja ninguna regla del backend.
7. **Playground: se resuelve el slug sobre el listado.** El contrato no tiene
   "buscar endpoint por slug". Se recorre `GET /endpoints?limit=200` y se toma el detalle del
   que coincide, que es el único que trae `resolved`. Es lo único que había sin tocar el
   contrato; si el catálogo crece, conviene agregar `GET /endpoints/by-slug/:slug`.

### Deuda y pendientes

- **Fase 08 sigue abierta.** Es el desvío autorizado por el owner. Lo que la 09 dejó
  pendientes para ella: `POST/GET/PATCH/DELETE /sources` no tienen `.e2e-spec.ts` propio, y
  falta cobertura de los servicios del panel más allá de la lógica pura.
- **Revisión visual pendiente** de los dos temas y de los modales, que necesita navegador.
- **El playground re-lista endpoints en cada carga.** Aceptable en el MVP; ver decisión 7.
- **`followLatest` en el editor:** el desplegable de dataset sigue visible para poder cargar
  el `schema` (ver §5.4). Si molesta, la alternativa es pedir el `schema` del dataset resuelto
  del endpoint ya creado.

### Impacto en specs

- [`frontend.md`](../../frontend.md) §4: el árbol real — `src/lib/actions/` existe y no estaba
  en el spec (Server Actions), `src/styles/globals.css` sí coincide. §5 y §6 se cumplieron sin
  cambios; §7 (verificación) se cumple con la salvedad del tercer punto de §8.
- El §11 de esta fase se corrigió para reflejar la decisión de [`AGENTS.md`](../../../AGENTS.md)
  §4 de trabajar en `main` sin ramas.
