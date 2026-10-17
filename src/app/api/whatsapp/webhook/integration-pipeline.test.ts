import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// Punto 11, G1 — WhatsApp pipeline integration test.
//
// CLASSIFICATION (per this phase's own explicit requirement — do not
// remove or reword this notice):
//
//   Internal integration test with shared stateful test backend.
//   Does not exercise physical Postgres or RLS.
//
// This is NOT "RLS real", NOT "Postgres integration", NOT an "E2E"
// test against any real service. It is a single, shared, in-memory,
// STATEFUL fake standing in for every Postgres table/RPC the real
// pipeline touches — every INSERT a real function performs is visible
// to the next real function that queries it, exactly like a real
// database, but implemented in this file, not in Postgres.
//
// Why not real Postgres (tests/rls/): investigated first, per this
// phase's own "REGLA FINAL" instruction not to maquillar a structural
// blocker. `src/app/api/whatsapp/webhook/route.ts`'s own
// `supabaseAdmin()` reads `NEXT_PUBLIC_SUPABASE_URL`/
// `SUPABASE_SERVICE_ROLE_KEY` directly — the app's real env var names.
// `tests/rls/env-guard.ts` uses DIFFERENT names
// (`RLS_TEST_SUPABASE_URL`/...) *specifically* so that even an
// accidentally-loaded `.env.local` could never make that suite touch
// real credentials. Copying the RLS-verified-local value into the
// app's own env var names to make `route.ts` reach that same local
// Postgres would subvert exactly the safety boundary that separation
// exists for — not a technical inconvenience, a deliberate security
// design already documented in this repository. The alternative
// (adding dependency injection to `supabaseAdmin()`) is a production
// code change, explicitly out of scope for this phase. Neither was
// done. See the P11 report for the full analysis.
//
// What IS real here, invoked exactly as production does (nothing
// re-implemented, nothing duplicated):
//   - the real `POST()` handler (imported, never copied)
//   - the real `verifyMetaWebhookSignature` (real HMAC-SHA256)
//   - the real `processWebhook`/`processMessage` (private to route.ts,
//     reached only by calling the real `POST()`)
//   - the real `insert_inbound_customer_message` /
//     `bump_conversation_on_inbound` / `claim_ai_reply_slot` /
//     `release_or_continue_ai_processing` RPC CONTRACTS — reimplemented
//     here as fake SQL functions with the SAME signature/semantics
//     (row lock → count → insert → bump, atomic claim, etc.), operating
//     on the same shared in-memory tables real queries also hit
//   - the real `dispatchInboundToFlows` (flows/engine.ts)
//   - the real `runAutomationsForTrigger` (automations/engine.ts)
//   - the real `dispatchInboundToAiReply` / `processOneTurn`
//     (ai/auto-reply.ts) — claim/drain loop, routing, handoff,
//     `detectHandoffIntent`, `buildSystemPrompt`, `sendMessageToConversation`
//   - the real catalog resolver / `executeCatalogTool` (scenario G)
//
// What is faked, and why each is a genuine external frontier:
//   - `global.fetch` — the ONLY thing intercepted at the network
//     boundary. Discriminates by URL: graph.facebook.com → fake Meta
//     Cloud API responses; api.anthropic.com → fake AI provider
//     responses. Nothing about WACRM's own code is skipped by this —
//     it's the literal network edge.
//   - `next/server`'s `after()` — cannot function outside a real
//     Next.js request's AsyncLocalStorage context in ANY test
//     environment; mocked here to capture the callback instead of
//     invoking it, then awaited explicitly — the exact same pattern
//     already established in route.test.ts.
//   - `@/lib/whatsapp/encryption` — mocked to identity functions. This
//     is not pipeline logic; it already has its own dedicated test
//     file (encryption.test.ts), and mocking it here is the same
//     established convention route.test.ts itself already uses.
//   - `@supabase/supabase-js`'s `createClient` and each module's own
//     `admin-client.ts` `supabaseAdmin()` — all point at the ONE shared
//     fake described above, so route.ts, auto-reply.ts, flows/engine.ts,
//     and automations/engine.ts all observe each other's writes.
// ============================================================

// ------------------------------------------------------------
// Shared, stateful, in-memory fake "Postgres". Generic enough to serve
// every table the real pipeline touches without hand-rolling one
// dispatcher per table.
// ------------------------------------------------------------
interface Row {
  [key: string]: unknown
}

type Filter = [string, string, unknown]

function matchesFilter(row: Row, [col, op, val]: Filter): boolean {
  const rowVal = row[col]
  switch (op) {
    case 'eq':
      return rowVal === val
    case 'neq':
      return rowVal !== val
    case 'in':
      return Array.isArray(val) && (val as unknown[]).includes(rowVal)
    case 'like': {
      const pattern = String(val)
      const s = String(rowVal ?? '')
      if (pattern.startsWith('%') && pattern.endsWith('%')) return s.includes(pattern.slice(1, -1))
      if (pattern.startsWith('%')) return s.endsWith(pattern.slice(1))
      if (pattern.endsWith('%')) return s.startsWith(pattern.slice(0, -1))
      return s === pattern
    }
    case 'contains':
      return Array.isArray(rowVal) && Array.isArray(val) && (val as unknown[]).every((v) => (rowVal as unknown[]).includes(v))
    case 'is':
      return val === null ? rowVal === null || rowVal === undefined : rowVal === val
    case 'gt':
      return (rowVal as never) > (val as never)
    case 'lt':
      return (rowVal as never) < (val as never)
    case 'gte':
      return (rowVal as never) >= (val as never)
    case 'lte':
      return (rowVal as never) <= (val as never)
    default:
      return true
  }
}

let idCounter = 0
function nextId(table: string): string {
  idCounter++
  return `${table}-${idCounter}`
}

function createFakeBackend() {
  const tables: Record<string, Row[]> = {}
  const table = (name: string): Row[] => tables[name] ?? (tables[name] = [])

  // PostgREST-style embedded relation — `.select('*, contact:contacts(*)')`
  // (send-message.ts's own real query for scenario M). Resolved by the
  // same foreign-key-column convention the whole codebase already uses:
  // alias `contact` reads the local `contact_id` column and looks it up
  // by `id` in the named table. `null` when there's no match, exactly
  // like a real left-join embed.
  function attachEmbeds(matched: Row[], cols: string | undefined): Row[] {
    if (!cols) return matched
    const embeds: Array<{ alias: string; targetTable: string }> = []
    const pattern = /(\w+):(\w+)\([^)]*\)/g
    let m: RegExpExecArray | null
    while ((m = pattern.exec(cols))) embeds.push({ alias: m[1], targetTable: m[2] })
    if (embeds.length === 0) return matched
    return matched.map((r) => {
      const withEmbeds: Row = { ...r }
      for (const { alias, targetTable } of embeds) {
        const fk = r[`${alias}_id`]
        withEmbeds[alias] = table(targetTable).find((t) => t.id === fk) ?? null
      }
      return withEmbeds
    })
  }

  function builder(name: string, op: 'select' | 'insert' | 'update' | 'delete', payload?: unknown, selectOpts?: { count?: string; head?: boolean }, initialCols?: string) {
    const rows = table(name)
    const filters: Filter[] = []
    let orderCol: string | null = null
    let orderAsc = true
    let limitN: number | null = null
    // Set on entry from db.from(name).select(cols, opts) below; a
    // chained re-call to api.select(...) (rare in this codebase, but
    // supported) overwrites it the same way.
    let selectCols: string | undefined = initialCols
    // PostgREST-style `.or('col.is.null,col.lt.<iso>')` — same
    // hand-rolled parser already established in auto-reply.test.ts's
    // own fake for the identical claim-column pattern.
    let orExpr: string | null = null

    function computeMatched(): Row[] {
      return rows.filter((r) => {
        if (!filters.every((f) => matchesFilter(r, f))) return false
        if (orExpr) {
          return orExpr!.split(',').some((clause) => {
            const [col, cop, val] = clause.split('.')
            const current = r[col]
            if (cop === 'is') return val === 'null' ? current === null || current === undefined : String(current) === val
            if (cop === 'lt') return typeof current === 'string' && current < val
            if (cop === 'gt') return typeof current === 'string' && current > val
            return false
          })
        }
        return true
      })
    }

    function run(): { data: unknown; error: null; count?: number } {
      if (op === 'select') {
        let matched = computeMatched()
        if (selectOpts?.count) {
          return { data: selectOpts.head ? null : matched, error: null, count: matched.length }
        }
        if (orderCol) {
          const col = orderCol
          matched = [...matched].sort((a, b) => {
            const av = a[col] as never
            const bv = b[col] as never
            if (av === bv) return 0
            return av < bv ? (orderAsc ? -1 : 1) : orderAsc ? 1 : -1
          })
        }
        if (limitN != null) matched = matched.slice(0, limitN)
        matched = attachEmbeds(matched, selectCols)
        return { data: matched, error: null }
      }
      if (op === 'insert') {
        const items = Array.isArray(payload) ? payload : [payload as Row]
        const inserted = items.map((p) => ({
          id: (p as Row).id ?? nextId(name),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...(p as Row),
        }))
        rows.push(...inserted)
        return { data: inserted, error: null }
      }
      if (op === 'update') {
        const matched = computeMatched()
        for (const r of matched) Object.assign(r, payload as Row)
        return { data: matched, error: null }
      }
      // delete
      const matched = computeMatched()
      const remaining = rows.filter((r) => !matched.includes(r))
      rows.length = 0
      rows.push(...remaining)
      return { data: matched, error: null }
    }

    const api = {
      select: (cols?: string, opts?: { count?: string; head?: boolean }) => {
        selectCols = cols
        if (opts) selectOpts = opts
        return api
      },
      eq: (c: string, v: unknown) => {
        filters.push([c, 'eq', v])
        return api
      },
      neq: (c: string, v: unknown) => {
        filters.push([c, 'neq', v])
        return api
      },
      in: (c: string, v: unknown) => {
        filters.push([c, 'in', v])
        return api
      },
      like: (c: string, v: unknown) => {
        filters.push([c, 'like', v])
        return api
      },
      contains: (c: string, v: unknown) => {
        filters.push([c, 'contains', v])
        return api
      },
      is: (c: string, v: unknown) => {
        filters.push([c, 'is', v])
        return api
      },
      gt: (c: string, v: unknown) => {
        filters.push([c, 'gt', v])
        return api
      },
      lt: (c: string, v: unknown) => {
        filters.push([c, 'lt', v])
        return api
      },
      or: (expr: string) => {
        orExpr = expr
        return api
      },
      order: (c: string, opts?: { ascending?: boolean }) => {
        orderCol = c
        orderAsc = opts?.ascending !== false
        return api
      },
      limit: (n: number) => {
        limitN = n
        return api
      },
      maybeSingle: async () => {
        const r = run()
        const d = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data
        return { data: d, error: null }
      },
      single: async () => {
        const r = run()
        const d = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data
        return { data: d, error: null }
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    }
    return api
  }

  const rpcHandlers: Record<string, (args: Record<string, unknown>) => { data: unknown; error: unknown }> = {
    // Mirrors migration 053 exactly: row-lock (no-op here, JS is
    // single-threaded within one dispatch), count prior customer
    // messages, ON CONFLICT DO NOTHING dedup, bump on real insert.
    insert_inbound_customer_message: (args) => {
      const messages = table('messages')
      const conversationId = args.p_conversation_id as string
      const messageId = args.p_message_id as string
      const existing = messages.find(
        (m) => m.conversation_id === conversationId && m.message_id === messageId,
      )
      if (existing) {
        return { data: [{ message_id: null, was_inserted: false, is_first_customer_message: false }], error: null }
      }
      const priorCount = messages.filter(
        (m) => m.conversation_id === conversationId && m.sender_type === 'customer',
      ).length
      const row: Row = {
        id: nextId('messages'),
        conversation_id: conversationId,
        sender_type: 'customer',
        content_type: args.p_content_type,
        content_text: args.p_content_text,
        media_url: args.p_media_url,
        media_type: args.p_media_type,
        message_id: messageId,
        status: 'delivered',
        created_at: args.p_created_at,
        reply_to_message_id: args.p_reply_to_message_id,
        interactive_reply_id: args.p_interactive_reply_id,
      }
      messages.push(row)
      // bump_conversation_on_inbound, inlined
      const conv = table('conversations').find((c) => c.id === conversationId)
      if (conv) {
        conv.unread_count = ((conv.unread_count as number) ?? 0) + 1
        conv.last_message_text = args.p_last_message_text
        conv.last_message_at = new Date().toISOString()
        conv.updated_at = new Date().toISOString()
      }
      return {
        data: [{ message_id: row.id, was_inserted: true, is_first_customer_message: priorCount === 0 }],
        error: null,
      }
    },
    claim_ai_reply_slot: (args) => {
      const conv = table('conversations').find((c) => c.id === args.conversation_id)
      if (!conv) return { data: false, error: null }
      const count = (conv.ai_reply_count as number) ?? 0
      const max = args.max_replies as number
      if (count >= max) return { data: false, error: null }
      conv.ai_reply_count = count + 1
      return { data: true, error: null }
    },
    release_or_continue_ai_processing: (args) => {
      const conversationId = args.p_conversation_id as string
      const lastSeen = args.p_last_seen_message_id as string | null
      const customerMessages = table('messages')
        .filter((m) => m.conversation_id === conversationId && m.sender_type === 'customer' && m.content_type === 'text')
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      const latest = customerMessages[0]?.id ?? null
      const conv = table('conversations').find((c) => c.id === conversationId)
      if (latest === null || latest === lastSeen) {
        if (conv) conv.ai_processing_started_at = null
        return { data: [{ released: true, latest_message_id: latest }], error: null }
      }
      if (conv) conv.ai_processing_started_at = new Date().toISOString()
      return { data: [{ released: false, latest_message_id: latest }], error: null }
    },
    // Minimal fake matching the shape DataSourceCatalogProvider expects
    // for scenario G — real search semantics narrowed to "return every
    // active product for this account whose name/sku loosely matches".
    search_ai_catalog_products: (args) => {
      const accountId = args.p_account_id as string
      const query = String(args.p_query ?? '').toLowerCase()
      const products = table('ai_catalog_products').filter((p) => {
        if (p.account_id !== accountId) return false
        if (!query) return true
        const name = String(p.name ?? '').toLowerCase()
        const sku = String(p.sku ?? '').toLowerCase()
        return name.includes(query) || sku.includes(query) || query.split(/\s+/).some((w) => name.includes(w))
      })
      return { data: products, error: null }
    },
  }

  const db = {
    from(name: string) {
      return {
        select: (cols?: string, opts?: { count?: string; head?: boolean }) => builder(name, 'select', undefined, opts, cols),
        insert: (payload: unknown) => builder(name, 'insert', payload),
        update: (payload: unknown) => builder(name, 'update', payload),
        upsert: (payload: unknown) => builder(name, 'insert', payload),
        delete: () => builder(name, 'delete'),
      }
    },
    rpc(name: string, args: Record<string, unknown> = {}) {
      const handler = rpcHandlers[name]
      const result = handler ? handler(args) : { data: null, error: null }
      return {
        single: async () => ({ data: Array.isArray(result.data) ? result.data[0] : result.data, error: result.error }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      }
    },
  }

  return { db, tables, table }
}

// ------------------------------------------------------------
// Fetch frontier — the ONLY network boundary. Discriminates by URL.
// ------------------------------------------------------------
interface FetchLog {
  url: string
  body: unknown
}

function makeFetchStub(opts: {
  metaSendMessageId: () => string
  nextAiResponse: () => { content: unknown[]; stop_reason: string }
  fetchLog: FetchLog[]
}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null
    opts.fetchLog.push({ url, body })

    if (url.includes('graph.facebook.com')) {
      // Every Meta Cloud API call this pipeline makes (send text/media,
      // fetch media info) resolves successfully with a fresh wamid.
      if (url.match(/\/[0-9]+$/) && !init?.method) {
        // GET /{media-id} — media info lookup (unused by this scenario,
        // included for completeness).
        return {
          ok: true,
          json: async () => ({ url: 'https://cdn.example/fake-media', mime_type: 'image/jpeg', file_size: 100 }),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({ messages: [{ id: opts.metaSendMessageId() }] }),
      } as Response
    }

    if (url.includes('api.anthropic.com')) {
      const next = opts.nextAiResponse()
      return {
        ok: true,
        json: async () => ({
          content: next.content,
          stop_reason: next.stop_reason,
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      } as Response
    }

    throw new Error(`integration test: unexpected fetch to unmocked URL: ${url}`)
  })
}

// ------------------------------------------------------------
// Module mocks — wired to the shared backend created fresh per test in
// beforeEach via `backendRef`.
// ------------------------------------------------------------
const backendRef: { current: ReturnType<typeof createFakeBackend> | null } = { current: null }

// route.ts's own inline `supabaseAdmin()` memoizes the object
// `createClient()` returns in a module-scope `_adminClient` variable,
// calling `createClient()` exactly ONCE for this module's entire
// lifetime (a legitimate production optimization — untouched here). A
// mock returning `backendRef.current!.db` directly would get captured
// by that memoization on the very first call and stay frozen to
// whichever backend existed at that moment — silently stale for every
// later test's own fresh backend, since `beforeEach` reassigns
// `backendRef.current` but route.ts would never call `createClient()`
// again to notice. This stable Proxy is the one object route.ts's
// `_adminClient` ends up caching, but every property access on it
// (`.from`, `.rpc`, `.storage`, ...) is resolved through to whatever
// `backendRef.current!.db` is AT ACCESS TIME, not at construction time —
// so route.ts stays correctly wired to each test's own fresh backend
// despite its own internal memoization.
function createDelegatingClientProxy() {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        const real = backendRef.current!.db as unknown as Record<string, unknown>
        const value = real[prop as string]
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(real) : value
      },
    },
  )
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => createDelegatingClientProxy(),
}))
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => backendRef.current!.db,
}))
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => backendRef.current!.db,
}))
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => backendRef.current!.db,
}))
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v,
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
}))

const afterCallbacks: Array<() => Promise<void> | void> = []
vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    afterCallbacks.push(cb)
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))

import { POST } from './route'
import { sendMessageToConversation } from '@/lib/whatsapp/send-message'
import { resetKnowledgeEmptyCache } from '@/lib/ai/knowledge'

const META_APP_SECRET = process.env.META_APP_SECRET ?? 'test-meta-app-secret'

function sign(rawBody: string): string {
  return 'sha256=' + crypto.createHmac('sha256', META_APP_SECRET).update(rawBody).digest('hex')
}

/** Drains every after() callback registered by the most recent POST(),
 *  in order, then clears the queue — the deterministic "wait for the
 *  deferred processing to finish" signal this file needs, mirroring
 *  route.test.ts's own established pattern exactly. */
async function drainAfterCallbacks(): Promise<void> {
  const pending = afterCallbacks.splice(0, afterCallbacks.length)
  for (const cb of pending) await cb()
}

function metaTextMessagePayload(args: {
  phoneNumberId: string
  from: string
  contactName: string
  messageId: string
  text: string
  timestampSeconds?: number
}) {
  return {
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550001111', phone_number_id: args.phoneNumberId },
              contacts: [{ profile: { name: args.contactName }, wa_id: args.from }],
              messages: [
                {
                  id: args.messageId,
                  from: args.from,
                  timestamp: String(args.timestampSeconds ?? Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: args.text },
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

async function postWebhook(payload: unknown, opts?: { badSignature?: boolean; omitSignature?: boolean }) {
  const rawBody = JSON.stringify(payload)
  const headers: Record<string, string> = {}
  if (!opts?.omitSignature) {
    headers['x-hub-signature-256'] = opts?.badSignature ? sign('tampered body, not the real one') : sign(rawBody)
  }
  const request = new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers,
    body: rawBody,
  })
  return POST(request as never) as unknown as { status: number; json: () => Promise<unknown> }
}

describe('Punto 11, G1 — WhatsApp pipeline: internal integration with shared stateful backend (NOT physical Postgres/RLS)', () => {
  let backend: ReturnType<typeof createFakeBackend>
  let fetchLog: FetchLog[]
  let aiResponseQueue: Array<{ content: unknown[]; stop_reason: string }>

  const ACCOUNT_A = 'acct-a'
  const ACCOUNT_B = 'acct-b'
  const PHONE_NUMBER_ID_A = 'pnid-a'
  const PHONE_NUMBER_ID_B = 'pnid-b'
  const OWNER_A = 'user-a-owner'
  const OWNER_B = 'user-b-owner'
  const AGENT_A = 'user-a-agent'

  function seedAccount(accountId: string, ownerId: string, phoneNumberId: string) {
    backend.table('profiles').push({ id: nextId('profiles'), account_id: accountId, user_id: ownerId, account_role: 'owner', full_name: 'Owner' })
    backend.table('whatsapp_config').push({
      id: nextId('wc'),
      account_id: accountId,
      user_id: ownerId,
      phone_number_id: phoneNumberId,
      access_token: 'fake-encrypted-token',
      mirror_inbound_media: true,
    })
    backend.table('ai_configs').push({
      id: nextId('aic'),
      account_id: accountId,
      created_by: ownerId,
      provider: 'anthropic',
      model: 'claude-test',
      api_key: 'fake-encrypted-key',
      system_prompt: `Somos una tienda de prueba de la cuenta ${accountId}.`,
      agent_behavior: null,
      is_active: true,
      auto_reply_enabled: true,
      auto_reply_max_per_conversation: 3,
      handoff_agent_id: null,
      embeddings_api_key: null,
    })
    backend.table('account_business_profiles').push({
      id: nextId('bp'),
      account_id: accountId,
      business_name: `Negocio ${accountId}`,
    })
    // routing.ts's `useKnowledge` gate (shared by Business Profile —
    // FASE 6) is clamped to accountHasKnowledgeBase(), a REAL count
    // query against `ai_knowledge_chunks`. Without at least one real
    // chunk row here, D/E/F's "hacen envios" message would signal
    // Knowledge intent but routing would still refuse to attach Business
    // Profile — not a test bug, the account genuinely has no KB. Seeded
    // for both accounts so the gate opens for real, the same way a
    // merchant who actually ingested a document would see it open.
    const doc = { id: nextId('doc'), account_id: accountId, title: 'FAQ', status: 'ready' }
    backend.table('ai_knowledge_documents').push(doc)
    backend.table('ai_knowledge_chunks').push({
      id: nextId('chunk'),
      document_id: doc.id,
      account_id: accountId,
      chunk_index: 0,
      content: `Hacemos envios a todo el pais. Horario: 9am-6pm. (${accountId})`,
      embedding: null,
    })
  }

  beforeEach(() => {
    idCounter = 0
    backend = createFakeBackend()
    backendRef.current = backend
    afterCallbacks.length = 0
    fetchLog = []
    aiResponseQueue = []
    // knowledge.ts's accountHasKnowledgeBase() cache is module-level,
    // keyed by accountId — and every test here reuses the SAME
    // ACCOUNT_A/ACCOUNT_B ids against a brand-new backend. Without this,
    // a cached answer from an earlier test would silently decide this
    // one's routing gate instead of this test's own real, freshly-seeded
    // ai_knowledge_chunks. Exported by that module specifically for this
    // (see its own "Exported for tests" comment).
    resetKnowledgeEmptyCache()

    seedAccount(ACCOUNT_A, OWNER_A, PHONE_NUMBER_ID_A)
    seedAccount(ACCOUNT_B, OWNER_B, PHONE_NUMBER_ID_B)
    // Account A's default handoff agent — a REAL member of A, so
    // handOffToHuman()'s isAccountMember() check (Punto 9, H9-1)
    // resolves it as valid.
    backend.table('profiles').push({ id: nextId('profiles'), account_id: ACCOUNT_A, user_id: AGENT_A, account_role: 'agent', full_name: 'Agent A' })
    const aiConfigA = backend.table('ai_configs').find((c) => c.account_id === ACCOUNT_A)!
    aiConfigA.handoff_agent_id = AGENT_A

    vi.stubGlobal(
      'fetch',
      makeFetchStub({
        metaSendMessageId: () => `wamid.${nextId('meta')}`,
        nextAiResponse: () => aiResponseQueue.shift() ?? { content: [{ type: 'text', text: 'Hola, ¿en qué puedo ayudarte?' }], stop_reason: 'end_turn' },
        fetchLog,
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ============================================================
  // A + B + C — valid webhook, real HMAC, real POST(), real after(),
  // real persistence (contact/conversation/message), correct
  // whatsapp_config resolution (never crossing into account B).
  // ============================================================
  it('A/B/C — a valid, correctly-signed webhook creates contact+conversation+inbound message in the RIGHT account, and never touches account B', async () => {
    aiResponseQueue.push({ content: [{ type: 'text', text: 'Con gusto, ¿en qué te ayudo?' }], stop_reason: 'end_turn' })

    const res = await postWebhook(
      metaTextMessagePayload({
        phoneNumberId: PHONE_NUMBER_ID_A,
        from: '15551234567',
        contactName: 'Cliente Real',
        messageId: 'wamid.inbound-1',
        text: 'Hola, ¿tienen envíos?',
      }),
    )
    expect(res.status).toBe(200)
    await drainAfterCallbacks()

    const contact = backend.table('contacts').find((c) => c.phone === '15551234567')
    expect(contact).toBeTruthy()
    expect(contact!.account_id).toBe(ACCOUNT_A)

    const conversation = backend.table('conversations').find((c) => c.contact_id === contact!.id)
    expect(conversation).toBeTruthy()
    expect(conversation!.account_id).toBe(ACCOUNT_A)

    const inbound = backend.table('messages').find((m) => m.message_id === 'wamid.inbound-1')
    expect(inbound).toBeTruthy()
    expect(inbound!.sender_type).toBe('customer')
    expect(inbound!.conversation_id).toBe(conversation!.id)

    // Nothing leaked into account B.
    expect(backend.table('contacts').some((c) => c.account_id === ACCOUNT_B)).toBe(false)
    expect(backend.table('conversations').some((c) => c.account_id === ACCOUNT_B)).toBe(false)
  })

  // ============================================================
  // D + E + F — real AI dispatch, real context, real prompt
  // construction, verified at the ONE legitimate external frontier:
  // the exact request body WACRM sent to the (faked) Anthropic API.
  // ============================================================
  it('D/E/F — the real pipeline builds a real prompt (Core + Business Profile) containing the just-persisted inbound message, and reaches the real AI provider frontier', async () => {
    aiResponseQueue.push({ content: [{ type: 'text', text: 'Claro, hacemos envíos a todo el país.' }], stop_reason: 'end_turn' })

    const res = await postWebhook(
      metaTextMessagePayload({
        phoneNumberId: PHONE_NUMBER_ID_A,
        from: '15551234567',
        contactName: 'Cliente Real',
        messageId: 'wamid.inbound-2',
        text: 'hacen envios',
      }),
    )
    expect(res.status).toBe(200)
    await drainAfterCallbacks()

    const aiCall = fetchLog.find((f) => f.url.includes('api.anthropic.com'))
    expect(aiCall).toBeTruthy()
    const wireSystem = (aiCall!.body as { system: unknown }).system
    const systemText = JSON.stringify(wireSystem)
    // Business Profile context (real buildBusinessProfileContext output).
    expect(systemText).toContain(`Negocio ${ACCOUNT_A}`)
    // The conversational context passed to the model contains the
    // customer's own just-persisted message — proves E (context) real.
    const wireMessages = (aiCall!.body as { messages: { role: string; content: unknown }[] }).messages
    const flatText = JSON.stringify(wireMessages)
    expect(flatText).toContain('hacen envios')

    // The real outbound reply landed in the shared backend.
    const outbound = backend.table('messages').find((m) => m.sender_type === 'bot')
    expect(outbound).toBeTruthy()
    expect(outbound!.content_text).toBe('Claro, hacemos envíos a todo el país.')
    expect(outbound!.message_id).toMatch(/^wamid\./)
  })

  // ============================================================
  // G — real catalog tool-calling loop: AI requests a tool, the REAL
  // executeCatalogTool()/resolver runs, the result returns to a real
  // second provider turn.
  // ============================================================
  it('G — a real catalog tool call is executed by the real resolver, and its result reaches the AI\'s second turn', async () => {
    backend.table('ai_data_sources').push({
      id: nextId('ds'),
      account_id: ACCOUNT_A,
      source_type: 'uploaded_csv',
      display_name: 'Catálogo de prueba',
      usage: 'catalog',
      status: 'active',
      is_primary: true,
    })
    backend.table('ai_catalog_products').push({
      id: nextId('prod'),
      account_id: ACCOUNT_A,
      data_source_id: backend.table('ai_data_sources')[backend.table('ai_data_sources').length - 1].id,
      source_product_id: 'sku-1',
      sku: 'sku-1',
      name: 'Camisa azul',
      price: 19.99,
      currency: 'USD',
      available: true,
      available_quantity: 5,
    })

    aiResponseQueue.push({
      content: [{ type: 'tool_use', id: 'tool-1', name: 'search_catalog', input: { query: 'camisa' } }],
      stop_reason: 'tool_use',
    })
    aiResponseQueue.push({ content: [{ type: 'text', text: 'Tenemos una camisa azul a $19.99.' }], stop_reason: 'end_turn' })

    const res = await postWebhook(
      metaTextMessagePayload({
        phoneNumberId: PHONE_NUMBER_ID_A,
        from: '15551234567',
        contactName: 'Cliente Real',
        messageId: 'wamid.inbound-3',
        text: '¿Tienen camisas?',
      }),
    )
    expect(res.status).toBe(200)
    await drainAfterCallbacks()

    const anthropicCalls = fetchLog.filter((f) => f.url.includes('api.anthropic.com'))
    expect(anthropicCalls.length).toBeGreaterThanOrEqual(2) // real tool-calling loop, two real provider turns
    const secondTurnMessages = JSON.stringify((anthropicCalls[1].body as { messages: unknown }).messages)
    // The REAL tool result (from the REAL resolver/executeCatalogTool)
    // reached the model's second turn — never fabricated by the test.
    expect(secondTurnMessages).toContain('19.99')
    expect(secondTurnMessages).not.toContain('"20"') // price precision preserved end to end (H-4 regression)

    const outbound = backend.table('messages').find((m) => m.sender_type === 'bot')
    expect(outbound!.content_text).toContain('19.99')
  })

  // ============================================================
  // H — real handoff: detectHandoffIntent() runs for real, resolves
  // "general" (no name/department in the message), falls back to the
  // account's real, valid default handoff agent.
  // ============================================================
  it('H — a real handoff disables AI, marks the conversation pending, and assigns the account\'s OWN default handoff agent', async () => {
    aiResponseQueue.push({ content: [{ type: 'text', text: 'Un momento, te comunico con una persona. [[HANDOFF]]' }], stop_reason: 'end_turn' })

    const res = await postWebhook(
      metaTextMessagePayload({
        phoneNumberId: PHONE_NUMBER_ID_A,
        from: '15559998888',
        contactName: 'Cliente Handoff',
        messageId: 'wamid.handoff-1',
        text: 'Quiero hablar con una persona.',
      }),
    )
    expect(res.status).toBe(200)
    await drainAfterCallbacks()

    const contact = backend.table('contacts').find((c) => c.phone === '15559998888')
    const conversation = backend.table('conversations').find((c) => c.contact_id === contact!.id)
    expect(conversation!.ai_autoreply_disabled).toBe(true)
    expect(conversation!.status).toBe('pending')
    expect(conversation!.assigned_agent_id).toBe(AGENT_A) // real member of account A, never invented
    expect(conversation!.ai_handoff_summary).toBeTruthy()

    // No AI-generated outbound was sent — handoff means the bot stays silent.
    expect(backend.table('messages').some((m) => m.sender_type === 'bot')).toBe(false)
  })

  // ============================================================
  // J — invalid signature blocks EVERYTHING, verified via shared-state,
  // not mock-call assertions.
  // ============================================================
  it('J — an invalid signature returns 401 and produces ZERO state changes anywhere in the shared backend', async () => {
    const res = await postWebhook(
      metaTextMessagePayload({
        phoneNumberId: PHONE_NUMBER_ID_A,
        from: '15550001234',
        contactName: 'Nunca Creado',
        messageId: 'wamid.should-never-exist',
        text: 'Este mensaje nunca debe procesarse.',
      }),
      { badSignature: true },
    )
    expect(res.status).toBe(401)
    expect(afterCallbacks).toHaveLength(0) // processWebhook was never even scheduled

    expect(backend.table('contacts')).toHaveLength(0)
    expect(backend.table('conversations')).toHaveLength(0)
    expect(backend.table('messages')).toHaveLength(0)
    expect(fetchLog).toHaveLength(0) // no AI call, no Meta call — nothing ran
  })

  it('J-bis — a MISSING signature header also returns 401 and produces zero state changes', async () => {
    const res = await postWebhook(
      metaTextMessagePayload({
        phoneNumberId: PHONE_NUMBER_ID_A,
        from: '15550001234',
        contactName: 'Nunca Creado',
        messageId: 'wamid.should-never-exist-2',
        text: 'Tampoco debe procesarse.',
      }),
      { omitSignature: true },
    )
    expect(res.status).toBe(401)
    expect(backend.table('messages')).toHaveLength(0)
  })

  // ============================================================
  // K — duplicate webhook delivery (same message id) never duplicates
  // anything — the REAL insert_inbound_customer_message contract.
  // ============================================================
  it('K — the exact same webhook delivered twice never duplicates contact/conversation/message', async () => {
    aiResponseQueue.push({ content: [{ type: 'text', text: 'Primera respuesta.' }], stop_reason: 'end_turn' })
    aiResponseQueue.push({ content: [{ type: 'text', text: 'Segunda respuesta (no debería usarse).' }], stop_reason: 'end_turn' })

    const payload = metaTextMessagePayload({
      phoneNumberId: PHONE_NUMBER_ID_A,
      from: '15557778888',
      contactName: 'Cliente Duplicado',
      messageId: 'wamid.duplicate-1',
      text: 'Hola, mensaje único.',
    })

    const res1 = await postWebhook(payload)
    expect(res1.status).toBe(200)
    await drainAfterCallbacks()

    const res2 = await postWebhook(payload) // exact same message id, real Meta-retry scenario
    expect(res2.status).toBe(200)
    await drainAfterCallbacks()

    expect(backend.table('contacts').filter((c) => c.phone === '15557778888')).toHaveLength(1)
    expect(backend.table('conversations')).toHaveLength(1)
    expect(backend.table('messages').filter((m) => m.message_id === 'wamid.duplicate-1')).toHaveLength(1)
  })

  // ============================================================
  // L — a new inbound after handoff: persisted, but AI stays silent —
  // the real sticky gate (fresh-read every turn, Punto 6/9).
  // ============================================================
  it('L — a new inbound message after handoff is persisted, but the real AI gate refuses to generate a reply', async () => {
    aiResponseQueue.push({ content: [{ type: 'text', text: 'Te comunico con una persona. [[HANDOFF]]' }], stop_reason: 'end_turn' })
    const first = await postWebhook(
      metaTextMessagePayload({
        phoneNumberId: PHONE_NUMBER_ID_A,
        from: '15556665555',
        contactName: 'Cliente Post-Handoff',
        messageId: 'wamid.pre-handoff',
        text: 'Necesito hablar con alguien.',
      }),
    )
    expect(first.status).toBe(200)
    await drainAfterCallbacks()

    const contact = backend.table('contacts').find((c) => c.phone === '15556665555')
    const conversation = backend.table('conversations').find((c) => c.contact_id === contact!.id)
    expect(conversation!.ai_autoreply_disabled).toBe(true)

    fetchLog.length = 0 // reset — anything below proves the SECOND message's own behavior
    const second = await postWebhook(
      metaTextMessagePayload({
        phoneNumberId: PHONE_NUMBER_ID_A,
        from: '15556665555',
        contactName: 'Cliente Post-Handoff',
        messageId: 'wamid.post-handoff',
        text: '¿Alguien me puede ayudar?',
      }),
    )
    expect(second.status).toBe(200)
    await drainAfterCallbacks()

    // The message IS persisted (customers are never ignored)...
    expect(backend.table('messages').some((m) => m.message_id === 'wamid.post-handoff')).toBe(true)
    // ...but no AI call was made, and no new bot outbound was sent.
    expect(fetchLog.some((f) => f.url.includes('api.anthropic.com'))).toBe(false)
    expect(backend.table('messages').filter((m) => m.sender_type === 'bot')).toHaveLength(0)
  })

  // ============================================================
  // M — a real human send after handoff: persists, never re-enables
  // AI, never stomps the existing assignment (Punto 10, F-P10-2).
  // ============================================================
  it('M — a real human send after handoff persists the outbound and does not reactivate AI or overwrite the existing assignment', async () => {
    aiResponseQueue.push({ content: [{ type: 'text', text: 'Te comunico con una persona. [[HANDOFF]]' }], stop_reason: 'end_turn' })
    await postWebhook(
      metaTextMessagePayload({
        phoneNumberId: PHONE_NUMBER_ID_A,
        from: '15554443333',
        contactName: 'Cliente Humano',
        messageId: 'wamid.pre-human',
        text: 'Quiero hablar con alguien.',
      }),
    )
    await drainAfterCallbacks()

    const contact = backend.table('contacts').find((c) => c.phone === '15554443333')
    const conversation = backend.table('conversations').find((c) => c.contact_id === contact!.id)
    expect(conversation!.assigned_agent_id).toBe(AGENT_A)

    // The REAL shared send core — same one /api/whatsapp/send uses —
    // called directly (this test isn't simulating cookie-based HTTP
    // auth, exactly like send-message.test.ts's own convention).
    await sendMessageToConversation(backend.db as never, ACCOUNT_A, {
      conversationId: conversation!.id as string,
      messageType: 'text',
      contentText: 'Hola, soy un agente humano, ¿en qué te ayudo?',
      humanAgentUserId: AGENT_A,
    })

    const humanOutbound = backend
      .table('messages')
      .find((m) => m.sender_type === 'agent' && m.content_text === 'Hola, soy un agente humano, ¿en qué te ayudo?')
    expect(humanOutbound).toBeTruthy()
    expect(humanOutbound!.conversation_id).toBe(conversation!.id)

    // Assignment untouched (was already AGENT_A — never overwritten),
    // and AI stays disabled — never "helpfully" re-enabled.
    expect(conversation!.assigned_agent_id).toBe(AGENT_A)
    expect(conversation!.ai_autoreply_disabled).toBe(true)
  })

  // ============================================================
  // Multi-tenant isolation — account B has a similarly-shaped config
  // on a DIFFERENT phone_number_id; a webhook for A must never resolve
  // or touch B's rows.
  // ============================================================
  it('multi-tenant isolation — a webhook on account A\'s phone_number_id never resolves or writes account B\'s config/contact/conversation', async () => {
    aiResponseQueue.push({ content: [{ type: 'text', text: 'Respuesta de la cuenta A.' }], stop_reason: 'end_turn' })
    // Same phone number contacting BOTH accounts independently — the
    // realistic case that would reveal any account_id mix-up.
    backend.table('contacts').push({ id: nextId('contacts'), account_id: ACCOUNT_B, user_id: OWNER_B, phone: '15550009999', name: 'Mismo numero en B' })

    const res = await postWebhook(
      metaTextMessagePayload({
        phoneNumberId: PHONE_NUMBER_ID_A,
        from: '15550009999',
        contactName: 'Cliente Compartido',
        messageId: 'wamid.tenant-check',
        text: 'Hola desde la cuenta A.',
      }),
    )
    expect(res.status).toBe(200)
    await drainAfterCallbacks()

    // A NEW contact was created for account A (never reused B's row for
    // the same phone number).
    const contactsWithThisPhone = backend.table('contacts').filter((c) => c.phone === '15550009999')
    expect(contactsWithThisPhone).toHaveLength(2)
    const contactA = contactsWithThisPhone.find((c) => c.account_id === ACCOUNT_A)
    expect(contactA).toBeTruthy()

    const conversation = backend.table('conversations').find((c) => c.contact_id === contactA!.id)
    expect(conversation!.account_id).toBe(ACCOUNT_A)
    expect(backend.table('conversations').some((c) => c.account_id === ACCOUNT_B)).toBe(false)
  })
})
