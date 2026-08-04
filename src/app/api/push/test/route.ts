// ============================================================
// POST /api/push/test
//
// Custom feature (not part of the upstream wacrm template): sends a
// synthetic push notification to every device the caller's account
// has subscribed, so the mobile-notification flow can be verified
// end-to-end without waiting on (or depending on) a real WhatsApp
// webhook delivery.
// ============================================================

import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { sendPushToAccount } from '@/lib/push/send'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function POST() {
  try {
    const ctx = await getCurrentAccount()

    const limit = checkRateLimit(`push:test:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const result = await sendPushToAccount(ctx.accountId, {
      title: 'Novo lead no WhatsApp 👋',
      body: 'Esta é uma notificação de teste — se você a recebeu, está tudo funcionando.',
      url: '/inbox',
      tag: 'wacrm-test',
    })

    if (result.sent === 0) {
      return NextResponse.json(
        { error: 'Nenhum dispositivo inscrito (ou envio falhou) — veja os logs do servidor.' },
        { status: 400 },
      )
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return toErrorResponse(err)
  }
}
