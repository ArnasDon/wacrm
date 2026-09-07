import { describe, it, expect } from 'vitest'
import { buildProductsWorkbook, toProductExportRow, type ProductExportRow } from './export-excel'
import type { Product, ProductRateRow } from '@/types'

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

function rate(overrides: Partial<ProductRateRow>): ProductRateRow {
  return {
    id: 'r',
    account_id: 'a1',
    product_id: 'p1',
    day_of_week: 'mon',
    occupancy: 'standard',
    price: 0,
    date_from: null,
    date_to: null,
    position: 0,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('toProductExportRow', () => {
  it('maps a product to an export row', () => {
    expect(toProductExportRow(makeProduct(), 'Camas')).toEqual({
      name: 'Cama Montessori',
      description: 'Cama baja de madera',
      price: 350,
      is_active: true,
      category: 'Camas',
      room_rates: '',
    })
  })

  it('falls back to an empty string when description is missing', () => {
    const row = toProductExportRow(makeProduct({ description: null }))
    expect(row.description).toBe('')
    expect(row.category).toBe('')
  })

  it('encodes always-on room rates into the room_rates cell, ignoring seasonal rows', () => {
    const row = toProductExportRow(
      makeProduct({
        rates: [
          rate({ id: 'r1', day_of_week: 'mon', occupancy: 'standard', price: 800 }),
          rate({ id: 'r2', day_of_week: 'fri', occupancy: 'standard', price: 1200 }),
          rate({ id: 'r3', day_of_week: 'fri', occupancy: 'group', price: 1700 }),
          rate({
            id: 'r4',
            day_of_week: 'mon',
            occupancy: 'standard',
            price: 1500,
            date_from: '2026-12-24',
            date_to: '2026-12-31',
          }),
        ],
      }),
    )
    expect(row.room_rates).toBe('mon=800;fri=1200//1700')
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
    expect(cama).toEqual([
      undefined,
      'Cama Montessori',
      'Cama baja de madera',
      350,
      'TRUE',
      '',
      '',
    ])
  })

  it('serializes to a real xlsx buffer', async () => {
    const wb = buildProductsWorkbook(rows)
    const buffer = await wb.xlsx.writeBuffer()
    expect(buffer.byteLength).toBeGreaterThan(0)
  })
})
