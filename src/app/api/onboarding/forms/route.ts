import { NextResponse } from 'next/server'
import { platformAdminClient } from '@/lib/platform/admin-client'
import { isValidOnboardingSecret } from '@/lib/onboarding/secret'
import { isFormVertical } from '@/lib/onboarding/spec'
import { TOKEN_PLACEHOLDER } from '@/lib/onboarding/links'

/**
 * POST /api/onboarding/forms  (x-onboarding-secret)
 * The Apps Script registers the Google Form it built for a vertical.
 */
export async function POST(request: Request) {
  if (!isValidOnboardingSecret(request.headers.get('x-onboarding-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as
    { form_vertical?: unknown; prefill_url?: unknown; edit_url?: unknown } | null
  const prefill = typeof body?.prefill_url === 'string' ? body.prefill_url : ''
  if (
    !isFormVertical(body?.form_vertical) ||
    !prefill.startsWith('https://docs.google.com/forms/') ||
    !prefill.includes(TOKEN_PLACEHOLDER)
  ) {
    return NextResponse.json({ error: 'form_vertical o prefill_url inválidos' }, { status: 400 })
  }
  const { error } = await platformAdminClient().from('onboarding_forms').upsert({
    form_vertical: body.form_vertical,
    prefill_url: prefill,
    edit_url: typeof body.edit_url === 'string' ? body.edit_url : null,
    updated_at: new Date().toISOString(),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
