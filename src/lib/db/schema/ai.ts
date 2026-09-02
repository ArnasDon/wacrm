/**
 * AI reply configuration, knowledge base, usage log.
 *
 * This is where the port diverges most from Postgres. Migration 030
 * gave `ai_knowledge_chunks` two search columns SQLite cannot express:
 *
 *   fts       tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED
 *   embedding vector(1536)
 *
 * Replacements:
 *
 *   - Lexical search moves to an FTS5 virtual table
 *     (`ai_knowledge_chunks_fts`), created in the migration SQL rather
 *     than here — Drizzle has no builder for FTS5 virtual tables or
 *     their sync triggers. It is declared in
 *     `drizzle/0001_fts5.sql` and kept in sync with the base table by
 *     three SQLite triggers.
 *
 *   - Semantic search moves to Cloudflare Vectorize, which lives
 *     outside D1 entirely. `embedding` therefore has no column here;
 *     the chunk's row id is the Vectorize vector id, and the binding is
 *     queried alongside D1 rather than joined to it.
 *
 * That split means a chunk write touches two stores with no shared
 * transaction. `vectorized_at` below records whether the Vectorize
 * upsert succeeded, so the reindex job can find and repair chunks that
 * landed in D1 but not in Vectorize.
 */
import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { id, timestamp, timestampNow, timestamps } from './_shared'
import { accounts } from './accounts'
import { user } from './auth'
import { conversations } from './crm'

export const aiConfigs = sqliteTable(
  'ai_configs',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .unique()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    /** AES-256-GCM-encrypted BYO provider key. */
    apiKey: text('api_key').notNull(),
    /** Migration 030 — separate key for the embeddings provider. */
    embeddingsApiKey: text('embeddings_api_key'),
    /** Business context / persona / tone. */
    systemPrompt: text('system_prompt'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
    autoReplyEnabled: integer('auto_reply_enabled', { mode: 'boolean' }).notNull().default(false),
    autoReplyMaxPerConversation: integer('auto_reply_max_per_conversation').notNull().default(3),
    /** Migration 033 — agent that handoffs are routed to. */
    handoffAgentId: text('handoff_agent_id').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    check('ai_configs_provider_check', sql`${t.provider} IN ('openai', 'anthropic')`),
    check(
      'ai_configs_auto_reply_max_check',
      sql`${t.autoReplyMaxPerConversation} BETWEEN 1 AND 20`,
    ),
  ],
)

export const aiKnowledgeDocuments = sqliteTable(
  'ai_knowledge_documents',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    ...timestamps,
  },
  (t) => [index('idx_ai_knowledge_documents_account').on(t.accountId)],
)

export const aiKnowledgeChunks = sqliteTable(
  'ai_knowledge_chunks',
  {
    id: id(),
    documentId: text('document_id')
      .notNull()
      .references(() => aiKnowledgeDocuments.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull().default(0),
    content: text('content').notNull(),
    /**
     * Set once this chunk's embedding is confirmed upserted into
     * Vectorize. NULL means the vector is missing or stale — the
     * reconcile path in the reindex job selects on this. Replaces the
     * atomicity Postgres gave us for free when the embedding was a
     * column in the same row.
     */
    vectorizedAt: timestamp('vectorized_at'),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    index('idx_ai_knowledge_chunks_account').on(t.accountId),
    index('idx_ai_knowledge_chunks_document').on(t.documentId),
    /** Finds chunks whose Vectorize upsert never landed. */
    index('idx_ai_knowledge_chunks_unvectorized')
      .on(t.accountId)
      .where(sql`vectorized_at IS NULL`),
  ],
)

export const aiUsageLog = sqliteTable(
  'ai_usage_log',
  {
    id: id(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    /** Which surface spent the tokens. */
    mode: text('mode').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    createdAt: timestampNow('created_at'),
  },
  (t) => [
    index('idx_ai_usage_log_account').on(t.accountId, t.createdAt),
    check('ai_usage_log_mode_check', sql`${t.mode} IN ('auto_reply', 'draft')`),
    check('ai_usage_log_provider_check', sql`${t.provider} IN ('openai', 'anthropic')`),
  ],
)
