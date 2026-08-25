import { describe, it, expect } from 'vitest'
import { renderQuotePdf } from './quote-pdf'
import type { Quote, QuoteItem } from '@/types'

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: 'quote-1',
    account_id: 'acct-1',
    user_id: 'user-1',
    contact_id: 'contact-1',
    deal_id: 'deal-1',
    customer_nit: '123456-7',
    customer_email: 'cliente@example.com',
    customer_phone: '+50212345678',
    customer_address: 'Zona 10, Ciudad de Guatemala',
    currency: 'GTQ',
    subtotal: 100,
    total: 100,
    status: 'draft',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function item(overrides: Partial<QuoteItem> = {}): QuoteItem {
  return {
    id: 'item-1',
    quote_id: 'quote-1',
    product_id: 'product-1',
    description: 'Producto de prueba',
    unit_price: 50,
    quantity: 2,
    line_total: 100,
    position: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('renderQuotePdf', () => {
  it('produces a non-empty PDF buffer', async () => {
    const buffer = await renderQuotePdf(quote(), [item()], 'Chat Sandía')
    expect(buffer.length).toBeGreaterThan(0)
    expect(buffer.subarray(0, 5).toString('utf-8')).toBe('%PDF-')
  })

  it('renders with no items without throwing', async () => {
    const buffer = await renderQuotePdf(quote({ subtotal: 0, total: 0 }), [], 'Chat Sandía')
    expect(buffer.length).toBeGreaterThan(0)
  })

  it('renders with no NIT/email without throwing (migration 082 — optional)', async () => {
    const buffer = await renderQuotePdf(quote({ customer_nit: null, customer_email: null }), [item()], 'Chat Sandía')
    expect(buffer.length).toBeGreaterThan(0)
    expect(buffer.subarray(0, 5).toString('utf-8')).toBe('%PDF-')
  })
})
