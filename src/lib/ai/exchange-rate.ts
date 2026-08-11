import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { DEFAULT_USD_TO_MZN_RATE } from './pricing'

const BCI_URL = 'https://www.bci.co.mz/cambio/'
const FETCH_TIMEOUT_MS = 8_000
// How long a cached rate is trusted before we try BCI again. The page
// itself only updates once (or a few times) a day, so anything under a
// few hours old is still today's rate.
const CACHE_TTL_MS = 6 * 60 * 60 * 1_000

export interface BciRate {
  buy: number
  sell: number
  /** Average of buy/sell — used as "the" rate for cost estimates. */
  rate: number
}

/**
 * Scrapes BCI's daily exchange-rate table (plain server-rendered HTML,
 * no JS needed) for the USD row. Returns null on ANY failure — network,
 * timeout, or the page's markup no longer matching — so callers always
 * have a defined fallback instead of a thrown error taking down a
 * dashboard read.
 */
export async function fetchBciUsdMznRate(): Promise<BciRate | null> {
  try {
    const res = await fetch(BCI_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wacrm-cost-tracker/1.0)' },
    })
    if (!res.ok) return null
    const html = await res.text()
    return parseBciUsdRow(html)
  } catch (error) {
    console.error('[exchange-rate] BCI fetch failed:', error)
    return null
  }
}

/** Exported separately from the network call so parsing can be unit
 *  tested against a captured HTML sample without a real fetch. */
export function parseBciUsdRow(html: string): BciRate | null {
  const match = html.match(/<td[^>]*>\s*USD\s*<\/td>\s*<td>\s*([\d.,]+)\s*<\/td>\s*<td>\s*([\d.,]+)\s*<\/td>/i)
  if (!match) return null
  const buy = Number(match[1].replace(',', '.'))
  const sell = Number(match[2].replace(',', '.'))
  if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy <= 0 || sell <= 0) return null
  return { buy, sell, rate: (buy + sell) / 2 }
}

export interface UsdToMznRate {
  rate: number
  source: 'bci' | 'cached' | 'default'
  updatedAt: string | null
}

/**
 * The rate to use right now for this account: refreshes from BCI when
 * the cached value is missing or older than CACHE_TTL_MS, persisting
 * the fresh value back onto ai_configs so the next call (and every
 * other reader — Settings, Usage) reads the same cached number instead
 * of each hitting BCI independently. Never throws: BCI down or the
 * account not configured yet both degrade to the last known value, or
 * the hardcoded default if there's never been one.
 */
export async function getUsdToMznRate(
  db: WacrmSupabaseClient,
  accountId: string,
): Promise<UsdToMznRate> {
  const { data: config } = await db
    .from('ai_configs')
    .select('usd_to_mzn_rate, usd_to_mzn_rate_updated_at')
    .eq('account_id', accountId)
    .maybeSingle()

  const cachedRate = config?.usd_to_mzn_rate ?? null
  const cachedAt = config?.usd_to_mzn_rate_updated_at ?? null
  const isFresh = cachedAt && Date.now() - new Date(cachedAt).getTime() < CACHE_TTL_MS

  if (isFresh && cachedRate) {
    return { rate: cachedRate, source: 'cached', updatedAt: cachedAt }
  }

  const fetched = await fetchBciUsdMznRate()
  if (fetched) {
    const updatedAt = new Date().toISOString()
    // Best-effort persist — a failed write just means the next reader
    // tries BCI again too, which is safe, just slightly wasteful.
    await db
      .from('ai_configs')
      .update({ usd_to_mzn_rate: fetched.rate, usd_to_mzn_rate_updated_at: updatedAt })
      .eq('account_id', accountId)
      .then(({ error }) => {
        if (error) console.error('[exchange-rate] failed to cache BCI rate:', error)
      })
    return { rate: fetched.rate, source: 'bci', updatedAt }
  }

  if (cachedRate) {
    return { rate: cachedRate, source: 'cached', updatedAt: cachedAt }
  }
  return { rate: DEFAULT_USD_TO_MZN_RATE, source: 'default', updatedAt: null }
}
