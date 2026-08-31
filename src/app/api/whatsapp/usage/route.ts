import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { daysAgoStart, lastNDayKeys, localDayKey } from '@/lib/dashboard/date-utils'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getPricingAnalytics, getWabaCurrency } from '@/lib/whatsapp/pricing-analytics'

const DEFAULT_WINDOW_DAYS = 30

interface MessageRow {
  status: string
  sender_type: 'customer' | 'agent' | 'bot'
  created_at: string
}

/**
 * GET /api/whatsapp/usage?days=30  (admin+)
 *
 * WhatsApp message volume + billing for the account's connected number.
 * Two independent sources, both real (neither is estimated locally):
 *   - `local`   — counted straight from the `messages` table.
 *   - `billing` — Meta's own `pricing_analytics` edge on the WABA, which
 *     is what actually gets invoiced. The two won't match 1:1: most
 *     inbound-triggered replies land inside a free customer-service
 *     window, so `local.total_outbound` is normally well above
 *     `billing.total_billable_volume`.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const url = new URL(request.url)
    const rawDays = Number(url.searchParams.get('days'))
    const days =
      Number.isFinite(rawDays) && rawDays >= 1
        ? Math.min(90, Math.floor(rawDays))
        : DEFAULT_WINDOW_DAYS
    const since = daysAgoStart(days - 1)

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('waba_id, access_token, status')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configError) {
      console.error('[whatsapp/usage GET] config fetch error:', configError)
      return NextResponse.json({ error: 'Failed to load usage' }, { status: 500 })
    }

    const { data: messageRows, error: messagesError } = await supabase
      .from('messages')
      .select('status, sender_type, created_at, conversations!inner(account_id)')
      .eq('conversations.account_id', accountId)
      .gte('created_at', since.toISOString())

    if (messagesError) {
      console.error('[whatsapp/usage GET] messages fetch error:', messagesError)
      return NextResponse.json({ error: 'Failed to load usage' }, { status: 500 })
    }

    const rows = (messageRows ?? []) as unknown as MessageRow[]
    const byStatus = { sending: 0, sent: 0, delivered: 0, read: 0, failed: 0 } as Record<
      string,
      number
    >
    let totalOutbound = 0
    let totalInbound = 0
    for (const r of rows) {
      if (r.sender_type === 'customer') {
        totalInbound += 1
      } else {
        totalOutbound += 1
        if (r.status in byStatus) byStatus[r.status] += 1
      }
    }

    const local = {
      total_outbound: totalOutbound,
      total_inbound: totalInbound,
      by_status: byStatus,
    }

    if (!config?.waba_id || !config?.access_token) {
      return NextResponse.json({
        configured: false,
        window_days: days,
        local,
        billing: null,
      })
    }

    const accessToken = decrypt(config.access_token)
    const endUnix = Math.floor(Date.now() / 1000)
    const startUnix = Math.floor(since.getTime() / 1000)

    try {
      const [dataPoints, currency] = await Promise.all([
        getPricingAnalytics({
          wabaId: config.waba_id,
          accessToken,
          startUnix,
          endUnix,
          granularity: 'DAILY',
        }),
        getWabaCurrency({ wabaId: config.waba_id, accessToken }),
      ])

      let totalCost = 0
      let totalVolume = 0
      const categoryMap = new Map<string, { category: string; volume: number; cost: number }>()
      const daily = new Map<string, { date: string; cost: number }>()
      for (const key of lastNDayKeys(days)) {
        daily.set(key, { date: key, cost: 0 })
      }

      for (const p of dataPoints) {
        totalCost += p.cost
        totalVolume += p.volume

        const cat =
          categoryMap.get(p.pricingCategory) ??
          { category: p.pricingCategory, volume: 0, cost: 0 }
        cat.volume += p.volume
        cat.cost += p.cost
        categoryMap.set(p.pricingCategory, cat)

        const bucket = daily.get(localDayKey(new Date(p.start * 1000)))
        if (bucket) bucket.cost += p.cost
      }

      return NextResponse.json({
        configured: true,
        window_days: days,
        local,
        billing: {
          available: true,
          currency,
          total_cost: totalCost,
          total_billable_volume: totalVolume,
          by_category: [...categoryMap.values()].sort((a, b) => b.cost - a.cost),
          daily: [...daily.values()],
        },
      })
    } catch (err) {
      // Meta call failed (bad token, missing permission, network) — still
      // surface the local counts rather than failing the whole request.
      console.error('[whatsapp/usage GET] pricing_analytics error:', err)
      return NextResponse.json({
        configured: true,
        window_days: days,
        local,
        billing: {
          available: false,
          error: err instanceof Error ? err.message : 'Failed to load billing data',
        },
      })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
