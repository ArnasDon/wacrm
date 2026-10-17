import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  loadStepsTree,
  replaceSteps,
  type BuilderStepInput,
} from '@/lib/automations/steps-tree'
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // Ownership is account-wide (RLS automations_select: is_account_member
  // (account_id), migration 017 — replaces the old per-creator model).
  // `viewer` matches that policy's own minimum: any account member may
  // read, not just the automation's original author.
  let accountId: string
  try {
    ;({ accountId } = await requireRole('viewer'))
  } catch (err) {
    return toErrorResponse(err)
  }

  const admin = supabaseAdmin()
  const { data: automation, error } = await admin
    .from('automations')
    .select('*')
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!automation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const steps = await loadStepsTree(id)
  return NextResponse.json({ automation, steps })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // Editing an automation is a write — the RLS automations_update policy
  // requires `agent`, but this route mutates via the service-role client
  // which bypasses RLS, so enforce the role here.
  let accountId: string
  try {
    ;({ accountId } = await requireRole('agent'))
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const admin = supabaseAdmin()

  // Ownership check before we touch anything. Account-wide (RLS
  // automations_update: is_account_member(account_id, 'agent'), migration
  // 017) — any agent+ teammate on the account may edit, not just the
  // automation's original creator. Load the fields we need to compute
  // the post-patch "effective" state for validation.
  const { data: existing } = await admin
    .from('automations')
    .select('id, account_id, is_active, trigger_type, trigger_config')
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const update: Record<string, unknown> = {}
  for (const k of [
    'name',
    'description',
    'trigger_type',
    'trigger_config',
    'is_active',
  ] as const) {
    if (k in body) update[k] = body[k]
  }

  // If this PATCH leaves the automation active (either explicitly
  // activating it OR editing an already-active one), validate the
  // merged configuration first. Activation is the natural gate — drafts
  // are still allowed to be incomplete.
  const willBeActive =
    typeof update.is_active === 'boolean' ? update.is_active : existing.is_active
  if (willBeActive) {
    const mergedTriggerType = (update.trigger_type ?? existing.trigger_type) as string
    const mergedTriggerConfig = update.trigger_config ?? existing.trigger_config
    const mergedSteps = Array.isArray(body.steps)
      ? (body.steps as { step_type: string; step_config: Record<string, unknown> }[])
      : await loadStepsTree(id)
    const issues = [
      ...validateTriggerForActivation(mergedTriggerType, mergedTriggerConfig),
      ...validateStepsForActivation(mergedSteps),
    ]
    if (issues.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot keep automation active with invalid configuration',
          issues,
        },
        { status: 400 },
      )
    }
  }

  if (Object.keys(update).length > 0) {
    const { error: updErr } = await admin
      .from('automations')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  if (Array.isArray(body.steps)) {
    const err = await replaceSteps(id, body.steps as BuilderStepInput[])
    if (err) return NextResponse.json({ error: err }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // Deleting an automation is a write — enforce `agent` (the service-role
  // client below bypasses the agent-gated automations_delete RLS).
  let accountId: string
  try {
    ;({ accountId } = await requireRole('agent'))
  } catch (err) {
    return toErrorResponse(err)
  }

  const admin = supabaseAdmin()

  // Existence check first, account-wide (RLS automations_delete:
  // is_account_member(account_id, 'agent'), migration 017 — any agent+
  // teammate may delete, not just the creator). The old `.eq('user_id',
  // ...)` delete below matched 0 rows for a foreign/nonexistent id
  // without ever erroring, which silently reported `{ok:true}` even
  // though nothing was deleted — this check gives that case its correct
  // 404 instead.
  const { data: existing } = await admin
    .from('automations')
    .select('id')
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { error } = await admin
    .from('automations')
    .delete()
    .eq('id', id)
    .eq('account_id', accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
