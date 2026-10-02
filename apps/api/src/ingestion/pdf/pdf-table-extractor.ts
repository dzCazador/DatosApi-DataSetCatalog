import { getDocument } from 'pdfjs-dist/legacy/build/pdf.js';

import type { ColumnSchema, Row } from '@datosapi/common';

import { UnprocessableContentError } from '../errors/ingestion.errors';
import { normalizeTable } from '../normalization/tabular-normalizer';
import type { RawRow } from '../normalization/tabular-normalizer';

/**
 * Extracción de tablas por coordenadas (ingestion.md §4.4 y §5).
 *
 * Un PDF no tiene tablas: tiene fragmentos de texto con posición. Este módulo es el único
 * lugar del repo que sabe eso, y lo implementa como un módulo interno reutilizado por `pdf`
 * y por `url`: las dos strategies delegan acá en lugar de duplicar el algoritmo (§5).
 *
 * Todo lo que no se puede determinar con certeza no se inventa: una columna sin encabezado
 * se llama `col_N` y una fila con menos celdas que columnas se completa con `null` dejando
 * constancia en `warnings`.
 */

/** Fragmento de texto con su posición en la página, en el sistema de coordenadas del PDF. */
export interface PdfTextItem {
  page: number;
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fragmentos con la misma línea base (mismo `y` dentro de la tolerancia). */
export interface PdfLine {
  page: number;
  /** `y` promedio de los fragmentos de la línea, para ordenar y comparar. */
  y: number;
  height: number;
  items: PdfTextItem[];
}

/** Banda horizontal que corresponde a una columna: de `from` a `to` inclusive. */
export interface ColumnBand {
  index: number;
  from: number;
  to: number;
}

/** Rango de columnas en el que caen los fragmentos de una línea. */
export interface LineCells {
  line: PdfLine;
  /** Un texto por banda; `null` cuando la línea no tiene fragmento en esa columna. */
  cells: (string | null)[];
}

export interface ExtractPdfTableOptions {
  /** 1-based. Ausente ⇒ todas las páginas. */
  pages?: number[];
  /** 0-based sobre las tablas detectadas. Ausente ⇒ la primera útil. */
  tableIndex?: number;
  /** Refuerzan la detección del encabezado; nunca inventan un nombre de columna. */
  headerHints?: string[];
}

export interface PdfExtraction {
  rows: Row[];
  schema: ColumnSchema[];
  warnings: string[];
  /** Cantidad de tablas usefules detectadas en todo el documento. */
  tableCount: number;
  pageCount: number;
  /** Página 1-based de la tabla extraída, para trazabilidad. */
  page: number;
}

/** `getTextContent` mezcla fragmentos de texto con marcas; sólo los primeros tienen posición. */
function isTextItem(item: unknown): item is {
  str: string;
  transform: number[];
  width: number;
  height: number;
} {
  return (
    typeof item === 'object' &&
    item !== null &&
    typeof (item as { str?: unknown }).str === 'string' &&
    typeof (item as { transform?: unknown }).transform === 'object'
  );
}

/** Ancho de página usado como unidad de comparación para las heurísticas de tamaño. */
const A4_WIDTH = 595;

/**
 * Un fragmento más ancho que esto es prosa, no una celda. El umbral es relativo al ancho de
 * página y no absoluto porque un PDF legal tiene el doble de ancho que un A4 y el mismo texto.
 */
const MAX_CELL_RATIO = 0.2;

/** Máximo de líneas que se aceptan como bloque de encabezado. */
const MAX_HEADER_LINES = 8;

/**
 * Fracción de la mediana de huecos que se tolera como hueco interno de una celda. Un cuarto
 * separa con holgura los huecos entre columnas (los grandes) de los internos de celda (los
 * chicos) sin dejar pasar un salto chico entre columnas.
 */
const BAND_GAP_RATIO = 0.25;

/** Piso del umbral: por debajo de 2pt dos fragmentos están pegados, no en columnas distintas. */
const MIN_BAND_GAP = 2;

/**
 * Tolerancia vertical para leer el bloque de encabezado hacia arriba.
 *
 * Es el mayor de dos límites porque los dos acotan casos reales distintos: `pitch × 1.25`
 * rechaza el párrafo institucional que antecede a la tabla (está mucho más lejos que una fila)
 * y `línea × 2.5` acepta un encabezado que el PDF dejó con más de un interlineado de aire
 * respecto de la primera fila, que es tan común como la tabla pegada.
 */
const HEADER_PITCH_FACTOR = 1.25;
const HEADER_LEADING_FACTOR = 2.5;

/** Un item es "celda" si no supera `MAX_CELL_RATIO` del ancho de página. */
function isCellLike(item: PdfTextItem, pageWidth: number): boolean {
  return item.width <= pageWidth * MAX_CELL_RATIO;
}

/** Frase de prosa: un solo fragmento que cubre buena parte de la línea. */
function isProseLine(line: PdfLine, pageWidth: number): boolean {
  const cells = line.items.filter((item) => isCellLike(item, pageWidth));

  if (cells.length > 1) return false;

  return line.items.some((item) => !isCellLike(item, pageWidth));
}

/**
 * Carga los fragmentos de texto con coordenadas (ingestion.md §4.4 paso 2 y 3a).
 *
 * Se usa el build *legacy* de `pdfjs-dist` porque es el único que se puede `require` desde
 * CommonJS, que es lo que compila este proyecto; el build moderno es ESM puro. No hace falta
 * `canvas`: sólo se extraen textos con posición, nunca se rasteriza.
 */
export async function loadItems(
  buffer: Buffer,
  pages?: number[],
): Promise<{ items: PdfTextItem[]; pageCount: number; pageWidth: number }> {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    verbosity: 0,
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
  });

  let document: Awaited<ReturnType<typeof getDocument>['promise']>;

  try {
    document = await loadingTask.promise;
  } catch (error) {
    throw new UnprocessableContentError(
      `El PDF no se pudo leer: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const pageCount = document.numPages;
  const wanted =
    pages === undefined || pages.length === 0
      ? Array.from({ length: pageCount }, (_, index) => index + 1)
      : [...new Set(pages.filter((page) => page >= 1 && page <= pageCount))].sort((a, b) => a - b);

  if (wanted.length === 0) {
    throw new UnprocessableContentError(
      `Ninguna de las páginas pedidas existe: el PDF tiene ${pageCount}`,
      { pages, pageCount },
    );
  }

  const items: PdfTextItem[] = [];
  let pageWidth = A4_WIDTH;

  for (const pageNumber of wanted) {
    const page = await document.getPage(pageNumber);
    const [, , width] = page.view;
    pageWidth = Math.max(width ?? A4_WIDTH, 1);

    const content = await page.getTextContent();

    for (const raw of content.items) {
      // `getTextContent` también devuelve marcas (`TextMarkedContent`) que no llevan texto ni
      // posición: son cero datos para la extracción y se descartan por tipo, no por contenido.
      if (!isTextItem(raw)) continue;

      const str = raw.str;

      // Los espacios que el PDF intercala entre fragmentos no son celdas: grouping y banding
      // los usan sólo para calcular gaps, y dejarlos produce columnas fantasma de un espacio.
      if (str.trim() === '') continue;

      const transform = raw.transform;

      items.push({
        page: pageNumber,
        str,
        x: transform[4] ?? 0,
        y: transform[5] ?? 0,
        width: raw.width,
        height: raw.height,
      });
    }

    page.cleanup();
  }

  await document.destroy();

  return { items, pageCount, pageWidth };
}

/**
 * Agrupa los fragmentos en líneas (ingestion.md §4.4 paso 3b): la tolerancia es media línea
 * de alto, como dice el spec, calculada sobre la altura real de los fragmentos del documento.
 */
export function groupLines(items: readonly PdfTextItem[]): PdfLine[] {
  const heights = items.map((item) => item.height).filter((height) => height > 0);
  const lineHeight = heights.length === 0 ? 10 : median(heights);
  const tolerance = lineHeight / 2;

  const byPage = new Map<number, PdfTextItem[]>();

  for (const item of items) {
    const bucket = byPage.get(item.page);

    if (bucket === undefined) byPage.set(item.page, [item]);
    else bucket.push(item);
  }

  const lines: PdfLine[] = [];

  for (const [page, pageItems] of byPage) {
    const descending = [...pageItems].sort((a, b) => b.y - a.y || a.x - b.x);
    let current: PdfLine | null = null;

    for (const item of descending) {
      if (current !== null && Math.abs(current.y - item.y) <= tolerance) {
        current.items.push(item);
        current.y = (current.y * (current.items.length - 1) + item.y) / current.items.length;
        current.height = Math.max(current.height, item.height);
        continue;
      }

      current = { page, y: item.y, height: item.height, items: [item] };
      lines.push(current);
    }
  }

  for (const line of lines) line.items.sort((a, b) => a.x - b.x);

  return lines.sort((a, b) => a.page - b.page || b.y - a.y);
}

/**
 * Detecta las columnas (ingestion.md §4.4 paso 3d) proyectando los fragmentos sobre el eje X.
 *
 * Un PDF no dibuja columnas: cada celda es un fragmento suelto. Lo que sí se puede medir es
 * qué regiones del eje horizontal cubre *alguna* celda, y esas regiones son las columnas. La
 * proyección evita el error clásico de cortar por los espacios entre palabras: dos palabras de
 * la misma celda se unen en la misma región porque el hueco entre ellas es mucho menor que el
 * que separa dos columnas.
 *
 * El umbral sale de la mediana de los huecos, como pide el spec, y no de un valor fijo: un PDF
 * con cuerpo 6 y uno con cuerpo 14 tienen separaciones de columna muy distintas. Se usa un
 * cuarto de la mediana porque los huecos que hay que respetar son los *entre* columnas, que
 * son los grandes, mientras que los que hay que ignorar son los internos de celda.
 *
 * Se proyecta por intervalo y no por borde izquierdo porque las columnas numéricas suelen
 * estar alineadas a la derecha: dos valores de la misma columna pueden empezar a 20pt de
 * distancia y aun así solaparse, mientras que valores de columnas vecinas nunca solapan.
 */
export function detectColumns(lines: readonly PdfLine[], pageWidth: number): ColumnBand[] {
  const intervals = lines
    .flatMap((line) => line.items)
    .filter((item) => isCellLike(item, pageWidth))
    .map((item) => ({ from: item.x, to: item.x + item.width }))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  if (intervals.length === 0) return [];

  // 1 pt de resolución: más fino que el hueco más chico que distingue dos columnas reales, y
  // lo bastante grueso para no inflar el número de regiones con los bordes de los caracteres.
  const resolution = 1;
  const limit = Math.ceil(pageWidth) + 1;
  const occupied = new Uint8Array(limit);

  for (const interval of intervals) {
    const from = Math.max(0, Math.floor(interval.from));
    const to = Math.min(limit - 1, Math.ceil(interval.to));

    for (let x = from; x <= to; x += resolution) occupied[x] = 1;
  }

  const runs = runsOf(occupied);

  if (runs.length === 0) return [];

  const gaps = runs.slice(1).map((run, index) => run.from - (runs[index]?.to ?? 0));
  const innerGaps = gaps.filter((gap) => gap > 0);
  const threshold = Math.max(MIN_BAND_GAP, median(innerGaps) * BAND_GAP_RATIO);

  const merged: { from: number; to: number }[] = [{ ...(runs[0] as { from: number; to: number }) }];

  for (const [index, run] of runs.entries()) {
    if (index === 0) continue;

    const last = merged[merged.length - 1] as { from: number; to: number };

    if (run.from - last.to <= threshold) last.to = run.to;
    else merged.push({ ...run });
  }

  return merged.map((band, index) => ({ index, from: band.from, to: band.to }));
}

/** Regiones contiguas de eje X con al menos un fragmento encima. */
function runsOf(occupied: Uint8Array): { from: number; to: number }[] {
  const runs: { from: number; to: number }[] = [];
  let from = -1;

  for (let x = 0; x < occupied.length; x++) {
    const filled = (occupied[x] ?? 0) === 1;

    if (filled && from === -1) from = x;
    if (!filled && from !== -1) {
      runs.push({ from, to: x - 1 });
      from = -1;
    }
  }

  if (from !== -1) runs.push({ from, to: occupied.length - 1 });

  return runs;
}

/** Una tabla sirve si al menos la mitad de sus líneas ocupa dos o más columnas. */
export function isUsefulTable(
  lines: readonly PdfLine[],
  bands: readonly ColumnBand[],
  pageWidth: number,
): boolean {
  if (bands.length < 2 || lines.length === 0) return false;

  const usable = lines.filter(
    (line) => splitLine(line, bands, pageWidth).cells.filter(isFilled).length >= 2,
  );

  return usable.length * 2 >= lines.length;
}

/**
 * Parte una línea en celdas, una por banda (ingestion.md §4.4 paso 3c). Varios fragmentos en
 * la misma banda se unen con espacio: es lo que reconstruye "en adelante" o "Más el %" cuando
 * el PDF los separa en trozos.
 */
export function splitLine(
  line: PdfLine,
  bands: readonly ColumnBand[],
  pageWidth: number,
): LineCells {
  const parts = new Map<number, string[]>();

  for (const item of line.items) {
    if (!isCellLike(item, pageWidth)) continue;

    const band = bandOf(item, bands);

    if (band === null) continue;

    const current = parts.get(band.index);

    if (current === undefined) parts.set(band.index, [item.str]);
    else current.push(item.str);
  }

  return {
    line,
    cells: bands.map((band) => {
      const part = parts.get(band.index);
      return part === undefined ? null : collapseSpaces(part.join(' '));
    }),
  };
}

/**
 * La banda a la que pertenece un fragmento. Si cae en el hueco entre dos bandas —que es lo
 * que pasa con celdas muy angostas o con texto desalineado— se asigna a la más cercana en X,
 * porque descartarlo perdería el dato.
 */
function bandOf(item: PdfTextItem, bands: readonly ColumnBand[]): ColumnBand | null {
  const from = item.x;
  const to = item.x + item.width;
  const containing = bands.find((band) => to > band.from && from < band.to);

  if (containing !== undefined) return containing;

  let best: ColumnBand | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const band of bands) {
    const distance = from < band.from ? band.from - from : from - band.to;

    if (distance < bestDistance) {
      best = band;
      bestDistance = distance;
    }
  }

  return best;
}

function isFilled(cell: string | null): boolean {
  return cell !== null && cell.trim() !== '';
}

/**
 * Una fila es ruido cuando no aporta nada: todas sus celdas vacías, o sólo separadores y
 * puntos de relleno, o el número de página al pie (ingestion.md §4.4 paso 7).
 */
export function isNoiseRow(cells: readonly (string | null)[]): boolean {
  const filled = cells.filter(isFilled);

  if (filled.length === 0) return true;

  if (filled.every((cell) => /^[\s.·\-–—_*•]+$/.test(cell as string))) return true;

  // Pie de página: una sola celda con un número suelto y sin decimales no es un dato de tabla.
  if (filled.length === 1)
    return /^p(?:ágina|g|gina|\.)?\s*\d{1,3}$/i.test((filled[0] as string).trim());

  return false;
}

/**
 * Detecta el bloque de encabezado (ingestion.md §4.4 paso 5) y arma un nombre por columna.
 *
 * El encabezado de una tabla real no suele ser una sola línea: en el PDF de AFIP son cinco
 * ("Sobre el", "Más el", "Ganancia neta imponible acumulada / Pagarán / excedente de", "%", "$").
 * Por eso el bloque se lee hacia arriba desde la primera fila de datos, mientras las líneas
 * sean mayoritariamente no numéricas y estén a una distancia vertical de tabla, y las
 * columnas se nombran con todos los fragmentos que caen en ellas, de arriba hacia abajo.
 *
 * `headerHints` sólo ordena: si una de las líneas del bloque contiene alguno de los hints se
 * elige ese bloque. Nunca inventan el nombre de una columna que el PDF no escribió, y si no
 * hay bloque no se emite `no-header-detected` porque eso lo decide la estrategia.
 */
export function detectHeaderRow(
  lines: readonly PdfLine[],
  bands: readonly ColumnBand[],
  dataStartIndex: number,
  pageWidth: number,
  headerHints?: string[],
): { labels: (string | null)[]; lineCount: number } {
  const tolerance = Math.max(
    medianRowPitch(lines, dataStartIndex) * HEADER_PITCH_FACTOR,
    medianLineHeight(lines) * HEADER_LEADING_FACTOR,
  );

  const first = lines[dataStartIndex];
  const block: PdfLine[] = [];

  if (first === undefined) return { labels: bands.map(() => null), lineCount: 0 };

  let reference = first;

  for (let index = dataStartIndex - 1; index >= 0; index--) {
    const line = lines[index];

    if (line === undefined || line.page !== first.page) break;

    // El bloque se lee hacia arriba, así que `line` está por encima de `reference` y el hueco
    // es la diferencia en ese sentido; al revés siempre daría negativo y cortaría de entrada.
    const gap = line.y - reference.y;

    if (gap <= 0 || gap > tolerance) break;
    if (isNumericLine(line, bands, pageWidth)) break;
    if (block.length >= MAX_HEADER_LINES) break;

    block.unshift(line);
    reference = line;
  }

  if (headerHints !== undefined && headerHints.length > 0) {
    const hinted = block.filter((line) => containsHint(line, headerHints));

    if (hinted.length > 0) {
      const first = block.indexOf(hinted[0] as PdfLine);
      const last = block.indexOf(hinted[hinted.length - 1] as PdfLine);

      return {
        labels: labelsOf(block.slice(first, last + 1), bands),
        lineCount: last - first + 1,
      };
    }
  }

  if (block.length === 0) return { labels: bands.map(() => null), lineCount: 0 };

  return { labels: labelsOf(block, bands), lineCount: block.length };
}

/**
 * Nombre de cada columna a partir del bloque de encabezado.
 *
 * Un fragmento del encabezado puede abarcar varias columnas: en el PDF de AFIP, "Ganancia neta
 * imponible acumulada" es el rótulo del grupo que cubre los dos tramos. Se asigna a todas las
 * bandas que toca en lugar de descartar la línea, porque el rótulo sí las describe a todas;
 * el desambiguado de duplicados de `tabular-normalizer` las distingue después (`..._2`).
 *
 * Descartarlo dejaría esas columnas como `col_N`, que es menos información, no más honestidad.
 */
function labelsOf(block: readonly PdfLine[], bands: readonly ColumnBand[]): (string | null)[] {
  const parts = new Map<number, string[]>();

  for (const line of block) {
    for (const item of line.items) {
      for (const band of bandsOf(item, bands)) {
        const current = parts.get(band.index);

        if (current === undefined) parts.set(band.index, [item.str]);
        else current.push(item.str);
      }
    }
  }

  return bands.map((band) => {
    const part = parts.get(band.index);

    return part === undefined || part.length === 0 ? null : collapseSpaces(part.join(' '));
  });
}

/**
 * Las bandas que un fragmento toca. Un fragmento angosto cae en una sola; uno ancho cae en
 * todas las que solapa. Si no solapa ninguna --celda muy angosta o texto desalineado-- se lo
 * asigna a la más cercana, porque descartarlo perdería el dato.
 */
function bandsOf(item: PdfTextItem, bands: readonly ColumnBand[]): ColumnBand[] {
  const from = item.x;
  const to = item.x + item.width;
  const overlapping = bands.filter((band) => to > band.from && from < band.to);

  if (overlapping.length > 0) return overlapping;

  const nearest = bandOf(item, bands);

  return nearest === null ? [] : [nearest];
}

function containsHint(line: PdfLine, hints: readonly string[]): boolean {
  const text = line.items
    .map((item) => item.str)
    .join(' ')
    .toLowerCase();

  return hints.some((hint) => hint.trim() !== '' && text.includes(hint.trim().toLowerCase()));
}

/** Alto de línea del documento: el interlineado contra el que se mide el aire del encabezado. */
function medianLineHeight(lines: readonly PdfLine[]): number {
  const heights = lines.flatMap((line) => line.items.map((item) => item.height));

  return heights.length === 0 ? 10 : median(heights);
}

/** Distancia vertical típica entre filas de datos, que define qué es "pegado" al encabezado. */
function medianRowPitch(lines: readonly PdfLine[], dataStartIndex: number): number {
  const pitches: number[] = [];

  for (let index = dataStartIndex + 1; index < lines.length; index++) {
    const current = lines[index];
    const previous = lines[index - 1];

    if (current === undefined || previous === undefined || current.page !== previous.page) continue;

    const pitch = previous.y - current.y;

    if (pitch > 0) pitches.push(pitch);
  }

  return pitches.length === 0 ? 20 : median(pitches);
}

/**
 * ¿Es una fila de datos? "Más de la mitad de sus celdas son numéricas", y a propósito tolera
 * una celda de texto: una fila con un mes ("ENERO") o un "en adelante" sigue siendo una fila
 * de datos, no una fila de encabezado.
 *
 * Con `bands` vacío todavía no se sabe dónde están las columnas, así que se decide sobre los
 * fragmentos: es el paso previo, el que permite detectar las bandas.
 */
function isNumericLine(line: PdfLine, bands: readonly ColumnBand[], pageWidth: number): boolean {
  const cells =
    bands.length === 0
      ? line.items.filter((item) => isCellLike(item, pageWidth)).map((item) => item.str)
      : splitLine(line, bands, pageWidth).cells.filter(isFilled);

  if (cells.length === 0) return false;

  const numeric = cells.filter((cell) => isNumericCell(cell as string)).length;

  // Mayoritario, no unanimous: una fila con un "enero" o un "en adelante" sigue siendo de datos.
  return numeric * 2 > cells.length;
}

function isNumericCell(text: string): boolean {
  const trimmed = text.trim();

  return /^[+-]?[$€£¥]?\s*\(?[0-9][0-9.,\s]*%?\)?$/.test(trimmed) || /en adelante/i.test(trimmed);
}

/**
 * Convierte las filas de la tabla en filas crudas (ingestion.md §4.4 paso 6), completando con
 * `null` y avisando cuando el ancho no coincide con el del encabezado.
 */
export function rowsFromTable(
  body: readonly LineCells[],
  columnCount: number,
  firstRowNumber: number,
): { rows: RawRow[]; warnings: string[] } {
  const rows: RawRow[] = [];
  const warnings: string[] = [];

  body.forEach((lineCells, offset) => {
    if (isNoiseRow(lineCells.cells)) return;

    const cells = [...lineCells.cells];

    while (cells.length < columnCount) cells.push(null);

    const present = lineCells.cells.filter(isFilled).length;

    if (present !== columnCount) {
      warnings.push(`row ${firstRowNumber + offset} had ${present} cells, expected ${columnCount}`);
    }

    rows.push(cells.slice(0, columnCount) as RawRow);
  });

  return { rows, warnings };
}

/**
 * Punto de entrada de la strategy: arma la tabla, la pasa por `tabular-normalizer` y devuelve
 * el contrato de `IngestResult`. Todas las strategies pasan por el mismo normalizador, lo que
 * garantiza que el `schema` se calcula de la misma forma para todos los orígenes (§5).
 */
export async function extractPdfTable(
  buffer: Buffer,
  options: ExtractPdfTableOptions,
): Promise<PdfExtraction> {
  const { items, pageCount, pageWidth } = await loadItems(buffer, options.pages);

  if (items.length === 0) {
    throw new UnprocessableContentError('no tabular region detected', {
      reason: 'the pdf has no extractable text',
    });
  }

  const lines = groupLines(items);
  const tables = tablesOf(lines, pageWidth, options.headerHints);

  if (tables.length === 0) {
    throw new UnprocessableContentError('no tabular region detected', {
      reason: 'no page has two or more populated columns',
    });
  }

  const index = options.tableIndex ?? 0;
  const table = tables[index];

  if (table === undefined) {
    throw new UnprocessableContentError(
      `tableIndex ${index} no existe: el PDF tiene ${tables.length} tabla(s)`,
      { tableIndex: index, tableCount: tables.length },
    );
  }

  const normalized = normalizeTable(table.headers, table.rows, { source: 'pdf' });

  return {
    rows: normalized.rows,
    schema: normalized.schema,
    // Las advertencias de la detección (`no-header-detected`, anchos que no coinciden) y las
    // del normalizador (tipos mezclados) son la misma lista para quien consulta el dataset:
    // separarlas obligaría a leer dos lugares para saber si un dato es confiable.
    warnings: [...table.warnings, ...normalized.warnings],
    tableCount: tables.length,
    pageCount,
    page: table.page,
  };
}

/** Una tabla detectada, con sus encabezados ya calculados. */
export interface DetectedTable {
  page: number;
  headers: string[];
  rows: RawRow[];
  warnings: string[];
}

/**
 * Una tabla por página (ingestion.md §4.4 pasos 3 a 8).
 *
 * Las bandas se calculan **sólo con las líneas de datos**, y no con todas las líneas de la
 * página. Es la decisión que hace funcionar el caso real: un título institucional y el
 * encabezado párrafo están compuestos por muchos fragmentos chicos alineados de lado a lado,
 * así que si se usaran para detectar columnas producirían una banda única que absorbería la
 * tabla entera. Las filas de datos son homogéneas en cambio: sus celdas están alineadas y
 * sus huecos son justamente los que separan columnas.
 *
 * Después las bandas se aplican a todas las líneas de la página, que es lo que deja el
 * encabezado y las filas con una celda menos en la columna que les corresponde.
 */
function tablesOf(
  lines: readonly PdfLine[],
  pageWidth: number,
  headerHints?: string[],
): DetectedTable[] {
  const byPage = new Map<number, PdfLine[]>();

  for (const line of lines) {
    const bucket = byPage.get(line.page);

    if (bucket === undefined) byPage.set(line.page, [line]);
    else bucket.push(line);
  }

  const tables: DetectedTable[] = [];

  for (const [page, pageLines] of byPage) {
    const candidate = pageLines.filter((line) => !isProseLine(line, pageWidth));

    if (candidate.length === 0) continue;

    // Paso previo, todavía sin bandas: se decide qué líneas son de datos por sus fragmentos.
    const dataLines = candidate.filter((line) => isNumericLine(line, [], pageWidth));

    if (dataLines.length === 0) continue;

    const bands = detectColumns(dataLines, pageWidth);

    if (!isUsefulTable(dataLines, bands, pageWidth)) continue;

    const dataStart = candidate.findIndex((line) => isNumericLine(line, bands, pageWidth));

    if (dataStart === -1) continue;

    const { labels, lineCount } = detectHeaderRow(
      candidate,
      bands,
      dataStart,
      pageWidth,
      headerHints,
    );
    const hasHeader = lineCount > 0;
    const body = candidate.slice(dataStart);
    const columnCount = bands.length;

    const { rows, warnings } = rowsFromTable(
      body.map((line) => splitLine(line, bands, pageWidth)),
      columnCount,
      1,
    );

    if (rows.length === 0) continue;

    // Sin encabezado las claves son genéricas y se deja constancia: publicar una tabla con
    // nombres de columna inventados sería peor que publicarla con `col_N` (ingestion.md §4.4
    // paso 8, y el principio de §1 de no inventar lo que no se puede determinar).
    const headers = labels.map((label, index) =>
      hasHeader && label !== null ? label : `col_${index + 1}`,
    );

    tables.push({
      page,
      headers,
      rows,
      warnings: hasHeader ? warnings : ['no-header-detected', ...warnings],
    });
  }

  return tables;
}

function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const low = sorted[middle - 1];
  const high = sorted[middle];

  if (sorted.length % 2 === 1) return high ?? 0;

  return ((low ?? 0) + (high ?? 0)) / 2;
}
