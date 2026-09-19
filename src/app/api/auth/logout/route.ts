import { NextResponse } from 'next/server'
import { destroyCurrentSession } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/http/errors'

export async function POST() {
  try {
    await destroyCurrentSession()
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
