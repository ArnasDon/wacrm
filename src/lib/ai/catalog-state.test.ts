import { describe, expect, it } from 'vitest'
import { conversationCatalogStatePrompt } from './catalog-state'

describe('conversationCatalogStatePrompt', () => {
  it('returns null for an empty catalogue state', () => {
    expect(
      conversationCatalogStatePrompt({
        lastQuery: null,
        lastFilters: {},
        shownProductKeys: [],
        shownMediaKeys: [],
        rejectedProductKeys: [],
        selectedProductKey: null,
        selectedProductName: null,
      }),
    ).toBeNull()
  })

  it('keeps selected product and structured filters without exposing internal keys', () => {
    const prompt = conversationCatalogStatePrompt({
      lastQuery: 'legging',
      lastFilters: { category: 'legging', color: 'preto', size: 'M', mode: 'browse' },
      shownProductKeys: ['internal:secret-product-id'],
      shownMediaKeys: ['internal:secret-product-id#1'],
      rejectedProductKeys: [],
      selectedProductKey: 'internal:secret-product-id',
      selectedProductName: 'Legging Cintura Alta',
    })

    expect(prompt).toContain('Legging Cintura Alta')
    expect(prompt).toContain('category="legging"')
    expect(prompt).toContain('color="preto"')
    expect(prompt).toContain('size="M"')
    expect(prompt).toContain('1 product(s) have already been shown')
    expect(prompt).not.toContain('secret-product-id')
  })
})
