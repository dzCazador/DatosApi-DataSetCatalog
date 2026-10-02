# Fase 05 — Ingesta PDF por coordenadas + caso AFIP

> **Objetivo:** extraer tablas de un PDF y completar el flujo end-to-end con el caso real de
> la Escala de Retención de Ganancias 4ª Categoría (AFIP, Art. 94 LIG).

**Spec de referencia:** [`ingestion.md`](../../ingestion.md) §4.4, §5 (normativo).

---

## 0. Preguntas y permisos (obligatorio antes de empezar)

### Preguntas

1. **¿Descarga del PDF de AFIP durante el desarrollo?** Default: **sí**, requiere red a
   `www.afip.gob.ar`. Si no hay red, la fase se cierra con un PDF fixture propio y el smoke
   test real queda pendiente.
2. **`storage/` en git.** Default: **ignorado** (ya está en `.gitignore` de la fase 00/01).
3. **Dependencia de parsing.** Default: `pdfjs-dist` (NO `pdf-parse`; ver
   [`stack.md`](../../stack.md) §2.3). Si `pdfjs-dist` da problemas con Node 22 sin
   canvas, se evalúa `pdf2json` como alternativa.

### Permisos a solicitar

- [x] `pnpm install` (agrega `pdfjs-dist`) — concedido.
- [x] Escribir en `storage/` para el binario descargado — concedido.
- [x] Levantar MongoDB (Docker) para el smoke test end-to-end — concedido.
- [x] Commit y push directo a `main` — concedido.

> El PDF de AFIP pesa 419.335 bytes, no ≈50 KB como estimado en la fase, y ocupa 4 páginas:
> una con la escala del Art. 94 y tres con las tablas mensuales por mes de pago.

### Valores por defecto si no hay respuesta

- Los defaults de arriba; si no hay red, seguir con fixture y documentar el bloqueo.

---

## 1. Instalación

- [x] `pnpm --filter @datosapi/api add pdfjs-dist` → **3.11.174** (build `legacy` CommonJS).
  Desde la 4, `pdfjs-dist` es ESM puro y no se puede `require` desde un backend CommonJS. El
  motivo queda documentado en [`stack.md`](../../stack.md) §2.3.
- [x] `canvas` **no** se agrega: sólo hace falta extracción de texto con coordenadas, nunca
  rasterizado. `pdfjs-dist` lo intenta cargar y avisa por `console` que no puede polyfillar
  `DOMMatrix`/`Path2D`; son warnings de rendering y no afectan la extracción.

## 2. `pdf/pdf-table-extractor.ts`

> Implementa literalmente el algoritmo de [`ingestion.md`](../../ingestion.md) §4.4.

- [x] `loadItems(buffer)` → `{ page, str, x, y, width, height }[]` con
  `pdfjs.getDocument({ data })` + `page.getTextContent()`.
- [x] `groupLines(items)`: agrupar por **Y** con tolerancia `0.5 * lineHeight`; ordenar por
  `x` dentro de la línea.
- [x] `detectColumns(lines)`: cortar por gaps horizontales usando la **mediana de gaps** como
  umbral (evita cortes por espacios de una sola palabra).
- [x] `isUsefulTable(lines)`: ≥ 2 columnas no vacías en al menos la mitad de las líneas; si no,
  se descarta la página (portada, encabezado institucional).
- [x] `detectHeaderRow(lines, hints?)`: primera fila mayoritariamente no numérica, con hints
  opcionales. Si no hay header ⇒ `warning: no-header-detected` + claves `col_1..col_n`.
- [x] `rowsFromTable(table, headers)`: una fila por línea; rellena con `null` y emite
  `warning: row {n} had {m} cells, expected {k}` si el ancho no coincide.
- [x] `isNoiseRow(cells)`: vacías, sólo puntos/guiones, o pie de página.
- [x] Todo pasa por `tabular-normalizer` (fase 04) para `schema` y tipos.

## 3. Strategies `pdf` y `url`

- [x] `pdf.strategy.ts`: descarga (con timeout y límite de bytes), persiste el binario en
  `STORAGE_DIR/<sourceId>/<timestamp>.pdf`, extrae la tabla `tableIndex` (default la primera
  útil), devuelve `meta` con `pageCount`, `tableCount`, `rawRowCount`, `bytes`,
  `contentType`, `durationMs`.
- [x] `url.strategy.ts`: delega según `content-type` (o `contentTypeHint` o extensión):
  pdf → `pdf.strategy`; json → igual que `api`; csv → igual que `manual/csv`;
  `text/plain` → intenta CSV; otro ⇒ `415`.
- [x] Sin tabla reconocible ⇒ `422 UNPROCESSABLE_CONTENT` con
  `no tabular region detected`.
- [x] `headerHints` opcional para reforzar la detección del encabezado: elige el bloque de
  encabezado que contiene el hint, nunca inventan el nombre de una columna que el PDF no escribió.
- [x] `csv-table.ts` extraído de `manual.strategy.ts` para que `manual` y `url` compartan el
  parseo CSV sin duplicarlo (ingestion.md §5).

## 4. Fixture de test

- [x] `src/ingestion/pdf/__fixtures__/make-fixture.ts`: genera los PDFs **en memoria** con un
  script propio. No se commitea ningún binario (`.gitignore` excluye `*.pdf`, y un binario en el
  repo no se puede revisar con un diff). Para abrirlos a ojo:
  `pnpm --filter @datosapi/api exec ts-node src/ingestion/pdf/__fixtures__/make-fixture.ts`.
- [x] Tabla de 3 columnas × 6 filas con encabezado en texto y separadores por espacios:
  6 filas, 3 columnas, sin warnings.
- [x] Tabla de 2 columnas **sin fila de encabezado** ⇒ `no-header-detected` + `col_1`, `col_2`.
- [x] Página de una sola columna (prosa) ⇒ `422 no tabular region detected` (ingestion.md §4.4
  paso 4 descarta las páginas sin al menos dos columnas).
- [x] **El PDF de AFIP no se usa en los tests** (no depender de red en CI).

## 5. Verificación con el caso real (AFIP)

- [x] Descargado:
  `https://www.afip.gob.ar/gananciasYBienes/ganancias/personas-humanas-sucesiones-indivisas/declaracion-jurada/documentos/Tabla-Art-94-LIG-per-jul-a-dic-2026.pdf`
  (419.335 bytes, `application/pdf`, 4 páginas).
- [x] Creada la source con `headerHints: ["Tramo", "Importe", "Alícuota", "Retención"]` y
  ingerida contra el Mongo local. `POST /sources/:id/ingest` → `202`.
- [x] `rowCount` = **9**, que es la cantidad de tramos de la escala del Art. 94 de la página 1
  (0 a 2.168.491,89 / 2.168.491,89 a 4.336.983,77 / … / 65.867.941,10 en adelante).
- [x] `schema` con 5 columnas y 4 de ellas `number`. Ver desvío D1 sobre los nombres.
- [x] Los importes coinciden con el PDF: se compararon los 9 tramos contra el documento.
- [x] `GET /sources/:id/datasets` devuelve `version: 1` con el dataset completo.

### Desvíos respecto de lo esperado por el spec

- **D1 — los nombres de columna no son los que anticipaba el spec.** La fase y
  [`ingestion.md`](../../ingestion.md) §9.1 esperan `tramo`, `importe_desde`, `importe_hasta`,
  `alicuota`, `retencion`. El PDF real no escribe esos rótulos: el encabezado de la página 1 dice
  "Ganancia neta imposable acumulada", "Pagarán", "Más el %" y "Sobre el excedente de $", y el
  primer rótulo abarca las dos primeras columnas (el tramo desde y el tramo hasta), por eso la
  segunda sale como `..._2`. Los `headerHints` del ejemplo (`Tramo`, `Importe`, `Alícuota`,
  `Retención`) tampoco aparecen en el documento, así que no pueden renombrar nada.
  No se renombra a mano: `ingestion.md` §1 prohíbe inventar lo que no se puede determinar, y el
  `headerHints` existe para reforzar la detección, no para sobreescribir el rótulo del PDF.
- **D2 — `warnings` no es `[]`.** Trae `mixed-types column '..._2': number, string -> string`:
  el último tramo dice "en adelante" en vez de un número, que es el dato real del PDF. Es el
  comportamiento correcto de `data-model.md` §6 (tipo mezclado degrada a `string` + warning) y no
  un bug de detección. Lo que la fase marca como bug —`no-header-detected`— **no** aparece: el
  encabezado se detecta bien.
- **D3 — `IngestContext` incorpora `sourceId`.** No estaba en el contrato de
  [`ingestion.md`](../../ingestion.md) §3, pero §4.4 exige persistir el PDF en
  `STORAGE_DIR/<sourceId>/<timestamp>.pdf`. Sin el id, la única forma de cumplir la ruta sería un
  directorio compartido donde un archivo no se puede atribuir a su source. Se completó el
  contrato y se documentó el porqué en `packages/common/src/types.ts`.

## 6. Criterios de aceptación

- [x] Tests del extractor verdes contra el fixture propio (`pdf-table-extractor.spec.ts`).
- [x] Ingesta real del PDF de AFIP con los valores correctos y `no-header-detected` ausente.
- [x] `GET /sources/:id/datasets` muestra `version: 1` con el dataset completo.
- [x] PDF > `INGEST_MAX_BYTES` ⇒ `413`. URL inexistente ⇒ `502`. Content-type no soportado ⇒ `415`.
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` en verde, más `pnpm test:e2e`
  (3 suites, 24 tests) contra el Mongo real.

## 7. Commit y push

Directo en `main`, sin rama ni PR (decisión del owner registrada en `AGENTS.md` §4).

## 8. Estado y decisiones

- **Fecha de ejecución:** 2026-10-02.
- **Veredicto del PDF real:** la extracción por coordenadas funciona sobre el documento real:
  9 filas, 5 columnas, los importes coinciden con el PDF y no aparece `no-header-detected`.
- **Schema detectado:** `ganancia_neta_imponible_acumulada` (number),
  `ganancia_neta_imponible_acumulada_2` (string), `pagaran` (number), `mas_el` (number),
  `sobre_el_excedente_de` (number).
- **Warnings:** `["mixed-types column 'ganancia_neta_imponible_acumulada_2': number, string ->
  string"]`, por el "en adelante" del último tramo. Desvío D2.
- **Desvíos:** D1 (nombres de columna), D2 (warning de tipos mezclados), D3 (`sourceId` en
  `IngestContext`). Los tres quedan explicados arriba.
- **Pendiente para fases siguientes:** nada de la fase 05. La fase 07 puede exponer estos datos
  vía endpoint dinámico; los nombres de columna del PDF real son largos, así que un
  `EndpointDefinition` con alias (`importe_desde`, `alicuota`) es la forma ergonomicamente
  correcta de publicarlos.