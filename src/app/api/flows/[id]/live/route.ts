import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const WINDOW_DAYS = 30
const LIVE_WINDOW_MINUTES = 5

interface NodeStat {
  node_key: string
  count_30d: number
  last_event_at: string
  live: boolean
}

/**
 * GET /api/flows/[id]/live
 *
 * Per-node execution stats for the read-only "Ver ao vivo" canvas mode:
 * how many times each node ran in the last 30 days, and whether it ran
 * within the last 5 minutes (drives the pulsing dot). Polled every 15s
 * by the client — cheap enough not to need Realtime for a first pass.
 *
 * RLS does the ownership check (flows/flow_runs/flow_run_events all carry
 * an account-membership policy); this route just shapes the aggregate.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: flow } = await supabase
    .from('flows')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (!flow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: runs, error: runsErr } = await supabase
    .from('flow_runs')
    .select('id')
    .eq('flow_id', id)
    .limit(2000)
  if (runsErr) {
    return NextResponse.json({ error: runsErr.message }, { status: 500 })
  }

  const runIds = (runs ?? []).map((r) => (r as { id: string }).id)
  if (runIds.length === 0) {
    return NextResponse.json({ nodes: [] as NodeStat[] })
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1_000).toISOString()
  const { data: events, error: eventsErr } = await supabase
    .from('flow_run_events')
    .select('node_key, created_at')
    .in('flow_run_id', runIds)
    .eq('event_type', 'node_entered')
    .not('node_key', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000)
  if (eventsErr) {
    return NextResponse.json({ error: eventsErr.message }, { status: 500 })
  }

  const now = Date.now()
  const byNode = new Map<string, { count: number; lastAt: string }>()
  for (const row of (events ?? []) as { node_key: string; created_at: string }[]) {
    const existing = byNode.get(row.node_key)
    if (existing) {
      existing.count += 1
    } else {
      // Rows arrive most-recent-first, so the first one seen per node is
      // already its most recent execution.
      byNode.set(row.node_key, { count: 1, lastAt: row.created_at })
    }
  }

  const nodes: NodeStat[] = Array.from(byNode.entries()).map(([node_key, stat]) => ({
    node_key,
    count_30d: stat.count,
    last_event_at: stat.lastAt,
    live: now - new Date(stat.lastAt).getTime() < LIVE_WINDOW_MINUTES * 60_000,
  }))

  return NextResponse.json({ nodes })
}
