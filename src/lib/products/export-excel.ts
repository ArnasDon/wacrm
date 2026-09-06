import ExcelJS from 'exceljs'
import type { Product } from '@/types'

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
  /** Always-on room rates (migration 106) — blank for non-room products. */
  rate_weekday?: number | ''
  rate_weekend?: number | ''
  rate_weekday_couple?: number | ''
  rate_weekend_couple?: number | ''
}

function alwaysRate(
  product: Product,
  group: 'weekday' | 'weekend',
  occupancy: 'standard' | 'couple',
): number | '' {
  const hit = (product.rates ?? []).find(
    (r) =>
      r.weekday_group === group &&
      r.occupancy === occupancy &&
      !r.date_from &&
      !r.date_to,
  )
  return hit ? hit.price : ''
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
    rate_weekday: alwaysRate(product, 'weekday', 'standard'),
    rate_weekend: alwaysRate(product, 'weekend', 'standard'),
    rate_weekday_couple: alwaysRate(product, 'weekday', 'couple'),
    rate_weekend_couple: alwaysRate(product, 'weekend', 'couple'),
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
    { header: 'rate_weekday', key: 'rate_weekday', width: 14 },
    { header: 'rate_weekend', key: 'rate_weekend', width: 14 },
    { header: 'rate_weekday_couple', key: 'rate_weekday_couple', width: 18 },
    { header: 'rate_weekend_couple', key: 'rate_weekend_couple', width: 18 },
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
      rate_weekday: row.rate_weekday ?? '',
      rate_weekend: row.rate_weekend ?? '',
      rate_weekday_couple: row.rate_weekday_couple ?? '',
      rate_weekend_couple: row.rate_weekend_couple ?? '',
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
