/**
 * Apply a vertical's starter kit to an account.
 *
 * Called from `POST /api/admin/companies/[id]/apply-vertical`
 * (platform-admin only) with a service-role client. Every step is
 * **idempotent**: anything that already exists by name is left alone,
 * so the operator can re-run a kit safely (e.g. after adding a field to
 * the definition).
 *
 * It never deletes and never overwrites owner-authored content — the AI
 * system prompt is only filled when empty, `catalog_delivery_mode` is
 * set unconditionally (it's a low-stakes toggle), and `google_sheets`
 * events are only touched when the account already connected a sheet.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { cloneFlowTemplate } from '@/lib/flows/clone-template'
import { ingestDocument } from '@/lib/ai/knowledge'
import { getVertical, type VerticalDefinition, type VerticalSlug } from './index'

export interface ApplyVerticalResult {
  vertical: VerticalSlug
  created: {
    customFields: string[]
    pipeline: string | null
    flows: string[]
    knowledgeDocs: string[]
  }
  skipped: string[]
  warnings: string[]
}

interface ApplyVerticalArgs {
  db: SupabaseClient
  accountId: string
  /** A user_id in the account, for the audit `user_id` / `created_by`
   *  columns — normally the account owner. */
  actingUserId: string
  vertical: VerticalSlug
}

export async function applyVerticalKit(args: ApplyVerticalArgs): Promise<ApplyVerticalResult> {
  const { db, accountId, actingUserId, vertical } = args
  const def = getVertical(vertical)
  if (!def) throw new Error(`Unknown vertical "${vertical}"`)

  const result: ApplyVerticalResult = {
    vertical,
    created: { customFields: [], pipeline: null, flows: [], knowledgeDocs: [] },
    skipped: [],
    warnings: [],
  }

  await seedCustomFields(db, accountId, actingUserId, def, result)
  await seedPipeline(db, accountId, actingUserId, def, result)
  await seedFlows(db, accountId, actingUserId, def, result)
  await seedKnowledgeDocs(db, accountId, actingUserId, def, result)
  await applyAccountSettings(db, accountId, def, result)
  await applyGoogleSheetsEvents(db, accountId, def, result)
  await applyAiPromptScaffold(db, accountId, def, result)

  // Stamp the vertical + when the kit ran. Done last so a partial
  // failure above doesn't mark it "applied".
  const { error: acctErr } = await db
    .from('accounts')
    .update({ industry_vertical: vertical, vertical_applied_at: new Date().toISOString() })
    .eq('id', accountId)
  if (acctErr) result.warnings.push(`accounts update: ${acctErr.message}`)

  return result
}

// ------------------------------------------------------------

async function seedCustomFields(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  def: VerticalDefinition,
  result: ApplyVerticalResult,
) {
  if (def.customFields.length === 0) return
  const { data: existing } = await db
    .from('custom_fields')
    .select('field_name')
    .eq('account_id', accountId)
  const have = new Set((existing ?? []).map((r) => String(r.field_name).trim().toLowerCase()))

  const toCreate = def.customFields.filter((name) => !have.has(name.trim().toLowerCase()))
  if (toCreate.length === 0) {
    result.skipped.push('custom fields (all already exist)')
    return
  }
  const { error } = await db.from('custom_fields').insert(
    toCreate.map((field_name) => ({
      account_id: accountId,
      user_id: userId,
      field_name,
      field_type: 'text',
    })),
  )
  if (error) {
    result.warnings.push(`custom fields: ${error.message}`)
    return
  }
  result.created.customFields = toCreate
}

async function seedPipeline(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  def: VerticalDefinition,
  result: ApplyVerticalResult,
) {
  if (!def.pipeline) return
  const { data: existing } = await db
    .from('pipelines')
    .select('id, name')
    .eq('account_id', accountId)
  if ((existing ?? []).some((p) => String(p.name).trim().toLowerCase() === def.pipeline!.name.toLowerCase())) {
    result.skipped.push(`pipeline "${def.pipeline.name}" (already exists)`)
    return
  }

  const { data: pipeline, error: pErr } = await db
    .from('pipelines')
    .insert({ account_id: accountId, user_id: userId, name: def.pipeline.name })
    .select('id')
    .single()
  if (pErr || !pipeline) {
    result.warnings.push(`pipeline: ${pErr?.message ?? 'insert failed'}`)
    return
  }
  const { error: sErr } = await db.from('pipeline_stages').insert(
    def.pipeline.stages.map((s, i) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      position: i,
      color: s.color,
      is_won: s.is_won ?? false,
    })),
  )
  if (sErr) {
    // Roll back the empty pipeline so it doesn't sit stage-less.
    await db.from('pipelines').delete().eq('id', pipeline.id)
    result.warnings.push(`pipeline stages: ${sErr.message}`)
    return
  }
  result.created.pipeline = def.pipeline.name
}

async function seedFlows(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  def: VerticalDefinition,
  result: ApplyVerticalResult,
) {
  if (def.flowTemplateSlugs.length === 0) return
  const { data: existing } = await db
    .from('flows')
    .select('name')
    .eq('account_id', accountId)
  const haveNames = new Set((existing ?? []).map((r) => String(r.name).trim().toLowerCase()))

  for (const slug of def.flowTemplateSlugs) {
    const res = await cloneFlowTemplate(db, { accountId, userId, templateSlug: slug })
    if (!res.ok) {
      result.warnings.push(`flow "${slug}": ${res.error}`)
      continue
    }
    // Dedupe by the template's name after the fact — cloneFlowTemplate
    // doesn't check, so if this kit already ran, delete the fresh dupe.
    const { data: flow } = await db.from('flows').select('name').eq('id', res.flowId!).single()
    const name = String(flow?.name ?? slug)
    if (haveNames.has(name.trim().toLowerCase())) {
      await db.from('flows').delete().eq('id', res.flowId!)
      result.skipped.push(`flow "${name}" (already exists)`)
      continue
    }
    haveNames.add(name.trim().toLowerCase())
    result.created.flows.push(name)
  }
}

async function seedKnowledgeDocs(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  def: VerticalDefinition,
  result: ApplyVerticalResult,
) {
  if (def.knowledgeDocs.length === 0) return
  const { data: existing } = await db
    .from('ai_knowledge_documents')
    .select('title')
    .eq('account_id', accountId)
  const haveTitles = new Set((existing ?? []).map((r) => String(r.title).trim().toLowerCase()))

  for (const doc of def.knowledgeDocs) {
    if (haveTitles.has(doc.title.trim().toLowerCase())) {
      result.skipped.push(`knowledge doc "${doc.title}" (already exists)`)
      continue
    }
    const { data: row, error } = await db
      .from('ai_knowledge_documents')
      .insert({ account_id: accountId, created_by: userId, title: doc.title, content: doc.content })
      .select('id')
      .single()
    if (error || !row) {
      result.warnings.push(`knowledge doc "${doc.title}": ${error?.message ?? 'insert failed'}`)
      continue
    }
    try {
      // Lexical-only ingest (no embeddings key passed) — search still
      // works; the owner can run "reindex" from Settings later.
      await ingestDocument(db, accountId, { embeddingsApiKey: null }, row.id as string, doc.content)
    } catch (err) {
      result.warnings.push(
        `knowledge doc "${doc.title}" ingest: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    result.created.knowledgeDocs.push(doc.title)
  }
}

async function applyAccountSettings(
  db: SupabaseClient,
  accountId: string,
  def: VerticalDefinition,
  result: ApplyVerticalResult,
) {
  const patch: Record<string, unknown> = {}
  if (def.accountSettings.catalog_delivery_mode) {
    patch.catalog_delivery_mode = def.accountSettings.catalog_delivery_mode
  }
  if (Object.keys(patch).length === 0) return
  const { error } = await db.from('accounts').update(patch).eq('id', accountId)
  if (error) result.warnings.push(`account settings: ${error.message}`)
}

async function applyGoogleSheetsEvents(
  db: SupabaseClient,
  accountId: string,
  def: VerticalDefinition,
  result: ApplyVerticalResult,
) {
  if (def.googleSheetsEvents.length === 0) return
  const { data: cfg } = await db
    .from('google_sheets_config')
    .select('events')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!cfg) {
    result.skipped.push('google sheets events (no sheet connected)')
    return
  }
  const merged = Array.from(new Set([...(cfg.events ?? []), ...def.googleSheetsEvents]))
  const { error } = await db
    .from('google_sheets_config')
    .update({ events: merged })
    .eq('account_id', accountId)
  if (error) result.warnings.push(`google sheets events: ${error.message}`)
}

async function applyAiPromptScaffold(
  db: SupabaseClient,
  accountId: string,
  def: VerticalDefinition,
  result: ApplyVerticalResult,
) {
  if (!def.aiSystemPromptScaffold) return
  const { data: cfg } = await db
    .from('ai_configs')
    .select('system_prompt')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!cfg) {
    result.skipped.push('AI prompt (no AI config yet)')
    return
  }
  if (cfg.system_prompt && String(cfg.system_prompt).trim().length > 0) {
    result.skipped.push('AI prompt (already set — not overwritten)')
    return
  }
  const { error } = await db
    .from('ai_configs')
    .update({ system_prompt: def.aiSystemPromptScaffold })
    .eq('account_id', accountId)
  if (error) result.warnings.push(`AI prompt: ${error.message}`)
}
