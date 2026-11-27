/**
 * Server side of the workspace bundle import. Every section is applied
 * independently: a problem in one never rolls back or blocks another,
 * and every result is reported back so the UI can show exactly what
 * happened.
 *
 * Idempotency, so the same file can be imported again safely:
 *   flows / automations  matched by name  -> skipped when they exist
 *                        (they may be live; delete first to replace)
 *   quick replies        matched by title -> updated in place
 *   knowledge documents  matched by title -> updated in place
 *   templates            matched by name + language -> skipped unless the
 *                        earlier attempt is still a DRAFT (retry)
 *   AI config            fields present in the bundle are applied
 *
 * Imports always create inactive drafts unless the bundle asks for
 * `activate: true`, and activation only happens when validation passes.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { upsertKnowledgeDocs } from '@/lib/ai/knowledge-import-server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { insertSteps, type BuilderStepInput } from '@/lib/automations/steps-tree'
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate'
import { supabaseAdmin as flowsAdmin } from '@/lib/flows/admin-client'
import { createFlowFromImport, FlowImportError, resolveTags } from '@/lib/flows/import-server'
import type { TemplatePayload } from '@/lib/whatsapp/template-validators'

import type { Bundle, BundleSection, BundleStep } from './schema'
import { applyStepTagIds, collectStepTagNames } from './tags'

export interface BundleCtx {
  supabase: SupabaseClient
  accountId: string
  userId: string
}

export interface SectionResult {
  created: number
  updated: number
  skipped: number
  warnings: string[]
}

export type BundleResult = Partial<Record<BundleSection, SectionResult>>

export type SubmitTemplateFn = (
  payload: TemplatePayload,
) => Promise<{ ok: boolean; error?: string }>

const empty = (): SectionResult => ({ created: 0, updated: 0, skipped: 0, warnings: [] })

function flattenSteps(steps: BundleStep[]): { step_type: string; step_config: Record<string, unknown> }[] {
  const out: { step_type: string; step_config: Record<string, unknown> }[] = []
  for (const s of steps) {
    out.push({ step_type: s.step_type, step_config: s.step_config })
    if (s.branches) {
      out.push(...flattenSteps(s.branches.yes ?? []), ...flattenSteps(s.branches.no ?? []))
    }
  }
  return out
}

async function importFlows(ctx: BundleCtx, bundle: Bundle): Promise<SectionResult> {
  const res = empty()
  const admin = flowsAdmin()
  const { data: existing } = await admin
    .from('flows')
    .select('name')
    .eq('account_id', ctx.accountId)
  const names = new Set(((existing ?? []) as Array<{ name: string }>).map((f) => f.name.trim().toLowerCase()))

  for (const flow of bundle.flows) {
    if (names.has(flow.name.trim().toLowerCase())) {
      res.skipped++
      res.warnings.push(`Flow "${flow.name}" already exists, skipped (delete it first to re-import).`)
      continue
    }
    try {
      const { flow: row, issues } = await createFlowFromImport(admin, {
        accountId: ctx.accountId,
        authorId: ctx.userId,
        flow,
        canCreateTags: true,
      })
      names.add(flow.name.trim().toLowerCase())
      res.created++
      const errors = issues.filter((i) => i.severity === 'error')
      if (flow.activate) {
        if (errors.length === 0) {
          await admin.from('flows').update({ status: 'active' }).eq('id', row.id as string)
        } else {
          res.warnings.push(`Flow "${flow.name}" was imported as a draft: ${errors[0].message}`)
        }
      } else if (errors.length > 0) {
        res.warnings.push(`Flow "${flow.name}" has ${errors.length} issue(s) to fix before it can be activated.`)
      }
    } catch (err) {
      res.warnings.push(
        `Flow "${flow.name}": ${err instanceof FlowImportError ? err.message : 'could not be imported.'}`,
      )
    }
  }
  return res
}

async function importAutomations(ctx: BundleCtx, bundle: Bundle): Promise<SectionResult> {
  const res = empty()
  const admin = supabaseAdmin()
  const { data: existing } = await admin
    .from('automations')
    .select('name')
    .eq('account_id', ctx.accountId)
  const names = new Set(((existing ?? []) as Array<{ name: string }>).map((a) => a.name.trim().toLowerCase()))

  for (const a of bundle.automations) {
    if (names.has(a.name.toLowerCase())) {
      res.skipped++
      res.warnings.push(`Automation "${a.name}" already exists, skipped.`)
      continue
    }
    let steps = a.steps
    try {
      const tagNames = collectStepTagNames(a.steps)
      if (tagNames.length > 0) {
        const ids = await resolveTags(admin, ctx.accountId, ctx.userId, tagNames, true)
        steps = applyStepTagIds(a.steps, ids)
      }
    } catch {
      res.warnings.push(`Automation "${a.name}": its tags could not be prepared.`)
      continue
    }
    const { data: row, error } = await admin
      .from('automations')
      .insert({
        user_id: ctx.userId,
        account_id: ctx.accountId,
        name: a.name,
        description: a.description,
        trigger_type: a.trigger_type,
        trigger_config: a.trigger_config,
        is_active: false,
      })
      .select('id')
      .single()
    if (error || !row) {
      res.warnings.push(`Automation "${a.name}": could not be saved.`)
      continue
    }
    const id = (row as { id: string }).id
    if (steps.length > 0) {
      const stepErr = await insertSteps(id, steps as unknown as BuilderStepInput[])
      if (stepErr) {
        await admin.from('automations').delete().eq('id', id)
        res.warnings.push(`Automation "${a.name}": steps could not be saved.`)
        continue
      }
    }
    names.add(a.name.toLowerCase())
    res.created++
    const issues = [
      ...validateTriggerForActivation(a.trigger_type, a.trigger_config),
      ...validateStepsForActivation(flattenSteps(steps)),
    ]
    if (a.activate) {
      if (issues.length === 0) {
        await admin.from('automations').update({ is_active: true }).eq('id', id)
      } else {
        res.warnings.push(`Automation "${a.name}" stays inactive: ${issues[0].message}`)
      }
    } else if (issues.length > 0) {
      res.warnings.push(`Automation "${a.name}" has ${issues.length} issue(s) to fix before activating.`)
    }
  }
  return res
}

async function importQuickReplies(ctx: BundleCtx, bundle: Bundle): Promise<SectionResult> {
  const res = empty()
  const admin = supabaseAdmin()
  const { data: existing } = await admin
    .from('quick_replies')
    .select('id, title')
    .eq('account_id', ctx.accountId)
  const idByTitle = new Map(
    ((existing ?? []) as Array<{ id: string; title: string }>).map((q) => [q.title.trim().toLowerCase(), q.id]),
  )
  for (const q of bundle.quick_replies) {
    const id = idByTitle.get(q.title.toLowerCase())
    const fields = {
      kind: q.kind,
      content_text: q.content_text,
      interactive_payload: q.interactive_payload,
    }
    if (id) {
      const { error } = await admin.from('quick_replies').update(fields).eq('id', id)
      if (error) res.warnings.push(`Quick reply "${q.title}": could not be updated.`)
      else res.updated++
    } else {
      const { error } = await admin.from('quick_replies').insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        title: q.title,
        ...fields,
      })
      if (error) res.warnings.push(`Quick reply "${q.title}": could not be saved.`)
      else res.created++
    }
  }
  return res
}

async function importTemplates(
  ctx: BundleCtx,
  bundle: Bundle,
  submit: SubmitTemplateFn,
): Promise<SectionResult> {
  const res = empty()
  const { data: existing } = await ctx.supabase
    .from('message_templates')
    .select('name, language, status')
    .eq('account_id', ctx.accountId)
  const state = new Map(
    ((existing ?? []) as Array<{ name: string; language: string | null; status: string | null }>).map(
      (t) => [`${t.name}|${t.language ?? 'en_US'}`, t.status],
    ),
  )
  for (const t of bundle.templates) {
    const prev = state.get(`${t.name}|${t.language}`)
    if (prev && prev !== 'DRAFT') {
      res.skipped++
      res.warnings.push(`Template "${t.name}" already exists (${prev}), skipped.`)
      continue
    }
    const r = await submit(t)
    if (r.ok) res.created++
    else res.warnings.push(`Template "${t.name}": ${r.error ?? 'could not be submitted.'}`)
  }
  return res
}

async function importAi(ctx: BundleCtx, bundle: Bundle): Promise<SectionResult> {
  const res = empty()
  const ai = bundle.ai
  if (!ai) return res

  if (ai.config && Object.keys(ai.config).length > 0) {
    const patch: Record<string, unknown> = {}
    if (ai.config.system_prompt !== undefined) patch.system_prompt = ai.config.system_prompt.trim() || null
    if (ai.config.is_active !== undefined) patch.is_active = ai.config.is_active
    if (ai.config.auto_reply_enabled !== undefined) patch.auto_reply_enabled = ai.config.auto_reply_enabled
    if (ai.config.auto_reply_max_per_conversation !== undefined)
      patch.auto_reply_max_per_conversation = ai.config.auto_reply_max_per_conversation
    const { data, error } = await ctx.supabase
      .from('ai_configs')
      .update(patch)
      .eq('account_id', ctx.accountId)
      .select('id')
    if (error) {
      res.warnings.push('AI settings could not be saved.')
    } else if (!data || data.length === 0) {
      res.warnings.push(
        'AI settings were not applied: add your AI provider key first (AI Agents → Provider & key), then import again.',
      )
    } else {
      res.updated++
    }
  }

  if (ai.knowledge.length > 0) {
    try {
      const k = await upsertKnowledgeDocs(ctx.supabase, ctx.accountId, ctx.userId, ai.knowledge)
      res.created += k.created
      res.updated += k.updated
      res.warnings.push(...k.warnings)
    } catch {
      res.warnings.push('Knowledge base could not be imported.')
    }
  }
  return res
}

export async function importBundle(
  ctx: BundleCtx,
  bundle: Bundle,
  opts: { sections: BundleSection[]; submitTemplate: SubmitTemplateFn },
): Promise<BundleResult> {
  const want = new Set(opts.sections)
  const out: BundleResult = {}
  // Order matters a little: tags/flows first, templates last (slowest, external).
  if (want.has('flows') && bundle.flows.length) out.flows = await importFlows(ctx, bundle)
  if (want.has('automations') && bundle.automations.length)
    out.automations = await importAutomations(ctx, bundle)
  if (want.has('quick_replies') && bundle.quick_replies.length)
    out.quick_replies = await importQuickReplies(ctx, bundle)
  if (want.has('ai') && bundle.ai) out.ai = await importAi(ctx, bundle)
  if (want.has('templates') && bundle.templates.length)
    out.templates = await importTemplates(ctx, bundle, opts.submitTemplate)
  return out
}
