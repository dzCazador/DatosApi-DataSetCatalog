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

- [ ] `pnpm install` de las dependencias de `apps/web`.
- [ ] Agregar `http://localhost:3000` a `CORS_ORIGINS` en `.env.example` y `.env`.
- [ ] Levantar la API y MongoDB (`pnpm infra:up`, `pnpm dev`) para verificar contra la API real.

### Valores por defecto si no hay respuesta

- Los defaults de arriba.

---

## 1. Bootstrap de `apps/web`

- [ ] Crear `apps/web/package.json`: `next@^15`, `react@^19`, `react-dom@^19`,
      `tailwindcss@^3`, `postcss`, `autoprefixer`, `lucide-react`, `zod@^4`.
      Dev: `typescript`, `@types/react`, `@types/node`, `eslint`, `eslint-config-next`,
      `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.
- [ ] `next.config.ts`, `tailwind.config.ts` con `darkMode: 'class'` y
      `content: ['./src/**/*.{ts,tsx}']`, `postcss.config.js`.
- [ ] `tsconfig.json` extendido de `tsconfig.base.json` con `jsx: preserve`,
      `paths` de Next y `"strict": true`. Sin relajar reglas.
- [ ] `apps/web/.env.example` con `NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1` y
      `WEB_PORT=3000`. Copiar a `.env.local` (gitignored).
- [ ] `globals.css` con las tres directivas de Tailwind y los tokens de color/espaciado.
- [ ] Scripts: `dev` (`next dev -p 3000`), `build`, `lint`, `typecheck`, `test`.
- [ ] Verificar que `pnpm --filter web build` corre en verde con la página vacía.

## 2. Capa de API (`src/lib/api/`)

- [ ] Un cliente por recurso (`sources`, `datasets`, `endpoints`, `health`, `dynamic`),
      tipado con los envelopes de respuesta (`{ data, meta }`).
- [ ] Base URL desde `NEXT_PUBLIC_API_URL`; **sin** URL hardcodeada.
- [ ] Traducción de error por `code` (`api-contract.md` §1.2), nunca por `message`. Cada
      función devuelve un discriminated union `{ ok: true, data } | { ok: false, error }`
      o lanza un error tipado; **nunca** un `any` ni un catch genérico que pierda el `code`.
- [ ] `ApiError` con `code`, `status`, `message`, `details` y un mensaje para UI por `code`.

## 3. Sistema de diseño (`src/components/ui/`)

Componentes propios, cero dependencias de UI externas. Cada uno acepta `className` para
extenderlo.

- [ ] `Button` (variantes `primary`/`secondary`/`ghost`/`danger`), `Input`, `Select`,
      `Textarea`, `Checkbox`, `Label`.
- [ ] `Card` y `CardHeader`/`CardBody`.
- [ ] `Badge` con las variantes derivadas de los estados del dominio: `pending`,
      `processing`, `ready`, `error`, `draft`, `published`, `archived`, `enabled`, `disabled`.
- [ ] `DataTable`: columnas declarativas, `loading` (skeleton), `empty` (con acción),
      paginación leyendo `meta`, y `key` por `ColumnSchema.key`.
- [ ] `Modal` para confirmaciones y forms; `Toast` para el resultado de una acción.
- [ ] `StatCard` para el dashboard (métrica + label + estado).

> Los tokens de Tailwind se definen en `globals.css` para que el modo oscuro sea un solo
> interruptor, no condicionales por componente.

## 4. Shell y navegación

- [ ] `layout.tsx` con la estructura de Horizon UI: **sidebar fijo** a la izquierda,
      **navbar superior**, contenido en tarjetas. El panel es de escritorio con sidebar
      colapsable.
- [ ] Sidebar con las secciones: Dashboard, Fuentes, Datasets, Endpoints, Docs.
- [ ] Marca del activo según la ruta; `Breadcrumb` en las páginas de detalle.
- [ ] `NavLink` como Server Component salvo que necesite estado activo por pathname.
- [ ] Navbar con el indicador de estado de la API (verde/rojo según `GET /health`) y el
      toggle de tema.

## 5. Pantallas

### 5.1 Dashboard (`/`)

- [ ] Cuatro `StatCard`: fuentes totales, por estado, datasets publicados, endpoints
      habilitados.
- [ ] Tabla de ingesta reciente: source, `lastIngestAt`, `rowCount`, `status`.
- [ ] Listado de endpoints con su `slug` y el link al playground.
- [ ] Si la API no responde, mostrar el estado caído **con el motivo**, no pantalla en blanco.

### 5.2 Fuentes (`/sources`, `/sources/[id]`)

- [ ] Listado con `type`, `status`, `lastIngestAt` y paginación.
- [ ] Alta: el formulario cambia según `type` (manual/api/url/pdf) y sólo pide los campos
      de la variante del `SourceConfig` correspondiente (`data-model.md` §2.1). No pedir
      `url` a una source manual.
- [ ] Detalle: config en solo lectura, botón **Ingerir** (que dispara
      `POST /ingest` y muestra `rowCount`, `warnings` y `durationMs` del resultado),
      `lastError` destacado cuando `status = error`, y la lista de versiones del dataset.
- [ ] Borrar con confirmación explícita, mencionando que deshabilita los endpoints
      asociados (`data-model.md` §5).

### 5.3 Datasets (`/datasets`, `/datasets/[id]`)

- [ ] Listado: `version`, `status`, `rowCount`, `columnsCount`, `warnings`, `updatedAt`.
- [ ] Detalle: tabla de `schema` (`key`, `label`, `type`, `nullable`, `decimalScale`) y
      preview de filas renderizado **desde el `schema`**, con el `label` como encabezado.
- [ ] Acciones: **Publicar** (`draft` → `published`) y **Archivar**. Confirmación en ambas.
- [ ] `warnings[]` visible como badge con el detalle ampliable; `meta` (URL de origen,
      `fetchedAt`, `method`, `durationMs`, `pageCount`) en una sección de trazabilidad.

### 5.4 Endpoints (`/endpoints`, `/endpoints/[id]`)

- [ ] Listado: `name`, `slug`, `followLatest`, `enabled`, dataset resuelto.
- [ ] Editor de la definición: `slug` con validación del patrón en cliente
      (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, 3–80) y de disponibilidad (`409 SLUG_TAKEN` se muestra
      en el campo, no como error genérico).
- [ ] Campos `fields`, `filters` y `sort` se editan contra el `schema` del dataset resuelto:
      un desplegable por columna, no un campo de texto libre. Esto evita el `422
      SCHEMA_MISMATCH`.
- [ ] Botón **Validar** contra `POST /endpoints/:id/validate`: muestra `valid` y la lista de
      `unknownFields` con el `where` de cada una.
- [ ] Toggles de `defaultLimit`/`maxLimit`/`enabled` y el interruptor `followLatest` (que
      oculta `datasetId` cuando está activo).

### 5.5 Playground (`/e/[slug]`)

- [ ] Resuelve la definición por `slug` y construye el formulario de filtros **desde
      `filters[]`**, renderizando un control según el `op`: `eq`/`ne` → select o input;
      `gt`/`gte`/`lt`/`lte` → input numérico o fecha según el tipo de la columna;
      `in`/`between` → input CSV; `contains`/`starts_with` → texto.
- [ ] Orden desde `sort[]`; paginación con `page`/`limit` leyendo `meta.total`/`meta.pages`.
- [ ] Resultado: tabla renderizada desde `fields`/`schema`, y el `curl` equivalente
      copiable con un click, para que el usuario pueda llevar la consulta a su código.
- [ ] Errores visibles por `code`: `FILTER_NOT_ALLOWED`, `SORT_NOT_ALLOWED`,
      `INVALID_PAGINATION`, `SLUG_NOT_FOUND` (estado vacío con acción), `502`/`504`
      (el problema es el origen, no el panel).

### 5.6 Docs

- [ ] `/docs` redirige a `GET /docs` de la API con un botón explícito, no un iframe.

## 6. Formateo es-AR (`src/lib/format/`)

- [ ] `formatNumber(value, decimalScale)` con `Intl.NumberFormat('es-AR')`:
      `54785.28` + `decimalScale: 2` → `54.785,28`; `0.15` + `decimalScale: 4` → `15 %`.
- [ ] `formatDate(iso)` → `dd/mm/aaaa`; los campos `date` del schema como `YYYY-MM-DD`.
- [ ] `null` → `—`. Nunca `0`, nunca `''` (`conventions.md` §6).
- [ ] `boolean` → "Sí"/"No". `json` → `JSON.stringify` con truncado si es largo.

## 7. Tests (Vitest)

- [ ] `formatNumber` / `formatDate`: el caso ambiguo (`decimalScale` incorrecto) y `null`.
- [ ] Traducción de `code` a mensaje: los códigos de `api-contract.md` §1.2.
- [ ] Construcción del query del playground desde `filters[]`/`sort[]`: cada `op` produce el
      query correcto (`in` → CSV, `between` → `a,b`).
- [ ] Sin tests de snapshot: se prueba lógica, no render.

## 8. Verificación

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` en verde desde la raíz.
- [ ] `CORS_ORIGINS` incluye `http://localhost:3000` y la API responde al panel.
- [ ] Con la API y MongoDB arriba, recorrer el flujo real end-to-end desde el panel:
      crear source PDF de AFIP → ingerir → ver `rowCount` y `warnings` → publicar →
      crear endpoint → validar → playground con `importe_desde=50000` → confirmar que la
      tabla coincide con el `curl` que devuelve el panel.
- [ ] Revisar el panel en tema claro y oscuro.
- [ ] `git status` limpio: ni `.env.local` ni `.next/` en el índice.

## 9. Documentación

- [ ] Sección "Frontend" en el `README.md` raíz: qué es, cómo correrlo, puerto.
- [ ] `specs/frontend.md` §5 contrastado con lo implementado; corregir el spec si la
      realidad difiere (el spec manda, pero un spec falso es peor que ningún spec).
- [ ] Roadmap del `README.md` con la fase 09 marcada.

## 10. Criterios de aceptación

- [ ] El flujo completo se puede hacer **sin `curl`**.
- [ ] Cero paquetes `@horizon-ui/*` en `package.json` y cero código copiado del template.
- [ ] Ninguna columna hardcodeada: todo sale del `schema`.
- [ ] Ningún filtro hardcodeado: todo sale de `filters[]`/`sort[]`.
- [ ] `pnpm dev` levanta api y web en paralelo desde la raíz.

## 11. Commit y push

```bash
git checkout -b fase/09-frontend-admin
git add -A
git commit -m "feat(web): add admin dashboard inspired by Horizon UI"
git push -u origin fase/09-frontend-admin
```

Abrir PR hacia `main`.

## 12. Estado y decisiones

- Fecha de ejecución: **<AGREGAR>**
- `<AGREGAR: alcance real, componentes propios, desvíos del spec>`
