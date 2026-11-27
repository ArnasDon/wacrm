import { supabaseAdmin as automationsAdmin } from '@/lib/automations/admin-client'
import { loadStepsTree, type BuilderStepNode } from '@/lib/automations/steps-tree'
import { supabaseAdmin as flowsAdmin } from '@/lib/flows/admin-client'
import { buildFlowExport } from '@/lib/flows/import'
import { loadFlowExport } from '@/lib/flows/import-server'

import { BUNDLE_VERSION, type BundleSection } from './schema'
import type { BundleCtx } from './import-server'
import { stepsWithTagNames } from './tags'

function stripStep(s: BuilderStepNode): Record<string, unknown> {
  const out: Record<string, unknown> = { step_type: s.step_type, step_config: s.step_config }
  const yes = (s.branches?.yes ?? []).map(stripStep)
  const no = (s.branches?.no ?? []).map(stripStep)
  if (yes.length || no.length) out.branches = { yes, no }
  return out
}

/**
 * Build a bundle from the current workspace. Secrets are never included
 * (AI provider keys, WhatsApp token, API keys); template delivery state
 * (status, Meta ids) is dropped so the file is portable.
 */
export async function exportBundle(ctx: BundleCtx, sections: BundleSection[]) {
  const want = new Set(sections)
  const out: Record<string, unknown> = {
    wacrm_bundle_version: BUNDLE_VERSION,
    exported_at: new Date().toISOString(),
  }

  if (want.has('flows')) {
    const admin = flowsAdmin()
    const { data: rows } = await admin
      .from('flows')
      .select('id')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true })
    const flows: unknown[] = []
    for (const r of (rows ?? []) as Array<{ id: string }>) {
      const loaded = await loadFlowExport(admin, ctx.accountId, r.id)
      if (loaded) flows.push(buildFlowExport(loaded.flow, loaded.nodes, loaded.tagNameById))
    }
    out.flows = flows
  }

  if (want.has('automations')) {
    const { data: rows } = await automationsAdmin()
      .from('automations')
      .select('id, name, description, trigger_type, trigger_config')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true })
    const { data: tagRows } = await automationsAdmin()
      .from('tags')
      .select('id, name')
      .eq('account_id', ctx.accountId)
    const tagNameById = new Map(
      ((tagRows ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]),
    )
    const automations: unknown[] = []
    for (const a of (rows ?? []) as Array<{
      id: string
      name: string
      description: string | null
      trigger_type: string
      trigger_config: Record<string, unknown>
    }>) {
      const steps = await loadStepsTree(a.id)
      automations.push({
        name: a.name,
        description: a.description,
        trigger_type: a.trigger_type,
        trigger_config: a.trigger_config,
        steps: stepsWithTagNames(steps.map(stripStep), tagNameById),
      })
    }
    out.automations = automations
  }

  if (want.has('quick_replies')) {
    const { data } = await ctx.supabase
      .from('quick_replies')
      .select('title, kind, content_text, interactive_payload')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true })
    out.quick_replies = data ?? []
  }

  if (want.has('templates')) {
    const { data } = await ctx.supabase
      .from('message_templates')
      .select(
        'name, category, language, header_type, header_content, header_media_url, body_text, footer_text, buttons, sample_values',
      )
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true })
    out.templates = (data ?? []).map((t: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(t).filter(([, v]) => v !== null && v !== undefined)),
    )
  }

  if (want.has('ai')) {
    const { data: cfg } = await ctx.supabase
      .from('ai_configs')
      .select('system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation')
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    const { data: docs } = await ctx.supabase
      .from('ai_knowledge_documents')
      .select('title, content')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true })
    out.ai = { config: cfg ?? null, knowledge: docs ?? [] }
  }
  return out
}
