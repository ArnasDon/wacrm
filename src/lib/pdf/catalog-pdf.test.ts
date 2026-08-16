import { describe, it, expect } from 'vitest'
import { renderCatalogPdf } from './catalog-pdf'
import type { Product } from '@/types'

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    account_id: 'acct-1',
    user_id: 'user-1',
    name: 'Producto de prueba',
    description: 'Una descripción breve',
    price: 99,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('renderCatalogPdf', () => {
  it('produces a non-empty PDF buffer', async () => {
    const buffer = await renderCatalogPdf([product(), product({ id: 'product-2', image_url: null })], 'Chat Sandía', 'GTQ')
    expect(buffer.length).toBeGreaterThan(0)
    expect(buffer.subarray(0, 5).toString('utf-8')).toBe('%PDF-')
  })

  it('renders with no products without throwing', async () => {
    const buffer = await renderCatalogPdf([], 'Chat Sandía', 'USD')
    expect(buffer.length).toBeGreaterThan(0)
  })
})
