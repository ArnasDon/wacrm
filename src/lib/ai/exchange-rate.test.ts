import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { DEFAULT_USD_TO_MZN_RATE } from './pricing'
import { getUsdToMznRate, parseBciUsdRow } from './exchange-rate'

// Trimmed fragment of the real table markup at https://www.bci.co.mz/cambio/
// (captured 2026-08-11) — the parser only needs the USD row.
const BCI_HTML = `
<table id="cambio-table" class="table-vw vw-100">
  <thead>
    <tr><th>PAÍSES / COUNTRIES</th><th>MOEDA / CURRENCY</th><th>COMPRA / BID</th><th>VENDA / OFFER</th></tr>
  </thead>
  <tbody class="cambio_total">
    <tr>
      <td class='column-first'>África do Sul</td>
      <td>ZAR</td>
      <td>3.89</td>
      <td>3.96</td>
    </tr>
    <tr>
      <td class='column-first'>EUA</td>
      <td>USD</td>
      <td>63.25</td>
      <td>64.51</td>
    </tr>
    <tr>
      <td class='column-first'>Suécia</td>
      <td>SEK</td>
      <td>6.65</td>
      <td>6.78</td>
    </tr>
  </tbody>
</table>
`

describe('parseBciUsdRow', () => {
  it('reads buy/sell off the real BCI table markup and averages them', () => {
    const result = parseBciUsdRow(BCI_HTML)
    expect(result).not.toBeNull()
    expect(result!.buy).toBe(63.25)
    expect(result!.sell).toBe(64.51)
    expect(result!.rate).toBeCloseTo((63.25 + 64.51) / 2)
  })

  it('returns null when the USD row is missing', () => {
    expect(parseBciUsdRow('<table><tr><td>EUR</td><td>72.1</td><td>73.0</td></tr></table>')).toBeNull()
  })

  it('returns null on malformed numbers', () => {
    expect(
      parseBciUsdRow(`<td>USD</td><td>not-a-number</td><td>64.51</td>`),
    ).toBeNull()
  })
})

function dbWith(opts: {
  cachedRate?: number | null
  cachedAt?: string | null
  update?: ReturnType<typeof vi.fn>
}) {
  const update = opts.update ?? vi.fn(() => ({
    eq: () => ({ then: (cb: (r: { error: null }) => void) => cb({ error: null }) }),
  }))
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () =>
      Promise.resolve({
        data:
          opts.cachedRate === undefined
            ? null
            : { usd_to_mzn_rate: opts.cachedRate, usd_to_mzn_rate_updated_at: opts.cachedAt ?? null },
        error: null,
      }),
    update,
  }
  return chain as unknown as WacrmSupabaseClient
}

describe('getUsdToMznRate', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the cached rate without fetching when it is fresh', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const db = dbWith({ cachedRate: 65, cachedAt: new Date().toISOString() })

    const result = await getUsdToMznRate(db, 'acct-1')

    expect(result).toEqual({ rate: 65, source: 'cached', updatedAt: expect.any(String) })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetches from BCI and persists the result when the cache is stale', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(BCI_HTML) }),
    )
    const update = vi.fn(() => ({
      eq: () => ({ then: (cb: (r: { error: null }) => void) => cb({ error: null }) }),
    }))
    const staleDate = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString()
    const db = dbWith({ cachedRate: 60, cachedAt: staleDate, update })

    const result = await getUsdToMznRate(db, 'acct-1')

    expect(result.source).toBe('bci')
    expect(result.rate).toBeCloseTo((63.25 + 64.51) / 2)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ usd_to_mzn_rate: result.rate }),
    )
  })

  it('falls back to the stale cached rate when the BCI fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const staleDate = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString()
    const db = dbWith({ cachedRate: 60, cachedAt: staleDate })

    const result = await getUsdToMznRate(db, 'acct-1')

    expect(result).toEqual({ rate: 60, source: 'cached', updatedAt: staleDate })
  })

  it('falls back to the hardcoded default when there is no cache and BCI fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const db = dbWith({ cachedRate: undefined })

    const result = await getUsdToMznRate(db, 'acct-1')

    expect(result).toEqual({ rate: DEFAULT_USD_TO_MZN_RATE, source: 'default', updatedAt: null })
  })
})
