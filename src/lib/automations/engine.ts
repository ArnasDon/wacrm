import type {
  Automation,
  AutomationLogStepResult,
  AutomationStep,
  AutomationTriggerType,
  ConditionStepConfig,
  KeywordMatchTriggerConfig,
  SendMessageStepConfig,
  SendTemplateStepConfig,
  SendWebhookStepConfig,
  TagStepConfig,
  UpdateContactFieldStepConfig,
  WaitStepConfig,
  CreateDealStepConfig,
  AssignConversationStepConfig,
} from '@/types'
import { supabaseAdmin } from './admin-client'
import {
  checkRateLimit,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { engineSendText, engineSendTemplate } from './meta-send'

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

export interface AutomationContext {
  /** Raw message text, for keyword_match + message_content conditions. */
  message_text?: string
  /** Conversation the event belongs to, if any. */
  conversation_id?: string
  /** Arbitrary variables accumulated during execution. */
  vars?: Record<string, unknown>
  /** The tag id that was added, for tag_added trigger. */
  tag_id?: string
  /** Agent the conversation was assigned to, for conversation_assigned. */
  agent_id?: string
}

export interface DispatchInput {
  /** Account-level tenancy key. Drives the lookup of which active
   *  automations to fire — `automations.account_id` is the tenant
   *  isolation after migration 017. Replaces the previous `userId`
   *  field; the per-automation user_id is read off each row when
   *  needed (sender identity for outbound messages, log audit). */
  accountId: string
  triggerType: AutomationTriggerType
  contactId?: string | null
  context?: AutomationContext
}

/**
 * Fire all active automations matching the given trigger for an
 * account.
 *
 * Must never throw — callers use fire-and-forget from the webhook.
 * All errors are caught and logged; per-automation failures are
 * recorded into automation_logs with status='failed'.
 */
export async function runAutomationsForTrigger(input: DispatchInput): Promise<void> {

  console.log("[AUTOMATION] Dispatcher entered", {
    trigger: input.triggerType,
    accountId: input.accountId,
    contactId: input.contactId,
  });

  const limit = checkRateLimit(
    `automation:${input.accountId}`,
    RATE_LIMITS.automationDispatch
  )

  if (!limit.success) {
    console.warn(
      '[automations] rate limit exceeded',
      input.accountId
    )

    return
  }

  try {
    const db = supabaseAdmin()

    // Tenant isolation. `contactId` can be caller-supplied (the manual
    // POST /api/automations/engine entrypoint reads it straight from the
    // request body), and every step below runs through the service-role
    // client, which bypasses RLS. So before any step can touch the
    // contact, verify it actually belongs to this account. A foreign or
    // forged id is refused silently — callers are fire-and-forget, and a
    // distinct error would leak whether a given contact UUID exists.
    if (input.contactId) {
      const { data: owned, error: ownErr } = await db
        .from('contacts')
        .select('id')
        .eq('id', input.contactId)
        .eq('account_id', input.accountId)
        .maybeSingle()
      if (ownErr) {
        console.error('[automations] contact ownership check failed:', ownErr)
        return
      }
      if (!owned) {
        console.warn('[automations] contact not in account, refusing dispatch', input.contactId)
        return
      }
    }

    const { data: automations, error } = await db
      .from('automations')
      .select('*')
      .eq('account_id', input.accountId)
      .eq('trigger_type', input.triggerType)
      .eq('is_active', true)

    if (error) {
      console.error('[automations] fetch failed:', error)
      return
    }
    console.log(
      "[AUTOMATION] Found",
      automations?.length ?? 0,
      "automation(s) for",
      input.triggerType
    );

    if (!automations || automations.length === 0) return;

    for (const automation of automations as Automation[]) {
      if (!triggerMatches(automation, input.context)) continue
      try {
        await executeAutomation(automation, input)
      } catch (err) {
        console.error('[automations] execute failed:', automation.id, err)
      }
    }
  } catch (err) {
    console.error('[automations] dispatch failed:', err)
  }
}

/**
 * Resume a run that was parked at a wait step. Called from the cron
 * endpoint after it grabs a due `automation_pending_executions` row.
 */
export async function resumePendingExecution(pending: {
  id: string
  automation_id: string
  /** Audit-only; the automation row carries account_id for tenancy. */
  user_id: string
  /** Account-scoped lookups read from the automation row, so this
   *  field is just here to mirror the row shape and keep the cron's
   *  pass-through self-documenting. */
  account_id: string
  contact_id: string | null
  log_id: string | null
  parent_step_id: string | null
  branch: 'yes' | 'no' | null
  next_step_position: number
  context: AutomationContext
}): Promise<void> {

  console.log("[CRON] resumePendingExecution()", pending)

  const db = supabaseAdmin()

  console.log("[AUTOMATION] resumePendingExecution()", pending.id)
  const { data: pendingRow } = await db
    .from('automation_pending_executions')
    .select('attempt_count, max_attempts')
    .eq('id', pending.id)
    .single()

  const { data: automation, error } = await db
    .from('automations').select('*')
    .eq('id', pending.automation_id)
    .single()

  if (error || !automation) {
    console.error('[automations] resume: missing automation', pending.automation_id, error)
    await markPending(pending.id, 'failed')
    return
  }

  try {

    console.log(
      "[AUTOMATION] Resuming at position",
      pending.next_step_position
    )
    console.log("[RESUME DEBUG]", {
  resumed: true,
  contact: pending.contact_id,
  startPosition: pending.next_step_position,
  parentStepId: pending.parent_step_id,
  branch: pending.branch,
})

    await executeStepsFrom({
      automation: automation as Automation,
      contactId: pending.contact_id,
      context: pending.context ?? {},
      parentStepId: pending.parent_step_id,
      branch: pending.branch,
      startPosition: pending.next_step_position,
      logId: pending.log_id,
      startedAt: Date.now(),
      depth: 0,
      triggerEvent: 'resumed_wait',
      resumed: true,
    })

    console.log("[AUTOMATION] Resume completed")
    await markPending(pending.id, 'done')
  } catch (err) {
    console.error('[automations] resume failed:', err)

    const message =
      err instanceof Error ? err.message : String(err)

    const nextAttempt =
      (pendingRow?.attempt_count ?? 0) + 1

    const maxAttempts =
      pendingRow?.max_attempts ?? 5

    if (nextAttempt >= maxAttempts) {
      await markPending(pending.id, 'failed')
    } else {
      await scheduleRetry(
        pending.id,
        nextAttempt,
        message,
      )
    }
  }
}

export async function replayAutomation(params: {
  automationId: string
  contactId: string | null
  triggerEvent: AutomationTriggerType
  context?: AutomationContext
}): Promise<void> {
  const db = supabaseAdmin()

  const { data: automation, error } = await db
    .from('automations')
    .select('*')
    .eq('id', params.automationId)
    .single()

  if (error || !automation) {
    throw new Error('Automation not found')
  }

  await executeAutomation(
    automation as Automation,
    {
      accountId: automation.account_id,
      triggerType: params.triggerEvent,
      contactId: params.contactId,
      context: params.context ?? {},
    }
  )
}

// ------------------------------------------------------------
// Internal execution
// ------------------------------------------------------------

async function executeAutomation(automation: Automation, input: DispatchInput) {
  const db = supabaseAdmin()

  console.log("[AUTOMATION] executeAutomation()", {
    automationId: automation.id,
    automationName: automation.name,
    trigger: input.triggerType,
    contactId: input.contactId,
  })

  console.log("[AUTOMATION] inserting automation_logs");

  const { data: log, error: logErr } = await db
    .from('automation_logs')
    .insert({
      automation_id: automation.id,
      // Tenancy: matches automation.account_id (NOT NULL post-017).
      account_id: automation.account_id,
      // Audit: keeps the historical "author of this automation"
      // pointer so logs still attribute to the right user even
      // after teammates join the account.
      user_id: automation.user_id,
      contact_id: input.contactId ?? null,
      trigger_event: input.triggerType,
      steps_executed: [],
      status: 'success',
    })
    .select()
    .single()

  console.log("[AUTOMATION] log insert", {
    log,
    logErr,
  })

  console.log("[AUTOMATION] About to execute steps")

  await executeStepsFrom({
    automation,
    contactId: input.contactId ?? null,
    context: input.context ?? {},
    parentStepId: null,
    branch: null,
    startPosition: 0,
    logId: log.id,
    startedAt: Date.now(),
    depth: 0,
    triggerEvent: input.triggerType,
  })

  // Atomic counter update via the SQL function from migration 007.
  // Doing this with a client-side read-modify-write raced when the
  // same automation fired for two contacts simultaneously — both
  // would read N and both write N+1, losing one count permanently.
  const { error: rpcErr } = await db.rpc('increment_automation_execution_count', {
    p_automation_id: automation.id,
  })
  if (rpcErr) {
    console.error('[automations] increment counter failed:', rpcErr)
  }
}

interface ExecuteArgs {
  automation: Automation
  contactId: string | null
  context: AutomationContext
  parentStepId: string | null
  branch: 'yes' | 'no' | null
  startPosition: number
  logId: string | null
  triggerEvent: string
  startedAt: number
  depth: number

  resumed?: boolean
}

const MAX_STEPS_PER_RUN = 100
const MAX_EXECUTION_TIME_MS = 30_000
const MAX_BRANCH_DEPTH = 10

async function executeStepsFrom(args: ExecuteArgs): Promise<void> {
  const db = supabaseAdmin()

  if (args.depth > MAX_BRANCH_DEPTH) {
    await finalizeLog(
      args.logId,
      'failed',
      `Maximum automation depth exceeded (${MAX_BRANCH_DEPTH})`
    )

    return
  }

  if (Date.now() - args.startedAt > MAX_EXECUTION_TIME_MS) {
    await finalizeLog(
      args.logId,
      'failed',
      `Automation exceeded runtime limit (${MAX_EXECUTION_TIME_MS}ms)`
    )

    return
  }

  const baseQuery = db
    .from('automation_steps')
    .select('*')
    .eq('automation_id', args.automation.id)
    .gte('position', args.startPosition)
    .order('position', { ascending: true })

  const scoped =
    args.parentStepId === null
      ? baseQuery.is('parent_step_id', null)
      : baseQuery.eq('parent_step_id', args.parentStepId).eq('branch', args.branch ?? 'yes')

  const { data: steps, error: stepsErr } = await scoped

  console.log("[AUTOMATION] Steps fetched", {
    automation: args.automation.name,
    count: steps?.length ?? 0,
    steps,
    stepsErr,
  });

  if (stepsErr) {
    await finalizeLog(args.logId, 'failed', stepsErr.message)
    return
  }
  if (!steps || steps.length === 0) {
    if (args.parentStepId === null && args.logId) {
      await finalizeLog(args.logId, 'success', null)
    }
    return
  }

  if (steps.length > MAX_STEPS_PER_RUN) {
    await finalizeLog(
      args.logId,
      'failed',
      `Automation exceeded step limit (${MAX_STEPS_PER_RUN})`
    )

    return
  }

  const results: AutomationLogStepResult[] = []
  let status: 'success' | 'partial' | 'failed' = 'success'
  let errorMessage: string | null = null

  for (const step of steps as AutomationStep[]) {
    // `wait` is the suspension point: enqueue and stop processing this
    // scope. The cron endpoint will pick it up later.
    if (step.step_type === 'wait' && !args.resumed) {
      const cfg = step.step_config as WaitStepConfig
      const ms = waitMs(cfg)
      await db.from('automation_pending_executions').insert({
        automation_id: args.automation.id,
        // Tenancy: account_id required NOT NULL post-017.
        account_id: args.automation.account_id,
        user_id: args.automation.user_id,
        contact_id: args.contactId,
        log_id: args.logId,
        parent_step_id: args.parentStepId,
        branch: args.branch,
        next_step_position: step.position + 1,
        context: args.context,
        run_at: new Date(Date.now() + ms).toISOString(),
        status: 'pending',
      })
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail: `waiting ${cfg.amount} ${cfg.unit}`,
      })
      status = 'partial'
      await appendResults(args.logId, results, status, errorMessage)
      return
    }

    try {
      console.log("[AUTOMATION] Running step", {
        automation: args.automation.name,
        position: step.position,
        type: step.step_type,
        config: step.step_config,
      })

      console.log("[AUTOMATION] resumed =", args.resumed);

      if (step.step_type === 'condition') {
        const cfg = step.step_config as ConditionStepConfig
        const taken = await evaluateCondition(cfg, args)
        results.push({
          step_id: step.id,
          step_type: 'condition',
          status: 'success',
          detail: `branch=${taken ? 'yes' : 'no'}`,
        })
        // Recurse into the chosen branch at position 0 (children use their
        // own ordering within the branch scope).
        await executeStepsFrom({
          ...args,
          parentStepId: step.id,
          branch: taken ? 'yes' : 'no',
          startPosition: 0,
          logId: args.logId,
          depth: args.depth + 1,
        })
        continue
      }

      const detail = await runStep(step, args)
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail,
      })
    } catch (err) {

      console.error("[AUTOMATION ERROR]", {
        automation: args.automation.name,
        position: step.position,
        type: step.step_type,
        error: err,
      })

      const msg = err instanceof Error ? err.message : String(err)
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'failed',
        detail: msg,
      })
      status = 'failed'
      errorMessage = msg
      break
    }
  }

  if (args.parentStepId === null) {
    await appendResults(args.logId, results, status, errorMessage)
  } else {
    // Nested branch — just append results; parent scope decides final status.
    await appendResults(args.logId, results, null, errorMessage)
  }
}

async function runStep(step: AutomationStep, args: ExecuteArgs): Promise<string> {
  const db = supabaseAdmin()

  switch (step.step_type) {
    case 'send_message': {
  const cfg = step.step_config as SendMessageStepConfig

  console.log("[SEND_MESSAGE STEP]", {
    automation: args.automation.name,
    logId: args.logId,
    contact: args.contactId,
    text: cfg.text,
  })

      console.log("[SEND_MESSAGE] Entered", {
        contactId: args.contactId,
        automation: args.automation.name,
      });

      if (!args.contactId) throw new Error('send_message needs a contact')
      const text = interpolate(cfg.text, args)
      if (!text.trim()) throw new Error('send_message has empty text')
      const conversationId = await resolveConversationId(args)
    console.log("[SEND_MESSAGE] conversationId =", conversationId);
    console.log("[SEND_MESSAGE] About to call engineSendText");
      const { whatsapp_message_id } = await engineSendText({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        text,
      })

      console.log("[SEND_MESSAGE] Meta response =", whatsapp_message_id);

      return `sent via Meta (${whatsapp_message_id})`
    }

    case 'send_template': {
      const cfg = step.step_config as SendTemplateStepConfig
      if (!args.contactId) throw new Error('send_template needs a contact')
      if (!cfg.template_name) throw new Error('send_template needs template_name')
      const conversationId = await resolveConversationId(args)
      // Meta templates use positional {{1}}, {{2}}, … placeholders, so
      // we MUST emit params in strict numeric order. Lexicographic sort
      // of "1", "2", …, "10" yields "1", "10", "2", … which silently
      // scrambles every template with ≥10 variables.
      const params = cfg.variables
        ? Object.keys(cfg.variables)
          .sort((a, b) => {
            const na = Number(a)
            const nb = Number(b)
            const aNum = Number.isFinite(na)
            const bNum = Number.isFinite(nb)
            if (aNum && bNum) return na - nb
            if (aNum) return -1
            if (bNum) return 1
            return a.localeCompare(b)
          })
          .map((k) => String(cfg.variables![k]))
        : []
      const { whatsapp_message_id } = await engineSendTemplate({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        templateName: cfg.template_name,
        language: cfg.language,
        params,
      })
      return `template sent via Meta (${whatsapp_message_id})`
    }

    case 'add_tag': {
      // contact_tags has no account_id column; cross-tenant protection for
      // the attacker-supplied contactId comes from the ownership guard in
      // runAutomationsForTrigger.
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('add_tag needs contact + tag_id')
      await db
        .from('contact_tags')
        .upsert(
          { contact_id: args.contactId, tag_id: cfg.tag_id },
          { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
        )
      return `tag ${cfg.tag_id} added`
    }

    case 'remove_tag': {
      // See add_tag: tenant scoping relies on the runAutomationsForTrigger
      // ownership guard, since contact_tags carries no account_id.
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('remove_tag needs contact + tag_id')
      await db
        .from('contact_tags')
        .delete()
        .eq('contact_id', args.contactId)
        .eq('tag_id', cfg.tag_id)
      return `tag ${cfg.tag_id} removed`
    }

    case 'assign_conversation': {
      const cfg = step.step_config as AssignConversationStepConfig
      if (!args.contactId) throw new Error('assign_conversation needs a contact')
      let agentId = cfg.agent_id
      if (cfg.mode === 'round_robin') {
        // Pick any member of the account. The existing implementation
        // only ever returned the automation's author; preserving that
        // shape until a real round-robin algorithm replaces it.
        const { data: profiles } = await db
          .from('profiles')
          .select('user_id')
          .eq('account_id', args.automation.account_id)
          .limit(1)
        agentId = profiles?.[0]?.user_id
      }
      if (!agentId) return 'no agent resolved'
      await db
        .from('conversations')
        .update({ assigned_agent_id: agentId })
        .eq('account_id', args.automation.account_id)
        .eq('contact_id', args.contactId)
      return `assigned to ${agentId}`
    }

    case 'update_contact_field': {
      const cfg = step.step_config as UpdateContactFieldStepConfig
      if (!args.contactId) throw new Error('update_contact_field needs a contact')
      const allowed = new Set(['name', 'email', 'company'])
      if (!allowed.has(cfg.field)) {
        return `field ${cfg.field} not writable from automations`
      }
      // Defense in depth: scope the service-role write to the account so
      // a future caller that skips the entry-point ownership guard still
      // cannot write across tenants.
      await db
        .from('contacts')
        .update({ [cfg.field]: cfg.value, updated_at: new Date().toISOString() })
        .eq('id', args.contactId)
        .eq('account_id', args.automation.account_id)
      return `${cfg.field} updated`
    }

    case 'create_deal': {
      const cfg = step.step_config as CreateDealStepConfig

      if (!args.contactId) {
  throw new Error("create_deal needs contact")
}

      if (!cfg.pipeline_id || !cfg.stage_id) {
        throw new Error('create_deal needs pipeline + stage')
      }

      const existingDeal = await db
  .from('deals')
  .select('id')
  .eq('account_id', args.automation.account_id)
  .eq('contact_id', args.contactId)
  .eq('pipeline_id', cfg.pipeline_id)
  .eq('status', 'open')
  .limit(1)
  .maybeSingle()

      if (existingDeal.data) {
        return 'deal already exists'
      }

      console.log("[CREATE_DEAL]", {
  contact: args.contactId,
  pipeline: cfg.pipeline_id,
  stage: cfg.stage_id,
})

const { error } = await db
  .from('deals')
  .insert({
    account_id: args.automation.account_id,
    user_id: args.automation.user_id,
    pipeline_id: cfg.pipeline_id,
    stage_id: cfg.stage_id,
    contact_id: args.contactId,
    title: interpolate(cfg.title, args),
    value: cfg.value ?? 0,
    status: 'open',
  })

if (error) {
  throw error
}

console.log("[CREATE_DEAL] success")

return "deal created"
    }


    case 'create_task': {
      const cfg = step.step_config as any

      const dueAt =
        cfg.due_in_minutes
          ? new Date(
            Date.now() + cfg.due_in_minutes * 60 * 1000
          ).toISOString()
          : null

      const existingTask = await db
        .from('tasks')
        .select('id')
        .eq('contact_id', args.contactId)
        .eq('status', 'pending')
        .eq(
          'title',
          interpolate(cfg.title ?? 'Follow Up', args)
        )
        .limit(1)
        .maybeSingle()

      if (existingTask.data) {
        return 'task already exists'
      }

      const { data, error } = await db
        .from('tasks')
        .insert({
          account_id: args.automation.account_id,
          created_by: args.automation.user_id,
          contact_id: args.contactId ?? null,
          conversation_id:
            args.context.conversation_id ?? null,
          title: interpolate(
            cfg.title ?? 'Follow Up',
            args
          ),
          description: cfg.description
            ? interpolate(cfg.description, args)
            : null,
          priority: cfg.priority ?? 'medium',
          status: 'pending',
          due_at: dueAt,
          assigned_to:
            cfg.assigned_to &&
              String(cfg.assigned_to).trim() !== ''
              ? cfg.assigned_to
              : null,
        })
        .select()
        .single()

      if (error) {
        throw new Error(error.message)
      }

      return `task created (${data.id})`
    }

    case 'send_webhook': {
      const cfg = step.step_config as SendWebhookStepConfig
      if (!cfg.url) throw new Error('send_webhook needs url')
      const body = cfg.body_template ? interpolate(cfg.body_template, args) : JSON.stringify(args.context)
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.headers ?? {}) },
        body,
      })
      if (!res.ok) throw new Error(`webhook returned ${res.status}`)
      return `webhook ${res.status}`
    }

    case 'close_conversation': {
      if (!args.contactId) throw new Error('close_conversation needs a contact')
      await db
        .from('conversations')
        .update({ status: 'closed', updated_at: new Date().toISOString() })
        .eq('account_id', args.automation.account_id)
        .eq('contact_id', args.contactId)
      return 'conversation closed'
    }

    default:
      return `unknown step: ${step.step_type}`
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * Pick the conversation a send-type step should use. Prefer the id the
 * webhook handed us (it's the one that just got the inbound message);
 * fall back to the contact's conversation for resumed/wait paths and
 * manual engine POSTs. Throws if none exists — send steps have
 * no meaningful target without a conversation.
 */
async function resolveConversationId(args: ExecuteArgs): Promise<string> {
  const fromCtx = args.context.conversation_id
  if (fromCtx) return fromCtx
  if (!args.contactId) throw new Error('cannot resolve conversation: no contact')
  const { data, error } = await supabaseAdmin()
    .from('conversations')
    .select('id')
    .eq('account_id', args.automation.account_id)
    .eq('contact_id', args.contactId)
    .maybeSingle()
  if (error) throw new Error(`conversation lookup failed: ${error.message}`)
  if (!data?.id) throw new Error('no conversation for contact')
  return data.id as string
}

function triggerMatches(
  automation: Automation,
  ctx: AutomationContext | undefined,
): boolean {

  if (automation.trigger_type === 'keyword_match') {

    const cfg =
      automation.trigger_config as KeywordMatchTriggerConfig

    if (!cfg?.keywords || cfg.keywords.length === 0) {
      return false
    }

    const text =
      (ctx?.message_text ?? '').toString()

    if (!text) {
      return false
    }

    const haystack =
      cfg.case_sensitive
        ? text
        : text.toLowerCase()

    return cfg.keywords.some((raw) => {
      const k =
        cfg.case_sensitive
          ? raw
          : raw.toLowerCase()

      return cfg.match_type === 'exact'
        ? haystack === k
        : haystack.includes(k)
    })
  }

  if (automation.trigger_type === 'tag_added') {

    const cfg =
      automation.trigger_config as {
        tag_id?: string
      }

    return (
      !!cfg.tag_id &&
      cfg.tag_id === ctx?.tag_id
    )
  }

  return true
}

async function evaluateCondition(cfg: ConditionStepConfig, args: ExecuteArgs): Promise<boolean> {
  const db = supabaseAdmin()
  switch (cfg.subject) {
    case 'tag_presence': {
      if (!args.contactId || !cfg.operand) return false
      // contact_tags has no account_id column (its RLS keys off the parent
      // contact), so tenant scoping here relies on the contact-ownership
      // guard in runAutomationsForTrigger.
      const { count } = await db
        .from('contact_tags')
        .select('id', { count: 'exact', head: true })
        .eq('contact_id', args.contactId)
        .eq('tag_id', cfg.operand)
      return (count ?? 0) > 0
    }
    case 'contact_field': {
      if (!args.contactId || !cfg.operand) return false
      // Scope to the account so the condition can't be turned into a
      // cross-tenant read oracle via the service-role client.
      const { data } = await db
        .from('contacts')
        .select(cfg.operand)
        .eq('id', args.contactId)
        .eq('account_id', args.automation.account_id)
        .maybeSingle()
      const v = (data as Record<string, unknown> | null)?.[cfg.operand]
      return v != null && String(v) === String(cfg.value ?? '')
    }
    case 'message_content': {
      const text = (args.context.message_text ?? '').toString()
      return text.toLowerCase().includes((cfg.value ?? '').toLowerCase())
    }
    case 'time_of_day': {
      // operand form "HH:mm-HH:mm" — true if now is within that window
      // (supports over-midnight ranges like "18:00-09:00").
      const [from, to] = (cfg.operand ?? '').split('-')
      if (!from || !to) return false
      const now = new Date()
      const mins = now.getHours() * 60 + now.getMinutes()
      const parse = (s: string) => {
        const [h, m] = s.split(':').map(Number)
        return (h || 0) * 60 + (m || 0)
      }
      const f = parse(from)
      const t = parse(to)
      return f <= t ? mins >= f && mins < t : mins >= f || mins < t
    }
    default:
      return false
  }
}

function waitMs(cfg: WaitStepConfig): number {
  const unitMs = cfg.unit === 'days' ? 86_400_000 : cfg.unit === 'hours' ? 3_600_000 : 60_000
  return Math.max(1_000, cfg.amount * unitMs)
}

function interpolate(s: string, args: ExecuteArgs): string {
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const [ns, prop] = String(key).split('.')
    if (ns === 'message' && prop === 'text') return String(args.context.message_text ?? '')
    if (ns === 'vars' && prop) return String(args.context.vars?.[prop] ?? '')
    return ''
  })
}

async function appendResults(
  logId: string | null,
  newItems: AutomationLogStepResult[],
  status: 'success' | 'partial' | 'failed' | null,
  errorMessage: string | null,
) {
  if (!logId) return

  const db = supabaseAdmin()

  const { data: existing } = await db
    .from('automation_logs')
    .select('steps_executed, status')
    .eq('id', logId)
    .single()

  const merged = [
    ...((existing?.steps_executed as AutomationLogStepResult[] | undefined) ?? []),
    ...newItems,
  ]

  const update: Record<string, unknown> = {
    steps_executed: merged,
  }

  if (status !== null) {
    update.status = status
  }

  if (errorMessage) {
    update.error_message = errorMessage
  }

  await db
    .from('automation_logs')
    .update(update)
    .eq('id', logId)
}

async function finalizeLog(
  logId: string | null,
  status: 'success' | 'partial' | 'failed',
  errorMessage: string | null,
) {
  if (!logId) return

  const db = supabaseAdmin()

  await db
    .from('automation_logs')
    .update({
      status,
      error_message: errorMessage,
    })
    .eq('id', logId)

  // Supervisor Layer
  if (status === 'failed') {
    const { data: log } = await db
      .from('automation_logs')
      .select('*')
      .eq('id', logId)
      .single()

    if (log?.account_id) {
      if (status === 'failed') {

        const { data: existingTask } = await db
          .from('tasks')
          .select('id')
          .eq('contact_id', log.contact_id)
          .eq('title', 'Automation Failure')
          .eq('status', 'pending')
          .maybeSingle()

        if (!existingTask) {

          await db
            .from('tasks')
            .insert({
              account_id: log.account_id,
              created_by: log.user_id,
              contact_id: log.contact_id,
              title: 'Automation Failure',
              description:
                errorMessage ??
                'Automation failed. Check automation logs.',
              priority: 'high',
              status: 'pending',
            })

        } // if (!existingTask)

      } // inner if (status === 'failed')

    } // if (log?.account_id)

  } // outer if (status === 'failed')

} // finalizeLog function

function getRetryDelayMinutes(attempt: number): number {
  const delays = [1, 5, 15, 60, 360]

  return delays[Math.min(attempt - 1, delays.length - 1)]
}

async function scheduleRetry(
  id: string,
  attemptCount: number,
  errorMessage: string,
) {
  const delayMinutes = getRetryDelayMinutes(attemptCount)

  await supabaseAdmin()
    .from('automation_pending_executions')
    .update({
      status: 'pending',
      attempt_count: attemptCount,
      last_error: errorMessage,
      failed_at: new Date().toISOString(),
      run_at: new Date(
        Date.now() + delayMinutes * 60 * 1000,
      ).toISOString(),
    })
    .eq('id', id)
}

async function markPending(id: string, status: 'done' | 'failed') {
  await supabaseAdmin()
    .from('automation_pending_executions')
    .update({ status })
    .eq('id', id)
}
