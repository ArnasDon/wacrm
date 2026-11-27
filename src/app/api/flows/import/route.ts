import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { hasMinRole } from '@/lib/auth/roles'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { parseFlowImport } from '@/lib/flows/import'
import { createFlowFromImport, FlowImportError } from '@/lib/flows/import-server'

/**
 * POST /api/flows/import
 *
 * Body: a portable flow document (see src/lib/flows/import.ts), either
 * bare or wrapped as `{ "flow": { ... } }`. Creates a NEW draft flow
 * with all its nodes and returns `{ flow, issues }` — `issues` is the
 * activation-validator report so the UI can show what's left to fix.
 *
 * Requires `agent`. Tags referenced by name are created when missing,
 * which (per the tags RLS policy) needs `admin`; an agent importing a
 * flow whose tags already exist is fine.
 */
export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  const parsed = parseFlowImport(body)
  if (!parsed.ok) {
    return NextResponse.json(
      { error: 'Invalid flow file.', details: parsed.errors },
      { status: 400 },
    )
  }

  try {
    const result = await createFlowFromImport(supabaseAdmin(), {
      accountId: ctx.accountId,
      authorId: ctx.userId,
      flow: parsed.value,
      canCreateTags: hasMinRole(ctx.role, 'admin'),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof FlowImportError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[api/flows/import] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
