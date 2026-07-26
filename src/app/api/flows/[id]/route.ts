import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import {
  isFlowRuntimeNodeType,
  isRegisteredNodeType,
} from '@/lib/flows/registry'
import { parseFlowVariableSchema } from '@/lib/flows/versions'
import type { FlowVariableDeclaration } from '@/lib/flows/runtime-primitives'

/**
 * GET   /api/flows/[id]  — fetch one flow with its nodes.
 * PUT   /api/flows/[id]  — replace name/trigger/entry/fallback + the
 *                          full node graph (delete-then-insert under
 *                          the hood). These rows are an editable draft;
 *                          the runner reads only immutable versions.
 *                          Requires `expected_draft_revision`; a missing
 *                          or invalid token returns 428 with
 *                          `code: "DRAFT_REVISION_REQUIRED"`.
 * DELETE /api/flows/[id] — hard delete (RLS+CASCADE clean up nodes,
 *                          runs, events).
 *
 * All three require a signed-in caller with account access. The GET response
 * separately reports whether the caller is the creator and may manage
 * immutable versions. Flows is in soft-GA — the beta gate that previously
 * 404'd non-beta accounts is gone.
 */

async function requireOwnership(
  flowId: string,
): Promise<
  | {
      ok: true
      userId: string
      canManageVersions: boolean
      supabase: Awaited<ReturnType<typeof createClient>>
    }
  | { ok: false; status: number; body: { error: string } }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, status: 401, body: { error: 'Unauthorized' } }
  }
  // RLS scopes this to the caller's account. Keep creator identity so the
  // editor receives an explicit version-management capability even when a
  // same-account teammate may read and edit the draft.
  const { data: flow } = await supabase
    .from('flows')
    .select('id, user_id')
    .eq('id', flowId)
    .maybeSingle()
  if (!flow) {
    return { ok: false, status: 404, body: { error: 'Not found' } }
  }
  return {
    ok: true,
    userId: user.id,
    canManageVersions: flow.user_id === user.id,
    supabase,
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const guard = await requireOwnership(id)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  const { supabase } = guard

  const [{ data: flow }, { data: nodes }] = await Promise.all([
    supabase.from('flows').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('flow_nodes')
      .select('*')
      .eq('flow_id', id)
      .order('created_at', { ascending: true }),
  ])
  if (!flow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({
    flow,
    nodes: nodes ?? [],
    capabilities: {
      can_manage_versions: guard.canManageVersions,
    },
  })
}

interface PutBody {
  expected_draft_revision?: number
  name?: string
  description?: string | null
  trigger_type?: 'keyword' | 'first_inbound_message' | 'manual'
  trigger_config?: Record<string, unknown>
  entry_node_id?: string | null
  fallback_policy?: Record<string, unknown>
  variable_schema?: FlowVariableDeclaration[]
  nodes?: Array<{
    node_key: string
    node_type: string
    config: Record<string, unknown>
    position_x?: number
    position_y?: number
  }>
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  // Writes require at least `agent` — the RLS flows_update policy demands
  // it, but this route mutates via the service-role client which bypasses
  // RLS, so the role must be enforced here (a viewer passes ownership).
  try {
    await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const guard = await requireOwnership(id)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const body = (await request.json().catch(() => null)) as PutBody | null
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (body.name !== undefined && !body.name.trim()) {
    return NextResponse.json(
      { error: 'name cannot be empty' },
      { status: 400 },
    )
  }
  if (
    !Number.isSafeInteger(body.expected_draft_revision) ||
    (body.expected_draft_revision ?? -1) < 0
  ) {
    return NextResponse.json(
      {
        code: 'DRAFT_REVISION_REQUIRED',
        error:
          'expected_draft_revision must be the non-negative integer returned by the latest flow read',
      },
      { status: 428 },
    )
  }
  const unknownNode = body.nodes?.find(
    (node) => !isRegisteredNodeType(node.node_type),
  )
  if (unknownNode) {
    return NextResponse.json(
      { error: `Unknown node type "${unknownNode.node_type}"` },
      { status: 400 },
    )
  }
  const unsupportedNode = body.nodes?.find(
    (node) => !isFlowRuntimeNodeType(node.node_type),
  )
  if (unsupportedNode) {
    return NextResponse.json(
      {
        error: `Node type "${unsupportedNode.node_type}" is not supported by the flow runtime`,
      },
      { status: 400 },
    )
  }
  let variableSchema: FlowVariableDeclaration[] | undefined
  if (body.variable_schema !== undefined) {
    try {
      variableSchema = parseFlowVariableSchema(body.variable_schema)
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Invalid flow variable schema',
        },
        { status: 400 },
      )
    }
  }

  const admin = supabaseAdmin()

  // The RPC applies only these whitelisted envelope fields. Omitting
  // `nodes` preserves the graph; passing an array replaces it atomically.
  const flowPatch: Record<string, unknown> = {}
  if (body.name !== undefined) flowPatch.name = body.name.trim()
  if (body.description !== undefined)
    flowPatch.description = body.description
  if (body.trigger_type !== undefined) flowPatch.trigger_type = body.trigger_type
  if (body.trigger_config !== undefined)
    flowPatch.trigger_config = body.trigger_config
  if (body.entry_node_id !== undefined)
    flowPatch.entry_node_id = body.entry_node_id
  if (body.fallback_policy !== undefined)
    flowPatch.fallback_policy = body.fallback_policy
  if (variableSchema !== undefined)
    flowPatch.variable_schema = variableSchema

  const { data: saved, error: saveError } = await admin.rpc(
    'save_flow_draft',
    {
      p_flow_id: id,
      p_expected_revision: body.expected_draft_revision,
      p_patch: flowPatch,
      p_nodes:
        body.nodes === undefined
          ? null
          : body.nodes.map((node) => ({
              node_key: node.node_key,
              node_type: node.node_type,
              config: node.config,
              position_x: node.position_x ?? 0,
              position_y: node.position_y ?? 0,
            })),
    },
  )
  if (saveError) {
    if (saveError.message.includes('draft_revision_conflict')) {
      return NextResponse.json(
        { error: 'Draft changed since it was loaded. Refresh and retry.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: saveError.message }, { status: 500 })
  }

  // The RPC returns the revisioned envelope; fetch the committed node list
  // so the editor can reconcile its local state.
  const flow = Array.isArray(saved) ? saved[0] : saved
  const { data: nodes } = await admin
    .from('flow_nodes')
    .select('*')
    .eq('flow_id', id)
    .order('created_at', { ascending: true })
  return NextResponse.json({ flow, nodes: nodes ?? [] })
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  // Writes require at least `agent` — see the PUT handler note. The
  // service-role client below bypasses the agent-gated flows_delete RLS.
  try {
    await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const guard = await requireOwnership(id)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  // CASCADE on flow_nodes / flow_runs / flow_run_events handles the
  // children. Active runs end abruptly — there's no graceful "drain"
  // mechanism in v1, but that's intentional: deleting a flow is a
  // deliberate destructive action and the partial unique index will
  // free up the contact for new triggers immediately.
  const { error } = await supabaseAdmin().from('flows').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

