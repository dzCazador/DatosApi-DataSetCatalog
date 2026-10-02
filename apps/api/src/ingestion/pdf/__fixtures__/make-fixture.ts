import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Generador de los PDFs de prueba de la fase 05.
 *
 * Los fixtures se **generan** y no se commitean: `.gitignore` excluye `*.pdf` y, más
 * importante, un binario en el repo es un archivo que nadie puede revisar con un diff. Como el
 * PDF es una estructura conocida y chica, escribirlo acá da tests herméticos (sin red, sin
 * binario que pueda quedar desactualizado respecto del generador) y un fixture que se lee.
 *
 * Se ejecuta como script con `pnpm --filter @datosapi/api tsx` o `ts-node`, y cada función
 * devuelve el `Buffer` del PDF, que es lo que consume el test.
 */

/** Un texto con su posición en la página, en puntos PDF (origen abajo-izquierda). */
export interface PlacedText {
  text: string;
  x: number;
  y: number;
  /** Cuerpo de la fuente. El default es 10, que es el cuerpo habitual de una tabla. */
  size?: number;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

/** Escapa los tres caracteres que son sintaxis dentro de una cadena PDF. */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7e]/g, (char) => {
      const code = char.codePointAt(0) ?? 0;

      // Lo que no es ASCII va como octal en WinAnsi, que es la codificación que declara la
      // fuente. Sin esto, una tilde o una "€" rompería el stream y el PDF no abriría.
      return code < 256 ? `\\${code.toString(8).padStart(3, '0')}` : '?';
    });
}

/**
 * Arma un PDF de una página con los textos indicados en sus coordenadas exactas.
 *
 * Cada texto es su propio bloque `BT/ET` con un `Td`, así `pdfjs-dist` devuelve un fragmento
 * por texto en la posición en que se lo puso: eso es lo que el extractor usa para reconstruir
 * la tabla, y por eso el fixture puede afirmarse sobre columnas y filas concretas.
 */
export function buildPdf(placed: readonly PlacedText[]): Buffer {
  const stream = placed
    .map(({ text, x, y, size = 10 }) =>
      [
        'BT',
        `/F1 ${size} Tf`,
        `${x.toFixed(2)} ${y.toFixed(2)} Td`,
        `(${escapeText(text)}) Tj`,
        'ET',
      ].join('\n'),
    )
    .join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;

  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

/** Tabla de 3 columnas × 6 filas con encabezado en texto, como pide la fase 05 §4. */
export function buildSimpleTablePdf(): Buffer {
  const columns = [60, 220, 360];
  const headers = ['Codigo', 'Importe', 'Alícuota'];
  const rows: readonly (readonly string[])[] = [
    ['A01', '1.234,56', '35%'],
    ['A02', '2.468,90', '25%'],
    ['A03', '3.703,35', '15%'],
    ['A04', '4.937,80', '9%'],
    ['A05', '6.172,25', '5%'],
    ['A06', '7.406,70', '3%'],
  ];

  // El encabezado va a un interlineado exacto de la primera fila: es como se ve una tabla en
  // un PDF real y es lo que el extractor tiene que leer como "encabezado de la tabla".
  const rowPitch = 22;

  const placed: PlacedText[] = headers.map((text, index) => ({
    text,
    x: columns[index]!,
    y: 730 + rowPitch,
  }));

  rows.forEach((row, rowIndex) => {
    row.forEach((text, columnIndex) => {
      placed.push({ text, x: columns[columnIndex]!, y: 730 - rowIndex * rowPitch });
    });
  });

  return buildPdf(placed);
}

/**
 * Tabla de 2 columnas y 5 filas **sin fila de encabezado**: todo lo que hay son números.
 *
 * Es el caso de ingestion.md §4.4 paso 8, y el que la estrategia de PDF tiene que poder
 * distinguir de una tabla bien formada: las claves salen genéricas (`col_1`, `col_2`) y el
 * `warning` deja constancia de que el encabezado no se encontró, en vez de publicar nombres
 * inventados.
 */
export function buildHeaderlessTablePdf(): Buffer {
  const columns = [80, 300];
  const rows: readonly (readonly string[])[] = [
    ['1.234,56', '35%'],
    ['2.468,90', '25%'],
    ['3.703,35', '15%'],
    ['4.937,80', '9%'],
    ['6.172,25', '5%'],
  ];

  const placed: PlacedText[] = [];

  rows.forEach((row, rowIndex) => {
    row.forEach((text, columnIndex) => {
      placed.push({ text, x: columns[columnIndex]!, y: 730 - rowIndex * 22 });
    });
  });

  return buildPdf(placed);
}

/**
 * Página de una sola columna: un párrafo. ingestion.md §4.4 paso 4 descarta las páginas sin al
 * menos dos columnas (son portada o encabezado institucional), así que este documento no tiene
 * tabla y la ingesta debe fallar con `422 no tabular region detected`.
 */
export function buildProsePdf(): Buffer {
  const lines = [
    'Reporte de retenciones del',
    'período julio a diciembre',
    'de 2026, conforme el',
    'artículo 94 de la ley',
  ];

  return buildPdf(lines.map((text, index) => ({ text, x: 60, y: 760 - index * 24, size: 11 })));
}

/** Sobrescribe un texto en un PDF del fixture, para simular que el origen cambió. */
export function withLabel(buffer: Buffer, from: string, to: string): Buffer {
  const text = buffer.toString('latin1');
  const escapedFrom = escapeText(from);

  if (!text.includes(escapedFrom)) {
    throw new Error(`El fixture no contiene '${from}': no se puede reescribir`);
  }

  return Buffer.from(text.replace(escapedFrom, escapeText(to)), 'latin1');
}

/**
 * Escribe los fixtures a disco para poder abrirlos con un lector de PDF y compararlos a ojo
 * contra lo que afirma el test:
 *
 * ```bash
 * pnpm --filter @datosapi/api exec ts-node src/ingestion/pdf/__fixtures__/make-fixture.ts [dir]
 * ```
 *
 * Los tests no lo necesitan: construyen el `Buffer` en memoria con las mismas funciones, que es
 * más rápido y no deja archivos que puedan quedar desactualizados respecto del generador.
 */
export function writeFixtures(directory: string): string[] {
  const fixtures: readonly [string, Buffer][] = [
    ['tabla-simple.pdf', buildSimpleTablePdf()],
    ['tabla-sin-encabezado.pdf', buildHeaderlessTablePdf()],
    ['prosa.pdf', buildProsePdf()],
  ];

  mkdirSync(directory, { recursive: true });

  return fixtures.map(([name, buffer]) => {
    const path = join(directory, name);

    writeFileSync(path, buffer);

    return path;
  });
}

/* c8 ignore start 2 -- entrypoint de script, no cubierto por tests */
if (process.argv[1]?.endsWith('make-fixture.ts') === true) {
  for (const path of writeFixtures(process.argv[2] ?? 'fixtures')) {
    process.stdout.write(`${path}
`);
  }
}
/* c8 ignore stop */
