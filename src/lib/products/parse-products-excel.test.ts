import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildProductsWorkbook, type ProductExportRow } from './export-excel'
import { parseProductsWorkbook } from './parse-products-excel'

async function workbookBuffer(wb: ExcelJS.Workbook): Promise<ArrayBuffer> {
  const buf = await wb.xlsx.writeBuffer()
  return buf as unknown as ArrayBuffer
}

describe('parseProductsWorkbook', () => {
  it('round-trips exactly what buildProductsWorkbook exported', async () => {
    const rows: ProductExportRow[] = [
      { name: 'Cama Montessori', description: 'Cama baja de madera', price: 350, is_active: true },
      { name: 'Silla', description: '', price: 75.5, is_active: false },
    ]
    const buffer = await workbookBuffer(buildProductsWorkbook(rows))
    const result = await parseProductsWorkbook(buffer)

    expect(result.errors).toEqual([])
    expect(result.rows).toEqual([
      { name: 'Cama Montessori', description: 'Cama baja de madera', price: 350, is_active: true, category: null, rates: [] },
      { name: 'Silla', description: null, price: 75.5, is_active: false, category: null, rates: [] },
    ])
  })

  it('round-trips category + the room_rates cell', async () => {
    const rows: ProductExportRow[] = [
      {
        name: 'Hab 101',
        description: 'Vista jardín',
        price: 0,
        is_active: true,
        category: 'Habitaciones',
        room_rates: 'mon=800/950;fri=1200//1600',
      },
    ]
    const result = await parseProductsWorkbook(await workbookBuffer(buildProductsWorkbook(rows)))
    expect(result.errors).toEqual([])
    expect(result.rows[0]).toMatchObject({
      name: 'Hab 101',
      category: 'Habitaciones',
      rates: [
        { day_of_week: 'mon', occupancy: 'standard', price: 800 },
        { day_of_week: 'mon', occupancy: 'couple', price: 950 },
        { day_of_week: 'fri', occupancy: 'standard', price: 1200 },
        { day_of_week: 'fri', occupancy: 'group', price: 1600 },
      ],
    })
  })

  it('reports a malformed room_rates cell and skips the row', async () => {
    const wb = new ExcelJS.Workbook()
    const sheet = wb.addWorksheet('Products')
    sheet.addRow(['name', 'price', 'room_rates'])
    sheet.addRow(['Hab', 0, 'funday=800'])
    sheet.addRow(['Fine', 10, ''])
    const result = await parseProductsWorkbook(await workbookBuffer(wb))
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].row).toBe(2)
    expect(result.rows).toHaveLength(1)
  })

  it('reports a row with a missing name and skips it, keeping the rest', async () => {
    const wb = new ExcelJS.Workbook()
    const sheet = wb.addWorksheet('Products')
    sheet.addRow(['name', 'description', 'price', 'is_active'])
    sheet.addRow(['', 'no name here', 100, 'true'])
    sheet.addRow(['Valid product', 'ok', 20, 'true'])
    const result = await parseProductsWorkbook(await workbookBuffer(wb))

    expect(result.errors).toEqual([{ row: 2, message: 'name is required' }])
    expect(result.rows).toEqual([{ name: 'Valid product', description: 'ok', price: 20, is_active: true, category: null, rates: [] }])
  })

  it('reports a row with a negative or non-numeric price and skips it', async () => {
    const wb = new ExcelJS.Workbook()
    const sheet = wb.addWorksheet('Products')
    sheet.addRow(['name', 'price'])
    sheet.addRow(['Negative price', -5])
    sheet.addRow(['Not a number', 'abc'])
    sheet.addRow(['Fine', 10])
    const result = await parseProductsWorkbook(await workbookBuffer(wb))

    expect(result.errors).toEqual([
      { row: 2, message: 'price must be a non-negative number' },
      { row: 3, message: 'price must be a non-negative number' },
    ])
    expect(result.rows).toEqual([{ name: 'Fine', description: null, price: 10, is_active: true, category: null, rates: [] }])
  })

  it('defaults is_active to true when the column is absent', async () => {
    const wb = new ExcelJS.Workbook()
    const sheet = wb.addWorksheet('Products')
    sheet.addRow(['name', 'price'])
    sheet.addRow(['Product', 10])
    const result = await parseProductsWorkbook(await workbookBuffer(wb))

    expect(result.rows).toEqual([{ name: 'Product', description: null, price: 10, is_active: true, category: null, rates: [] }])
  })

  it('skips fully blank trailing rows without reporting an error', async () => {
    const wb = new ExcelJS.Workbook()
    const sheet = wb.addWorksheet('Products')
    sheet.addRow(['name', 'price'])
    sheet.addRow(['Product', 10])
    sheet.addRow([])
    const result = await parseProductsWorkbook(await workbookBuffer(wb))

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
  })

  it('returns no rows/errors when required columns are missing entirely', async () => {
    const wb = new ExcelJS.Workbook()
    const sheet = wb.addWorksheet('Products')
    sheet.addRow(['description', 'is_active'])
    sheet.addRow(['missing name/price columns', 'true'])
    const result = await parseProductsWorkbook(await workbookBuffer(wb))

    expect(result).toEqual({ rows: [], errors: [] })
  })
})
