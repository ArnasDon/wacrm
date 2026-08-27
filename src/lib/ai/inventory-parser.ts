import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { formatCurrency } from '@/lib/currency'

/** Maximum rows to include in the inventory content (prevents timeouts). */
const MAX_INVENTORY_ROWS = 50_000

export interface ParsedInventory {
  content: string
  metadata: InventoryMetadata
  preview: InventoryPreview
  /**
   * Structured rows for `usage: catalog|both` data sources (see
   * src/lib/ai/data-sources/service.ts). Always computed — cheap — but
   * only persisted to `ai_catalog_products` by callers that opted into
   * catalog usage; the legacy KB-only upload/sheet routes ignore it.
   * `name` is required for a row to be usable as a product; rows with no
   * detected name column fall back to the first non-empty cell so a
   * catalog-usage sheet without a "Nombre" header still produces
   * something searchable rather than being silently dropped.
   */
  products: CatalogProductRow[]
}

/** One structured product row extracted from a CSV/Excel/Sheet, before
 *  it becomes an `ai_catalog_products` row. Prices are already parsed to
 *  a plain number (no currency symbol) — currency is applied separately. */
export interface CatalogProductRow {
  /** Row index within the parsed data (0-based) — used as the stable
   *  `source_product_id` when no SKU column was detected. */
  rowIndex: number
  sku: string | null
  name: string
  brand: string | null
  model: string | null
  description: string | null
  color: string | null
  capacity: string | null
  size: string | null
  variantLabel: string | null
  price: number | null
  availableQuantity: number | null
  imageUrl: string | null
}

export interface InventoryMetadata {
  source: 'csv' | 'excel' | 'sheet'
  filename?: string
  url?: string
  currency: string
  rows: number
  columns: string[]
  detected: DetectedColumnMap
  selectedColumns?: string[]
  parseErrors?: string[]
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
  /** Below: only used to build structured `products` rows for catalog-
   *  usage data sources \u2014 the flattened KB `content` text (legacy path)
   *  doesn't depend on these being detected. */
  brand: string | null
  model: string | null
  description: string | null
  color: string | null
  capacity: string | null
  size: string | null
  image: string | null
}

const COLUMN_SYNONYMS: Record<keyof DetectedColumnMap, string[]> = {
  sku: [
    'sku', 'codigo', 'c\u00f3digo', 'code', 'id', 'ref', 'referencia',
    'product_id', 'codigo_item', 'item_code', 'articulo_id',
  ],
  name: [
    'nombre', 'name', 'producto', 'product', 'descripcion',
    'descripci\u00f3n', 'description', 'item', 'articulo',
    'art\u00edculo', 'titulo', 't\u00edtulo', 'detalle',
    'parte', 'pieza', 'product_name',
  ],
  price: [
    'precio', 'price', 'cost', 'costo', 'valor', 'value', 'pvp',
    'price_list', 'precio_venta', 'costo promedio', 'costo total',
    'precio promedio', 'precio total', 'precio unitario',
    'precio_compra', 'costo_unitario', 'costo_total',
    'precio_lista', 'precio_venta_publico', 'precio_venta',
    'precio_1', 'precio_2',
  ],
  stock: [
    'stock', 'cantidad', 'quantity', 'inventario', 'inventory',
    'existencia', 'existencias', 'qty', 'disponible', 'disponibles',
    'uds', 'unidades', 'cant_existencia', 'cantidad_existencia',
  ],
  category: [
    'categoria', 'categor\u00eda', 'category', 'departamento',
    'department', 'linea', 'l\u00ednea', 'grupo', 'group',
    'familia', 'tipo', 'clase', 'segmento',
    'subcategoria', 'subcategor\u00eda',
  ],
  brand: ['marca', 'brand', 'fabricante', 'manufacturer'],
  model: ['modelo', 'model'],
  description: ['descripcion_comercial', 'descripcion_larga', 'notas', 'notes', 'comentario', 'comentarios'],
  color: ['color', 'colour', 'colores', 'colors'],
  capacity: ['capacidad', 'capacity', 'almacenamiento', 'storage', 'gb', 'memoria', 'ram'],
  size: ['talla', 'size', 'tamano', 'tama\u00f1o', 'pulgadas', 'inches', 'inch', 'pulgada'],
  image: [
    'imagen', 'image', 'foto', 'photo', 'image_url', 'imagen_url',
    'picture', 'picture_url', 'foto_url', 'url_imagen', 'url_foto',
  ],
}

export function parseInventoryFile(
  buffer: ArrayBuffer,
  filename: string,
  selectedColumns?: string[],
  currency?: string,
): ParsedInventory {
  const ext = filename.toLowerCase().split('.').pop() ?? ''
  if (ext === 'csv') return parseCsv(buffer, { source: 'csv', filename }, selectedColumns, currency)
  if (['xlsx', 'xls'].includes(ext)) return parseExcel(buffer, { source: 'excel', filename }, selectedColumns, currency)
  throw new InventoryError(`Unsupported format: .${ext}. Use CSV or Excel (.xlsx).`)
}

export function parseSheetCsv(
  csvText: string,
  url: string,
  selectedColumns?: string[],
  currency?: string,
): ParsedInventory {
  const clean = csvText.trim().replace(/^\uFEFF/, '')
  const result = Papa.parse<string[]>(clean, { skipEmptyLines: true })
  if (result.errors.length > 0 && result.data.length === 0) {
    throw new InventoryError('Could not parse the Google Sheets CSV.')
  }
  return buildInventory(
    result.data as string[][],
    { source: 'sheet', url },
    selectedColumns,
    result.errors.filter((e) => e.type !== 'FieldMismatch').map((e) => e.message),
    currency,
  )
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
  currency?: string,
): ParsedInventory {
  const raw = new TextDecoder('utf-8').decode(buffer)
  const text = raw.replace(/^\uFEFF/, '')
  const result = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true })
  if (result.errors.length > 0 && result.data.length === 0) {
    throw new InventoryError(`Failed to parse CSV: ${result.errors[0]?.message ?? 'unknown error'}`)
  }
  return buildInventory(
    result.data as string[][],
    meta,
    selectedColumns,
    result.errors.filter((e) => e.type !== 'FieldMismatch').map((e) => e.message),
    currency,
  )
}

function parseExcel(
  buffer: ArrayBuffer,
  meta: { source: 'excel'; filename: string },
  selectedColumns?: string[],
  currency?: string,
): ParsedInventory {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new InventoryError('Excel file has no sheets.')
  const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 }) as string[][]
  if (data.length < 2) throw new InventoryError('Excel file must have a header row and at least one data row.')
  const rows = data.map((r) => r.map((c) => String(c ?? '')))
  return buildInventory(rows, meta, selectedColumns, undefined, currency)
}

function buildInventory(
  rows: string[][],
  meta: { source: 'csv' | 'excel' | 'sheet'; filename?: string; url?: string },
  selectedColumns?: string[],
  parseErrors?: string[],
  currency?: string,
): ParsedInventory {
  if (rows.length < 2) {
    throw new InventoryError('File must have a header row and at least one data row.')
  }

  const cur = currency || 'USD'

  // Keep original-case headers but lower-case for comparison.
  const rawHeader = rows[0].map((h) => h.trim())
  const headerLower = rawHeader.map((h) => h.toLowerCase())
  const detected = detectColumns(headerLower)

  // Find detected column indices for price/stock formatting.
  const priceColIdx = detected.price !== null ? headerLower.indexOf(detected.price) : -1
  const stockColIdx = detected.stock !== null ? headerLower.indexOf(detected.stock) : -1

  const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim().length > 0))
  if (dataRows.length === 0) {
    throw new InventoryError('No data rows found after the header.')
  }

  // Limit rows to prevent oversized content / Vercel timeouts.
  const truncated = dataRows.length > MAX_INVENTORY_ROWS
  if (truncated) dataRows.length = MAX_INVENTORY_ROWS

  // Resolve selectedColumns to column indices (case-insensitive).
  let columnIndices: number[] | null = null
  if (selectedColumns && selectedColumns.length > 0) {
    const lowerSelected = selectedColumns.map((s) => s.trim().toLowerCase())
    columnIndices = []
    for (let ci = 0; ci < headerLower.length; ci++) {
      if (lowerSelected.includes(headerLower[ci])) {
        columnIndices.push(ci)
      }
    }
  }

  const blocks: string[] = []
  const headerLabels = buildHeaderLabels(detected, headerLower)

  for (const row of dataRows) {
    const parts: string[] = []
    for (let ci = 0; ci < headerLower.length; ci++) {
      if (columnIndices !== null && !columnIndices.includes(ci)) continue
      const val = row[ci]?.trim() ?? ''
      if (!val) continue
      const label = headerLabels[ci] ?? rawHeader[ci]

      // Format price with currency symbol.
      if (ci === priceColIdx) {
        const parsed = parsePrice(val)
        if (parsed !== null) {
          parts.push(`${label}: ${formatCurrency(parsed, cur)}`)
          continue
        }
      }

      // Append unit to stock.
      if (ci === stockColIdx && isNumeric(val)) {
        parts.push(`${label}: ${val} unidades`)
        continue
      }

      parts.push(`${label}: ${val}`)
    }
    if (parts.length > 0) blocks.push(parts.join('\n'))
  }

  // Preview — use raw header keys so the user sees real column names.
  const sample: Record<string, string>[] = dataRows.slice(0, 5).map((row) => {
    const obj: Record<string, string> = {}
    for (let ci = 0; ci < headerLower.length; ci++) {
      obj[rawHeader[ci]] = row[ci]?.trim() ?? ''
    }
    return obj
  })

  const trimmedErrors = parseErrors?.slice(0, 5)

  return {
    content: blocks.join('\n\n'),
    metadata: {
      source: meta.source,
      filename: meta.filename,
      url: meta.url,
      currency: cur,
      rows: dataRows.length,
      ...(truncated ? { truncated: true } : {}),
      columns: rawHeader,
      detected,
      ...(columnIndices !== null ? { selectedColumns } : {}),
      ...(trimmedErrors && trimmedErrors.length > 0 ? { parseErrors: trimmedErrors } : {}),
    },
    preview: { sample, detected },
    products: buildProductRows(dataRows, headerLower, detected),
  }
}

/**
 * Structured rows for catalog-usage data sources (see
 * src/lib/ai/data-sources/service.ts). Reuses the same column detection
 * as the flattened KB `content` above so both representations always
 * agree on which column is which. A row with no usable name (no
 * detected `name` column AND no non-empty first cell) is dropped — it
 * has nothing a customer could search for.
 */
function buildProductRows(
  dataRows: string[][],
  headerLower: string[],
  detected: DetectedColumnMap,
): CatalogProductRow[] {
  const idx = (col: string | null): number => (col !== null ? headerLower.indexOf(col) : -1)
  const skuIdx = idx(detected.sku)
  const nameIdx = idx(detected.name)
  const priceIdx = idx(detected.price)
  const stockIdx = idx(detected.stock)
  const brandIdx = idx(detected.brand)
  const modelIdx = idx(detected.model)
  const descIdx = idx(detected.description)
  const colorIdx = idx(detected.color)
  const capacityIdx = idx(detected.capacity)
  const sizeIdx = idx(detected.size)
  const imageIdx = idx(detected.image)

  const cell = (row: string[], i: number): string | null => {
    if (i < 0) return null
    const v = row[i]?.trim()
    return v ? v : null
  }

  const products: CatalogProductRow[] = []
  dataRows.forEach((row, rowIndex) => {
    const name = cell(row, nameIdx) ?? cell(row, 0)
    if (!name) return // nothing searchable in this row

    const priceRaw = cell(row, priceIdx)
    const stockRaw = cell(row, stockIdx)
    const capacity = cell(row, capacityIdx)
    const size = cell(row, sizeIdx)

    products.push({
      rowIndex,
      sku: cell(row, skuIdx),
      name,
      brand: cell(row, brandIdx),
      model: cell(row, modelIdx),
      description: cell(row, descIdx),
      color: cell(row, colorIdx),
      capacity,
      size,
      variantLabel: capacity ?? size,
      price: priceRaw !== null ? parsePrice(priceRaw) : null,
      availableQuantity:
        stockRaw !== null && isNumeric(stockRaw) ? Math.round(Number(stockRaw.replace(/,/g, ''))) : null,
      imageUrl: cell(row, imageIdx),
    })
  })
  return products
}

function parsePrice(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.,\-]/g, '').trim()
  if (!cleaned) return null
  const num = Number(cleaned.replace(/,/g, ''))
  return isFinite(num) ? Math.round(num) : null
}

function isNumeric(val: string): boolean {
  const cleaned = val.replace(/[^0-9.,\-]/g, '').trim()
  if (!cleaned) return false
  return isFinite(Number(cleaned.replace(/,/g, '')))
}

function detectColumns(header: string[]): DetectedColumnMap {
  const detected: DetectedColumnMap = {
    sku: null, name: null, price: null, stock: null, category: null,
    brand: null, model: null, description: null, color: null,
    capacity: null, size: null, image: null,
  }

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
      brand: 'Marca',
      model: 'Modelo',
      description: 'Descripci\u00f3n',
      color: 'Color',
      capacity: 'Capacidad',
      size: 'Talla',
      image: 'Imagen',
    }
    return labels[role] ?? role
  })
}

export { InventoryError }
