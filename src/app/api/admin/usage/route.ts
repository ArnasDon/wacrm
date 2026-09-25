import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { usageByAccount } from '@/lib/db/platform'
import { toErrorResponse } from '@/lib/http/errors'

/** GET ?days=14 — AI usage per merchant per day. */
export async function GET(request: Request) {
  try {
    await requirePlatformAdmin()
    const raw = Number(new URL(request.url).searchParams.get('days') ?? 14)
    const days = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 90) : 14
    return NextResponse.json({ days, usage: await usageByAccount(days) })
  } catch (err) {
    return toErrorResponse(err)
  }
}
