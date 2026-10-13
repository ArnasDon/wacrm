import { NextResponse } from 'next/server'
import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account'
import { platformAdminClient } from '@/lib/platform/admin-client'
import { applyOnboardingIntake } from '@/lib/onboarding/apply'
import type { FormVertical } from '@/lib/onboarding/spec'

/**
 * POST /api/admin/companies/[id]/onboarding/[intakeId]/apply  (platform admin)
 * Turns a received form into the company's KB, prompt and settings.
 * Safe to re-run: docs and the generated prompt block are replaced in place.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; intakeId: string }> },
) {
  try {
    await requirePlatformAdmin()
    const { id, intakeId } = await params
    const db = platformAdminClient()
    const { data: intake, error } = await db
      .from('onboarding_intakes')
      .select('id, account_id, form_vertical, answers')
      .eq('id', intakeId)
      .eq('account_id', id)
      .maybeSingle()
    if (error) throw error
    if (!intake?.answers) {
      return NextResponse.json({ error: 'Ese formulario todavía no tiene respuestas.' }, { status: 409 })
    }
    const result = await applyOnboardingIntake(db, {
      id: intake.id as string,
      account_id: intake.account_id as string,
      form_vertical: intake.form_vertical as FormVertical,
      answers: intake.answers as Record<string, string>,
    })
    const { error: upErr } = await db
      .from('onboarding_intakes')
      .update({ applied_at: result.applied_at, apply_result: result })
      .eq('id', intake.id)
    if (upErr) throw upErr
    return NextResponse.json({ result })
  } catch (error) {
    return toErrorResponse(error)
  }
}
