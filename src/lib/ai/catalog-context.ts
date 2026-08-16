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
export async function loadCatalogContext(
  db: SupabaseClient,
  accountId: string,
): Promise<string[] | null> {
  const [{ data: products }, { data: account }] = await Promise.all([
    db
      .from('products')
      .select('name, price, description')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .order('name')
      .limit(MAX_PRODUCTS_IN_PROMPT),
    db.from('accounts').select('default_currency').eq('id', accountId).maybeSingle(),
  ])
  if (!products || products.length === 0) return null

  const currency = (account?.default_currency as string | undefined) ?? 'USD'
  return (products as { name: string; price: number; description: string | null }[]).map((p) => {
    const price = formatCurrency(p.price, currency)
    const desc = p.description ? ` — ${truncate(p.description, MAX_DESCRIPTION_CHARS)}` : ''
    return `- ${p.name} (${price})${desc}`
  })
}

function truncate(s: string, max: number): string {
  const trimmed = s.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}
