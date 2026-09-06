import type { SupabaseClient } from '@supabase/supabase-js'
import { formatCurrency } from '@/lib/currency'

// Bounds how much of the catalog reaches the prompt — plenty for a
// small/medium product list, keeps token spend predictable for
// accounts with a large one.
const MAX_PRODUCTS_IN_PROMPT = 30
const MAX_DESCRIPTION_CHARS = 80

/**
 * Compact, prompt-ready lines describing the account's active catalog
 * (name, price, short description), so the model can recommend and
 * quote real products by name instead of guessing. Returns null when
 * the account has no active products — callers should simply omit the
 * catalog section from the prompt in that case.
 */
interface CatalogProductRow {
  id: string
  name: string
  price: number
  description: string | null
}

interface RateRow {
  product_id: string
  weekday_group: 'weekday' | 'weekend'
  occupancy: 'standard' | 'couple'
  price: number
  date_from: string | null
  date_to: string | null
}

export async function loadCatalogContext(
  db: SupabaseClient,
  accountId: string,
): Promise<string[] | null> {
  const [{ data: products }, { data: account }] = await Promise.all([
    db
      .from('products')
      .select('id, name, price, description')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .order('name')
      .limit(MAX_PRODUCTS_IN_PROMPT),
    db
      .from('accounts')
      .select('default_currency, industry_vertical')
      .eq('id', accountId)
      .maybeSingle(),
  ])
  if (!products || products.length === 0) return null

  const currency = (account?.default_currency as string | undefined) ?? 'USD'
  const typed = products as CatalogProductRow[]

  // Hotel vertical: show each room's per-date rate structure (migration
  // 106) instead of just the base price, so the model can inform
  // tariffs and compute a stay correctly.
  let ratesByProduct = new Map<string, RateRow[]>()
  if (account?.industry_vertical === 'hotel') {
    const { data: rates } = await db
      .from('product_rates')
      .select('product_id, weekday_group, occupancy, price, date_from, date_to')
      .eq('account_id', accountId)
      .in('product_id', typed.map((p) => p.id))
    ratesByProduct = groupBy((rates as RateRow[] | null) ?? [], (r) => r.product_id)
  }

  return typed.map((p) => {
    const desc = p.description ? ` — ${truncate(p.description, MAX_DESCRIPTION_CHARS)}` : ''
    const rates = ratesByProduct.get(p.id) ?? []
    if (rates.length > 0) {
      return `- ${p.name}: ${formatRateSummary(rates, currency)}${desc}`
    }
    return `- ${p.name} (${formatCurrency(p.price, currency)})${desc}`
  })
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const row of rows) {
    const k = key(row)
    const list = map.get(k) ?? []
    list.push(row)
    map.set(k, list)
  }
  return map
}

/** "Lun–Jue Q800 · Vie–Dom Q1200 · pareja Lun–Jue Q950 · pareja Vie–Dom Q1400
 *  (temporada 24/12–31/12: Q1500)". Compact enough for the prompt. */
function formatRateSummary(rates: RateRow[], currency: string): string {
  const always = rates.filter((r) => !r.date_from && !r.date_to)
  const label = (r: RateRow) =>
    `${r.occupancy === 'couple' ? 'pareja ' : ''}${r.weekday_group === 'weekend' ? 'Vie–Dom' : 'Lun–Jue'}`
  const parts = always
    .sort(
      (a, b) =>
        Number(a.occupancy === 'couple') - Number(b.occupancy === 'couple') ||
        Number(a.weekday_group === 'weekend') - Number(b.weekday_group === 'weekend'),
    )
    .map((r) => `${label(r)} ${formatCurrency(r.price, currency)}`)

  const seasons = rates.filter((r) => r.date_from && r.date_to)
  if (seasons.length > 0) {
    const from = seasons[0].date_from!
    const to = seasons[0].date_to!
    const prices = [...new Set(seasons.map((r) => formatCurrency(r.price, currency)))]
    parts.push(`temporada ${from}–${to}: ${prices.join(' / ')}`)
  }
  return parts.join(' · ')
}

function truncate(s: string, max: number): string {
  const trimmed = s.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}
