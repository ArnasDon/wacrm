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

describe('buildSearchVariants — size cue', () => {
  it('adds a bare letter-code size when explicitly cued by "tamanho"', () => {
    const variants = buildSearchVariants('tens isso em tamanho M?')
    expect(variants).toContain('m')
  })

  it('adds a two-letter size code without truncating it to one letter', () => {
    const variants = buildSearchVariants('tem tamanho GG?')
    expect(variants).toContain('gg')
    expect(variants).not.toContain('g')
  })

  it('adds a numeric size when cued by "numero"', () => {
    const variants = buildSearchVariants('tem numero 38?')
    expect(variants).toContain('38')
  })

  it('does not add a bare size letter when there is no size cue in the query', () => {
    const variants = buildSearchVariants('quero comprar leggings')
    expect(variants).not.toContain('m')
    expect(variants).not.toContain('p')
    expect(variants).not.toContain('g')
  })
})
