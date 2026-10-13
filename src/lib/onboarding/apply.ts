import type { SupabaseClient } from '@supabase/supabase-js'
import { ingestDocument } from '@/lib/ai/knowledge'
import { loadAiConfig } from '@/lib/ai/config'
import { getVertical } from '@/lib/verticals'
import { applyVerticalKit } from '@/lib/verticals/seed'
import { formSections, FORM_TO_ACCOUNT_VERTICAL, type FormVertical } from './spec'

/** Marks the generated prompt block so a re-apply replaces it in place. */
export const PROMPT_BLOCK_START = '## REGLAS DEL NEGOCIO (formulario de alta)'
export const PROMPT_BLOCK_END = '## FIN REGLAS DEL NEGOCIO'
const DOC_SUFFIX = ' (formulario de alta)'

export interface ManualStep {
  title: string
  detail: string
}

export interface OnboardingOutput {
  docs: { title: string; content: string }[]
  promptBlock: string
  windowStartHour: number | null
  windowEndHour: number | null
  catalogDeliveryMode: 'digital' | 'pdf' | 'photos' | null
  missing: string[]
  manual: ManualStep[]
}

function hour(answer: string | undefined): number | null {
  const n = answer ? parseInt(answer, 10) : NaN
  return Number.isFinite(n) && n >= 0 && n <= 24 ? n : null
}

const DELIVERY: Record<string, 'digital' | 'pdf' | 'photos'> = { 'Enlace web': 'digital', PDF: 'pdf', Fotos: 'photos' }

/** Pure: answers → what to write and what's left for a human. */
export function buildOnboardingOutput(vertical: FormVertical, answers: Record<string, string>): OnboardingOutput {
  const docs: { title: string; content: string }[] = []
  const rules: string[] = []
  const missing: string[] = []

  for (const section of formSections(vertical)) {
    const lines: string[] = []
    for (const q of section.questions) {
      const a = answers[q.key]
      if (!a) {
        if (q.required) missing.push(`${section.title}: ${q.title}`)
        continue
      }
      if (q.target === 'kb') lines.push(`${q.title}\n${a}`)
      if (q.target === 'prompt' && q.promptLine) rules.push(`- ${q.promptLine(a)}`)
    }
    if (section.doc && lines.length) {
      docs.push({ title: section.doc + DOC_SUFFIX, content: `${section.doc.toUpperCase()}\n\n${lines.join('\n\n')}` })
    }
  }

  const start = hour(answers.equipo_hora_inicio)
  const end = hour(answers.equipo_hora_fin)
  if (start != null && end != null) {
    rules.push(`- El equipo responde de ${start}:00 a ${end}:00 (hora local).`)
  }
  rules.push('- Nunca compartes números de cuenta bancaria; si el cliente los pide, el equipo se los envía.')

  const promptBlock = [PROMPT_BLOCK_START, ...rules, PROMPT_BLOCK_END].join('\n')

  const manual: ManualStep[] = []
  const add = (title: string, key: string) => {
    if (answers[key]) manual.push({ title, detail: answers[key] })
  }
  add('Cargar precios en el catálogo (Productos → Importar Excel)', 'hotel_precios')
  add('Cargar temporada alta en las tarifas del catálogo', 'hotel_temporada')
  add('Cargar servicios y precios en el catálogo', 'clinica_servicios')
  add('Cargar productos y precios en el catálogo', 'comercio_catalogo')
  add('Configurar recordatorio de citas', 'clinica_recordatorio')
  add('Invitar al equipo (Configuración → Equipo)', 'equipo_personas')
  add('Etiquetar con "Sin IA" estos contactos cuando escriban', 'equipo_sin_ia')
  add('Descargar logo y fotos', 'negocio_fotos')
  manual.push({ title: 'Conectar WhatsApp y activar la IA', detail: 'Después de revisar el prompt y correr la prueba de la IA.' })

  return {
    docs,
    promptBlock,
    windowStartHour: start,
    windowEndHour: end,
    catalogDeliveryMode: DELIVERY[answers.comercio_envio_catalogo ?? ''] ?? null,
    missing,
    manual,
  }
}

/** Pure: put the block into the prompt, or say why not. */
export function mergePromptBlock(current: string | null, block: string, scaffold: string | undefined):
  { prompt: string; mode: 'created' | 'replaced' } | null {
  const text = (current ?? '').trim()
  if (!text) return { prompt: [scaffold, block].filter(Boolean).join('\n\n'), mode: 'created' }
  const s = text.indexOf(PROMPT_BLOCK_START)
  const e = text.indexOf(PROMPT_BLOCK_END)
  if (s >= 0 && e > s) {
    return { prompt: text.slice(0, s) + block + text.slice(e + PROMPT_BLOCK_END.length), mode: 'replaced' }
  }
  // A hand-written prompt is never edited unreviewed.
  return null
}

export interface ApplyResult {
  applied_at: string
  docs: string[]
  prompt: 'created' | 'replaced' | 'suggested' | 'no_ai_config'
  suggested_prompt_block: string | null
  settings: string[]
  kit: { created: Record<string, unknown>; skipped: string[] } | null
  missing: string[]
  manual: ManualStep[]
  warnings: string[]
}

export async function applyOnboardingIntake(
  db: SupabaseClient,
  intake: { id: string; account_id: string; form_vertical: FormVertical; answers: Record<string, string> },
): Promise<ApplyResult> {
  const accountId = intake.account_id
  const out = buildOnboardingOutput(intake.form_vertical, intake.answers)
  const warnings: string[] = []
  const settings: string[] = []

  const { data: account, error: accErr } = await db
    .from('accounts').select('owner_user_id, timezone').eq('id', accountId).single()
  if (accErr || !account?.owner_user_id) throw new Error('La empresa no tiene dueño asignado todavía.')
  const ownerId = account.owner_user_id as string

  // 1. Vertical kit, minus its placeholder KB docs and prompt (the form fills both).
  const accountVertical = FORM_TO_ACCOUNT_VERTICAL[intake.form_vertical]
  let kit: ApplyResult['kit'] = null
  if (accountVertical !== 'generic') {
    const r = await applyVerticalKit({ db, accountId, actingUserId: ownerId, vertical: accountVertical, skip: ['knowledgeDocs', 'aiPrompt'] })
    kit = { created: r.created as unknown as Record<string, unknown>, skipped: r.skipped }
    warnings.push(...r.warnings)
  }

  // 2. Knowledge base: one doc per section, replaced on re-apply.
  const config = await loadAiConfig(db, accountId, { requireActive: false }).catch(() => null)
  const docs: string[] = []
  for (const doc of out.docs) {
    const { data: existing } = await db.from('ai_knowledge_documents')
      .select('id').eq('account_id', accountId).eq('title', doc.title).maybeSingle()
    let id = existing?.id as string | undefined
    if (id) {
      const { error } = await db.from('ai_knowledge_documents').update({ content: doc.content }).eq('id', id)
      if (error) { warnings.push(`${doc.title}: ${error.message}`); continue }
    } else {
      const { data, error } = await db.from('ai_knowledge_documents')
        .insert({ account_id: accountId, created_by: ownerId, title: doc.title, content: doc.content })
        .select('id').single()
      if (error || !data) { warnings.push(`${doc.title}: ${error?.message ?? 'no se pudo crear'}`); continue }
      id = data.id as string
    }
    try {
      await ingestDocument(db, accountId, { embeddingsApiKey: config?.embeddingsApiKey ?? null }, id, doc.content)
    } catch (err) {
      warnings.push(`${doc.title}: indexado semántico falló (${err instanceof Error ? err.message : String(err)}); la búsqueda por texto sí funciona`)
    }
    docs.push(doc.title)
  }

  // 3. Prompt + follow-up window (both live on ai_configs).
  let prompt: ApplyResult['prompt'] = 'no_ai_config'
  let suggested: string | null = out.promptBlock
  const { data: cfg } = await db.from('ai_configs').select('system_prompt').eq('account_id', accountId).maybeSingle()
  if (cfg) {
    const patch: Record<string, unknown> = {}
    const merged = mergePromptBlock(cfg.system_prompt as string | null, out.promptBlock, getVertical(accountVertical)?.aiSystemPromptScaffold)
    if (merged) {
      patch.system_prompt = merged.prompt
      prompt = merged.mode
      suggested = null
    } else {
      prompt = 'suggested'
    }
    if (out.windowStartHour != null && out.windowEndHour != null) {
      patch.followups_business_hours_only = true
      patch.followups_window_start_hour = out.windowStartHour
      patch.followups_window_end_hour = out.windowEndHour
      settings.push(`Seguimientos solo de ${out.windowStartHour}:00 a ${out.windowEndHour}:00`)
    }
    const { error } = await db.from('ai_configs').update(patch).eq('account_id', accountId)
    if (error) warnings.push(`Configuración de IA: ${error.message}`)
  }

  // 4. Account settings.
  const accPatch: Record<string, unknown> = {}
  if (!account.timezone) { accPatch.timezone = 'America/Guatemala'; settings.push('Zona horaria: America/Guatemala') }
  if (out.catalogDeliveryMode) { accPatch.catalog_delivery_mode = out.catalogDeliveryMode; settings.push(`Envío del catálogo: ${out.catalogDeliveryMode}`) }
  if (Object.keys(accPatch).length) {
    const { error } = await db.from('accounts').update(accPatch).eq('id', accountId)
    if (error) warnings.push(`Empresa: ${error.message}`)
  }

  return {
    applied_at: new Date().toISOString(),
    docs,
    prompt,
    suggested_prompt_block: suggested,
    settings,
    kit,
    missing: out.missing,
    manual: out.manual,
    warnings,
  }
}
