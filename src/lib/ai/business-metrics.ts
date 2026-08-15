import type { SupabaseClient } from '@supabase/supabase-js'

export interface BusinessMetrics {
  generatedAt: string
  contacts: { total: number; cold: number; warm: number; hot: number; unclassified: number }
  conversations: { total: number; open: number; pending: number; closed: number }
  deals: { total: number; open: number; won: number; lost: number; wonValue: number }
}

async function exactCount(query: PromiseLike<{ count: number | null; error: { message: string } | null }>) {
  const { count, error } = await query
  if (error) throw new Error(error.message)
  return count ?? 0
}

/** Account-scoped snapshot used as grounding for the company's own AI agent. */
export async function loadBusinessMetrics(
  db: SupabaseClient,
  accountId: string,
): Promise<BusinessMetrics> {
  const contactCount = (temperature?: string | null) => {
    let query = db.from('contacts').select('id', { count: 'exact', head: true }).eq('account_id', accountId)
    query = temperature === null
      ? query.is('lead_temperature', null)
      : temperature
        ? query.eq('lead_temperature', temperature)
        : query
    return exactCount(query)
  }
  const conversationCount = (status?: string) => {
    let query = db.from('conversations').select('id', { count: 'exact', head: true }).eq('account_id', accountId)
    if (status) query = query.eq('status', status)
    return exactCount(query)
  }

  const [contactsTotal, cold, warm, hot, unclassified, conversationsTotal, open, pending, closed, dealsResult] = await Promise.all([
    contactCount(), contactCount('cold'), contactCount('warm'), contactCount('hot'), contactCount(null),
    conversationCount(), conversationCount('open'), conversationCount('pending'), conversationCount('closed'),
    db.from('deals').select('status, value').eq('account_id', accountId),
  ])
  if (dealsResult.error) throw new Error(dealsResult.error.message)
  const deals = dealsResult.data ?? []

  return {
    generatedAt: new Date().toISOString(),
    contacts: { total: contactsTotal, cold, warm, hot, unclassified },
    conversations: { total: conversationsTotal, open, pending, closed },
    deals: {
      total: deals.length,
      open: deals.filter((deal) => deal.status === 'open').length,
      won: deals.filter((deal) => deal.status === 'won').length,
      lost: deals.filter((deal) => deal.status === 'lost').length,
      wonValue: deals.filter((deal) => deal.status === 'won').reduce((sum, deal) => sum + Number(deal.value ?? 0), 0),
    },
  }
}

export function metricsGrounding(metrics: BusinessMetrics): string {
  return `\n\nMÉTRICAS ACTUALES DE ESTA EMPRESA (no mezclar con otras cuentas):\n${JSON.stringify(metrics)}`
}
