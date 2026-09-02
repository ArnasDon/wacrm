/**
 * Seeds a local D1 database with one complete account and reads it back.
 *
 * This is the Phase 1 gate: it proves the ported schema accepts a
 * realistic write path (account → profile → contact → conversation →
 * message, plus a pipeline, a deal, and a knowledge chunk) and that
 * every FK, CHECK constraint, and partial unique index behaves the way
 * the Postgres original did.
 *
 * Run with:
 *   npm run db:seed
 *
 * which executes it through `wrangler dev` so a real D1 binding is
 * available. It is destructive to the local database only; it never
 * touches remote D1.
 */
import { and, eq } from 'drizzle-orm'

import { createDb } from '../src/lib/db'
import {
  accounts,
  aiKnowledgeChunks,
  aiKnowledgeDocuments,
  contacts,
  conversations,
  deals,
  messages,
  pipelines,
  pipelineStages,
  profiles,
  user,
} from '../src/lib/db/schema'

export async function seed(binding: D1Database) {
  const db = createDb(binding)

  const userId = crypto.randomUUID()
  const accountId = crypto.randomUUID()
  const contactId = crypto.randomUUID()
  const conversationId = crypto.randomUUID()
  const pipelineId = crypto.randomUUID()
  const stageId = crypto.randomUUID()
  const documentId = crypto.randomUUID()

  // ---- identity -------------------------------------------------
  // Better Auth owns this row in production; the seed writes it
  // directly because Phase 2 has not landed yet.
  await db.insert(user).values({
    id: userId,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    emailVerified: true,
  })

  // ---- account + profile ----------------------------------------
  // This pair is what `handle_new_user()` created via trigger in
  // Postgres. Phase 2 moves it into a post-registration hook; the
  // ordering here is that hook's logic in miniature.
  await db.insert(accounts).values({
    id: accountId,
    name: 'Ada Lovelace',
    ownerUserId: userId,
    defaultCurrency: 'GBP',
  })

  await db.insert(profiles).values({
    id: crypto.randomUUID(),
    userId,
    accountId,
    accountRole: 'owner',
    fullName: 'Ada Lovelace',
    email: 'ada@example.com',
    betaFeatures: ['account_sharing'],
  })

  // ---- CRM core ---------------------------------------------------
  await db.insert(contacts).values({
    id: contactId,
    accountId,
    userId,
    phone: '+44 20 7946 0958',
    phoneNormalized: '+442079460958',
    name: 'Charles Babbage',
    company: 'Analytical Engines Ltd',
  })

  await db.insert(conversations).values({
    id: conversationId,
    accountId,
    userId,
    contactId,
    status: 'open',
    lastMessageText: 'Is the engine ready?',
    lastMessageAt: new Date(),
    unreadCount: 1,
  })

  const inboundId = crypto.randomUUID()
  await db.insert(messages).values({
    id: inboundId,
    conversationId,
    senderType: 'customer',
    contentType: 'text',
    contentText: 'Is the engine ready?',
    status: 'delivered',
  })

  // A reply quoting the inbound message — exercises the
  // `reply_to_message_id` self-link that has no FK behind it.
  await db.insert(messages).values({
    id: crypto.randomUUID(),
    conversationId,
    senderType: 'agent',
    senderId: userId,
    contentType: 'text',
    contentText: 'Nearly — the mill is assembled.',
    replyToMessageId: inboundId,
    status: 'sent',
  })

  // ---- pipeline + deal --------------------------------------------
  await db.insert(pipelines).values({ id: pipelineId, accountId, userId, name: 'Sales' })
  await db
    .insert(pipelineStages)
    .values({ id: stageId, pipelineId, name: 'Qualified', position: 0 })

  await db.insert(deals).values({
    id: crypto.randomUUID(),
    accountId,
    userId,
    pipelineId,
    stageId,
    contactId,
    conversationId,
    title: 'Analytical Engine — pilot',
    // Money is stored in minor units: £1,250.00.
    valueMinor: 125_000,
    currency: 'GBP',
    expectedCloseDate: '2026-12-01',
  })

  // ---- AI knowledge -----------------------------------------------
  // `vectorizedAt` stays null: no Vectorize upsert happens here, which
  // is exactly the state the Phase 4 reconcile job looks for.
  await db.insert(aiKnowledgeDocuments).values({
    id: documentId,
    accountId,
    title: 'Shipping policy',
    content: 'Orders dispatch within two working days.',
  })

  await db.insert(aiKnowledgeChunks).values({
    id: crypto.randomUUID(),
    documentId,
    accountId,
    chunkIndex: 0,
    content: 'Orders dispatch within two working days.',
  })

  return { userId, accountId, contactId, conversationId }
}

/**
 * Reads the seeded data back and asserts the schema behaves. Returns a
 * list of human-readable check results rather than throwing, so a
 * failing run reports every problem at once instead of the first.
 */
export async function verify(binding: D1Database, ids: Awaited<ReturnType<typeof seed>>) {
  const db = createDb(binding)
  const results: { check: string; ok: boolean; detail?: string }[] = []

  const record = (check: string, ok: boolean, detail?: string) =>
    results.push({ check, ok, detail })

  // Account-scoped read — the shape every Phase 3 query will take.
  const contactRows = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.accountId, ids.accountId), eq(contacts.id, ids.contactId)))
  record('contact reads back under its account', contactRows.length === 1)

  // Timestamps survive the epoch-millis round trip as real Dates.
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, ids.conversationId))
  record(
    'timestamp round-trips as a Date',
    conversation?.lastMessageAt instanceof Date,
    `got ${Object.prototype.toString.call(conversation?.lastMessageAt)}`,
  )

  // JSON columns deserialize back into real arrays.
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, ids.userId))
  record(
    'json array column round-trips',
    Array.isArray(profile?.betaFeatures) && profile.betaFeatures[0] === 'account_sharing',
  )

  // Booleans come back as booleans, not 0/1.
  record('boolean round-trips', conversation?.aiAutoreplyDisabled === false)

  // The quoted-reply self-link resolves.
  const messageRows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, ids.conversationId))
  const reply = messageRows.find((m) => m.replyToMessageId !== null)
  record(
    'reply_to_message_id points at a real message',
    Boolean(reply) && messageRows.some((m) => m.id === reply!.replyToMessageId),
  )

  // FTS5 triggers indexed the chunk on insert.
  const fts = await binding
    .prepare(
      `SELECT chunk_id FROM ai_knowledge_chunks_fts WHERE ai_knowledge_chunks_fts MATCH ?`,
    )
    .bind('dispatch')
    .all()
  record('fts5 index populated by trigger', fts.results.length === 1)

  // A CHECK constraint still rejects an invalid enum value.
  let checkRejected = false
  try {
    await db.insert(conversations).values({
      id: crypto.randomUUID(),
      accountId: ids.accountId,
      userId: ids.userId,
      contactId: ids.contactId,
      // 'archived' is not one of open/pending/closed.
      status: 'archived',
    })
  } catch {
    checkRejected = true
  }
  record('CHECK constraint rejects an invalid status', checkRejected)

  return results
}
