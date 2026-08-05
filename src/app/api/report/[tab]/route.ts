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
    await requireRole('agent')
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
        return NextResponse.json(await loadOverview(range))
      case 'campaigns':
        return NextResponse.json(await loadCampaigns(range))
      case 'channels':
        return NextResponse.json(await loadChannels(range))
      case 'ads':
        return NextResponse.json(await loadAds(range))
      case 'email':
        return NextResponse.json(await loadEmail(range))
      case 'calls':
        return NextResponse.json(await loadCalls(range))
      case 'top-leads':
        return NextResponse.json(await loadTopLeads(range))
      case 'lost':
        return NextResponse.json(await loadLost(range))
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
