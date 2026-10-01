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

- [ ] `pnpm install` (agrega `pdfjs-dist`).
- [ ] Descargar el PDF de ejemplo de AFIP (≈50 KB) a `storage/` en runtime.

### Valores por defecto si no hay respuesta

- Los defaults de arriba; si no hay red, seguir con fixture y documentar el bloqueo.

---

## 1. Instalación

- [ ] `pnpm --filter @datosapi/api add pdfjs-dist`.
- [ ] Si `pdfjs-dist` lo requiere, configurar `canvas` como dependencia opcional y
  documentarlo en `AGENTS.md` §3 (no es bloqueante: sólo hace falta **extracción de texto con
  coordenadas**, no rasterizado).

## 2. `pdf-table-extractor.ts`

> Implementa literalmente el algoritmo de [`ingestion.md`](../../ingestion.md) §4.4.

- [ ] `loadItems(buffer)` → `{ page, str, x, y, width, height }[]` con
  `pdfjs.getDocument({ data })` + `page.getTextContent()`.
- [ ] `groupLines(items)`: agrupar por **Y** con tolerancia `0.5 * lineHeight`; ordenar por
  `x` dentro de la línea.
- [ ] `detectColumns(lines)`: cortar por gaps horizontales usando la **mediana de gaps** como
  umbral (evita cortes por espacios de una sola palabra).
- [ ] `isUsefulTable(lines)`: ≥ 2 columnas no vacías en al menos la mitad de las líneas; si no,
  se descarta la página (portada, encabezado institucional).
- [ ] `detectHeaderRow(lines, hints?)`: primera fila mayoritariamente no numérica, con hints
  opcionales. Si no hay header ⇒ `warning: no-header-detected` + claves `col_1..col_n`.
- [ ] `rowsFromTable(table, headers)`: una fila por línea; rellena con `null` y emite
  `warning: row {n} had {m} cells, expected {k}` si el ancho no coincide.
- [ ] `isNoiseRow(cells)`: vacías, sólo puntos/guiones, o pie de página.
- [ ] Todo pasa por `tabular-normalizer` (fase 04) para `schema` y tipos.

## 3. Strategies `pdf` y `url`

- [ ] `pdf.strategy.ts`: descarga (con timeout y límite de bytes), persiste el binario en
  `STORAGE_DIR/<sourceId>/<timestamp>.pdf`, extrae la tabla `tableIndex` (default la primera
  útil), devuelve `meta` con `pageCount`, `tableCount`, `rawRowCount`, `bytes`,
  `contentType`, `durationMs`.
- [ ] `url.strategy.ts`: delega según `content-type` (o `contentTypeHint` o extensión):
  pdf → `pdf.strategy`; json → igual que `api`; csv → igual que `manual/csv`;
  `text/plain` → intenta CSV; otro ⇒ `415`.
- [ ] Sin tabla reconocible ⇒ `422 UNPROCESSABLE_CONTENT` con
  `no tabular region detected`.
- [ ] `headerHints` opcional para reforzar la detección del encabezado.

## 4. Fixture de test

- [ ] `src/ingestion/__fixtures__/tabla-simple.pdf`: PDF **propio**, generado con un script
  (`src/ingestion/__fixtures__/make-fixture.ts`, ejecutable con `pnpm tsx`), que simule una
  tabla de 3 columnas y 6 filas, con encabezado en texto y separadores por espacios.
- [ ] Test unitario del extractor contra ese fixture: 6 filas, 3 columnas, sin warnings.
- [ ] Segundo test con un PDF de una columna ⇒ `no-header-detected` + `col_1`.
- [ ] **El PDF de AFIP no se usa en los tests** (no depender de red en CI).

## 5. Verificación con el caso real (AFIP)

- [ ] Descargar:
  `https://www.afip.gob.ar/gananciasYBienes/ganancias/personas-humanas-sucesiones-indivisas/declaracion-jurada/documentos/Tabla-Art-94-LIG-per-jul-a-dic-2026.pdf`
- [ ] Crear la source con `headerHints: ["Tramo", "Importe", "Alícuota", "Retención"]`.
- [ ] Ingerir y verificar contra el PDF a ojo:
  - [ ] `rowCount` coincide con la cantidad de tramos de la tabla.
  - [ ] `schema` con `tramo`, `importe_desde`, `importe_hasta`, `alicuota`, `retencion`
        como `number` (excepto `tramo`, que puede ser `string`).
  - [ ] `warnings: []`. Si aparece `no-header-detected`, **es un bug**: la detección de
        columnas o de encabezado falló.
  - [ ] Los importes coinciden con los del PDF (comparar 3 filas al azar).

## 6. Criterios de aceptación

- [ ] Tests del extractor verdes contra el fixture propio.
- [ ] Ingesta real del PDF de AFIP con `warnings: []` y valores correctos.
- [ ] `GET /sources/:id/datasets` muestra `version: 1` con el dataset completo.
- [ ] PDF > `INGEST_MAX_BYTES` ⇒ `413`. URL inexistente ⇒ `502`.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` en verde.

## 7. Commit y push

```bash
git checkout -b fase/05-ingesta-pdf
git add -A
git commit -m "feat(ingestion): extract pdf tables and verify AFIP dataset"
git push -u origin fase/05-ingesta-pdf
```

Abrir PR hacia `main`.

## 8. Estado y decisiones

- Fecha de ejecución: **<AGREGAR>**
- `<AGREGAR: veredicto del PDF real, schema detectado, warnings, desvíos>`