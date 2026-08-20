import { describe, it, expect } from 'vitest'
import { parsePriceOptions, MAX_PRICE_OPTIONS } from './price-options'

describe('parsePriceOptions', () => {
  it('defaults to an empty list when the field is absent', () => {
    const result = parsePriceOptions(undefined)
    expect(result).toEqual({ ok: true, options: [] })
  })

  it('accepts a minimal option (label + price only)', () => {
    const result = parsePriceOptions([{ label: 'Talla XL', price: 150 }])
    expect(result).toEqual({
      ok: true,
      options: [{ label: 'Talla XL', price: 150, installation_cost: null, image_urls: [] }],
    })
  })

  it('accepts an option with installation cost and photos', () => {
    const result = parsePriceOptions([
      { label: 'Talla XL', price: 150, installation_cost: 25, image_urls: ['https://x/a.png', 'https://x/b.png'] },
    ])
    expect(result).toEqual({
      ok: true,
      options: [
        { label: 'Talla XL', price: 150, installation_cost: 25, image_urls: ['https://x/a.png', 'https://x/b.png'] },
      ],
    })
  })

  it('treats an empty-string installation_cost as absent', () => {
    const result = parsePriceOptions([{ label: 'A', price: 10, installation_cost: '' }])
    expect(result).toMatchObject({ ok: true, options: [{ installation_cost: null }] })
  })

  it('rejects more than MAX_PRICE_OPTIONS entries', () => {
    const raw = Array.from({ length: MAX_PRICE_OPTIONS + 1 }, (_, i) => ({ label: `Opt ${i}`, price: 1 }))
    const result = parsePriceOptions(raw)
    expect(result.ok).toBe(false)
  })

  it('rejects a missing label', () => {
    const result = parsePriceOptions([{ label: '  ', price: 10 }])
    expect(result.ok).toBe(false)
  })

  it('rejects a negative price', () => {
    const result = parsePriceOptions([{ label: 'A', price: -5 }])
    expect(result.ok).toBe(false)
  })

  it('rejects a negative installation_cost', () => {
    const result = parsePriceOptions([{ label: 'A', price: 10, installation_cost: -1 }])
    expect(result.ok).toBe(false)
  })

  it('rejects a non-array payload', () => {
    const result = parsePriceOptions({ label: 'A', price: 10 })
    expect(result.ok).toBe(false)
  })

  it('filters out non-string image_urls entries', () => {
    const result = parsePriceOptions([{ label: 'A', price: 10, image_urls: ['ok', 42, null, '  '] }])
    expect(result).toMatchObject({ ok: true, options: [{ image_urls: ['ok'] }] })
  })
})
