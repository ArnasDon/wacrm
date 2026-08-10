import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { generateLearningSuggestions } from '@/lib/ai/learning-generate'

/**
 * Scans every account with an active AI config for recurring,
 * consistent patterns worth remembering and writes pending `learning`
 * suggestions to the Central de IA (BLOCO 4/4). Same external-scheduler
 * contract as `/api/automations/cron`, `/api/flows/cron`, and
 * `/api/ai/followups/cron` — re-uses `AUTOMATION_CRON_SECRET`.
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
    return NextResponse.json({ accounts_processed: 0, created: 0, touched: 0 })
  }

  let created = 0
  let touched = 0
  for (const row of activeConfigs) {
    try {
      const result = await generateLearningSuggestions(admin, row.account_id as string)
      created += result.created
      touched += result.touched
    } catch (err) {
      console.error('[learning/cron] account', row.account_id, 'failed:', err)
    }
  }

  return NextResponse.json({
    accounts_processed: activeConfigs.length,
    created,
    touched,
  })
}
