import { describe, it, expect } from 'vitest'
import { decodeCatalogId, encodeCatalogId } from './id'

describe('catalog composite ids', () => {
  it('round-trips provider key + native id', () => {
    const id = encodeCatalogId('budun_int-1', 'sku-42')
    expect(decodeCatalogId(id)).toEqual({ providerKey: 'budun_int-1', nativeId: 'sku-42' })
  })

  it('splits on the FIRST colon, so a native id containing colons stays intact', () => {
    const id = encodeCatalogId('ds_abc', 'row:with:colons')
    expect(decodeCatalogId(id)).toEqual({ providerKey: 'ds_abc', nativeId: 'row:with:colons' })
  })

  it('returns null for an id with no separator — never guessed at', () => {
    expect(decodeCatalogId('not-a-composite-id')).toBeNull()
  })

  it('returns null for an id a model could plausibly fabricate', () => {
    // A model hallucinating "budun_123" (no native id half) must not
    // resolve to anything.
    expect(decodeCatalogId('budun_123:')).toBeNull()
    expect(decodeCatalogId(':native-only')).toBeNull()
    expect(decodeCatalogId('')).toBeNull()
  })
})
