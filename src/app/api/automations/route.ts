import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getTemplate } from '@/lib/automations/templates'
import { insertSteps, type BuilderStepInput } from '@/lib/automations/steps-tree'
import {
  validateStepsForActivation,
  validateStepTypesKnown,
  validateTriggerForActivation,
} from '@/lib/automations/validate'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('automations')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ automations: data ?? [] })
}

export async function POST(request: Request) {
  // Creating an automation is a write — the RLS automations_insert policy
  // requires `agent`, but this route inserts via the service-role client
  // which bypasses RLS, so the role must be enforced here.
  try {
    await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Resolve the caller's account_id — `automations.account_id` is NOT
  // NULL post-017, so an INSERT without it trips the not-null constraint
  // even though the admin client bypasses RLS.
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json(
      { error: 'Your profile is not linked to an account.' },
      { status: 403 },
    )
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { name, description, trigger_type, trigger_config, is_active, steps, template, source } = body

  let effectiveSteps: BuilderStepInput[] | undefined = steps
  let effectiveName = name
  let effectiveDescription = description
  let effectiveTriggerType = trigger_type
  let effectiveTriggerConfig = trigger_config

  if (template && (!steps || steps.length === 0)) {
    const t = getTemplate(template)
    if (t) {
      effectiveName = effectiveName ?? t.name
      effectiveDescription = effectiveDescription ?? t.description
      effectiveTriggerType = effectiveTriggerType ?? t.trigger_type
      effectiveTriggerConfig = effectiveTriggerConfig ?? t.trigger_config
      effectiveSteps = t.steps as unknown as BuilderStepInput[]
    }
  }

  if (!effectiveName || !effectiveTriggerType) {
    return NextResponse.json(
      { error: 'name and trigger_type are required' },
      { status: 400 },
    )
  }

  // AI-assistant-originated automations are always created as a draft,
  // never active, regardless of what the request body says — activating
  // a rule is a separate, explicit step the owner takes afterward in
  // Automations. Enforced here (not just in the assistant's own prompt
  // or the frontend) so it holds even against a malformed client or a
  // direct call to this endpoint with source=ai_assistant.
  const effectiveIsActive = source === 'ai_assistant' ? false : !!is_active

  // A step_type outside the builder's own known set (e.g. an
  // AI-assistant proposal that invented one beyond its tool schema)
  // can never be rendered or run — reject it unconditionally, even for
  // a draft. Unlike the activation checks below, an incomplete-but-
  // real step is fine to save mid-build; a step type that doesn't
  // exist at all is not.
  const typeIssues = validateStepTypesKnown(
    (effectiveSteps ?? []) as unknown as { step_type: string; step_config: Record<string, unknown> }[],
  )
  if (typeIssues.length > 0) {
    return NextResponse.json(
      { error: 'Automation contains an unsupported step type', issues: typeIssues },
      { status: 400 },
    )
  }

  // Block activation of a clearly broken automation up-front instead of
  // letting every trigger silently produce a failed log row. Drafts
  // (is_active=false) are allowed to be incomplete so users can save
  // progress mid-build.
  if (effectiveIsActive) {
    const issues = [
      ...validateTriggerForActivation(effectiveTriggerType, effectiveTriggerConfig ?? {}),
      ...validateStepsForActivation(
        (effectiveSteps ?? []) as unknown as { step_type: string; step_config: Record<string, unknown> }[],
      ),
    ]
    if (issues.length > 0) {
      return NextResponse.json(
        { error: 'Cannot activate automation with invalid configuration', issues },
        { status: 400 },
      )
    }
  }

  const admin = supabaseAdmin()
  const { data: automation, error: insertErr } = await admin
    .from('automations')
    .insert({
      user_id: user.id,
      account_id: accountId,
      name: effectiveName,
      description: effectiveDescription ?? null,
      trigger_type: effectiveTriggerType,
      trigger_config: effectiveTriggerConfig ?? {},
      is_active: effectiveIsActive,
    })
    .select()
    .single()

  if (insertErr || !automation) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'insert failed' },
      { status: 500 },
    )
  }

  if (effectiveSteps && effectiveSteps.length > 0) {
    const err = await insertSteps(automation.id, effectiveSteps)
    if (err) return NextResponse.json({ error: err }, { status: 500 })
  }

  // Traceability for the owner-only AI assistant (see
  // src/lib/ai/assistant/*): when it proposed this automation and the
  // owner confirmed, log the creation to the same audit trail every
  // other AI-originated mutation gets — via the caller's own
  // RLS-scoped client, exactly like `executeBusinessAction`'s audit
  // insert, so it's provably this account's owner creating it in
  // their own account, never a service-role bypass. Best-effort: a
  // logging failure must not undo an automation the owner already
  // confirmed.
  if (source === 'ai_assistant') {
    const { error: auditError } = await supabase.from('ai_action_log').insert({
      account_id: accountId,
      actor_user_id: user.id,
      action: 'create_automation_rule',
      target_id: automation.id,
      input: { name: effectiveName, trigger_type: effectiveTriggerType, trigger_config: effectiveTriggerConfig, steps: effectiveSteps },
      result: { automation_id: automation.id, is_active: effectiveIsActive },
    })
    if (auditError) console.error('[automations] ai_action_log insert failed:', auditError)
  }

  return NextResponse.json({ automation }, { status: 201 })
}
