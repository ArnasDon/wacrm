import ExcelJS from 'exceljs'
import type { Product } from '@/types'
import { formatRoomRatesCell } from '@/lib/products/rates'

// Fixed English labels, same convention as src/lib/contacts/export-excel.ts
// and src/lib/kpis/export-excel.ts.

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } }

export interface ProductExportRow {
  name: string
  description: string
  price: number
  is_active: boolean
  /** Catalog category name (migration 106) — blank when uncategorised. */
  category?: string
  /** Always-on room rates (migrations 106 + 108 + 111) as one compact
   *  cell — blank for non-room products. Format:
   *  `mon=800/950/1600;fri=1200;sat=1400//1700` (day=standard[/couple[/group]]).
   *  Seasonal overrides are not round-tripped via Excel. */
  room_rates?: string
}

/** Shapes a raw product into the row the export sheet writes — same
 *  columns `parseProductsWorkbook` expects back on import, so a round
 *  trip (export → edit in Excel → re-import) works without remapping.
 *  `categoryName` is looked up by the caller (products don't carry it). */
export function toProductExportRow(
  product: Product,
  categoryName?: string | null,
): ProductExportRow {
  return {
    name: product.name,
    description: product.description ?? '',
    price: product.price,
    is_active: product.is_active,
    category: categoryName ?? '',
    room_rates: formatRoomRatesCell(product.rates ?? []),
  }
}

/** Builds the products workbook — pure data shaping only, unit-testable
 *  without a DOM; `downloadProductsExcel` below owns the browser-
 *  download side effect. */
export function buildProductsWorkbook(rows: ProductExportRow[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Chat Sandía'
  wb.created = new Date()

  const sheet = wb.addWorksheet('Products')
  sheet.columns = [
    { header: 'name', key: 'name', width: 28 },
    { header: 'description', key: 'description', width: 40 },
    { header: 'price', key: 'price', width: 12 },
    { header: 'is_active', key: 'is_active', width: 10 },
    { header: 'category', key: 'category', width: 20 },
    { header: 'room_rates', key: 'room_rates', width: 40 },
  ]
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = { vertical: 'middle' }
  })

  for (const row of rows) {
    sheet.addRow({
      name: row.name,
      description: row.description,
      price: row.price,
      is_active: row.is_active ? 'TRUE' : 'FALSE',
      category: row.category ?? '',
      room_rates: row.room_rates ?? '',
    })
  }

  return wb
}

/** Builds the workbook and triggers a browser download. */
export async function downloadProductsExcel(rows: ProductExportRow[]): Promise<void> {
  const wb = buildProductsWorkbook(rows)
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'products.xlsx'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
