import { NextResponse, type NextRequest } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  loadAds,
  loadCalls,
  loadCampaigns,
  loadChannels,
  loadEmail,
  loadLost,
  loadOverview,
  loadTopLeads,
  type DateRange,
} from '@/lib/reporting/queries'

// ============================================================
// GET /api/report/[tab]?from=ISO&to=ISO — agregados de reporting
// (DAD §7.6, Item 15). Solo agent+.
//   tab: overview | campaigns | channels | ads | email | calls |
//        top-leads | lost
// ============================================================

const TABS = new Set([
  'overview',
  'campaigns',
  'channels',
  'ads',
  'email',
  'calls',
  'top-leads',
  'lost',
])

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tab: string }> },
) {
  try {
    // El accountId del llamante acota TODAS las consultas: los cargadores
    // usan service-role, que salta RLS, así que este es el único filtro de
    // tenencia que hay. Antes se descartaba y /reports mezclaba cuentas.
    const ctx = await requireRole('agent')
    const { tab } = await params
    if (!TABS.has(tab)) {
      return NextResponse.json({ error: 'unknown tab' }, { status: 404 })
    }

    const url = new URL(req.url)
    const from = url.searchParams.get('from') ?? ''
    const to = url.searchParams.get('to') ?? ''
    const range: DateRange = { from, to }

    switch (tab) {
      case 'overview':
        return NextResponse.json(await loadOverview(ctx.accountId, range))
      case 'campaigns':
        return NextResponse.json(await loadCampaigns(ctx.accountId, range))
      case 'channels':
        return NextResponse.json(await loadChannels(ctx.accountId, range))
      case 'ads':
        return NextResponse.json(await loadAds(ctx.accountId, range))
      case 'email':
        return NextResponse.json(await loadEmail(ctx.accountId, range))
      case 'calls':
        return NextResponse.json(await loadCalls(ctx.accountId, range))
      case 'top-leads':
        return NextResponse.json(await loadTopLeads(ctx.accountId, range))
      case 'lost':
        return NextResponse.json(await loadLost(ctx.accountId, range))
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
