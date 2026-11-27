/**
 * Workspace bundle — one JSON file that carries a whole WhatsApp setup:
 * flows, automations, quick replies, message templates and the AI agent
 * (instructions + knowledge base).
 *
 *   {
 *     "wacrm_bundle_version": 1,
 *     "name": "Online Onward Tickets",
 *     "flows":        [ { ...portable flow, "activate": false } ],
 *     "automations":  [ { "name", "trigger_type", "trigger_config", "steps": [...], "activate": false } ],
 *     "quick_replies":[ { "title", "kind": "text", "content_text" } ],
 *     "templates":    [ { "name", "category", "language", "body_text", "buttons", "sample_values", ... } ],
 *     "ai": { "config": { "system_prompt", "is_active", "auto_reply_enabled",
 *                         "auto_reply_max_per_conversation" },
 *             "knowledge": [ { "title", "content" } ] }
 *   }
 *
 * Every section is optional. Secrets are NEVER part of a bundle: the AI
 * provider key, WhatsApp access token and API keys are not exported and
 * not imported.
 *
 * This module is pure (no I/O): it validates shape only.
 */

import { parseFlowImport, type PortableFlow } from '@/lib/flows/import'
import { parseKnowledgeImport, type ImportDoc } from '@/lib/ai/knowledge-import'
import { validateInteractivePayload } from '@/lib/whatsapp/interactive'
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'

export const BUNDLE_VERSION = 1
export const BUNDLE_SECTIONS = [
  'flows',
  'automations',
  'quick_replies',
  'templates',
  'ai',
] as const
export type BundleSection = (typeof BUNDLE_SECTIONS)[number]

export const BUNDLE_LIMITS = {
  flows: 20,
  automations: 50,
  quick_replies: 200,
  templates: 50,
} as const

export interface BundleFlow extends PortableFlow {
  activate: boolean
}

export interface BundleStep {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: BundleStep[]; no?: BundleStep[] }
}

export interface BundleAutomation {
  name: string
  description: string | null
  trigger_type: string
  trigger_config: Record<string, unknown>
  steps: BundleStep[]
  activate: boolean
}

export interface BundleQuickReply {
  title: string
  kind: 'text' | 'interactive'
  content_text: string | null
  interactive_payload: unknown | null
}

export interface BundleAiConfig {
  system_prompt?: string
  is_active?: boolean
  auto_reply_enabled?: boolean
  auto_reply_max_per_conversation?: number
}

export interface Bundle {
  name: string | null
  flows: BundleFlow[]
  automations: BundleAutomation[]
  quick_replies: BundleQuickReply[]
  templates: TemplatePayload[]
  ai: { config: BundleAiConfig | null; knowledge: ImportDoc[] } | null
}

export type BundleParse =
  | { ok: true; bundle: Bundle }
  | { ok: false; errors: string[] }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseSteps(raw: unknown, where: string, errors: string[], depth = 0): BundleStep[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    errors.push(`${where} must be an array.`)
    return []
  }
  if (depth > 6) {
    errors.push(`${where} is nested too deeply.`)
    return []
  }
  const out: BundleStep[] = []
  raw.forEach((s, i) => {
    const w = `${where}[${i}]`
    if (!isRecord(s) || typeof s.step_type !== 'string' || !s.step_type) {
      errors.push(`${w} needs a step_type.`)
      return
    }
    const step: BundleStep = {
      step_type: s.step_type,
      step_config: isRecord(s.step_config) ? s.step_config : {},
    }
    if (isRecord(s.branches)) {
      step.branches = {
        yes: parseSteps(s.branches.yes, `${w}.branches.yes`, errors, depth + 1),
        no: parseSteps(s.branches.no, `${w}.branches.no`, errors, depth + 1),
      }
    }
    out.push(step)
  })
  return out
}

function normalizeCategory(c: unknown): TemplatePayload['category'] | null {
  if (typeof c !== 'string') return null
  const v = c.trim().toLowerCase()
  if (v === 'marketing') return 'Marketing'
  if (v === 'utility') return 'Utility'
  if (v === 'authentication') return 'Authentication'
  return null
}

export function parseBundle(input: unknown): BundleParse {
  const root = isRecord(input) && isRecord(input.bundle) ? input.bundle : input
  if (!isRecord(root)) return { ok: false, errors: ['The file must contain a JSON object.'] }

  const errors: string[] = []
  const bundle: Bundle = {
    name: typeof root.name === 'string' ? root.name : null,
    flows: [],
    automations: [],
    quick_replies: [],
    templates: [],
    ai: null,
  }

  const arr = (key: keyof typeof BUNDLE_LIMITS): unknown[] => {
    const v = root[key]
    if (v === undefined) return []
    if (!Array.isArray(v)) {
      errors.push(`"${key}" must be an array.`)
      return []
    }
    if (v.length > BUNDLE_LIMITS[key]) {
      errors.push(`"${key}" can hold at most ${BUNDLE_LIMITS[key]} items.`)
      return []
    }
    return v
  }

  // flows
  arr('flows').forEach((f, i) => {
    const r = parseFlowImport(f)
    if (!r.ok) {
      errors.push(...r.errors.map((e) => `flows[${i}]: ${e}`))
      return
    }
    bundle.flows.push({
      ...r.value,
      activate: isRecord(f) && f.activate === true,
    })
  })

  // automations
  arr('automations').forEach((a, i) => {
    const w = `automations[${i}]`
    if (!isRecord(a)) {
      errors.push(`${w} must be an object.`)
      return
    }
    const name = typeof a.name === 'string' ? a.name.trim() : ''
    const trigger_type = typeof a.trigger_type === 'string' ? a.trigger_type.trim() : ''
    if (!name || !trigger_type) {
      errors.push(`${w} needs a name and a trigger_type.`)
      return
    }
    bundle.automations.push({
      name,
      description: typeof a.description === 'string' ? a.description : null,
      trigger_type,
      trigger_config: isRecord(a.trigger_config) ? a.trigger_config : {},
      steps: parseSteps(a.steps, `${w}.steps`, errors),
      activate: a.activate === true,
    })
  })

  // quick replies
  const seenQr = new Set<string>()
  arr('quick_replies').forEach((q, i) => {
    const w = `quick_replies[${i}]`
    if (!isRecord(q)) {
      errors.push(`${w} must be an object.`)
      return
    }
    const title = typeof q.title === 'string' ? q.title.trim() : ''
    if (!title) {
      errors.push(`${w} needs a title.`)
      return
    }
    if (seenQr.has(title.toLowerCase())) {
      errors.push(`Duplicate quick reply title "${title}".`)
      return
    }
    seenQr.add(title.toLowerCase())
    const kind = q.kind === 'interactive' ? 'interactive' : 'text'
    if (kind === 'interactive') {
      const v = validateInteractivePayload(q.interactive_payload)
      if (!v.ok) {
        errors.push(`${w} ("${title}"): ${v.error}`)
        return
      }
      bundle.quick_replies.push({
        title,
        kind,
        content_text: null,
        interactive_payload: q.interactive_payload,
      })
    } else {
      const text = typeof q.content_text === 'string' ? q.content_text : ''
      if (!text.trim()) {
        errors.push(`${w} ("${title}") needs content_text.`)
        return
      }
      bundle.quick_replies.push({
        title,
        kind,
        content_text: text,
        interactive_payload: null,
      })
    }
  })

  // templates
  const seenTpl = new Set<string>()
  arr('templates').forEach((t, i) => {
    const w = `templates[${i}]`
    if (!isRecord(t)) {
      errors.push(`${w} must be an object.`)
      return
    }
    const category = normalizeCategory(t.category)
    if (!category) {
      errors.push(`${w}: category must be Marketing or Utility.`)
      return
    }
    if (category === 'Authentication') {
      errors.push(`${w}: Authentication templates must be created in Meta.`)
      return
    }
    const payload = {
      ...(t as unknown as TemplatePayload),
      category,
      language: typeof t.language === 'string' && t.language ? t.language : 'en_US',
    } as TemplatePayload
    try {
      validateTemplatePayload(payload)
    } catch (e) {
      errors.push(`${w} ("${String(t.name)}"): ${e instanceof Error ? e.message : 'invalid'}`)
      return
    }
    const key = `${payload.name}|${payload.language}`
    if (seenTpl.has(key)) {
      errors.push(`Duplicate template "${payload.name}" (${payload.language}).`)
      return
    }
    seenTpl.add(key)
    bundle.templates.push(payload)
  })

  // ai
  if (root.ai !== undefined) {
    if (!isRecord(root.ai)) {
      errors.push('"ai" must be an object.')
    } else {
      let config: BundleAiConfig | null = null
      if (root.ai.config !== undefined) {
        if (!isRecord(root.ai.config)) {
          errors.push('ai.config must be an object.')
        } else {
          const c = root.ai.config
          config = {}
          if (c.system_prompt !== undefined) {
            if (typeof c.system_prompt !== 'string' || c.system_prompt.length > 20000) {
              errors.push('ai.config.system_prompt must be text up to 20,000 characters.')
            } else config.system_prompt = c.system_prompt
          }
          if (c.is_active !== undefined) {
            if (typeof c.is_active !== 'boolean') errors.push('ai.config.is_active must be true or false.')
            else config.is_active = c.is_active
          }
          if (c.auto_reply_enabled !== undefined) {
            if (typeof c.auto_reply_enabled !== 'boolean')
              errors.push('ai.config.auto_reply_enabled must be true or false.')
            else config.auto_reply_enabled = c.auto_reply_enabled
          }
          if (c.auto_reply_max_per_conversation !== undefined) {
            const n = Number(c.auto_reply_max_per_conversation)
            if (!Number.isFinite(n)) errors.push('ai.config.auto_reply_max_per_conversation must be a number.')
            else config.auto_reply_max_per_conversation = Math.min(20, Math.max(1, Math.floor(n)))
          }
        }
      }
      let knowledge: ImportDoc[] = []
      if (root.ai.knowledge !== undefined) {
        const k = parseKnowledgeImport(root.ai.knowledge)
        if (!k.ok) errors.push(...k.errors.map((e) => `ai.knowledge: ${e}`))
        else knowledge = k.documents
      }
      bundle.ai = { config, knowledge }
    }
  }

  const anything =
    bundle.flows.length ||
    bundle.automations.length ||
    bundle.quick_replies.length ||
    bundle.templates.length ||
    bundle.ai
  if (!anything && errors.length === 0) {
    errors.push('The bundle is empty: add at least one of flows, automations, quick_replies, templates or ai.')
  }
  return errors.length ? { ok: false, errors } : { ok: true, bundle }
}

/** Counts per section, used by the import dialog and the API response. */
export function summarizeBundle(b: Bundle): Record<BundleSection, number> {
  return {
    flows: b.flows.length,
    automations: b.automations.length,
    quick_replies: b.quick_replies.length,
    templates: b.templates.length,
    ai: (b.ai?.knowledge.length ?? 0) + (b.ai?.config ? 1 : 0),
  }
}
