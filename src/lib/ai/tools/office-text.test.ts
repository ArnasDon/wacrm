import { describe, it, expect } from 'vitest';
import { extractDocxText, extractPptxText, extractXlsxRows, formatXlsxForModel } from './office-text';
import { buildZip } from './test-support/build-zip';

describe('extractDocxText', () => {
  it('extracts paragraph text in order', () => {
    const documentXml =
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>Hola</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Mundo</w:t></w:r><w:r><w:t xml:space="preserve"> feliz</w:t></w:r></w:p>' +
      '</w:body></w:document>';
    const zip = buildZip([{ name: 'word/document.xml', data: documentXml, method: 8 }]);

    expect(extractDocxText(zip)).toBe('Hola\nMundo feliz');
  });

  it('throws a readable error when word/document.xml is missing', () => {
    const zip = buildZip([{ name: 'other.xml', data: '<x/>', method: 0 }]);
    expect(() => extractDocxText(zip)).toThrow(/\.docx/);
  });
});

describe('extractPptxText', () => {
  it('extracts text per slide, in slide order', () => {
    const slide1 = '<p:sld><a:p><a:r><a:t>Titulo</a:t></a:r></a:p></p:sld>';
    const slide2 = '<p:sld><a:p><a:r><a:t>Contenido</a:t></a:r></a:p></p:sld>';
    // Deliberately built out of numeric order to prove sorting works.
    const zip = buildZip([
      { name: 'ppt/slides/slide2.xml', data: slide2, method: 0 },
      { name: 'ppt/slides/slide1.xml', data: slide1, method: 0 },
    ]);

    expect(extractPptxText(zip)).toBe('Diapositiva 1:\nTitulo\n\nDiapositiva 2:\nContenido');
  });

  it('throws a readable error when there are no slides', () => {
    const zip = buildZip([{ name: 'other.xml', data: '<x/>', method: 0 }]);
    expect(() => extractPptxText(zip)).toThrow(/\.pptx/);
  });
});

describe('extractXlsxRows', () => {
  it('resolves shared strings and numeric cells into header-keyed rows', () => {
    const sharedStrings = '<sst><si><t>Producto</t></si><si><t>Precio</t></si><si><t>Café</t></si></sst>';
    const sheet1 =
      '<sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1500</v></c></row>' +
      '</sheetData>';
    const zip = buildZip([
      { name: 'xl/sharedStrings.xml', data: sharedStrings, method: 0 },
      { name: 'xl/worksheets/sheet1.xml', data: sheet1, method: 8 },
    ]);

    expect(extractXlsxRows(zip)).toEqual([{ Producto: 'Café', Precio: '1500' }]);
  });

  it('handles an inline string cell without the shared-strings table', () => {
    const sheet1 =
      '<sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Nombre</t></is></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>Ana</t></is></c></row>' +
      '</sheetData>';
    const zip = buildZip([{ name: 'xl/worksheets/sheet1.xml', data: sheet1, method: 0 }]);

    expect(extractXlsxRows(zip)).toEqual([{ Nombre: 'Ana' }]);
  });

  it('falls back to col_N for a blank header cell', () => {
    const sheet1 =
      '<sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t></t></is></c></row>' +
      '<row r="2"><c r="A2"><v>42</v></c></row>' +
      '</sheetData>';
    const zip = buildZip([{ name: 'xl/worksheets/sheet1.xml', data: sheet1, method: 0 }]);

    expect(extractXlsxRows(zip)).toEqual([{ col_1: '42' }]);
  });

  it('throws a readable error when the first sheet is missing', () => {
    const zip = buildZip([{ name: 'other.xml', data: '<x/>', method: 0 }]);
    expect(() => extractXlsxRows(zip)).toThrow(/\.xlsx/);
  });
});

describe('formatXlsxForModel', () => {
  it('formats extracted rows the same way as the Google Sheets tool', () => {
    const sheet1 =
      '<sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Producto</t></is></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>Café</t></is></c></row>' +
      '</sheetData>';
    const zip = buildZip([{ name: 'xl/worksheets/sheet1.xml', data: sheet1, method: 0 }]);

    expect(formatXlsxForModel(zip)).toBe('Fila 1: Producto: Café');
  });
});
