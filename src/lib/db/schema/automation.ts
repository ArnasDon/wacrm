/**
 * Automations (linear step lists with condition branches) and flows
 * (the node-graph builder).
 *
 * `increment_automation_execution_count` / `increment_flow_execution_count`
 * were Postgres RPCs doing an atomic `UPDATE ... SET n = n + 1`. In D1
 * the same statement is written directly by the runner — SQLite applies
 * a single UPDATE atomically, so no function is needed. See
 * `docs/d1-migration/postgres-function-inventory.md`.
 */
import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { id, timestamp, timestampNow, timestamps } from './_shared'
import { accounts } from './accounts'
import { user } from './auth'
import { contacts, conversations, messages } from './crm'

export const automations = sqliteTable(
  'automations',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    triggerType: text('trigger_type').notNull(),
    triggerConfig: text('trigger_config', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
    executionCount: integer('execution_count').notNull().default(0),
    lastExecutedAt: timestamp('last_executed_at'),
    ...timestamps,
  },
  (t) => [
    index('idx_automations_account').on(t.accountId),
    index('idx_automations_active_trigger').on(t.triggerType).where(sql`is_active = 1`),
  ],
)

/**
 * Steps form a shallow tree: `parent_step_id` is NULL for root-level
 * steps and set to a Condition step's id for steps inside one of its
 * branches; `branch` says which ('yes' / 'no'). `position` orders
 * siblings within their scope.
 */
export const automationSteps = sqliteTable(
  'automation_steps',
  {
    id: id(),
    automationId: text('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    /** Self-FK; emitted in the generated SQL rather than inline. */
    parentStepId: text('parent_step_id'),
    branch: text('branch'),
    stepType: text('step_type').notNull(),
    stepConfig: text('step_config', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    position: integer('position').notNull(),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    index('idx_automation_steps_automation_id').on(t.automationId, t.position),
    index('idx_automation_steps_parent')
      .on(t.parentStepId)
      .where(sql`parent_step_id IS NOT NULL`),
    check('automation_steps_branch_check', sql`${t.branch} IS NULL OR ${t.branch} IN ('yes', 'no')`),
  ],
)

export const automationLogs = sqliteTable(
  'automation_logs',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    automationId: text('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** SET NULL, not CASCADE — deleting a contact must not erase the audit trail. */
    contactId: text('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    triggerEvent: text('trigger_event').notNull(),
    stepsExecuted: text('steps_executed', { mode: 'json' }).$type<unknown[]>().notNull().default([]),
    status: text('status').notNull(),
    errorMessage: text('error_message'),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    index('idx_automation_logs_automation').on(t.automationId, t.createdAt),
    index('idx_automation_logs_account').on(t.accountId),
    check('automation_logs_status_check', sql`${t.status} IN ('success', 'partial', 'failed')`),
  ],
)

/** Delayed steps waiting for the cron to pick them up. */
export const automationPendingExecutions = sqliteTable(
  'automation_pending_executions',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    automationId: text('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    contactId: text('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    logId: text('log_id').references(() => automationLogs.id, { onDelete: 'cascade' }),
    parentStepId: text('parent_step_id').references(() => automationSteps.id, {
      onDelete: 'set null',
    }),
    branch: text('branch'),
    nextStepPosition: integer('next_step_position').notNull(),
    context: text('context', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: text('status').notNull().default('pending'),
    runAt: integer('run_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    index('idx_automation_pending_account').on(t.accountId),
    index('idx_automation_pending_due').on(t.status, t.runAt),
    check(
      'automation_pending_status_check',
      sql`${t.status} IN ('pending', 'running', 'done', 'failed')`,
    ),
    check(
      'automation_pending_branch_check',
      sql`${t.branch} IS NULL OR ${t.branch} IN ('yes', 'no')`,
    ),
  ],
)

export const flows = sqliteTable(
  'flows',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('draft'),
    triggerType: text('trigger_type').notNull(),
    triggerConfig: text('trigger_config', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /**
     * References `flow_nodes.node_key` (a string, not the row id). NULL
     * while authoring; required before activation, enforced by the
     * validator rather than the schema so drafts can save.
     */
    entryNodeId: text('entry_node_id'),
    fallbackPolicy: text('fallback_policy', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({
        on_unknown_reply: 'reprompt',
        max_reprompts: 2,
        on_timeout_hours: 24,
        on_exhaust: 'handoff',
      }),
    executionCount: integer('execution_count').notNull().default(0),
    lastExecutedAt: timestamp('last_executed_at'),
    ...timestamps,
  },
  (t) => [
    index('idx_flows_account').on(t.accountId),
    index('idx_flows_active_trigger')
      .on(t.accountId, t.triggerType)
      .where(sql`status = 'active'`),
    check('flows_status_check', sql`${t.status} IN ('draft', 'active', 'archived')`),
    check(
      'flows_trigger_type_check',
      sql`${t.triggerType} IN ('keyword', 'first_inbound_message', 'manual')`,
    ),
  ],
)

export const flowNodes = sqliteTable(
  'flow_nodes',
  {
    id: id(),
    flowId: text('flow_id')
      .notNull()
      .references(() => flows.id, { onDelete: 'cascade' }),
    nodeKey: text('node_key').notNull(),
    nodeType: text('node_type').notNull(),
    config: text('config', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    positionX: integer('position_x').notNull().default(0),
    positionY: integer('position_y').notNull().default(0),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    uniqueIndex('idx_flow_nodes_flow_key').on(t.flowId, t.nodeKey),
    index('idx_flow_nodes_flow').on(t.flowId),
    check(
      'flow_nodes_node_type_check',
      sql`${t.nodeType} IN ('start', 'send_buttons', 'send_list', 'send_message', 'collect_input', 'condition', 'set_tag', 'handoff', 'http_fetch', 'end')`,
    ),
  ],
)

export const flowRuns = sqliteTable(
  'flow_runs',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    flowId: text('flow_id')
      .notNull()
      .references(() => flows.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    contactId: text('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    conversationId: text('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull().default('active'),
    currentNodeKey: text('current_node_key'),
    lastPromptMessageId: text('last_prompt_message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    /** Captured collect_input values plus http_fetch responses. */
    vars: text('vars', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    repromptCount: integer('reprompt_count').notNull().default(0),
    startedAt: timestampNow('started_at'),
    lastAdvancedAt: timestampNow('last_advanced_at'),
    endedAt: timestamp('ended_at'),
    endReason: text('end_reason'),
  },
  (t) => [
    index('idx_flow_runs_account').on(t.accountId),
    /**
     * At most one active run per contact per account (migration 017).
     * Preserved as a partial unique index — SQLite supports the
     * `WHERE` clause.
     */
    uniqueIndex('idx_one_active_run_per_contact')
      .on(t.accountId, t.contactId)
      .where(sql`status = 'active'`),
    check(
      'flow_runs_status_check',
      sql`${t.status} IN ('active', 'completed', 'handed_off', 'timed_out', 'paused_by_agent', 'failed')`,
    ),
  ],
)

export const flowRunEvents = sqliteTable(
  'flow_run_events',
  {
    id: id(),
    flowRunId: text('flow_run_id')
      .notNull()
      .references(() => flowRuns.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    nodeKey: text('node_key'),
    payload: text('payload', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    index('idx_flow_run_events_run').on(t.flowRunId, t.createdAt),
    check(
      'flow_run_events_event_type_check',
      sql`${t.eventType} IN ('started', 'node_entered', 'message_sent', 'reply_received', 'fallback_fired', 'handoff', 'timeout', 'error', 'completed')`,
    ),
  ],
)
