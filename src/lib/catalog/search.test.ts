import { describe, expect, it } from 'vitest'
import { buildSearchVariants } from './search'

// Sample account-configured groups, used to prove the generic mechanism
// works when a caller supplies its own taxonomy — this is deliberately
// NOT imported from anywhere in core code; core has no built-in
// category/colour vocabulary of its own (see ./taxonomy.ts).
const SAMPLE_COLOR_GROUPS = [
  ['branco', 'branca', 'brancos', 'brancas'],
  ['preto', 'preta', 'pretos', 'pretas'],
]
const SAMPLE_CATEGORY_GROUPS = [
  ['legging', 'leggings', 'colante', 'colantes'],
  ['sapatilha', 'sapatilhas'],
]

describe('buildSearchVariants — no built-in vocabulary by default', () => {
  it('does not expand a colour word to other grammatical forms with no groups supplied', () => {
    const variants = buildSearchVariants('tens isso em branco')

    expect(variants).toContain('branco')
    expect(variants).not.toContain('branca')
    expect(variants).not.toContain('brancas')
  })

  it('does not expand a category synonym with no groups supplied', () => {
    const variants = buildSearchVariants('colante')

    expect(variants).toContain('colante')
    expect(variants).not.toContain('legging')
    expect(variants).not.toContain('leggings')
  })

  it('still matches on the raw query and its individual words — plain textual matching keeps working', () => {
    const variants = buildSearchVariants('legging azul escuro')

    expect(variants).toContain('legging azul escuro')
    expect(variants).toContain('legging')
    expect(variants).toContain('azul')
    expect(variants).toContain('escuro')
  })
})

describe('buildSearchVariants — expands an account own configured groups', () => {
  it('expands a masculine colour word to its feminine/plural forms when the account configured that group', () => {
    const variants = buildSearchVariants('tens isso em branco', SAMPLE_CATEGORY_GROUPS, SAMPLE_COLOR_GROUPS)

    expect(variants).toContain('branco')
    expect(variants).toContain('branca')
    expect(variants).toContain('brancas')
  })

  it('expands a feminine colour word back to the masculine form when configured', () => {
    const variants = buildSearchVariants('legging preta', SAMPLE_CATEGORY_GROUPS, SAMPLE_COLOR_GROUPS)

    expect(variants).toContain('preta')
    expect(variants).toContain('preto')
  })

  it('expands product-category synonyms when the account configured that group', () => {
    const variants = buildSearchVariants('colante', SAMPLE_CATEGORY_GROUPS, SAMPLE_COLOR_GROUPS)

    expect(variants).toContain('legging')
    expect(variants).toContain('leggings')
  })

  it('does not add unrelated colour synonyms for a query with no colour', () => {
    const variants = buildSearchVariants('sapatilha', SAMPLE_CATEGORY_GROUPS, SAMPLE_COLOR_GROUPS)

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
