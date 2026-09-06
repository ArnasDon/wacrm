/**
 * Clone a starter flow template into an account as a fresh draft.
 *
 * Extracted from `POST /api/flows` (the `template_slug` branch) so the
 * per-vertical starter-kit seeder (`src/lib/verticals/seed.ts`) can
 * reuse the exact same fan-out: one `flows` row + its `flow_nodes`,
 * with a rollback of the parent if the node insert fails.
 *
 * `db` must be a client that can write `flows` / `flow_nodes` for
 * `accountId` — the API route passes a service-role client and enforces
 * the role itself; the seeder does the same.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getFlowTemplate } from './templates'

export interface CloneFlowTemplateResult {
  ok: boolean
  flowId?: string
  error?: string
}

export async function cloneFlowTemplate(
  db: SupabaseClient,
  args: { accountId: string; userId: string; templateSlug: string; name?: string },
): Promise<CloneFlowTemplateResult> {
  const template = getFlowTemplate(args.templateSlug)
  if (!template) return { ok: false, error: `Unknown flow template "${args.templateSlug}"` }

  const { data: flow, error: flowErr } = await db
    .from('flows')
    .insert({
      user_id: args.userId,
      account_id: args.accountId,
      name: args.name?.trim() || template.name,
      description: template.description,
      status: 'draft',
      trigger_type: template.trigger_type,
      trigger_config: template.trigger_config,
      entry_node_id: template.entry_node_id,
    })
    .select('id')
    .single()
  if (flowErr || !flow) {
    return { ok: false, error: flowErr?.message ?? 'flow insert failed' }
  }

  if (template.nodes.length > 0) {
    const { error: nodesErr } = await db.from('flow_nodes').insert(
      template.nodes.map((n) => ({
        flow_id: flow.id,
        node_key: n.node_key,
        node_type: n.node_type,
        config: n.config,
      })),
    )
    if (nodesErr) {
      // Roll back so a half-cloned template doesn't sit as an empty
      // draft. CASCADE on flow_id removes any nodes that did land.
      await db.from('flows').delete().eq('id', flow.id)
      return { ok: false, error: nodesErr.message }
    }
  }

  return { ok: true, flowId: flow.id as string }
}
