import { NextResponse, type NextRequest } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  GROUP_BY_OPTIONS,
  loadAcquisition,
  type GroupBy,
} from '@/lib/reporting/acquisition'
import type { DateRange } from '@/lib/reporting/queries'

// ============================================================
// GET /api/report/acquisition?from=ISO&to=ISO&group_by=channel
//
// La única ruta de /reports. Sustituye a las pestañas campaigns / channels /
// ads, que eran el mismo informe con distinto GROUP BY. Solo agent+.
// ============================================================

const VALID_GROUPS = new Set<string>(GROUP_BY_OPTIONS.map((o) => o.key))

export async function GET(req: NextRequest) {
  try {
    // El accountId del llamante acota TODAS las consultas: los cargadores
    // usan service-role, que salta RLS.
    const ctx = await requireRole('agent')

    const url = new URL(req.url)
    const range: DateRange = {
      from: url.searchParams.get('from') ?? '',
      to: url.searchParams.get('to') ?? '',
    }
    const raw = url.searchParams.get('group_by') ?? 'channel'
    const groupBy: GroupBy = (VALID_GROUPS.has(raw) ? raw : 'channel') as GroupBy

    return NextResponse.json(await loadAcquisition(ctx.accountId, range, groupBy))
  } catch (err) {
    return toErrorResponse(err)
  }
}
