import { NextResponse } from 'next/server'
import { platformAdminClient } from '@/lib/platform/admin-client'
import { isValidOnboardingSecret } from '@/lib/onboarding/secret'
import { answersByKey, FORM_LABELS, type FormVertical } from '@/lib/onboarding/spec'
import { sendEmail } from '@/lib/email/send'
import { WEEKLY_HEALTH_INBOX } from '@/lib/admin/weekly-health'

/**
 * POST /api/onboarding/intake  (x-onboarding-secret)
 * A Google Form response, forwarded by the Apps Script's submit trigger:
 * `{ token, answers: { question title: answer } }`. Stored by question
 * key on the company's intake; a resubmission overwrites the answers.
 */
export async function POST(request: Request) {
  if (!isValidOnboardingSecret(request.headers.get('x-onboarding-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as { token?: unknown; answers?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token || !body?.answers || typeof body.answers !== 'object') {
    return NextResponse.json({ error: 'token y answers son obligatorios' }, { status: 400 })
  }

  const db = platformAdminClient()
  const { data: intake, error } = await db
    .from('onboarding_intakes')
    .select('id, form_vertical, account:accounts(name)')
    .eq('token', token)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!intake) return NextResponse.json({ error: 'Código de alta desconocido' }, { status: 404 })

  const vertical = intake.form_vertical as FormVertical
  const answers = answersByKey(vertical, body.answers as Record<string, unknown>)
  const { error: upErr } = await db
    .from('onboarding_intakes')
    .update({ answers, received_at: new Date().toISOString() })
    .eq('id', intake.id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const account = Array.isArray(intake.account) ? intake.account[0] : intake.account
  const name = (account as { name?: string } | null)?.name ?? 'una empresa'
  await sendEmail({
    account: 'support',
    to: WEEKLY_HEALTH_INBOX,
    subject: `Formulario de alta recibido: ${name}`,
    text:
      `${name} llenó el formulario de alta (${FORM_LABELS[vertical]}) con ${Object.keys(answers).length} respuestas.\n\n` +
      `Revísalo y aplícalo en /admin → ${name} → Formulario de alta.\n\n— SANDÍA`,
  }).catch((err) => console.error('[onboarding/intake] email failed:', err))

  return NextResponse.json({ ok: true })
}
