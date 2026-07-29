import Papa from 'papaparse'
import * as XLSX from 'xlsx'

export interface ParsedInventory {
  content: string
  metadata: InventoryMetadata
  preview: InventoryPreview
}

export interface InventoryMetadata {
  source: 'csv' | 'excel' | 'sheet'
  filename?: string
  url?: string
  rows: number
  columns: string[]
  detected: DetectedColumnMap
  selectedColumns?: string[]
}

export interface InventoryPreview {
  sample: Record<string, string>[]
  detected: DetectedColumnMap
}

export interface DetectedColumnMap {
  sku: string | null
  name: string | null
  price: string | null
  stock: string | null
  category: string | null
}

const COLUMN_SYNONYMS: Record<keyof DetectedColumnMap, string[]> = {
  sku: ['sku', 'codigo', 'c\u00f3digo', 'code', 'id', 'ref', 'referencia', 'product_id'],
  name: ['nombre', 'name', 'producto', 'product', 'descripcion', 'descripci\u00f3n', 'description', 'item', 'articulo', 'art\u00edculo'],
  price: ['precio', 'price', 'cost', 'costo', 'valor', 'value', 'pvp', 'price_list', 'precio_venta'],
  stock: ['stock', 'cantidad', 'quantity', 'inventario', 'inventory', 'existencia', 'existencias', 'qty', 'disponible'],
  category: ['categoria', 'categor\u00eda', 'category', 'departamento', 'department', 'linea', 'l\u00ednea', 'grupo', 'group', 'familia'],
}

export function parseInventoryFile(
  buffer: ArrayBuffer,
  filename: string,
  selectedColumns?: string[],
): ParsedInventory {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (ext === 'csv') return parseCsv(buffer, { source: 'csv', filename }, selectedColumns)
  if (['xlsx', 'xls'].includes(ext)) return parseExcel(buffer, { source: 'excel', filename }, selectedColumns)
  throw new InventoryError(`Unsupported format: .${ext}. Use CSV or Excel (.xlsx).`)
}

export function parseSheetCsv(
  csvText: string,
  url: string,
  selectedColumns?: string[],
): ParsedInventory {
  const result = Papa.parse<string[]>(csvText.trim(), { skipEmptyLines: true })
  if (result.errors.length > 0 && result.data.length === 0) {
    throw new InventoryError('Could not parse the Google Sheets CSV.')
  }
  return buildInventory(result.data as string[][], { source: 'sheet', url }, selectedColumns)
}

class InventoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InventoryError'
  }
}

function parseCsv(
  buffer: ArrayBuffer,
  meta: { source: 'csv'; filename: string },
  selectedColumns?: string[],
): ParsedInventory {
  const text = new TextDecoder('utf-8').decode(buffer)
  const result = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true })
  if (result.errors.length > 0 && result.data.length === 0) {
    throw new InventoryError(`Failed to parse CSV: ${result.errors[0]?.message ?? 'unknown error'}`)
  }
  return buildInventory(result.data as string[][], meta, selectedColumns)
}

function parseExcel(
  buffer: ArrayBuffer,
  meta: { source: 'excel'; filename: string },
  selectedColumns?: string[],
): ParsedInventory {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new InventoryError('Excel file has no sheets.')
  const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 }) as string[][]
  if (data.length < 2) throw new InventoryError('Excel file must have a header row and at least one data row.')
  const rows = data.map((r) => r.map((c) => String(c ?? '')))
  return buildInventory(rows, meta, selectedColumns)
}

function buildInventory(
  rows: string[][],
  meta: { source: 'csv' | 'excel' | 'sheet'; filename?: string; url?: string },
  selectedColumns?: string[],
): ParsedInventory {
  if (rows.length < 2) {
    throw new InventoryError('File must have a header row and at least one data row.')
  }

  const header = rows[0].map((h) => h.trim().toLowerCase())
  const detected = detectColumns(header)

  const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim().length > 0))
  if (dataRows.length === 0) {
    throw new InventoryError('No data rows found after the header.')
  }

  // Resolve selectedColumns to column indices.
  let columnIndices: number[] | null = null
  if (selectedColumns && selectedColumns.length > 0) {
    const lowerSelected = selectedColumns.map((s) => s.trim().toLowerCase())
    columnIndices = []
    for (let ci = 0; ci < header.length; ci++) {
      if (lowerSelected.includes(header[ci])) {
        columnIndices.push(ci)
      }
    }
  }

  const lines: string[] = ['=== INVENTARIO ===']
  const headerLabels = buildHeaderLabels(detected, header)

  for (const row of dataRows) {
    const parts: string[] = []
    for (let ci = 0; ci < header.length; ci++) {
      if (columnIndices !== null && !columnIndices.includes(ci)) continue
      const val = row[ci]?.trim() ?? ''
      if (val) {
        const label = headerLabels[ci] ?? header[ci]
        parts.push(`${label}: ${val}`)
      }
    }
    if (parts.length > 0) lines.push(parts.join(' | '))
  }

  const sample: Record<string, string>[] = dataRows.slice(0, 5).map((row) => {
    const obj: Record<string, string> = {}
    for (let ci = 0; ci < header.length; ci++) {
      obj[header[ci]] = row[ci]?.trim() ?? ''
    }
    return obj
  })

  return {
    content: lines.join('\n'),
    metadata: {
      source: meta.source,
      filename: meta.filename,
      url: meta.url,
      rows: dataRows.length,
      columns: header,
      detected,
      ...(columnIndices !== null ? { selectedColumns } : {}),
    },
    preview: { sample, detected },
  }
}

function detectColumns(header: string[]): DetectedColumnMap {
  const detected: DetectedColumnMap = { sku: null, name: null, price: null, stock: null, category: null }

  for (const [role, synonyms] of Object.entries(COLUMN_SYNONYMS)) {
    for (const h of header) {
      if (synonyms.includes(h)) {
        detected[role as keyof DetectedColumnMap] = h
        break
      }
    }
  }

  return detected
}

function buildHeaderLabels(detected: DetectedColumnMap, header: string[]): (string | null)[] {
  const columnRole: Record<number, string> = {}
  for (const [role, colName] of Object.entries(detected)) {
    if (colName !== null) {
      const idx = header.indexOf(colName)
      if (idx !== -1) columnRole[idx] = role
    }
  }

  return header.map((_h, i) => {
    const role = columnRole[i]
    if (!role) return null
    const labels: Record<string, string> = {
      sku: 'SKU',
      name: 'Nombre',
      price: 'Precio',
      stock: 'Stock',
      category: 'Categor\u00eda',
    }
    return labels[role] ?? role
  })
}

export { InventoryError }
