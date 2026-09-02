/**
 * WhatsApp configuration, message templates, broadcasts.
 *
 * The broadcast counter columns (`sent_count`, `delivered_count`, …)
 * were maintained in Postgres by the `broadcast_recipient_aggregate_trigger`
 * / `_bcast_bump` trigger pair from migration 005, which incremented
 * them on every recipient status change. That logic moves into the
 * application — see `docs/d1-migration/postgres-function-inventory.md`
 * for why, and for the reconciliation path that replaces
 * `recompute_broadcast_counts()`.
 */
import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { id, timestamp, timestampNow, timestamps } from './_shared'
import { accounts } from './accounts'
import { user } from './auth'
import { contacts } from './crm'

export const whatsappConfig = sqliteTable(
  'whatsapp_config',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .unique()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    phoneNumberId: text('phone_number_id').notNull(),
    wabaId: text('waba_id'),
    /** AES-256-GCM encrypted at the application layer, as before. */
    accessToken: text('access_token').notNull(),
    verifyToken: text('verify_token'),
    status: text('status').notNull().default('disconnected'),
    connectedAt: timestamp('connected_at'),
    /** Registration state, migration 015. */
    registeredAt: timestamp('registered_at'),
    subscribedAppsAt: timestamp('subscribed_apps_at'),
    lastRegistrationError: text('last_registration_error'),
    /** Migration 039 — whether to mirror inbound media into our own storage. */
    mirrorInboundMedia: integer('mirror_inbound_media', { mode: 'boolean' })
      .notNull()
      .default(true),
    ...timestamps,
  },
  (t) => [
    /** Migration 013 — a phone number may only be claimed once globally. */
    uniqueIndex('idx_whatsapp_config_phone_number_id').on(t.phoneNumberId),
    check('whatsapp_config_status_check', sql`${t.status} IN ('connected', 'disconnected')`),
  ],
)

export const messageTemplates = sqliteTable(
  'message_templates',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category').notNull().default('Marketing'),
    language: text('language').default('en_US'),
    headerType: text('header_type'),
    headerContent: text('header_content'),
    bodyText: text('body_text').notNull(),
    footerText: text('footer_text'),
    buttons: text('buttons', { mode: 'json' }).$type<unknown>(),
    status: text('status').default('Draft'),
    /** Meta integration columns, migration 014. */
    metaTemplateId: text('meta_template_id'),
    sampleValues: text('sample_values', { mode: 'json' }).$type<unknown>(),
    headerHandle: text('header_handle'),
    headerMediaUrl: text('header_media_url'),
    qualityScore: text('quality_score'),
    rejectionReason: text('rejection_reason'),
    submissionError: text('submission_error'),
    lastSubmittedAt: timestamp('last_submitted_at'),
    ...timestamps,
  },
  (t) => [
    index('idx_message_templates_account').on(t.accountId),
    check(
      'message_templates_category_check',
      sql`${t.category} IN ('Marketing', 'Utility', 'Authentication')`,
    ),
    check(
      'message_templates_header_type_check',
      sql`${t.headerType} IS NULL OR ${t.headerType} IN ('text', 'image', 'video', 'document')`,
    ),
    check(
      'message_templates_status_check',
      sql`${t.status} IN ('Draft', 'Pending', 'Approved', 'Rejected')`,
    ),
  ],
)

export const broadcasts = sqliteTable(
  'broadcasts',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    templateName: text('template_name').notNull(),
    templateLanguage: text('template_language').notNull().default('en_US'),
    templateVariables: text('template_variables', { mode: 'json' }).$type<unknown>(),
    audienceFilter: text('audience_filter', { mode: 'json' }).$type<unknown>(),
    scheduledAt: timestamp('scheduled_at'),
    status: text('status').notNull().default('draft'),
    /**
     * Counters, maintained by the application rather than the Postgres
     * trigger from migration 005.
     */
    totalRecipients: integer('total_recipients').notNull().default(0),
    sentCount: integer('sent_count').notNull().default(0),
    deliveredCount: integer('delivered_count').notNull().default(0),
    readCount: integer('read_count').notNull().default(0),
    repliedCount: integer('replied_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    /**
     * Migration 038 — held by whichever worker is mid-send, so a resumed
     * or concurrent run cannot double-send. The lock is advisory and
     * time-based; the sender clears it on completion.
     */
    deliveryLockedAt: timestamp('delivery_locked_at'),
    ...timestamps,
  },
  (t) => [
    index('idx_broadcasts_account').on(t.accountId),
    check(
      'broadcasts_status_check',
      sql`${t.status} IN ('draft', 'scheduled', 'sending', 'sent', 'failed')`,
    ),
  ],
)

export const broadcastRecipients = sqliteTable(
  'broadcast_recipients',
  {
    id: id(),
    broadcastId: text('broadcast_id')
      .notNull()
      .references(() => broadcasts.id, { onDelete: 'cascade' }),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id),
    status: text('status').notNull().default('pending'),
    /** Migration 003 — the wamid Meta returns, for status callback matching. */
    whatsappMessageId: text('whatsapp_message_id'),
    /** Migration 035 — per-recipient template variable values. */
    templateParams: text('template_params', { mode: 'json' }).$type<unknown>(),
    sentAt: timestamp('sent_at'),
    deliveredAt: timestamp('delivered_at'),
    readAt: timestamp('read_at'),
    repliedAt: timestamp('replied_at'),
    errorMessage: text('error_message'),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    index('idx_broadcast_recipients_broadcast').on(t.broadcastId),
    index('idx_broadcast_recipients_wamid').on(t.whatsappMessageId),
    check(
      'broadcast_recipients_status_check',
      sql`${t.status} IN ('pending', 'sent', 'delivered', 'read', 'replied', 'failed')`,
    ),
  ],
)

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    /** Display only, e.g. "wacrm_live_a1b2c3d4". */
    keyPrefix: text('key_prefix').notNull(),
    /** SHA-256 hex of the full plaintext key. */
    keyHash: text('key_hash').notNull().unique(),
    /** Was `text[]`. JSON array now — see `_shared.ts`. */
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull().default([]),
    lastUsedAt: timestamp('last_used_at'),
    /** NULL = never expires. */
    expiresAt: timestamp('expires_at'),
    /** NULL = active. */
    revokedAt: timestamp('revoked_at'),
    createdAt: timestampNow('created_at'),
  },
  (t) => [index('idx_api_keys_account').on(t.accountId)],
)

export const webhookEndpoints = sqliteTable(
  'webhook_endpoints',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    url: text('url').notNull(),
    /** AES-256-GCM-encrypted HMAC signing secret. */
    secret: text('secret').notNull(),
    /** Was `text[]`. JSON array now. */
    events: text('events', { mode: 'json' }).$type<string[]>().notNull().default([]),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    lastDeliveryAt: timestamp('last_delivery_at'),
    /** Consecutive failures; reset to 0 on success. */
    failureCount: integer('failure_count').notNull().default(0),
    createdAt: timestampNow('created_at'),
  },
  (t) => [index('idx_webhook_endpoints_account').on(t.accountId)],
)
