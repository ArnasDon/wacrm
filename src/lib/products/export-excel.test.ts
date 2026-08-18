import { describe, it, expect } from 'vitest'
import { buildProductsWorkbook, toProductExportRow, type ProductExportRow } from './export-excel'
import type { Product } from '@/types'

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    account_id: 'a1',
    user_id: 'u1',
    name: 'Cama Montessori',
    description: 'Cama baja de madera',
    price: 350,
    is_active: true,
    created_at: '2026-08-01T10:00:00',
    updated_at: '2026-08-01T10:00:00',
    ...overrides,
  }
}

describe('toProductExportRow', () => {
  it('maps a product to an export row', () => {
    expect(toProductExportRow(makeProduct())).toEqual({
      name: 'Cama Montessori',
      description: 'Cama baja de madera',
      price: 350,
      is_active: true,
    })
  })

  it('falls back to an empty string when description is missing', () => {
    const row = toProductExportRow(makeProduct({ description: null }))
    expect(row.description).toBe('')
  })
})

describe('buildProductsWorkbook', () => {
  const rows: ProductExportRow[] = [
    { name: 'Cama Montessori', description: 'Cama baja de madera', price: 350, is_active: true },
    { name: 'Silla', description: '', price: 75.5, is_active: false },
  ]

  it('writes one row per product into a single Products sheet', () => {
    const wb = buildProductsWorkbook(rows)
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Products'])
    const sheet = wb.getWorksheet('Products')!
    expect(sheet.rowCount).toBe(3) // header + 2 products
    const sheetRows = sheet.getSheetValues() as unknown[][]
    const cama = sheetRows.find((r) => r?.[1] === 'Cama Montessori')
    expect(cama).toEqual([undefined, 'Cama Montessori', 'Cama baja de madera', 350, 'TRUE'])
  })

  it('serializes to a real xlsx buffer', async () => {
    const wb = buildProductsWorkbook(rows)
    const buffer = await wb.xlsx.writeBuffer()
    expect(buffer.byteLength).toBeGreaterThan(0)
  })
})
