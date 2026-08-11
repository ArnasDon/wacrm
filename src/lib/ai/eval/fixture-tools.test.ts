import { describe, expect, it } from 'vitest'
import { createFixtureTools, FIXTURE_CATALOG } from './fixture-tools'

describe('fixture tools', () => {
  it('finds catalogue products by name', async () => {
    const { executeTool, recordedCalls } = createFixtureTools()
    const result = JSON.parse(
      await executeTool({ id: 'c1', name: 'search_catalog', arguments: JSON.stringify({ query: 'legging' }) }),
    )
    expect(result.found).toBe(true)
    expect(result.products).toHaveLength(2)
    expect(result.products.map((p: { color: string }) => p.color).sort()).toEqual(['Branca', 'Preta'])
    expect(recordedCalls()).toEqual([{ name: 'search_catalog', arguments: { query: 'legging' } }])
  })

  it('finds catalogue products by colour alone', async () => {
    const { executeTool } = createFixtureTools()
    const result = JSON.parse(
      await executeTool({ id: 'c1', name: 'search_catalog', arguments: JSON.stringify({ query: 'branca' }) }),
    )
    expect(result.found).toBe(true)
    expect(result.products.every((p: { color: string }) => p.color === 'Branca')).toBe(true)
  })

  // Real finding from building this fixture: masculine/feminine agreement
  // ("branco" vs "Branca") is NOT normalised here, deliberately — this
  // fixture mirrors search.ts's actual matching (simple substring/ilike,
  // no stemming), so a gap here is a real gap in production too, not a
  // fixture bug. Worth a follow-up in search.ts if this shows up as a
  // real customer complaint.
  it('does not match across Portuguese gender agreement (mirrors a real search.ts gap)', async () => {
    const { executeTool } = createFixtureTools()
    const result = JSON.parse(
      await executeTool({ id: 'c1', name: 'search_catalog', arguments: JSON.stringify({ query: 'branco' }) }),
    )
    expect(result.found).toBe(false)
  })

  it('reports no match honestly instead of inventing a product', async () => {
    const { executeTool } = createFixtureTools()
    const result = JSON.parse(
      await executeTool({ id: 'c1', name: 'search_catalog', arguments: JSON.stringify({ query: 'fato de banho' }) }),
    )
    expect(result.found).toBe(false)
    expect(result.products).toEqual([])
  })

  it('gives a style opinion referencing the requested products', async () => {
    const { executeTool } = createFixtureTools()
    const result = JSON.parse(
      await executeTool({
        id: 'c1',
        name: 'get_style_opinion',
        arguments: JSON.stringify({
          product_refs: [FIXTURE_CATALOG[0].productRef],
          customer_description: 'Sou baixinha, prefiro roupa reservada.',
        }),
      }),
    )
    expect(result.ok).toBe(true)
    expect(result.opinion).toContain(FIXTURE_CATALOG[0].name)
  })

  it('records a scheduled visit', async () => {
    const { executeTool } = createFixtureTools()
    const result = JSON.parse(
      await executeTool({
        id: 'c1',
        name: 'schedule_visit',
        arguments: JSON.stringify({ scheduled_at: '2026-08-15T15:00:00+02:00' }),
      }),
    )
    expect(result).toMatchObject({ ok: true, scheduled: true, scheduled_at: '2026-08-15T15:00:00+02:00' })
  })

  it('rejects an unknown tool name', async () => {
    const { executeTool } = createFixtureTools()
    await expect(
      executeTool({ id: 'c1', name: 'delete_everything', arguments: '{}' }),
    ).rejects.toThrow('Unknown fixture tool')
  })

  it('keeps recorded calls isolated per fixture instance', async () => {
    const a = createFixtureTools()
    const b = createFixtureTools()
    await a.executeTool({ id: 'c1', name: 'search_knowledge', arguments: JSON.stringify({ query: 'horario' }) })
    expect(a.recordedCalls()).toHaveLength(1)
    expect(b.recordedCalls()).toHaveLength(0)
  })
})
