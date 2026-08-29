import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiConfig } from './types'
import { chunkText } from './chunk'
import { embedTexts, toVectorLiteral } from './embeddings'
import { kbEmptyCacheTtlMs } from './defaults'

// ============================================================
// Knowledge base: ingest (chunk + optionally embed) and hybrid
// retrieve (semantic when an embeddings key is present, topped up with
// lexical full-text search).
// ============================================================

interface MatchRow {
  id: string
  content: string
}

// ------------------------------------------------------------
// Per-account, short-TTL cache of "does this account have ANY
// Knowledge Base chunks" — AI optimization project, FASE 4 (negative
// side only, originally) broadened in FASE 5 to also remember a
// positive answer, so the routing layer (routing.ts) can ask this
// BEFORE deciding whether a turn needs Knowledge at all, and
// `retrieveKnowledge`'s own guard below then reuses the exact same
// cached answer instead of re-querying — one real `count()` per TTL
// window either way, never two just because two call sites asked in
// the same request.
//
// Module-level (one process, not one request), but strictly keyed by
// accountId, so it can never answer one account's state for a
// different one. Bounded by `kbEmptyCacheTtlMs()` AND invalidated
// immediately by `ingestDocument` for that account — never a source of
// staleness for an account that genuinely just gained or lost content.
// A cache-miss/expired entry always re-checks the database for real;
// a query failure is never cached and fails OPEN (assume content might
// exist) rather than silently skipping Knowledge for an account it
// could actually help.
// ------------------------------------------------------------
interface KbStateEntry {
  hasContent: boolean
  until: number
}
const kbStateCache = new Map<string, KbStateEntry>()

function cachedKbState(accountId: string): boolean | undefined {
  const entry = kbStateCache.get(accountId)
  if (!entry) return undefined
  if (Date.now() >= entry.until) {
    kbStateCache.delete(accountId)
    return undefined
  }
  return entry.hasContent
}

function setCachedKbState(accountId: string, hasContent: boolean): void {
  kbStateCache.set(accountId, { hasContent, until: Date.now() + kbEmptyCacheTtlMs() })
}

function clearCachedKbState(accountId: string): void {
  kbStateCache.delete(accountId)
}

/** Forget every account's cached Knowledge-Base-presence state, forcing
 *  the next check per account to recheck the database. Exported for
 *  tests (isolating cases that reuse the same account id) and as an
 *  operational escape hatch — not called anywhere in the normal
 *  request path. */
export function resetKnowledgeEmptyCache(): void {
  kbStateCache.clear()
}

/**
 * Cheap, cached "does this account have any Knowledge Base chunks at
 * all" check — the same guard `retrieveKnowledge` already applies,
 * exposed standalone so the routing layer (routing.ts) can gate
 * whether to attempt Knowledge for a turn BEFORE paying for embedding/
 * RPC work, without adding a second real query when `retrieveKnowledge`
 * itself runs right after (it reuses this exact cached answer).
 */
export async function accountHasKnowledgeBase(
  db: SupabaseClient,
  accountId: string,
): Promise<boolean> {
  const cached = cachedKbState(accountId)
  if (cached !== undefined) return cached

  try {
    const { count, error } = await db
      .from('ai_knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if (!error) {
      const hasContent = (count ?? 0) > 0
      setCachedKbState(accountId, hasContent)
      return hasContent
    }
  } catch (err) {
    console.error('[ai knowledge] failed to check KB size:', err)
  }
  // Unknown (query threw or errored) — fail open, and don't cache an
  // unknown state as if it were confirmed either way.
  return true
}

/**
 * (Re)build the chunks for one document. Deletes the document's
 * existing chunks, re-chunks the content, and — when the account has an
 * embeddings key — embeds each chunk. Runs under whatever client the
 * caller passes (service-role for ingest routes).
 *
 * Throws on embedding failure so the ingest route can report it; the
 * chunks are only written once embedding (if attempted) succeeds, so a
 * failed embed never leaves half-indexed rows.
 */
export async function ingestDocument(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  documentId: string,
  content: string,
): Promise<void> {
  // Any ingest for this account can change whether it has zero chunks
  // overall (adding the account's first content, or clearing its only
  // document down to nothing) — forget the cached state unconditionally
  // so the next check re-checks for real rather than trusting a mark
  // that may now be wrong (FASE 4).
  clearCachedKbState(accountId)

  const chunks = chunkText(content)

  // Replace, don't append — re-ingest must be idempotent.
  const { error: delErr } = await db
    .from('ai_knowledge_chunks')
    .delete()
    .eq('document_id', documentId)
  if (delErr) throw delErr

  if (chunks.length === 0) return

  // Embed if a key is set, but DON'T let an embedding failure stop the
  // chunks from being stored: a failed embed must still leave the
  // document searchable lexically. We record the error and rethrow it
  // AFTER inserting (embedding-less) rows, so the route can warn
  // "semantic indexing failed" — which is now truthful, because lexical
  // search really does still work.
  let embeddings: number[][] | null = null
  let embedError: unknown = null
  if (config.embeddingsApiKey) {
    try {
      embeddings = await embedTexts(config.embeddingsApiKey, chunks)
    } catch (err) {
      embedError = err
    }
  }

  const rows = chunks.map((content, i) => ({
    document_id: documentId,
    account_id: accountId,
    chunk_index: i,
    content,
    embedding: embeddings ? toVectorLiteral(embeddings[i]) : null,
  }))

  const { error: insErr } = await db.from('ai_knowledge_chunks').insert(rows)
  if (insErr) throw insErr

  if (embedError) throw embedError
}

/**
 * Retrieve up to `k` knowledge excerpts relevant to `queryText`.
 *
 * Semantic-primary when an embeddings key is configured (embed the
 * query → cosine-nearest chunks), then topped up with lexical full-text
 * matches to fill `k`. Lexical-only when there's no key. Best-effort:
 * any failure (no KB, embedding error, RPC error) degrades to fewer or
 * zero results and never throws into the draft / auto-reply path.
 */
export async function retrieveKnowledge(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  queryText: string,
  k = 15,
): Promise<string[]> {
  const query = queryText.trim()
  if (!query || k <= 0) return []

  // Avoid embedding/RPC work when the account has no knowledge chunks —
  // cached (FASE 4), and the same cache the routing layer's
  // accountHasKnowledgeBase() call already warmed for this account, so
  // this is a second real query only the first time either is asked in
  // a given TTL window, never twice per turn.
  if (!(await accountHasKnowledgeBase(db, accountId))) return []

  const picked = new Map<string, string>() // id → content, preserves order

  // Semantic path.
  if (config.embeddingsApiKey) {
    try {
      const [queryEmbedding] = await embedTexts(config.embeddingsApiKey, [query])
      if (queryEmbedding) {
        const { data, error } = await db.rpc('match_ai_knowledge_semantic', {
          p_account_id: accountId,
          p_query_embedding: toVectorLiteral(queryEmbedding),
          p_match_count: k,
        })
        if (!error && Array.isArray(data)) {
          for (const row of data as MatchRow[]) picked.set(row.id, row.content)
        }
      }
    } catch (err) {
      console.error('[ai knowledge] semantic retrieval failed, falling back to FTS:', err)
    }
  }

  // Lexical top-up (also the sole path when there's no embeddings key).
  if (picked.size < k) {
    try {
      const { data, error } = await db.rpc('match_ai_knowledge_fts', {
        p_account_id: accountId,
        p_query: query,
        p_match_count: k,
      })
      if (!error && Array.isArray(data)) {
        for (const row of data as MatchRow[]) {
          if (picked.size >= k) break
          if (!picked.has(row.id)) picked.set(row.id, row.content)
        }
      }
    } catch (err) {
      console.error('[ai knowledge] lexical retrieval failed:', err)
    }
  }

  const results = Array.from(picked.values()).slice(0, k)
  if (results.length === 0) {
    console.log(
      `[ai knowledge] no chunks found for query "${query.slice(0, 80)}" (account ${accountId.slice(0, 8)}…)`,
    )
  }
  return results
}