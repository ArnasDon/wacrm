import ExcelJS from 'exceljs'
import { parseRoomRatesCell } from '@/lib/products/rates'

/**
 * .xlsx parsing for the products import dialog. Expects the same
 * columns `buildProductsWorkbook` (export-excel.ts) writes — name,
 * description, price, is_active — so an export → edit → re-import
 * round trip works without remapping. Column order doesn't matter
 * (matched by header name, case-insensitive); extra columns are
 * ignored.
 */

export interface ParsedRate {
  day_of_week: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
  occupancy: 'standard' | 'couple' | 'group'
  price: number
}

export interface ParsedProductRow {
  name: string
  description: string | null
  price: number
  is_active: boolean
  /** Catalog category name (migration 106) — null when the column is
   *  absent/blank. Resolved to an id by the bulk-import route. */
  category: string | null
  /** Always-on room rates from the `room_rates` cell (migration 111) —
   *  empty for a normal product. */
  rates: ParsedRate[]
}

export interface ProductRowError {
  /** 1-based row number as it appears in the spreadsheet (row 1 = header). */
  row: number
  message: string
}

export interface ParseProductsWorkbookResult {
  rows: ParsedProductRow[]
  errors: ProductRowError[]
}

const REQUIRED_COLUMNS = ['name', 'price'] as const

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text
    if ('result' in value && value.result != null) return String(value.result)
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((r) => r.text).join('')
    }
    return ''
  }
  return String(value)
}

function parseBool(value: ExcelJS.CellValue, fallback: boolean): boolean {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'boolean') return value
  const s = cellToString(value).trim().toLowerCase()
  if (!s) return fallback
  if (['true', '1', 'yes', 'y', 'sí', 'si', 'active'].includes(s)) return true
  if (['false', '0', 'no', 'n', 'inactive'].includes(s)) return false
  return fallback
}

/**
 * Parses an uploaded .xlsx `ArrayBuffer` into product rows, validating
 * each independently — a bad row (missing name, non-numeric/negative
 * price) is reported in `errors` and skipped, never thrown, so one
 * typo doesn't sink the whole file. Returns empty `rows`/`errors` (not
 * a throw) when the file has no usable header — the caller shows
 * `noValidRows` for that case.
 */
export async function parseProductsWorkbook(buffer: ArrayBuffer): Promise<ParseProductsWorkbookResult> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const sheet = wb.worksheets[0]
  if (!sheet) return { rows: [], errors: [] }

  const headerRow = sheet.getRow(1)
  const columnByName = new Map<string, number>()
  headerRow.eachCell((cell, colNumber) => {
    const key = cellToString(cell.value).trim().toLowerCase()
    if (key) columnByName.set(key, colNumber)
  })

  const missing = REQUIRED_COLUMNS.filter((c) => !columnByName.has(c))
  if (missing.length > 0) {
    return { rows: [], errors: [] }
  }

  const nameCol = columnByName.get('name')!
  const priceCol = columnByName.get('price')!
  const descriptionCol = columnByName.get('description')
  const isActiveCol = columnByName.get('is_active')
  const categoryCol = columnByName.get('category')
  const roomRatesCol = columnByName.get('room_rates')

  const rows: ParsedProductRow[] = []
  const errors: ProductRowError[] = []

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber)
    // Skip fully blank rows (trailing empty rows are common in exports).
    if (row.cellCount === 0 || !row.values || (row.values as unknown[]).every((v) => v == null || v === '')) {
      continue
    }

    const name = cellToString(row.getCell(nameCol).value).trim()
    if (!name) {
      errors.push({ row: rowNumber, message: 'name is required' })
      continue
    }

    const rawPrice = row.getCell(priceCol).value
    const price = Number(cellToString(rawPrice).trim())
    if (!Number.isFinite(price) || price < 0) {
      errors.push({ row: rowNumber, message: 'price must be a non-negative number' })
      continue
    }

    const description = descriptionCol ? cellToString(row.getCell(descriptionCol).value).trim() || null : null
    const isActive = isActiveCol ? parseBool(row.getCell(isActiveCol).value, true) : true
    const category = categoryCol
      ? cellToString(row.getCell(categoryCol).value).trim() || null
      : null

    let rates: ParsedRate[] = []
    if (roomRatesCol) {
      const parsed = parseRoomRatesCell(cellToString(row.getCell(roomRatesCol).value))
      if (parsed === null) {
        errors.push({
          row: rowNumber,
          message:
            'room_rates must look like "mon=800/950/1600;fri=1200" (day=standard[/couple[/group]])',
        })
        continue
      }
      rates = parsed
    }

    rows.push({ name, description, price, is_active: isActive, category, rates })
  }

  return { rows, errors }
}
