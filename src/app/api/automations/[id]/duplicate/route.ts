import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // Duplicating creates a new automation row — a write. Enforce `agent`
  // (the service-role client below bypasses the agent-gated
  // automations_insert RLS).
  let accountId: string
  let userId: string
  try {
    const ctx = await requireRole('agent')
    accountId = ctx.accountId
    userId = ctx.userId
  } catch (err) {
    return toErrorResponse(err)
  }

  // Match on `account_id`, not `user_id` — see the tenancy note in the
  // sibling [id]/route.ts (GHSA-xvrq-88hg-44q6). `user_id` records the
  // author and survives removal from the account, so scoping the source
  // row by it let an ex-member clone an automation straight back into
  // the account they no longer belong to.
  const admin = supabaseAdmin()
  const { data: original, error: origErr } = await admin
    .from('automations')
    .select('*')
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (origErr) return NextResponse.json({ error: origErr.message }, { status: 500 })
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: copy, error: copyErr } = await admin
    .from('automations')
    .insert({
      // Clone into the caller's own account. Equal to
      // `original.account_id` by construction now that the lookup above
      // is account-scoped; written from the caller's context so the
      // insert can never land in an account they aren't a member of.
      account_id: accountId,
      user_id: userId,
      name: `${original.name} (Copy)`,
      description: original.description,
      trigger_type: original.trigger_type,
      trigger_config: original.trigger_config,
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
