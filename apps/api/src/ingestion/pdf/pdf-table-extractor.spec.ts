import { extractPdfTable } from './pdf-table-extractor';
import {
  buildHeaderlessTablePdf,
  buildPdf,
  buildProsePdf,
  buildSimpleTablePdf,
} from './__fixtures__/make-fixture';

describe('pdf-table-extractor', () => {
  describe('tabla de 3 columnas con encabezado', () => {
    it('extrae 6 filas y 3 columnas sin warnings', async () => {
      const extraction = await extractPdfTable(buildSimpleTablePdf(), {});

      expect(extraction.tableCount).toBe(1);
      expect(extraction.page).toBe(1);
      expect(extraction.rows).toHaveLength(6);
      expect(extraction.warnings).toEqual([]);
      expect(extraction.schema.map((column) => [column.key, column.type])).toEqual([
        ['codigo', 'string'],
        ['importe', 'number'],
        ['alicuota', 'number'],
      ]);
    });

    it('normaliza los importes y las alícuotas según ingestion.md §4.4', async () => {
      const { rows } = await extractPdfTable(buildSimpleTablePdf(), {});

      // "1.234,56" es un número es-AR, no texto: el punto es de miles y la coma decimal.
      expect(rows[0]).toEqual({ codigo: 'A01', importe: 1234.56, alicuota: 0.35 });
      expect(rows[3]).toEqual({ codigo: 'A04', importe: 4937.8, alicuota: 0.09 });
    });

    it('el encabezado se lee como nombre de columna y no como dato', async () => {
      const { rows, schema } = await extractPdfTable(buildSimpleTablePdf(), {});

      expect(schema.map((column) => column.label)).toEqual(['Codigo', 'Importe', 'Alícuota']);
      expect(rows.some((row) => Object.values(row).includes('Codigo'))).toBe(false);
    });
  });

  describe('tabla sin fila de encabezado', () => {
    it('avisa no-header-detected y usa claves genéricas', async () => {
      const extraction = await extractPdfTable(buildHeaderlessTablePdf(), {});

      expect(extraction.warnings).toContain('no-header-detected');
      expect(extraction.schema.map((column) => column.key)).toEqual(['col_1', 'col_2']);
      expect(extraction.rows).toHaveLength(5);
      // Los valores sí se normalizan aunque falte el encabezado: el `schema` describe los datos.
      expect(extraction.schema.map((column) => column.type)).toEqual(['number', 'number']);
    });
  });

  describe('documento sin tabla reconocible', () => {
    it('una página de una sola columna es 422 no tabular region detected', async () => {
      // ingestion.md §4.4 paso 4: sin al menos dos columnas no hay tabla, y una página así es
      // portada o encabezado institucional.
      await expect(extractPdfTable(buildProsePdf(), {})).rejects.toThrow(
        'no tabular region detected',
      );
    });
  });

  describe('páginas inexistentes', () => {
    it('falla con 422 cuando la página pedida no existe', async () => {
      await expect(extractPdfTable(buildSimpleTablePdf(), { pages: [99] })).rejects.toThrow(
        /Ninguna de las páginas pedidas existe/,
      );
    });
  });

  describe('headerHints', () => {
    it('eligen el bloque de encabezado que contiene el hint', async () => {
      // Encabezado a 24pt de la primera fila: entra en el bloque por `pitch × 1.25`, y un hint
      // que lo nombre lo elige aunque haya más texto arriba.
      const pdf = buildPdf([
        { text: 'Informe generado por el organismo', x: 60, y: 800, size: 11 },
        { text: 'Importe retenido', x: 220, y: 754, size: 10 },
        { text: 'Codigo', x: 60, y: 754, size: 10 },
        { text: '100,25', x: 60, y: 730 },
        { text: '1.234,56', x: 220, y: 730 },
        { text: '200,50', x: 60, y: 708 },
        { text: '2.468,90', x: 220, y: 708 },
      ]);

      const extraction = await extractPdfTable(pdf, { headerHints: ['Codigo'] });

      expect(extraction.schema.map((column) => column.key)).toEqual(['codigo', 'importe_retenido']);
      expect(extraction.rows).toHaveLength(2);
    });

    it('un hint que no aparece no descarta el encabezado detectado', async () => {
      const extraction = await extractPdfTable(buildSimpleTablePdf(), {
        headerHints: ['Tramo', 'Alícuota'],
      });

      expect(extraction.warnings).toEqual([]);
      expect(extraction.schema.map((column) => column.key)).toEqual([
        'codigo',
        'importe',
        'alicuota',
      ]);
    });
  });

  describe('tableIndex', () => {
    it('rechaza un índice fuera de rango diciendo cuántas tablas hay', async () => {
      await expect(extractPdfTable(buildSimpleTablePdf(), { tableIndex: 3 })).rejects.toThrow(
        /tableIndex 3 no existe/,
      );
    });
  });
});
