import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';

/**
 * GET   /api/flows/[id]  — fetch one flow with its nodes.
 * PUT   /api/flows/[id]  — replace name/trigger/entry/fallback + the
 *                          full node graph (delete-then-insert under
 *                          the hood; not atomic, but the runner is
 *                          resilient to mid-edit reads — node_not_found
 *                          gracefully ends the run).
 * DELETE /api/flows/[id] — hard delete (RLS+CASCADE clean up nodes,
 *                          runs, events).
 *
 * All three require a signed-in caller who owns the flow. Flows is in
 * soft-GA — the beta gate that previously 404'd non-beta accounts is
 * gone; the "Beta" label in the UI is the only remaining signal.
 */

async function requireOwnership(flowId: string): Promise<
  | {
      ok: true;
      userId: string;
      supabase: Awaited<ReturnType<typeof createClient>>;
    }
  | { ok: false; status: number; body: { error: string } }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, status: 401, body: { error: 'Unauthorized' } };
  }
  // RLS scopes this to the caller — a flow owned by another user
  // returns null (404 below).
  const { data: flow } = await supabase
    .from('flows')
    .select('id')
    .eq('id', flowId)
    .maybeSingle();
  if (!flow) {
    return { ok: false, status: 404, body: { error: 'Not found' } };
  }
  return { ok: true, userId: user.id, supabase };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const guard = await requireOwnership(id);
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
  const { supabase } = guard;

  const [{ data: flow }, { data: nodes }] = await Promise.all([
    supabase.from('flows').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('flow_nodes')
      .select('*')
      .eq('flow_id', id)
      .order('created_at', { ascending: true }),
  ]);
  if (!flow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ flow, nodes: nodes ?? [] });
}

interface PutBody {
  name?: string;
  description?: string | null;
  trigger_type?: 'keyword' | 'first_inbound_message' | 'manual';
  trigger_config?: Record<string, unknown>;
  entry_node_id?: string | null;
  fallback_policy?: Record<string, unknown>;
  nodes?: Array<{
    node_key: string;
    node_type: string;
    config: Record<string, unknown>;
    position_x?: number;
    position_y?: number;
  }>;
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  // Writes require at least `agent` — the RLS flows_update policy demands
  // it, but this route mutates via the service-role client which bypasses
  // RLS, so the role must be enforced here (a viewer passes ownership).
  try {
    await requireRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }

  const guard = await requireOwnership(id);
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const body = (await request.json().catch(() => null)) as PutBody | null;
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (body.name !== undefined && !body.name.trim()) {
    return NextResponse.json(
      { error: 'name cannot be empty' },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();

  // Update the flow row first — the body may not include `nodes` (a
  // header-only save for editing the trigger config without touching
  // the graph). Skip node replacement in that case.
  const flowPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.name !== undefined) flowPatch.name = body.name.trim();
  if (body.description !== undefined) flowPatch.description = body.description;
  if (body.trigger_type !== undefined)
    flowPatch.trigger_type = body.trigger_type;
  if (body.trigger_config !== undefined)
    flowPatch.trigger_config = body.trigger_config;
  if (body.entry_node_id !== undefined)
    flowPatch.entry_node_id = body.entry_node_id;
  if (body.fallback_policy !== undefined)
    flowPatch.fallback_policy = body.fallback_policy;

  const { error: updErr } = await admin
    .from('flows')
    .update(flowPatch)
    .eq('id', id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  if (body.nodes !== undefined) {
    // Delete-then-insert. Not transactional but the runner handles
    // mid-edit reads safely (a node_not_found ends the run cleanly).
    const { error: delErr } = await admin
      .from('flow_nodes')
      .delete()
      .eq('flow_id', id);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
    if (body.nodes.length > 0) {
      const { error: insErr } = await admin.from('flow_nodes').insert(
        body.nodes.map((n) => ({
          flow_id: id,
          node_key: n.node_key,
          node_type: n.node_type,
          config: n.config,
          position_x: n.position_x ?? 0,
          position_y: n.position_y ?? 0,
        }))
      );
      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }
  }

  // Re-fetch and return the new state — the editor uses the response
  // to reconcile its local form state.
  const [{ data: flow }, { data: nodes }] = await Promise.all([
    admin.from('flows').select('*').eq('id', id).maybeSingle(),
    admin
      .from('flow_nodes')
      .select('*')
      .eq('flow_id', id)
      .order('created_at', { ascending: true }),
  ]);
  return NextResponse.json({ flow, nodes: nodes ?? [] });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  // Writes require at least `agent` — see the PUT handler note. The
  // service-role client below bypasses the agent-gated flows_delete RLS.
  try {
    await requireRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }

  const guard = await requireOwnership(id);
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  // CASCADE on flow_nodes / flow_runs / flow_run_events handles the
  // children. Active runs end abruptly — there's no graceful "drain"
  // mechanism in v1, but that's intentional: deleting a flow is a
  // deliberate destructive action and the partial unique index will
  // free up the contact for new triggers immediately.
  const { error } = await supabaseAdmin().from('flows').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
