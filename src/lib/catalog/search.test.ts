import { describe, expect, it } from 'vitest'
import { buildSearchVariants } from './search'

describe('buildSearchVariants — colour gender agreement', () => {
  it('expands a masculine colour word to its feminine/plural forms', () => {
    const variants = buildSearchVariants('tens isso em branco')
    expect(variants).toContain('branco')
    expect(variants).toContain('branca')
    expect(variants).toContain('brancas')
  })

  it('expands a feminine colour word back to the masculine form', () => {
    const variants = buildSearchVariants('legging preta')
    expect(variants).toContain('preta')
    expect(variants).toContain('preto')
  })

  it('still expands product-category synonyms as before', () => {
    const variants = buildSearchVariants('colante')
    expect(variants).toContain('legging')
    expect(variants).toContain('leggings')
  })

  it('does not add unrelated colour synonyms for a query with no colour', () => {
    const variants = buildSearchVariants('sapatilha')
    expect(variants).not.toContain('branca')
    expect(variants).not.toContain('preto')
  })
})
