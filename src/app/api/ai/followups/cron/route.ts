import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { generateFollowupSuggestions } from '@/lib/ai/followup-generate'

/**
 * Scans every account with an active AI config for stale conversations
 * and writes pending `followup` suggestions to the Central de IA.
 * Meant to be hit on a schedule (external pinger — this project has no
 * built-in scheduler; see docs/docker.md), same as
 * `/api/automations/cron` and `/api/flows/cron`. Re-uses
 * `AUTOMATION_CRON_SECRET` so operators only have one secret to manage
 * (same reasoning as the flows cron).
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const { data: activeConfigs, error } = await admin
    .from('ai_configs')
    .select('account_id')
    .eq('is_active', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!activeConfigs || activeConfigs.length === 0) {
    return NextResponse.json({ accounts_processed: 0, created: 0, scored: 0 })
  }

  let created = 0
  let scored = 0
  for (const row of activeConfigs) {
    try {
      const result = await generateFollowupSuggestions(admin, row.account_id as string)
      created += result.created
      scored += result.scored
    } catch (err) {
      console.error('[followups/cron] account', row.account_id, 'failed:', err)
    }
  }

  return NextResponse.json({
    accounts_processed: activeConfigs.length,
    created,
    scored,
  })
}
