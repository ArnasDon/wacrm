import { NextResponse } from 'next/server'
import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account'
import { platformAdminClient } from '@/lib/platform/admin-client'
import { isFormVertical } from '@/lib/onboarding/spec'
import { intakeLink, newIntakeToken } from '@/lib/onboarding/links'

type Params = { params: Promise<{ id: string }> }

async function prefillUrls() {
  const { data, error } = await platformAdminClient().from('onboarding_forms').select('form_vertical, prefill_url')
  if (error) throw error
  return new Map((data ?? []).map((f) => [f.form_vertical as string, f.prefill_url as string]))
}

/** GET /api/admin/companies/[id]/onboarding: the company's form links and answers. */
export async function GET(_request: Request, { params }: Params) {
  try {
    await requirePlatformAdmin()
    const { id } = await params
    const { data, error } = await platformAdminClient()
      .from('onboarding_intakes')
      .select('id, form_vertical, token, answers, received_at, applied_at, apply_result, created_at')
      .eq('account_id', id)
      .order('created_at', { ascending: false })
    if (error) throw error
    const urls = await prefillUrls()
    const intakes = (data ?? []).map(({ token, ...row }) => {
      const prefill = urls.get(row.form_vertical as string)
      return { ...row, link: prefill ? intakeLink(prefill, token as string) : null }
    })
    return NextResponse.json({ intakes })
  } catch (error) {
    return toErrorResponse(error)
  }
}

/**
 * POST /api/admin/companies/[id]/onboarding  { form_vertical }
 * Returns the company's link for that form, creating it on first use.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    await requirePlatformAdmin()
    const { id } = await params
    const body = (await request.json().catch(() => null)) as { form_vertical?: unknown } | null
    if (!isFormVertical(body?.form_vertical)) {
      return NextResponse.json({ error: 'Formulario inválido' }, { status: 400 })
    }
    const prefill = (await prefillUrls()).get(body.form_vertical)
    if (!prefill) {
      return NextResponse.json(
        { error: 'Ese formulario aún no existe. Corre el script de Google (ver "Formularios de alta").' },
        { status: 409 },
      )
    }

    const db = platformAdminClient()
    const { data: pending } = await db
      .from('onboarding_intakes')
      .select('token')
      .eq('account_id', id)
      .eq('form_vertical', body.form_vertical)
      .is('received_at', null)
      .limit(1)
      .maybeSingle()
    let token = pending?.token as string | undefined
    if (!token) {
      token = newIntakeToken()
      const { error } = await db
        .from('onboarding_intakes')
        .insert({ account_id: id, form_vertical: body.form_vertical, token })
      if (error) throw error
    }
    return NextResponse.json({ link: intakeLink(prefill, token) })
  } catch (error) {
    return toErrorResponse(error)
  }
}
