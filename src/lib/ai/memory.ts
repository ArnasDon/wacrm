import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Scoped memory for Clara — GLOBAL / PROPERTY / AD / CONVERSATION.
//
// This is the structured counterpart to the legacy RAG (ai_knowledge_documents
// + ai_knowledge_chunks, still used for property Book/Visão do Corretor —
// see knowledge.ts) and to ai_configs.team_presentation/global_never_rules
// (still used for the company blurb and hard "never do X" rules — see
// prompt-builder.ts §5). ai_memories exists for everything those two didn't
// have a safe home for: team communication style/patterns, non-subjective
// property facts, ad-specific facts, and conversation-specific facts —
// each one carrying the exact id that scopes it, enforced at the database
// level (ai_memories_scope_target_check, migration 20260918190000) so a
// scoped row can never silently leak by having a null target id.
//
// Retrieval is a pure filter, never a "fetch everything and let the LLM
// figure out what applies" — retrieveScopedMemories only ever returns rows
// whose scope matches the caller's own context ids. There is no path from
// here back into another property/ad/conversation's rows.
// ============================================================

export type MemoryScope = 'global' | 'property' | 'ad' | 'conversation'

export type GlobalKnowledgeType =
  | 'business_rule'
  | 'company_fact'
  | 'sales_strategy'
  | 'language_style'
  | 'communication_pattern'

export type PropertyKnowledgeType =
  | 'property_fact'
  | 'property_subjective'
  | 'property_sales_argument'
  | 'property_objection'
  | 'property_market_insight'

export type AdKnowledgeType = 'ad_fact' | 'ad_strategy'

export type ConversationKnowledgeType = 'client_preference' | 'conversation_context'

export type MemoryKnowledgeType =
  | GlobalKnowledgeType
  | PropertyKnowledgeType
  | AdKnowledgeType
  | ConversationKnowledgeType

export type MemoryConfidence = 'low' | 'medium' | 'high'
/**
 * 'candidate': learned once or twice, not yet trusted enough to answer a
 * customer with — usable as provisional context in the SAME turn only
 * (see memory-consolidation.ts's confidence policy), never surfaced as
 * consolidated fact.
 * 'conflict': contradicts an existing 'active' memory; held aside until
 * enough independent evidence accumulates to replace it — the 'active'
 * row is never touched while a 'conflict' row for it exists.
 */
export type MemoryStatus = 'active' | 'candidate' | 'conflict' | 'inactive' | 'archived' | 'deprecated'
export type MemorySourceType =
  | 'learning_scan'
  | 'audio_transcript'
  | 'manual'
  | 'agent_chat'
  | 'ad_referral'
  | 'suggestion_approved'
  | 'backfill_migration'

/** Style/pattern knowledge types — kept separate from the rest of GLOBAL
 *  in the prompt (own section) so it never gets mistaken for a factual
 *  claim about the company. */
export const STYLE_KNOWLEDGE_TYPES: readonly GlobalKnowledgeType[] = ['language_style', 'communication_pattern']

// never_rule is deliberately excluded — it keeps its own pre-existing,
// prominent pipeline (ai_configs.global_never_rules, read directly into
// prompt-builder.ts's own §5) rather than ai_memories. See
// learning-types.ts's LearningType doc comment.
const GLOBAL_TYPES: readonly GlobalKnowledgeType[] = [
  'business_rule',
  'company_fact',
  'sales_strategy',
  'language_style',
  'communication_pattern',
]
const PROPERTY_TYPES: readonly PropertyKnowledgeType[] = [
  'property_fact',
  'property_subjective',
  'property_sales_argument',
  'property_objection',
  'property_market_insight',
]
const AD_TYPES: readonly AdKnowledgeType[] = ['ad_fact', 'ad_strategy']
const CONVERSATION_TYPES: readonly ConversationKnowledgeType[] = ['client_preference', 'conversation_context']

/**
 * Scope is a pure function of knowledge_type, never a second field the
 * model has to get right independently — a type and a mismatched scope
 * could otherwise disagree (e.g. "property_fact" tagged scope: "global"),
 * silently making a property-specific claim retrievable everywhere.
 * Unknown types fall back to null — caller must reject those, never guess.
 */
export function inferScopeFromKnowledgeType(type: string): MemoryScope | null {
  if ((GLOBAL_TYPES as readonly string[]).includes(type)) return 'global'
  if ((PROPERTY_TYPES as readonly string[]).includes(type)) return 'property'
  if ((AD_TYPES as readonly string[]).includes(type)) return 'ad'
  if ((CONVERSATION_TYPES as readonly string[]).includes(type)) return 'conversation'
  return null
}

export interface MemoryRow {
  id: string
  accountId: string
  scope: MemoryScope
  knowledgeType: string
  title: string
  content: string
  propertyId: string | null
  adId: string | null
  conversationId: string | null
  contactId: string | null
  sourceType: MemorySourceType
  sourceMessageId: string | null
  agentId: string | null
  confidence: MemoryConfidence
  occurrenceCount: number
  status: MemoryStatus
  metadata: Record<string, unknown>
  /** Independent confirmations this memory has accrued — see
   *  memory-consolidation.ts. Never hand-edit; always append via
   *  consolidateMemory so duplicate/non-independent evidence is deduped. */
  evidence: MemoryEvidence[]
  /** Prior values this memory held before being updated by a
   *  higher-confidence contradiction (official source, or 3 independent
   *  confirmations of new information) — see memory-consolidation.ts. */
  valueHistory: MemoryValueHistoryEntry[]
  createdAt: string
  updatedAt: string
}

/** One independent confirmation of a piece of knowledge. 'system' evidence
 *  (Clara's own repeated automatic output) is recorded but never counted
 *  toward consolidation thresholds — see evidenceSignature in
 *  memory-consolidation.ts. */
export interface MemoryEvidence {
  kind: 'conversation' | 'message' | 'official' | 'human' | 'system'
  conversationId?: string | null
  messageId?: string | null
  agentId?: string | null
  ref?: string | null
  note?: string | null
  recordedAt: string
}

export interface MemoryValueHistoryEntry {
  value: string
  replacedAt: string
  reason: 'official_source' | 'contradiction_resolved'
}

interface MemoryDbRow {
  id: string
  account_id: string
  scope: MemoryScope
  knowledge_type: string
  title: string
  content: string
  property_id: string | null
  ad_id: string | null
  conversation_id: string | null
  contact_id: string | null
  source_type: MemorySourceType
  source_message_id: string | null
  agent_id: string | null
  confidence: MemoryConfidence
  occurrence_count: number
  status: MemoryStatus
  metadata: Record<string, unknown> | null
  evidence: MemoryEvidence[] | null
  value_history: MemoryValueHistoryEntry[] | null
  created_at: string
  updated_at: string
}

export function fromDbRow(row: MemoryDbRow): MemoryRow {
  return {
    id: row.id,
    accountId: row.account_id,
    scope: row.scope,
    knowledgeType: row.knowledge_type,
    title: row.title,
    content: row.content,
    propertyId: row.property_id,
    adId: row.ad_id,
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    sourceType: row.source_type,
    sourceMessageId: row.source_message_id,
    agentId: row.agent_id,
    confidence: row.confidence,
    occurrenceCount: row.occurrence_count,
    status: row.status,
    metadata: row.metadata ?? {},
    evidence: row.evidence ?? [],
    valueHistory: row.value_history ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export type { MemoryDbRow }

export const SELECT_COLUMNS =
  'id, account_id, scope, knowledge_type, title, content, property_id, ad_id, conversation_id, contact_id, source_type, source_message_id, agent_id, confidence, occurrence_count, status, metadata, evidence, value_history, created_at, updated_at'

export interface SaveMemoryArgs {
  accountId: string
  scope: MemoryScope
  knowledgeType: MemoryKnowledgeType
  title: string
  content: string
  propertyId?: string | null
  adId?: string | null
  conversationId?: string | null
  contactId?: string | null
  agentId?: string | null
  sourceType: MemorySourceType
  sourceMessageId?: string | null
  confidence: MemoryConfidence
  occurrenceCount?: number
  metadata?: Record<string, unknown>
  /** Defaults to 'active' for back-compat with every pre-consolidation
   *  caller. memory-consolidation.ts passes 'candidate' or 'conflict'
   *  explicitly for a first/contested occurrence. */
  status?: MemoryStatus
  evidence?: MemoryEvidence[]
}

/**
 * Persists one scoped memory. Never trusts the caller's scope/id pairing
 * blindly — re-derives scope from knowledgeType and throws if the caller
 * passed a mismatched scope, and requires exactly the id that scope needs
 * (the DB CHECK constraint is the last line of defense, this is the first).
 */
export async function saveMemory(db: SupabaseClient, args: SaveMemoryArgs): Promise<MemoryRow> {
  const expectedScope = inferScopeFromKnowledgeType(args.knowledgeType)
  if (!expectedScope || expectedScope !== args.scope) {
    throw new Error(
      `saveMemory: knowledgeType "${args.knowledgeType}" does not belong to scope "${args.scope}" (expected "${expectedScope}")`,
    )
  }
  if (args.scope === 'property' && !args.propertyId) {
    throw new Error('saveMemory: scope "property" requires propertyId')
  }
  if (args.scope === 'ad' && !args.adId) {
    throw new Error('saveMemory: scope "ad" requires adId')
  }
  if (args.scope === 'conversation' && !args.conversationId) {
    throw new Error('saveMemory: scope "conversation" requires conversationId')
  }

  const { data, error } = await db
    .from('ai_memories')
    .insert({
      account_id: args.accountId,
      scope: args.scope,
      knowledge_type: args.knowledgeType,
      title: args.title.slice(0, 500),
      content: args.content,
      property_id: args.scope === 'property' ? args.propertyId : null,
      ad_id: args.scope === 'ad' ? args.adId : null,
      conversation_id: args.scope === 'conversation' ? args.conversationId : null,
      contact_id: args.contactId ?? null,
      agent_id: args.agentId ?? null,
      source_type: args.sourceType,
      source_message_id: args.sourceMessageId ?? null,
      confidence: args.confidence,
      occurrence_count: args.occurrenceCount ?? 1,
      metadata: args.metadata ?? {},
      status: args.status ?? 'active',
      evidence: args.evidence ?? [],
    })
    .select(SELECT_COLUMNS)
    .single()

  if (error || !data) throw error || new Error('saveMemory: insert returned no row')
  return fromDbRow(data as MemoryDbRow)
}

export async function setMemoryStatus(
  db: SupabaseClient,
  accountId: string,
  memoryId: string,
  status: MemoryStatus,
): Promise<void> {
  const { error } = await db
    .from('ai_memories')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', memoryId)
    .eq('account_id', accountId)
  if (error) throw error
}

export interface ScopedMemories {
  global: MemoryRow[]
  style: MemoryRow[]
  property: MemoryRow[]
  ad: MemoryRow[]
  conversation: MemoryRow[]
}

const EMPTY_SCOPED: ScopedMemories = { global: [], style: [], property: [], ad: [], conversation: [] }

/**
 * The ONLY read path a conversational turn should use. Each group is
 * fetched with its own scope + id filter — never a single "give me
 * everything relevant" query — so a bug in one branch can't leak into
 * another (e.g. a broken propertyId can only ever return zero PROPERTY
 * rows, never fall through to someone else's).
 *
 * Includes 'candidate' rows alongside 'active' ones (never 'conflict' —
 * those are internal consolidation state, not usable knowledge). A
 * candidate is real evidence Clara has already seen once or twice, just
 * not yet consolidated — excluding it entirely would make automatic,
 * no-approval-required learning (memory-consolidation.ts) pointless, since
 * nothing would be usable until it happened to cross the active threshold.
 * formatMemoriesForPrompt tags candidates as provisional so the model
 * never treats them with the same certainty as a consolidated fact.
 */
export async function retrieveScopedMemories(
  db: SupabaseClient,
  accountId: string,
  ctx: { propertyId?: string | null; adId?: string | null; conversationId?: string | null },
): Promise<ScopedMemories> {
  const [globalRes, propertyRes, adRes, conversationRes] = await Promise.all([
    db
      .from('ai_memories')
      .select(SELECT_COLUMNS)
      .eq('account_id', accountId)
      .eq('scope', 'global')
      .in('status', ['active', 'candidate'])
      .order('status', { ascending: true })
      .order('occurrence_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20),
    ctx.propertyId
      ? db
          .from('ai_memories')
          .select(SELECT_COLUMNS)
          .eq('account_id', accountId)
          .eq('scope', 'property')
          .eq('property_id', ctx.propertyId)
          .in('status', ['active', 'candidate'])
          .order('status', { ascending: true })
          .order('occurrence_count', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [] as MemoryDbRow[], error: null }),
    ctx.adId
      ? db
          .from('ai_memories')
          .select(SELECT_COLUMNS)
          .eq('account_id', accountId)
          .eq('scope', 'ad')
          .eq('ad_id', ctx.adId)
          .in('status', ['active', 'candidate'])
          .order('status', { ascending: true })
          .order('occurrence_count', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(6)
      : Promise.resolve({ data: [] as MemoryDbRow[], error: null }),
    ctx.conversationId
      ? db
          .from('ai_memories')
          .select(SELECT_COLUMNS)
          .eq('account_id', accountId)
          .eq('scope', 'conversation')
          .eq('conversation_id', ctx.conversationId)
          .in('status', ['active', 'candidate'])
          .order('status', { ascending: true })
          .order('occurrence_count', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(6)
      : Promise.resolve({ data: [] as MemoryDbRow[], error: null }),
  ])

  if (globalRes.error) {
    console.error('[memory] failed to load global memories:', globalRes.error)
    return EMPTY_SCOPED
  }

  const globalRows = ((globalRes.data ?? []) as MemoryDbRow[]).map(fromDbRow)
  const isStyle = (m: MemoryRow) => (STYLE_KNOWLEDGE_TYPES as readonly string[]).includes(m.knowledgeType)

  return {
    global: globalRows.filter((m) => !isStyle(m)),
    style: globalRows.filter(isStyle),
    property: ((propertyRes.data ?? []) as MemoryDbRow[]).map(fromDbRow),
    ad: ((adRes.data ?? []) as MemoryDbRow[]).map(fromDbRow),
    conversation: ((conversationRes.data ?? []) as MemoryDbRow[]).map(fromDbRow),
  }
}

/**
 * Formats one memory row for the prompt, tagging WHO it came from when
 * known (a specific corretor) so the model never confuses "the team's
 * general style" with "Ronaldo specifically said X" — and never presents
 * either as a fact about the property/company itself.
 */
function formatMemory(m: MemoryRow, agentNameById: Map<string, string>): string {
  const who = m.agentId ? agentNameById.get(m.agentId) || null : null
  const whoPrefix = who ? `[${who}] ` : ''
  // A 'candidate' hasn't cleared the consolidation bar yet (see
  // memory-consolidation.ts) — flagged inline so the model treats it as
  // provisional context, never states it to a customer as a confirmed fact.
  const statusPrefix = m.status === 'candidate' ? '[NÃO CONFIRMADO — use com cautela, não afirme como fato] ' : ''
  return `${statusPrefix}${whoPrefix}${m.content}`
}

export function formatMemoriesForPrompt(
  memories: MemoryRow[],
  agentNameById: Map<string, string> = new Map(),
): string[] {
  return memories.map((m) => formatMemory(m, agentNameById))
}

/**
 * Resolves the display names for whichever agent_ids appear in a batch of
 * memories, in one round trip — used to label style/pattern memories with
 * "[Ronaldo]" / "[Thatianna]" instead of a bare uuid.
 */
export async function loadAgentNames(
  db: SupabaseClient,
  agentIds: Iterable<string>,
): Promise<Map<string, string>> {
  const ids = Array.from(new Set(agentIds)).filter(Boolean)
  if (ids.length === 0) return new Map()
  const { data, error } = await db.from('profiles').select('user_id, full_name').in('user_id', ids)
  if (error || !data) return new Map()
  return new Map((data as { user_id: string; full_name: string }[]).map((p) => [p.user_id, p.full_name]))
}

/** Minimum distinct ad-scoped occurrences before a fact is trusted enough
 *  to promote to the property it belongs to — a single ad's copy is
 *  marketing, not a verified property fact, until it recurs. */
export const AD_TO_PROPERTY_PROMOTION_MIN_OCCURRENCES = 3

/**
 * Promotes an AD memory to PROPERTY scope once it has recurred enough to
 * stop being "this one ad's copy" and start being a real, durable fact
 * about the property it advertises. The reverse direction (PROPERTY →
 * GLOBAL) deliberately has no automatic path at all — a fact real for one
 * empreendimento must never silently become a rule for every
 * empreendimento; that promotion, if it's ever wanted, is a human
 * decision made through the normal suggestion-approval flow, not
 * something this scanner does on its own recurrence count.
 */
export async function promoteAdMemoryToProperty(
  db: SupabaseClient,
  accountId: string,
  memoryId: string,
  propertyId: string,
): Promise<MemoryRow | null> {
  const { data: existing, error: fetchErr } = await db
    .from('ai_memories')
    .select(SELECT_COLUMNS)
    .eq('id', memoryId)
    .eq('account_id', accountId)
    .eq('scope', 'ad')
    .maybeSingle()
  if (fetchErr || !existing) return null

  const row = existing as MemoryDbRow
  if (row.occurrence_count < AD_TO_PROPERTY_PROMOTION_MIN_OCCURRENCES) return null

  const promotedType: PropertyKnowledgeType =
    row.knowledge_type === 'ad_strategy' ? 'property_sales_argument' : 'property_fact'

  const { data: updated, error: updateErr } = await db
    .from('ai_memories')
    .update({
      scope: 'property',
      knowledge_type: promotedType,
      property_id: propertyId,
      ad_id: null,
      metadata: { ...(row.metadata ?? {}), promoted_from: 'ad', promoted_from_ad_id: row.ad_id },
      updated_at: new Date().toISOString(),
    })
    .eq('id', memoryId)
    .eq('account_id', accountId)
    .select(SELECT_COLUMNS)
    .single()
  if (updateErr || !updated) return null
  return fromDbRow(updated as MemoryDbRow)
}
