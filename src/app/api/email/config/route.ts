import { NextResponse, type NextRequest } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'

// ============================================================
// POST /api/email/config — guarda config de email (Resend).
// owner-only. Mismo estándar que telnyx/config: "pegar 1 API key
// y funciona". La key se encripta (AES-256-GCM) y se persiste en
// `email_config` vía el cliente autenticado (RLS owner-only).
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('owner')

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'bad body' }, { status: 400 })
    }

    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    const fromEmail = typeof body.from_email === 'string' ? body.from_email.trim() : ''
    if (!apiKey) {
      return NextResponse.json({ error: 'api_key is required' }, { status: 400 })
    }
    if (!fromEmail) {
      return NextResponse.json({ error: 'from_email is required' }, { status: 400 })
    }

    const payload: Record<string, unknown> = {
      account_id: ctx.accountId,
      resend_api_key_encrypted: encrypt(apiKey),
      from_email: fromEmail,
    }
    if (typeof body.reply_to === 'string' && body.reply_to.trim()) {
      payload.reply_to = body.reply_to.trim()
    }

    const { error } = await ctx.supabase
      .from('email_config')
      .upsert(payload, { onConflict: 'account_id' })

    if (error) {
      return NextResponse.json({ error: 'could not save email config' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}