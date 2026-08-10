import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { runHandoffLessonDetector } from '@/lib/ai/flywheel'

export const runtime = 'nodejs'

function validSecret(supplied: string, expected: string): boolean {
  const suppliedBuffer = Buffer.from(supplied)
  const expectedBuffer = Buffer.from(expected)
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  )
}

/**
 * Scheduled sweep across every account's recent AI→human handoffs, drafting
 * lesson suggestions for review. Same cron-secret convention as
 * /api/ai/memory/cron — point one scheduled job (Vercel Cron or external) at
 * each endpoint, both gated by AUTOMATION_CRON_SECRET.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  if (!validSecret(request.headers.get('x-cron-secret') ?? '', expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await runHandoffLessonDetector(supabaseAdmin(), { limit: 20 })
  return NextResponse.json(result)
}
