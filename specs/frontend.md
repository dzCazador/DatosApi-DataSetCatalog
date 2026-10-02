# Frontend — DatosApi (panel de administración)

> Documento **NORMATIVO**. Define el stack, la estructura y las reglas de UI del frontend que
> se construye en la **fase 09**. El frontend es un **consumidor de la API pública**: no
> habla con MongoDB ni con Mongoose, y no duplica reglas de negocio.

---

## 1. Propósito y alcance

El panel existe para **operar** DatosApi, no para reemplazar la API:

| Pantalla | Qué resuelve | Endpoints que consume |
|---|---|---|
| Dashboard | Estado del sistema: fuentes por estado, ingesta reciente, endpoints publicados | `GET /health`, `GET /sources`, `GET /datasets`, `GET /endpoints` |
| Fuentes | Alta, edición, disparo de ingesta y diagnóstico de errores | `/sources*` |
| Datasets | Versiones por fuente, `schema`, `warnings`, preview de filas, publicar/archivar | `/datasets*` |
| Endpoints | Alta/edición de la definición, allowlist de filtros, validar contra el schema | `/endpoints*` |
| Playground | Probar `GET /e/:slug` con filtros y ver la respuesta real | `GET /e/:slug` |
| Docs | Enlace a Swagger (`/docs`) | — |

**Fuera de alcance del frontend:** autenticación (fase futura, ver
[`architecture.md`](architecture.md) §10), exportación a Excel, edición de `rows` o `schema`
desde la UI (los datos se cambian reingeriendo), y multi-tenancy.

---

## 2. Decisión de diseño: inspirado en Horizon UI

El panel se **inspira** en
[horizon-ui/horizon-tailwind-react-nextjs](https://github.com/horizon-ui/horizon-tailwind-react-nextjs)
(template de dashboard open source para Tailwind + Next.js, licencia MIT en el repositorio;
la licencia comercial de Horizon UI / Simmmple cubre el template y sus assets).

Qué se toma y qué no:

| Se adopta | No se adopta |
|---|---|
| Estructura de layout: sidebar fijo + navbar superior + contenido en tarjetas | Código, componentes o assets del template |
| Escala de espaciado, radios y sombras de Tailwind | Bloques y páginas de ejemplo (NFTs, perfil, auth) |
| Tipografía y escala de grises | Dependencias del template (`@horizon-ui/*`) |
| Modo claro/oscuro con tokens de Tailwind | Imágenes, logos o marcas de Horizon UI / Simmmple |
| Patrones de tabla, badge de estado, tarjeta de métrica | Código de las páginas de ejemplo |

**Regla:** el frontend es **código propio**. Se escriben los componentes desde cero con
Tailwind + los tokens definidos acá. No se clona ni se vendoriza el template, y no se
instalan paquetes `@horizon-ui/*`. Esto mantiene el proyecto sin dependencia de la licencia
comercial y deja el diseño ser propio.

Si alguna vez se decide usar el template como base, es un cambio de licencia y debe
documentarse como decisión explícita, no como detalle de implementación.

---

## 3. Stack

| Pieza | Elección | Versión objetivo | Nota |
|---|---|---|---|
| Framework | Next.js (App Router) | 15.x | Render en servidor por defecto; el panel es de lectura mayoritaria |
| UI runtime | React | 19.x | — |
| Lenguaje | TypeScript | 5.x `strict` | Mismas reglas que el backend ([`conventions.md`](conventions.md) §1) |
| Estilos | Tailwind CSS | 3.x | Sin CSS-in-JS ni librerías de componentes |
| Iconos | `lucide-react` | — | Set outline, una sola dependencia de iconos |
| Cliente HTTP | `fetch` nativo | — | Se reusa la capa de `fetch` del backend; no Axios |
| Formularios | React Server Actions + `zod` | 4.x | `zod` valida en el servidor **y** en el cliente con los mismos esquemas |

**Sin** librería de componentes de UI (MUI, Chakra, Ant Design, shadcn completo). Los
componentes del panel son propios y viven en `apps/web/src/components/ui`.

### 3.1 Por qué Next.js y no un SPA

1. El panel es **de lectura**: listados, schema, preview y playground. El servidor renderiza
   la primera vista sin waterfall de requests.
2. El `schema` del dataset permite generar la tabla y los filtros **en el servidor**, que es
   donde vive el dato.
3. Un solo proceso y un solo puerto para el panel en dev.

---

## 4. Estructura

```text
apps/web/
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx                # shell: sidebar + navbar
│  │  ├─ page.tsx                  # dashboard
│  │  ├─ error.tsx                 # error boundary del panel (no de la API)
│  │  ├─ not-found.tsx
│  │  ├─ sources/
│  │  │  ├─ page.tsx               # listado + alta
│  │  │  └─ [id]/page.tsx          # detalle + ingesta + datasets
│  │  ├─ datasets/
│  │  │  ├─ page.tsx
│  │  │  └─ [id]/page.tsx          # schema + preview + publicar/archivar
│  │  ├─ endpoints/
│  │  │  ├─ page.tsx               # listado + alta
│  │  │  └─ [id]/page.tsx          # editor de definición + validar
│  │  ├─ e/[slug]/page.tsx         # playground del endpoint dinámico
│  │  └─ docs/page.tsx             # enlace a /docs de la API
│  ├─ components/
│  │  ├─ ui/                       # DataTable, Button, Badge, Card, Modal, Toast, Input…
│  │  ├─ layout/                   # Sidebar + Navbar + Breadcrumb
│  │  ├─ data-columns.tsx          # columnas de tabla derivadas de ColumnSchema[]
│  │  ├─ schema-columns.tsx        # tabla del schema
│  │  ├─ api-error-banner.tsx      # error de API traducido por code
│  │  ├─ sources/                  # formulario de alta, ingesta, borrado
│  │  ├─ datasets/                 # publicar/archivar, warnings
│  │  ├─ endpoints/                # editor, listas de campos/filtros/sort, validar, borrar
│  │  └─ playground/               # formulario de filtros
│  ├─ lib/
│  │  ├─ actions/                  # Server Actions + traducción del resultado a la UI
│  │  ├─ api/                      # clientes por recurso + tipos de respuesta
│  │  ├─ schema/                   # zod: source config, editor de endpoint, slug, paginación
│  │  ├─ format/                   # number/date/percent es-AR según ColumnSchema
│  │  └─ cn.ts
│  ├─ test/setup.ts
│  └─ styles/globals.css           # @tailwind + tokens (claro y .dark)
├─ .env.example                    # NEXT_PUBLIC_API_URL + WEB_PORT
├─ next.config.ts
├─ tailwind.config.ts
├─ turbo.json                      # outputs .next/** y env del panel
├─ vitest.config.ts
└─ tsconfig.json
```

- Las rutas de Next **mapean 1:1 con los recursos de la API**: `/sources` ↔ `/sources`,
  `/datasets` ↔ `/datasets`, `/endpoints` ↔ `/endpoints`. El slug del playground es la
  única ruta parametrizada por dato.
- El cliente de API vive en `src/lib/api/`. Ninguna página hace `fetch` directo: pasa por
  un cliente por recurso, que aplica `API_URL` y traduce errores.
- `src/lib/actions/` contiene las **Server Actions**. Devuelven siempre el mismo shape
  (`{ ok, message, detail?, fieldErrors? }`), nunca lanzan y nunca devuelven `Error`: una
  acción que devuelve `redirect()` se declara como `Promise<ActionResult>` porque `redirect`
  tira y nunca retorna.

---

## 5. Contrato con la API

- **Base URL:** variable de entorno `NEXT_PUBLIC_API_URL` (default
  `http://localhost:3001/api/v1`). Se define en `apps/web/.env.local`, que queda
  gitignored.
- **CORS:** la API acepta el origen del panel vía `CORS_ORIGINS`
  ([`stack.md`](stack.md) §6). Es la única pieza de backend que agrega la fase 09.
- **Errores:** el panel ramifica por `code`, nunca por `message`
  ([`api-contract.md`](api-contract.md) §1.2). Un `SLUG_NOT_FOUND` muestra un estado vacío
  con acción; un `FILTER_NOT_ALLOWED` muestra un aviso de que el filtro no está permitido;
  un `502`/`504` muestra que el problema es el origen, no el panel.
  Hay **tres** motivos de fallo, no uno: `http` (la API respondió con un `code`), `transport`
  (no respondió: apagada, `NEXT_PUBLIC_API_URL` mal, red) y `parse` (`2xx` con body
  inesperado). Los tres se presentan con un motivo visible: nunca hay pantalla en blanco.
- **Paginación:** el panel siempre manda `page` y `limit` explícitos, y usa `meta.total` /
  `meta.pages` de la respuesta. Nunca pagina en cliente sobre un conjunto ya recortado.
- **Filtros del playground:** el formulario se construye a partir de `filters[]` y `sort[]`
  de la `EndpointDefinition`, renderizando un control según el `op` declarado. El panel no
  ofrece campos de filtro libres porque la API los rechazaría con `400`.

---

## 6. Reglas de UI

1. **El `schema` manda.** Toda columna renderizada sale de `ColumnSchema[]` (`key`, `label`,
   `type`, `nullable`, `decimalScale`). Nunca se hardcodea el nombre de una columna.
2. **`warnings` siempre visible.** Un dataset con `warnings[]` no vacío muestra un badge
   con el count; el detalle se abre. La extracción dudosa no se esconde (ver
   [`architecture.md`](architecture.md) §6).
3. **Formato es-AR desde el `decimalScale`.** `importe_desde` con `decimalScale: 2` se
   muestra con 2 decimales y separador de miles; `alicuota` con `decimalScale: 4` se muestra
   como porcentaje (`0.15` → `15 %`). Un `null` se muestra como `—`, nunca como `0`.
4. **Estados vacíos con acción.** "Sin fuentes todavía" ofrece crear una. "Sin endpoints"
   ofrece crear uno desde un dataset publicado.
5. **Destructive actions con confirmación.** Borrar un source o un endpoint pide
   confirmación, porque el borrado tiene efectos (ver [`data-model.md`](data-model.md) §5).
6. **Dark mode** vía tokens de Tailwind (`darkMode: 'class'`), con persistencia en
   `localStorage`.
7. **Accesibilidad:** navegación por teclado en sidebar, tabla con `<th scope>`, foco
   visible, contraste AA en ambos modos.
8. **Responsive mínimo:** sidebar colapsable; el panel se usa en escritorio, pero no se
   rompe en tablet.

---

## 7. Verificación

- `pnpm lint` y `pnpm typecheck` en verde para `apps/web`. El panel **hereda** la config de
  ESLint de la raíz y le suma `next/core-web-vitals` + `next/typescript` vía `FlatCompat`
  (`eslint-config-next` 15 sigue en formato eslintrc). Ninguna regla del backend se relaja.
- Tests con Vitest + Testing Library sólo donde hay lógica propia: formateo según
  `ColumnSchema`, traducción de `code` a mensaje, y construcción del query del playground a
  partir de `filters[]`/`sort[]`.
- **Sin** tests de renderizado completo: lo que se prueba es la lógica, no el snapshot.
  `@testing-library/react` queda declarado como dependencia para cuando haya lógica de
  componente que probar de verdad, no para快照.
- Verificación manual contra la API real siguiendo el flujo de
  [`api-contract.md`](api-contract.md) §8. La del panel se hizo por HTTP (ver
  [`todo/begin/09-frontend-admin.md`](todo/begin/09-frontend-admin.md) §8): la revisión
  **visual** de los dos temas y de los modales sigue pendiente porque necesita navegador.
