import { NextResponse } from 'next/server'
import { loadAccountChannelsForValidation } from '@/lib/cb-channels/repo'
import { createClient } from '@/lib/supabase/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  loadStepsTree,
  replaceSteps,
  type BuilderStepInput,
} from '@/lib/automations/steps-tree'
import {
  validateStepsForActivation,
  validateChannelScopeForActivation,
  validateAsaasReguaForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate'
import { ehGatilhoDaRegua } from '@/lib/asaas/regua'
import { normalizarAssinatura } from '@/lib/assinatura/assinatura'

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const { data: automation, error } = await admin
    .from('automations')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
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
  try {
    // Fase 2 dos perfis (2026-08-30): mutação de automação/fluxo/disparo subiu de
    // 'agent' para 'admin' — decisão do operador; ver canManageAutomations em roles.ts.
    await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }

  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const admin = supabaseAdmin()

  // Ownership check before we touch anything. Load the fields we need
  // to compute the post-patch "effective" state for validation.
  const { data: existing } = await admin
    .from('automations')
    .select('id, user_id, account_id, is_active, trigger_type, trigger_config, channel_ids')
    .eq('id', id)
    .maybeSingle()
  if (!existing || existing.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const update: Record<string, unknown> = {}
  for (const k of [
    'name',
    'description',
    'trigger_type',
    'trigger_config',
    'is_active',
    'channel_ids',
    'stage_ids',
  ] as const) {
    if (k in body) update[k] = body[k]
  }
  // "Assinar como" (998, D18): ausente do corpo = não mexe (a convenção de
  // `handoff_agent_id`); presente, texto aparado com teto ou NULL.
  if ('assinatura_personalizada' in body) update.assinatura_personalizada = normalizarAssinatura(body.assinatura_personalizada)
  // Array vazio significaria "nenhum canal", mas o dispatch o leria como
  // "sem restricao" — normaliza para null, a mesma regra da migration 903.
  if (Array.isArray(update.channel_ids) && update.channel_ids.length === 0) {
    update.channel_ids = null
  }
  // Mesma normalização para o recorte por etapa (933).
  if (Array.isArray(update.stage_ids) && update.stage_ids.length === 0) {
    update.stage_ids = null
  }

  // If this PATCH leaves the automation active (either explicitly
  // activating it OR editing an already-active one), validate the
  // merged configuration first. Activation is the natural gate — drafts
  // are still allowed to be incomplete.
  const willBeActive =
    typeof update.is_active === 'boolean' ? update.is_active : existing.is_active
  // Gatilho da régua do Asaas (998): sem recorte por etapa — trocar o gatilho
  // pela tela não limpa o valor gravado (a armadilha da grade do funil).
  if (ehGatilhoDaRegua((update.trigger_type ?? existing.trigger_type) as string)) update.stage_ids = null
  if (willBeActive) {
    const mergedTriggerType = (update.trigger_type ?? existing.trigger_type) as string
    const mergedTriggerConfig = update.trigger_config ?? existing.trigger_config
    const mergedSteps = Array.isArray(body.steps)
      ? (body.steps as { step_type: string; step_config: Record<string, unknown> }[])
      : await loadStepsTree(id)
    const issues = [
      ...validateTriggerForActivation(mergedTriggerType, mergedTriggerConfig),
      ...validateStepsForActivation(mergedSteps),
      ...validateAsaasReguaForActivation(mergedTriggerType, mergedSteps),
      ...validateChannelScopeForActivation(
        mergedSteps,
        (('channel_ids' in update
          ? update.channel_ids
          : existing.channel_ids) as string[] | null) ?? null,
        await loadAccountChannelsForValidation(supabaseAdmin(), existing.account_id as string),
      ),
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
  try {
    await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }

  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabaseAdmin()
    .from('automations')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
