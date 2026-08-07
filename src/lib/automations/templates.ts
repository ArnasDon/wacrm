import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'

export type TemplateSlug =
  | 'welcome_message'
  | 'out_of_office'
  | 'lead_qualifier'
  | 'follow_up_reminder'

export interface TemplateStepSeed {
  step_type: AutomationStepType
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
}

// ============================================================
// Raw definitions — customer-facing copy (name, description, message
// bodies, keyword lists) lives in messages/*.json under
// `Automations.templates.<slug>.*`, not here. Resolve with
// `resolveTemplate` / `resolveAllTemplates`, passing a translator
// scoped to that namespace (`useTranslations('Automations.templates')`
// client-side, `getTranslations({ namespace: 'Automations.templates' })`
// server-side) — otherwise a template applied under any locale would
// still send English message text to customers.
// ============================================================

interface TemplateStepSeedRaw {
  step_type: AutomationStepType
  /** i18n key (relative to the slug's namespace) for step_config.text, when this step type carries one. */
  textKey?: string
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  parent_index?: number | null
}

interface AutomationTemplateDefinitionRaw {
  slug: TemplateSlug
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  /** i18n key (relative to the slug's namespace) for a comma-separated keyword list, when trigger_config.keywords applies. */
  keywordsKey?: string
  steps: TemplateStepSeedRaw[]
}

const AUTOMATION_TEMPLATES_RAW: Record<TemplateSlug, AutomationTemplateDefinitionRaw> = {
  welcome_message: {
    slug: 'welcome_message',
    // first_inbound_message (added in PR #33) catches both brand-new
    // contacts AND manually-added/imported contacts on their first-ever
    // reply, which is what a user setting up a "welcome" automation
    // almost always wants. new_contact_created would miss the
    // manually-imported case.
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        textKey: 'welcome_message.step0',
        step_config: {},
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },
  out_of_office: {
    slug: 'out_of_office',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'condition',
        step_config: {
          subject: 'time_of_day',
          operand: '18:00-09:00',
        },
      },
      {
        step_type: 'send_message',
        textKey: 'out_of_office.step1',
        step_config: {},
        parent_index: 0,
        branch: 'yes',
      },
    ],
  },
  lead_qualifier: {
    slug: 'lead_qualifier',
    trigger_type: 'keyword_match',
    trigger_config: { match_type: 'contains' },
    keywordsKey: 'lead_qualifier.keywords',
    steps: [
      {
        step_type: 'send_message',
        textKey: 'lead_qualifier.step0',
        step_config: {},
      },
      {
        step_type: 'wait',
        step_config: { amount: 10, unit: 'minutes' },
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },
  follow_up_reminder: {
    slug: 'follow_up_reminder',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'days' },
      },
      {
        step_type: 'send_message',
        textKey: 'follow_up_reminder.step1',
        step_config: {},
      },
    ],
  },
}

export const TEMPLATE_SLUGS = Object.keys(AUTOMATION_TEMPLATES_RAW) as TemplateSlug[]

/**
 * Resolve one template's translatable copy via `t`, scoped to the
 * `Automations.templates` namespace (so `t('welcome_message.name')`
 * etc. resolve). `t` may be next-intl's client `useTranslations` or
 * server `getTranslations` result — both share this call signature.
 */
export function resolveTemplate(
  slug: TemplateSlug,
  t: (key: string, values?: Record<string, string | number | Date>) => string
): AutomationTemplateDefinition {
  const raw = AUTOMATION_TEMPLATES_RAW[slug]
  const triggerConfig: AutomationTriggerConfig = raw.keywordsKey
    ? {
        ...raw.trigger_config,
        keywords: t(raw.keywordsKey)
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      }
    : raw.trigger_config

  return {
    slug: raw.slug,
    name: t(`${slug}.name`),
    description: t(`${slug}.description`),
    trigger_type: raw.trigger_type,
    trigger_config: triggerConfig,
    steps: raw.steps.map((s) => ({
      step_type: s.step_type,
      step_config: s.textKey ? { ...s.step_config, text: t(s.textKey) } : s.step_config,
      branch: s.branch,
      parent_index: s.parent_index,
    })),
  }
}

export function resolveAllTemplates(
  t: (key: string, values?: Record<string, string | number | Date>) => string
): Record<TemplateSlug, AutomationTemplateDefinition> {
  const out = {} as Record<TemplateSlug, AutomationTemplateDefinition>
  for (const slug of TEMPLATE_SLUGS) {
    out[slug] = resolveTemplate(slug, t)
  }
  return out
}

export function getTemplate(
  slug: string,
  t: (key: string, values?: Record<string, string | number | Date>) => string
): AutomationTemplateDefinition | null {
  if (!TEMPLATE_SLUGS.includes(slug as TemplateSlug)) return null
  return resolveTemplate(slug as TemplateSlug, t)
}
