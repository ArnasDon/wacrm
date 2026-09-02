/**
 * Contacts, tags, custom fields, conversations, messages.
 *
 * Note on `user_id`: migration 017 stopped using it for tenancy — it
 * now identifies "the agent who owns this row" for assignment and audit
 * only. Isolation is `account_id`. Both columns are carried forward
 * with that split intact, so Phase 3's access layer must filter on
 * `account_id` and never on `user_id`.
 */
import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { id, timestamp, timestampNow, timestamps } from './_shared'
import { accounts, profiles } from './accounts'
import { user } from './auth'

export const contacts = sqliteTable(
  'contacts',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    phone: text('phone').notNull(),
    /**
     * E.164-normalised phone, added in migration 022 to dedupe contacts
     * that differ only by formatting. Postgres backfilled it with a
     * regexp_replace; the port computes it in application code on write.
     */
    phoneNormalized: text('phone_normalized'),
    name: text('name'),
    email: text('email'),
    company: text('company'),
    avatarUrl: text('avatar_url'),
    ...timestamps,
  },
  (t) => [
    index('idx_contacts_account').on(t.accountId),
    index('idx_contacts_phone').on(t.phone),
    /** Migration 022: one contact per normalised number per account. */
    uniqueIndex('idx_contacts_account_phone_normalized')
      .on(t.accountId, t.phoneNormalized)
      .where(sql`phone_normalized IS NOT NULL`),
  ],
)

export const tags = sqliteTable(
  'tags',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#3b82f6'),
    createdAt: timestampNow('created_at'),
  },
  (t) => [index('idx_tags_account').on(t.accountId)],
)

export const contactTags = sqliteTable(
  'contact_tags',
  {
    id: id(),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    uniqueIndex('idx_contact_tags_unique').on(t.contactId, t.tagId),
    index('idx_contact_tags_contact').on(t.contactId),
    index('idx_contact_tags_tag').on(t.tagId),
  ],
)

export const customFields = sqliteTable(
  'custom_fields',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    fieldName: text('field_name').notNull(),
    fieldType: text('field_type').notNull().default('text'),
    fieldOptions: text('field_options', { mode: 'json' }).$type<unknown>(),
    createdAt: timestampNow('created_at'),
  },
  (t) => [index('idx_custom_fields_account').on(t.accountId)],
)

export const contactCustomValues = sqliteTable(
  'contact_custom_values',
  {
    id: id(),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    customFieldId: text('custom_field_id')
      .notNull()
      .references(() => customFields.id, { onDelete: 'cascade' }),
    value: text('value'),
    createdAt: timestampNow('created_at'),
  },
  (t) => [uniqueIndex('idx_contact_custom_values_unique').on(t.contactId, t.customFieldId)],
)

export const contactNotes = sqliteTable(
  'contact_notes',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    noteText: text('note_text').notNull(),
    createdAt: timestampNow('created_at'),
  },
  (t) => [index('idx_contact_notes_account').on(t.accountId)],
)

export const conversations = sqliteTable(
  'conversations',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('open'),
    assignedAgentId: text('assigned_agent_id'),
    lastMessageText: text('last_message_text'),
    lastMessageAt: timestamp('last_message_at'),
    unreadCount: integer('unread_count').notNull().default(0),
    /** AI reply columns, migrations 029 / 033. */
    aiAutoreplyDisabled: integer('ai_autoreply_disabled', { mode: 'boolean' })
      .notNull()
      .default(false),
    aiReplyCount: integer('ai_reply_count').notNull().default(0),
    aiHandoffSummary: text('ai_handoff_summary'),
    ...timestamps,
  },
  (t) => [
    index('idx_conversations_account').on(t.accountId),
    index('idx_conversations_contact_id').on(t.contactId),
    check('conversations_status_check', sql`${t.status} IN ('open', 'pending', 'closed')`),
  ],
)

export const messages = sqliteTable(
  'messages',
  {
    id: id(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderType: text('sender_type').notNull(),
    senderId: text('sender_id'),
    contentType: text('content_type').notNull().default('text'),
    contentText: text('content_text'),
    mediaUrl: text('media_url'),
    /** Migration 039 — MIME type of mirrored inbound media. */
    mediaType: text('media_type'),
    templateName: text('template_name'),
    messageId: text('message_id'),
    status: text('status').notNull().default('sent'),
    /**
     * Self-reference for quoted replies (migration 009). Declared
     * without `.references()` because Drizzle cannot express a
     * self-FK inline; the constraint is added in the generated SQL.
     */
    replyToMessageId: text('reply_to_message_id'),
    /** Interactive button/list replies, migration 035. */
    interactiveReplyId: text('interactive_reply_id'),
    interactivePayload: text('interactive_payload', { mode: 'json' }).$type<unknown>(),
    /** Migration 029 — flags a message the AI composed. */
    aiGenerated: integer('ai_generated', { mode: 'boolean' }).notNull().default(false),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    index('idx_messages_conversation').on(t.conversationId),
    index('idx_messages_message_id').on(t.messageId),
    check(
      'messages_sender_type_check',
      sql`${t.senderType} IN ('customer', 'agent', 'bot')`,
    ),
    check(
      'messages_content_type_check',
      sql`${t.contentType} IN ('text', 'image', 'document', 'audio', 'video', 'location', 'template')`,
    ),
    check(
      'messages_status_check',
      sql`${t.status} IN ('sending', 'sent', 'delivered', 'read', 'failed')`,
    ),
  ],
)

export const messageReactions = sqliteTable(
  'message_reactions',
  {
    id: id(),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    emoji: text('emoji').notNull(),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    uniqueIndex('idx_message_reactions_unique').on(t.messageId, t.actorType, t.actorId),
    check('message_reactions_actor_type_check', sql`${t.actorType} IN ('customer', 'agent')`),
  ],
)

export const quickReplies = sqliteTable(
  'quick_replies',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** Author / audit only — never used for tenancy isolation. */
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /**
     * 'text' snippets carry `content_text`; 'interactive' snippets carry
     * `interactive_payload`, validated app-side against Meta's limits.
     */
    kind: text('kind').notNull().default('text'),
    contentText: text('content_text'),
    interactivePayload: text('interactive_payload', { mode: 'json' }).$type<unknown>(),
    ...timestamps,
  },
  (t) => [
    index('idx_quick_replies_account').on(t.accountId),
    check('quick_replies_kind_check', sql`${t.kind} IN ('text', 'interactive')`),
  ],
)

export const notifications = sqliteTable(
  'notifications',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type').notNull().default('conversation_assigned'),
    conversationId: text('conversation_id').references(() => conversations.id, {
      onDelete: 'cascade',
    }),
    contactId: text('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    body: text('body'),
    readAt: timestamp('read_at'),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    index('idx_notifications_user_unread').on(t.userId, t.readAt),
    check('notifications_type_check', sql`${t.type} IN ('conversation_assigned')`),
  ],
)

export const pipelines = sqliteTable(
  'pipelines',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestampNow('created_at'),
  },
  (t) => [index('idx_pipelines_account').on(t.accountId)],
)

export const pipelineStages = sqliteTable(
  'pipeline_stages',
  {
    id: id(),
    pipelineId: text('pipeline_id')
      .notNull()
      .references(() => pipelines.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    color: text('color').notNull().default('#3b82f6'),
    createdAt: timestampNow('created_at'),
  },
  (t) => [index('idx_pipeline_stages_pipeline').on(t.pipelineId)],
)

export const deals = sqliteTable(
  'deals',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    pipelineId: text('pipeline_id')
      .notNull()
      .references(() => pipelines.id, { onDelete: 'cascade' }),
    stageId: text('stage_id')
      .notNull()
      .references(() => pipelineStages.id),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id),
    conversationId: text('conversation_id').references(() => conversations.id),
    /** Migration 002 — agent this deal is assigned to. */
    assignedTo: text('assigned_to').references(() => profiles.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    /**
     * Was `NUMERIC(12,2)`. SQLite has no exact-decimal type, and REAL
     * would introduce float error on money. Stored as an INTEGER count
     * of minor units (cents); formatting and parsing happen at the
     * boundary. A migration of existing rows must multiply by 100.
     */
    valueMinor: integer('value_minor').notNull().default(0),
    currency: text('currency').default('USD'),
    notes: text('notes'),
    /** Was `DATE`. Stored as an ISO `YYYY-MM-DD` string — no time component intended. */
    expectedCloseDate: text('expected_close_date'),
    status: text('status').default('active'),
    ...timestamps,
  },
  (t) => [
    index('idx_deals_account').on(t.accountId),
    index('idx_deals_pipeline').on(t.pipelineId),
    index('idx_deals_stage').on(t.stageId),
  ],
)
