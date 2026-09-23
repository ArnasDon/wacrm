import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // Duplicating creates a new automation row — a write. Enforce the role
  // here (the service-role client below bypasses the automations_insert RLS).
  let ctx: { accountId: string; userId: string }
  try {
    // Fase 2 dos perfis (2026-08-30): mutação de automação/fluxo/disparo subiu de
    // 'agent' para 'admin' — decisão do operador; ver canManageAutomations em roles.ts.
    ctx = await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }

  // A automação é da CONTA, não de quem a criou — ver o topo de
  // `../route.ts`. Qualquer admin da conta duplica; a cópia fica no nome de
  // quem duplicou.
  const admin = supabaseAdmin()
  const { data: original, error: origErr } = await admin
    .from('automations')
    .select('*')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (origErr) return NextResponse.json({ error: origErr.message }, { status: 500 })
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: copy, error: copyErr } = await admin
    .from('automations')
    .insert({
      // Clone into the same account as the original. account_id is NOT
      // NULL post-017, so the INSERT fails the constraint without it.
      account_id: original.account_id,
      user_id: ctx.userId,
      name: `${original.name} (Copy)`,
      description: original.description,
      trigger_type: original.trigger_type,
      trigger_config: original.trigger_config,
      // Sem isto a cópia nasce SEM escopo — e escopo ausente é lido pelo
      // motor como "todos os canais". Duplicar a triagem do Comercial
      // devolvia uma automação que responde por todos os números do
      // escritório, inclusive o celular pessoal do sócio.
      channel_ids: original.channel_ids ?? null,
      // Mesma armadilha, mesma correção, para o recorte por etapa (933):
      // escopo ausente é lido como "todas as etapas".
      stage_ids: original.stage_ids ?? null,
      // "Assinar como" (998): sem isto a cópia nasce assinando com o nome da
      // conta, e a diferença só aparece na mensagem que chega ao cliente.
      assinatura_personalizada: original.assinatura_personalizada ?? null,
      is_active: false,
    })
    .select()
    .single()
  if (copyErr || !copy) {
    return NextResponse.json({ error: copyErr?.message ?? 'copy failed' }, { status: 500 })
  }

  const { data: steps } = await admin
    .from('automation_steps')
    .select('id, parent_step_id, branch, step_type, step_config, position')
    .eq('automation_id', id)
    .order('position', { ascending: true })

  if (steps && steps.length > 0) {
    // Re-map parent_step_id: build old→new id map first so the second
    // pass inserts rows with correct parent references.
    const idMap = new Map<string, string>()
    const uid = () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36)
    for (const row of steps) idMap.set(row.id as string, uid())

    const rows = steps.map((row) => ({
      id: idMap.get(row.id as string)!,
      automation_id: copy.id,
      parent_step_id: row.parent_step_id ? idMap.get(row.parent_step_id as string) : null,
      branch: row.branch,
      step_type: row.step_type,
      step_config: row.step_config,
      position: row.position,
    }))
    const { error: insErr } = await admin.from('automation_steps').insert(rows)
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({ automation: copy }, { status: 201 })
}
