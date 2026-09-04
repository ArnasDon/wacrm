import type { SupabaseClient } from '@supabase/supabase-js'
import { loadBusinessMetrics, type BusinessMetrics } from '@/lib/ai/business-metrics'
import { loadAssistantReport } from '@/lib/ai/report'
import { checkFreeBusy, APPOINTMENT_LOOKAHEAD_MS } from '@/lib/google-calendar/api'
import { formatWithOffset } from '@/lib/timezone'
import type { BusinessAction } from '@/lib/ai/business-actions'

// ============================================================
// Tool catalog for the owner-only "AI assistant" chat
// (`POST /api/ai/assistant`). Separate from the customer-facing
// auto-reply bot's sentinel system (`generate.ts`) on purpose — this
// assistant needs to resolve arbitrary entities by name and chain
// several lookups, which the fixed-id sentinel pattern can't do.
//
// Every read tool below runs against the RLS-scoped Supabase client of
// the calling owner's own session (never `supabaseAdmin()`), so Postgres
// itself bounds every query to that owner's `account_id` regardless of
// what the model asks for — this is the structural half of "the AI can
// never exceed what its owner already could in the dashboard."
//
// Write tools are NOT executed here. The tool-calling loop
// (`anthropic-tools.ts`) stops the moment the model calls one of them
// and returns it to the frontend as a `pendingAction` for the owner to
// explicitly confirm — see `src/app/api/ai/assistant/route.ts`.
// ============================================================

export interface ToolSchema {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

const READ_TOOLS: ToolSchema[] = [
  {
    name: 'get_business_metrics',
    description:
      "Get this account's current business snapshot: contacts by lead temperature, conversations by status, and deals (open/won/lost counts + total won value). Use this to answer any question about sales, pipeline health, or to ground a recommendation in real numbers.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'generate_report',
    description:
      "Build a period report for this account: leads generated / qualified (with the previous period for comparison), qualification and conversion rates, deals won and their total value, median first-response time, follow-ups sent, opportunities recovered, human hand-offs and how many advanced, brief-completion rate, and the lead-temperature split. Use this when the owner asks for a report, a summary, 'how did we do', weekly/monthly numbers, etc. Present it as a short readable summary, calling out what moved vs. the previous period; do not dump raw JSON.",
    input_schema: {
      type: 'object',
      properties: {
        periodDays: {
          type: 'integer',
          minimum: 7,
          maximum: 365,
          default: 30,
          description: 'How many days back the report covers. Default 30.',
        },
      },
    },
  },
  {
    name: 'search_deals',
    description:
      "Search this account's deals (pipeline opportunities) by title or contact name, optionally filtered by status. Use this to resolve a deal the owner referred to by name/description into its id before proposing move_deal or mark_deal_won — never invent a deal id.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text match against deal title or contact name.' },
        status: { type: 'string', enum: ['open', 'won', 'lost'] },
        limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
      },
    },
  },
  {
    name: 'search_contacts',
    description:
      "Search this account's contacts by name, phone, or email. Use this to resolve a contact the owner referred to by name into its id before proposing set_lead_temperature, create_quote, or schedule_appointment — never invent a contact id.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text match against name, phone, or email.' },
        limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
      },
    },
  },
  {
    name: 'list_pipelines_and_stages',
    description:
      "List this account's pipelines and their stages (id, name, order, whether a stage counts as won). Use this to resolve a stage name the owner mentioned (e.g. \"Negociación\") into its stage id before proposing move_deal.",
    input_schema: {
      type: 'object',
      properties: {
        pipeline_id: { type: 'string', description: 'Limit to one pipeline. Omit to list all of them.' },
      },
    },
  },
  {
    name: 'list_automations',
    description:
      "List this account's existing automations (name, trigger type, active/draft). Use this before proposing create_automation_rule so you don't suggest a duplicate of a rule that already exists, and to answer \"what rules do I have\".",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_products',
    description:
      "Search this account's active product catalog by name. Use this to resolve a product the owner named into its product_id before proposing create_quote — never invent a product_id or a price, quotes may only reference real catalog products.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text match against product name.' },
        limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
      },
    },
  },
  {
    name: 'check_calendar_availability',
    description:
      "Check this account's real Google Calendar free/busy data between two ISO datetimes. Only call this when the owner wants to schedule an appointment. Returns connected:false if no calendar is linked — in that case do not propose schedule_appointment.",
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'ISO 8601 datetime, start of the window to check.' },
        to: { type: 'string', description: 'ISO 8601 datetime, end of the window to check.' },
      },
      required: ['from', 'to'],
    },
  },
]

/**
 * Write tools mirror `BusinessAction` 1:1 (same names/params
 * `executeBusinessAction` already accepts) plus one new capability,
 * `create_automation_rule`. The loop never executes these — see the
 * module doc comment above.
 */
const WRITE_TOOLS: ToolSchema[] = [
  {
    name: 'close_conversation',
    description: 'Propose closing a conversation. targetId is the conversation id (from search results or the owner).',
    input_schema: { type: 'object', properties: { targetId: { type: 'string' } }, required: ['targetId'] },
  },
  {
    name: 'mark_deal_won',
    description: 'Propose marking a deal as won (moves it to the pipeline\'s won stage). targetId is the deal id — resolve it with search_deals first if the owner named it.',
    input_schema: { type: 'object', properties: { targetId: { type: 'string' } }, required: ['targetId'] },
  },
  {
    name: 'move_deal',
    description: 'Propose moving a deal to a different pipeline stage. targetId is the deal id, stageId is the target stage id — resolve both with search_deals / list_pipelines_and_stages first, never invent either.',
    input_schema: {
      type: 'object',
      properties: { targetId: { type: 'string' }, stageId: { type: 'string' } },
      required: ['targetId', 'stageId'],
    },
  },
  {
    name: 'set_lead_temperature',
    description: 'Propose (re)classifying a contact\'s buying-interest temperature. targetId is the CONTACT id (not a deal) — resolve it with search_contacts first.',
    input_schema: {
      type: 'object',
      properties: { targetId: { type: 'string' }, temperature: { type: 'string', enum: ['cold', 'warm', 'hot'] } },
      required: ['targetId', 'temperature'],
    },
  },
  {
    name: 'create_quote',
    description: 'Propose creating a quote for a contact from catalog products only. targetId is the CONTACT id. Every item must reference a real product_id — never invent a price.',
    input_schema: {
      type: 'object',
      properties: {
        targetId: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { product_id: { type: 'string' }, quantity: { type: 'number' } },
            required: ['product_id', 'quantity'],
          },
        },
        customerNit: { type: 'string', description: 'Optional — only ask the owner for this if they bring it up themselves.' },
        customerEmail: { type: 'string', description: 'Optional — only ask the owner for this if they bring it up themselves.' },
        customerPhone: { type: 'string' },
        customerAddress: { type: 'string' },
      },
      required: ['targetId', 'items', 'customerPhone', 'customerAddress'],
    },
  },
  {
    name: 'schedule_appointment',
    description: 'Propose booking a real Google Calendar appointment for a contact. targetId is the CONTACT id. Only propose a slot confirmed free by check_calendar_availability — never guess availability.',
    input_schema: {
      type: 'object',
      properties: {
        targetId: { type: 'string' },
        startTime: { type: 'string', description: 'ISO 8601, with the account\'s real UTC offset.' },
        endTime: { type: 'string', description: 'ISO 8601, with the account\'s real UTC offset.' },
        attendeeEmail: { type: 'string' },
        appointmentSummary: { type: 'string' },
        appointmentDescription: { type: 'string' },
      },
      required: ['targetId', 'startTime', 'endTime', 'attendeeEmail'],
    },
  },
  {
    name: 'create_task',
    description:
      "Propose creating a task / reminder for the owner. Use this whenever the owner says \"recuérdame\", \"anota que\", \"crea una tarea\", \"pendiente\", etc. The task is always assigned to the owner and, when `dueInHours` is set, they get a reminder notification when it comes due. `linkContactId` optionally ties it to a contact — resolve the name with search_contacts first, never invent an id. Nothing is created until the owner confirms it.",
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short imperative title, e.g. "Llamar a Juan para confirmar medidas".' },
        notes: { type: 'string', description: 'Optional extra context.' },
        dueInHours: {
          type: 'number',
          description: 'Hours from now until it is due. Omit or 0 = no due date (and no reminder).',
        },
        linkContactId: { type: 'string', description: 'Optional contact id to attach the task to.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'create_automation_rule',
    description:
      "Propose a new lead-handling rule (automation) built from the owner's instructions in plain language. Always created as a DRAFT (inactive) — the owner reviews it in Automations and activates it separately, it never starts firing on real customers from this chat. Steps run in order. Every step_type you emit MUST be exactly one of the values listed in that field's enum below and nothing else, even if it's close to what the owner asked for — never invent one. move_deal (step_config: {\"stage_id\": \"...\"}) moves the CONTACT'S CURRENTLY OPEN DEAL to that stage when the automation fires; it does nothing if the contact has no open deal (it never creates one) and takes no deal id — resolve the stage id with list_pipelines_and_stages first, never invent it. condition branches the rule in two: step_config is {\"subject\": \"message_count\"|\"time_of_day\", \"operand\": ..., \"value\": ...} — for \"message_count\" (total messages exchanged in the conversation so far, either direction), operand is one of \">\" \">=\" \"<\" \"<=\" \"==\" and value is the number as a string (e.g. subject message_count, operand \">=\", value \"6\" for \"6 or more messages\"); for \"time_of_day\", operand is a \"HH:mm-HH:mm\" window (24h, account's local time) and value is unused. Only use these two subjects — tag_presence and contact_field also exist in the system but need a real tag/field id you have no tool to look up here, so never propose them (tell the owner to add that condition manually in the Automations builder instead). A condition step ALSO needs a sibling `branches` property alongside step_type/step_config: {\"yes\": [...steps], \"no\": [...steps]}, each an array of steps in this exact same shape (a branch step can itself be a condition, but keep it to one level of nesting unless the owner explicitly asks for more — deeply nested conditions are hard for the owner to review at a glance). If the owner asks for something no step type or condition subject here covers, say so plainly instead of approximating it with the wrong one.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        trigger_type: {
          type: 'string',
          enum: [
            'new_message_received', 'first_inbound_message', 'keyword_match',
            'new_contact_created', 'conversation_assigned', 'tag_added',
            'time_based', 'interactive_reply',
          ],
        },
        trigger_config: {
          type: 'object',
          description: 'Shape depends on trigger_type — e.g. {"keywords":["precio"],"match_type":"contains"} for keyword_match, {"tag_id":"..."} for tag_added, {} for new_message_received.',
        },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              step_type: {
                type: 'string',
                enum: ['send_message', 'add_tag', 'remove_tag', 'assign_conversation', 'update_contact_field', 'move_deal', 'condition', 'wait', 'close_conversation'],
              },
              step_config: { type: 'object' },
              branches: {
                type: 'object',
                description: 'ONLY when step_type is "condition": {"yes": [...steps], "no": [...steps]} — each nested step follows this exact same {step_type, step_config, branches?} shape. Omit this property entirely for every other step_type.',
              },
            },
            required: ['step_type', 'step_config'],
          },
        },
      },
      required: ['name', 'trigger_type', 'trigger_config', 'steps'],
    },
  },
]

export const ASSISTANT_TOOLS: ToolSchema[] = [...READ_TOOLS, ...WRITE_TOOLS]

const WRITE_TOOL_NAMES = new Set<string>(WRITE_TOOLS.map((t) => t.name))

export function isWriteTool(name: string): boolean {
  return WRITE_TOOL_NAMES.has(name)
}

/** Business-action write tools — the ones that go through
 *  `POST /api/ai/actions` on confirm. Excludes `create_automation_rule`
 *  and `create_task`, which have their own confirm endpoints (see
 *  `ai-assistant.tsx`). */
export function isBusinessActionTool(name: string): name is BusinessAction {
  return (
    WRITE_TOOL_NAMES.has(name) &&
    name !== 'create_automation_rule' &&
    name !== 'create_task'
  )
}

const MAX_LIMIT = 25
const DEFAULT_LIMIT = 10

function clampLimit(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(Math.floor(n), MAX_LIMIT)
}

/**
 * Execute one READ tool call server-side and return its JSON-serializable
 * result for the next turn's `tool_result`. Throws are caught by the loop
 * and surfaced to the model as an error result, so it can recover instead
 * of the whole request failing.
 */
export async function executeReadTool(
  db: SupabaseClient,
  accountId: string,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'get_business_metrics':
      return await loadBusinessMetrics(db, accountId) satisfies BusinessMetrics

    case 'generate_report': {
      const days = Number(input.periodDays)
      return await loadAssistantReport(db, Number.isFinite(days) ? days : 30)
    }

    case 'search_deals': {
      const limit = clampLimit(input.limit)
      const q = typeof input.query === 'string' ? input.query.trim() : ''

      // Two plain queries instead of a `deals -> contacts` PostgREST
      // embed: an embedded join can 500 with PGRST200 whenever the
      // schema-relationship cache is stale (see move-deal.ts's own
      // account lookup, which avoids the same trap for the same
      // reason) — not worth that fragility just to match by name.
      let contactIds: string[] = []
      if (q) {
        const { data: matchingContacts, error: contactsError } = await db
          .from('contacts')
          .select('id')
          .eq('account_id', accountId)
          .ilike('name', `%${q}%`)
          .limit(limit)
        if (contactsError) throw new Error(contactsError.message)
        contactIds = (matchingContacts ?? []).map((c) => c.id as string)
      }

      let query = db
        .from('deals')
        .select('id, title, status, value, pipeline_id, stage_id, contact_id')
        .eq('account_id', accountId)
        .order('updated_at', { ascending: false })
        .limit(limit)
      if (q && contactIds.length > 0) {
        query = query.or(`title.ilike.%${q}%,contact_id.in.(${contactIds.join(',')})`)
      } else if (q) {
        query = query.ilike('title', `%${q}%`)
      }
      if (typeof input.status === 'string' && ['open', 'won', 'lost'].includes(input.status)) {
        query = query.eq('status', input.status)
      }
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return data ?? []
    }

    case 'search_contacts': {
      const limit = clampLimit(input.limit)
      let query = db
        .from('contacts')
        .select('id, name, phone, email, lead_temperature')
        .eq('account_id', accountId)
        .order('updated_at', { ascending: false })
        .limit(limit)
      const q = typeof input.query === 'string' ? input.query.trim() : ''
      if (q) query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return data ?? []
    }

    case 'search_products': {
      const limit = clampLimit(input.limit)
      let query = db
        .from('products')
        .select('id, name, price, description')
        .eq('account_id', accountId)
        .eq('is_active', true)
        .order('name')
        .limit(limit)
      const q = typeof input.query === 'string' ? input.query.trim() : ''
      if (q) query = query.ilike('name', `%${q}%`)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return data ?? []
    }

    case 'list_pipelines_and_stages': {
      let pipelineQuery = db.from('pipelines').select('id, name').eq('account_id', accountId)
      if (typeof input.pipeline_id === 'string' && input.pipeline_id) {
        pipelineQuery = pipelineQuery.eq('id', input.pipeline_id)
      }
      const { data: pipelines, error: pipelinesError } = await pipelineQuery
      if (pipelinesError) throw new Error(pipelinesError.message)
      const pipelineIds = (pipelines ?? []).map((p) => p.id as string)
      if (pipelineIds.length === 0) return []
      const { data: stages, error: stagesError } = await db
        .from('pipeline_stages')
        .select('id, pipeline_id, name, position, is_won')
        .in('pipeline_id', pipelineIds)
        .order('position', { ascending: true })
      if (stagesError) throw new Error(stagesError.message)
      return (pipelines ?? []).map((p) => ({
        id: p.id, name: p.name,
        stages: (stages ?? []).filter((s) => s.pipeline_id === p.id),
      }))
    }

    case 'list_automations': {
      const { data, error } = await db
        .from('automations')
        .select('id, name, description, trigger_type, is_active')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return data ?? []
    }

    case 'check_calendar_availability': {
      const from = typeof input.from === 'string' ? input.from : ''
      const to = typeof input.to === 'string' ? input.to : ''
      const { data: gcalConfig } = await db
        .from('google_calendar_config')
        .select('status')
        .eq('account_id', accountId)
        .maybeSingle()
      if (gcalConfig?.status !== 'connected') return { connected: false }
      const { data: accountRow } = await db.from('accounts').select('timezone').eq('id', accountId).maybeSingle()
      const timeZone = (accountRow as { timezone: string | null } | null)?.timezone || 'UTC'
      const fromDate = from ? new Date(from) : new Date()
      const toDate = to ? new Date(to) : new Date(fromDate.getTime() + APPOINTMENT_LOOKAHEAD_MS)
      const busy = await checkFreeBusy(db, accountId, fromDate.toISOString(), toDate.toISOString())
      return {
        connected: true,
        time_zone: timeZone,
        from: formatWithOffset(fromDate, timeZone),
        to: formatWithOffset(toDate, timeZone),
        busy: busy.map((b) => ({
          start: formatWithOffset(new Date(b.start), timeZone),
          end: formatWithOffset(new Date(b.end), timeZone),
        })),
      }
    }

    default:
      throw new Error(`Unknown read tool: ${name}`)
  }
}
