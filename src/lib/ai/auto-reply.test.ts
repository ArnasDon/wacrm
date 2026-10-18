import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AiError, type AiConfig } from './types'
import { checkSharedRateLimit } from '@/lib/rate-limit'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  loadCatalogContext: vi.fn(),
  loadQuickReplyContext: vi.fn(),
  loadClinicAppointmentContext: vi.fn(),
  transitionAppointment: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  moveDeal: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  dispatchSystemAlert: vi.fn().mockResolvedValue({ opened: false, notified: false, alertId: null }),
  resolveSystemAlert: vi.fn().mockResolvedValue(undefined),
  sendCatalogToConversation: vi.fn(),
  sendRestaurantMenuToConversation: vi.fn(),
  checkFreeBusy: vi.fn(),
  createEvent: vi.fn(),
  waitForQuietPeriod: vi.fn(),
  createQuote: vi.fn(),
  sendQuoteAsText: vi.fn(),
  sendQuoteToConversation: vi.fn(),
  sendQuoteByAccountPreference: vi.fn(),
  sendMessageToConversation: vi.fn(),
  upsertReservationRequest: vi.fn(),
  loadTrailingOutbound: vi.fn(),
  countHumanRepliesAfter: vi.fn(),
  teammateTookOver: vi.fn(),
  teammateRepliedRecently: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
    openDeal: null as { id: string; pipeline_id: string; stage_id: string } | null,
    /** Per-pipeline open-deal override, keyed by pipeline_id — set only
     *  by tests exercising the 2026-09-23 per-category-pipeline scoping
     *  fix; unset (default) means every `deals` read ignores any
     *  `pipeline_id` filter and just returns `openDeal`, same as the
     *  code's own non-hotel/no-category fallback path. */
    openDealsByPipeline: null as Record<string, { id: string; pipeline_id: string; stage_id: string } | null> | null,
    stages: [] as { id: string; name: string; is_won?: boolean }[],
    aiActionLogInserts: [] as Record<string, unknown>[],
    /** A `set_contact_name` is on file — the guest stated their name (hotel close requires it). */
    guestNameLogged: true,
    /** Prior successful `schedule_appointment` rows the idempotency guard
     *  reads back — shared with `sendHotelBookingNudge`'s own dedup guard,
     *  since the mock's `ai_action_log` chain's `.limit()` doesn't
     *  distinguish by `action` either (see the `ai_action_log` mock below). */
    priorScheduleBookings: [] as { input: Record<string, unknown>; created_at?: string }[],
    pipeline: null as { id: string } | null,
    /** All of the account's pipelines (id + name), for
     *  `resolveHotelCategoryPipeline`'s name-matched lookup — empty means
     *  "no per-category pipeline", falling back to `pipeline` above. */
    pipelines: [] as { id: string; name: string }[],
    contact: { lead_temperature: null as string | null, name: 'Juan Pérez', phone: '50255551234', email: null as string | null },
    account: { default_currency: 'USD' } as { default_currency: string; name?: string; timezone?: string; catalog_delivery_mode?: string; industry_vertical?: string; restaurant_menu_url?: string | null; deposit_percent?: number },
    accountError: null as { code: string; message: string } | null,
    dealInserts: [] as Record<string, unknown>[],
    createdDeal: { id: 'new-deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' } as Record<string, unknown>,
    contactUpdates: [] as Record<string, unknown>[],
    /** `google_calendar_config.status` — null means no row (not connected). */
    gcalStatus: null as string | null,
    /** `quick_replies` row the mocked resolution lookup returns, or null. */
    quickReplyRow: null as { id: string; content_text: string } | null,
    /** Account's active `products` rows, for the create_quote_chat item-matching
     *  and send_photo product-name lookups. */
    products: [] as { id: string; name: string; image_url?: string | null; image_urls?: string[] | null; category_id?: string | null }[],
    /** `reservation_requests` row `sendHotelBookingNudge`/`sendQuoteFollowUp`
     *  look up (the in-progress booking for this conversation/product), or
     *  null when there isn't one yet. */
    reservationRow: null as Record<string, unknown> | null,
    /** Rows `loadActiveReservationsSummary` sees for the handoff recap —
     *  empty means "nothing active", the default for every non-hotel test. */
    activeReservationRows: [] as Record<string, unknown>[],
    /** `product_rates` rows for `computeStayEstimateStatus`'s proactive
     *  stay-estimate follow-up — empty means "no rates on file" (the
     *  function bails out to 'unpriceable'/'no_rates'), same default as
     *  every other hotel-pricing fixture in this file. */
    productRates: [] as Record<string, unknown>[],
    /** Payloads passed to `reservation_requests.update(...)` — currently
     *  only `computeStayEstimateStatus`'s price backfill/correction. */
    reservationRequestUpdates: [] as Record<string, unknown>[],
    /** Payloads passed to `reservation_requests.insert(...)` —
     *  `upsertReservationRequest`'s create path (`autoRecordReservation`
     *  when `h.state.reservationRow` is null, the default). */
    reservationRequestInserts: [] as Record<string, unknown>[],
    /** `product_categories.name` for whatever `category_id` a test's
     *  product carries — feeds `sendHotelBookingNudge`'s cold-start path. */
    productCategoryName: null as string | null,
    /** The account's full `product_categories` rows (id/name/banner
     *  urls) — `loadHotelCategoryBanners`/`autoSendCategoryBanner`'s
     *  multi-row lookup. */
    categories: [] as { id: string; name: string; banner_url?: string | null; banner_url_weekend?: string | null }[],
    /** Prior `ai_action_log` rows the mock hands back to WHICHEVER
     *  dedup guard reads them (`autoSendCategoryBanner`'s
     *  `send_category_banner` check, or `autoSendProductPhoto`'s
     *  `send_photo` one) — the mock doesn't distinguish by `action`
     *  since `.eq()` is inert here, same as the real query only
     *  filters differ. */
    dedupeActionLogRows: [] as { input: Record<string, unknown>; result?: Record<string, unknown>; created_at: string }[],
    /** Rows inserted via `db.from('messages').insert(...)` — currently only handOffToHuman's internal note. */
    messageInserts: [] as Record<string, unknown>[],
    /** `messages` read for `tryRecoverTransientHandoff` — a human's own
     *  reply after the handoff, or null (nobody engaged → recover). */
    humanMsgAfterHandoff: null as { id: string } | null,
    convFullSelectError: false,
    /** Rows `tryRecoverTransientHandoff`'s guarded UPDATE ... .select('id') returns. */
    recoveryUpdateRows: [{ id: 'conv-1' }] as { id: string }[],
    /** `profiles` rows `notifyHandoffUnassigned` notifies — agent+ teammates. */
    accountProfiles: [{ user_id: 'user-1' }, { user_id: 'user-2' }] as { user_id: string }[],
    /** Rows inserted via `db.from('notifications').insert(...)`. */
    notificationInserts: [] as Record<string, unknown>[],
  },
}))

vi.mock('@/lib/google-calendar/api', () => ({
  checkFreeBusy: h.checkFreeBusy,
  createEvent: h.createEvent,
  APPOINTMENT_LOOKAHEAD_MS: 7 * 24 * 60 * 60 * 1000,
}))

// Resolves instantly and "wins" by default so every existing test below
// exercises the real eligibility/send logic unchanged — the handful of
// debounce-specific tests override this per-case.
vi.mock('./debounce', () => ({ waitForQuietPeriod: h.waitForQuietPeriod }))
// Only the DB loaders are stubbed — the classification/parsing helpers
// keep their real implementation.
vi.mock('./human-reply', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./human-reply')>()
  return {
    ...actual,
    loadTrailingOutbound: h.loadTrailingOutbound,
    countHumanRepliesAfter: h.countHumanRepliesAfter,
    teammateTookOver: h.teammateTookOver,
    teammateRepliedRecently: h.teammateRepliedRecently,
  }
})
vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', async (importOriginal) => ({
  ...await importOriginal<typeof import('./context')>(),
  buildConversationContext: h.buildConversationContext,
}))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./catalog-context', () => ({ loadCatalogContext: h.loadCatalogContext }))
vi.mock('./quick-reply-context', () => ({ loadQuickReplyContext: h.loadQuickReplyContext }))
vi.mock('@/lib/clinic/appointment-context', () => ({
  loadClinicAppointmentContext: h.loadClinicAppointmentContext,
}))
vi.mock('@/lib/clinic/appointments', () => ({
  transitionAppointment: h.transitionAppointment,
}))
// Only `generateReply` is stubbed — `isRetryableAiError` (used by the
// dispatch's one-retry wrapper) keeps its real implementation.
vi.mock('./generate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./generate')>()
  return { ...actual, generateReply: h.generateReply }
})
vi.mock('@/lib/observability/alerts', () => ({
  dispatchSystemAlert: h.dispatchSystemAlert,
  resolveSystemAlert: h.resolveSystemAlert,
}))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: h.dispatchWebhookEvent }))
vi.mock('@/lib/quotes/create-quote', () => ({
  createQuote: h.createQuote,
  CreateQuoteError: class CreateQuoteError extends Error {
    status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  },
}))
vi.mock('@/lib/quotes/send-quote', () => ({
  sendQuoteAsText: h.sendQuoteAsText,
  sendQuoteToConversation: h.sendQuoteToConversation,
  sendQuoteByAccountPreference: h.sendQuoteByAccountPreference,
  SendQuoteError: class SendQuoteError extends Error {
    status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  },
}))
// Only `upsertReservationRequest` is stubbed (captures exactly what
// `autoRecordReservation` builds and hands it, e.g. to verify the
// precio guard below) — `categorySlugFromName` keeps its real
// implementation, since `auto-reply.ts` imports it from this same module.
vi.mock('@/lib/reservations/upsert', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reservations/upsert')>()
  return { ...actual, upsertReservationRequest: h.upsertReservationRequest }
})
vi.mock('@/lib/whatsapp/send-message', () => ({
  sendMessageToConversation: h.sendMessageToConversation,
  SendMessageError: class SendMessageError extends Error {
    status: number
    constructor(code: string, message: string, status = 400) {
      super(message)
      this.status = status
    }
  },
}))
vi.mock('@/lib/pipelines/move-deal', () => ({
  moveDeal: h.moveDeal,
  MoveDealError: class MoveDealError extends Error {
    status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  },
}))
vi.mock('@/lib/products/send-catalog', () => ({
  sendCatalogToConversation: h.sendCatalogToConversation,
  SendCatalogError: class SendCatalogError extends Error {
    status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  },
}))
vi.mock('@/lib/products/send-restaurant-menu', () => ({
  sendRestaurantMenuToConversation: h.sendRestaurantMenuToConversation,
  SendRestaurantMenuError: class SendRestaurantMenuError extends Error {
    status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  },
}))
// The real limiter is an in-memory counter shared across every test in
// this file (same accountId) — mocked so the growing number of tests
// here can't tip a shared counter over the real 30/min cap and start
// skipping later tests. One focused test overrides the next result to
// verify that an exhausted account does not leave its customer silent.
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>()
  return { ...actual, checkSharedRateLimit: vi.fn().mockResolvedValue({ success: true }) }
})

// `.select().eq().eq().order()` (or without `.order()`) → a multi-row
// select, resolved lazily whenever the chain is awaited (every step
// returns the same thenable chain, so it doesn't matter which call is
// last — mirrors how the real supabase-js query builder is itself a
// thenable, no separate terminal call required for a plain select-many).
function selectManyChain(getData: () => unknown) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    then: (resolve: (v: { data: unknown; error: null }) => void) =>
      resolve({ data: getData(), error: null }),
  }
  return chain
}

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'deals') {
        // .select().eq().eq().eq().order().limit().maybeSingle() → most
        // recently updated open deal for the contact — scoped to a
        // specific pipeline_id when `loadDealStageOptions`/
        // `autoMoveDealStage` resolved this conversation's category
        // pipeline (`h.state.openDealsByPipeline`, keyed by pipeline_id,
        // takes over from the unscoped `h.state.openDeal` once set —
        // see the 2026-09-23 per-category-pipeline fix's own tests).
        let pipelineIdFilter: string | undefined
        const readChain: Record<string, unknown> = {
          select: () => readChain,
          eq: (col: string, value: string) => {
            if (col === 'pipeline_id') pipelineIdFilter = value
            return readChain
          },
          order: () => readChain,
          limit: () => readChain,
          maybeSingle: () =>
            Promise.resolve({
              data:
                pipelineIdFilter && h.state.openDealsByPipeline
                  ? (h.state.openDealsByPipeline[pipelineIdFilter] ?? null)
                  : h.state.openDeal,
              error: null,
            }),
        }
        return {
          ...readChain,
          // .insert(payload).select().single() → autonomous deal creation
          // when the contact has no open deal yet.
          insert: (payload: Record<string, unknown>) => {
            h.state.dealInserts.push(payload)
            const insertChain = {
              select: () => insertChain,
              single: () => Promise.resolve({ data: h.state.createdDeal, error: null }),
            }
            return insertChain
          },
        }
      }
      if (table === 'pipelines') {
        // Two shapes share this table:
        //  - .select('id').eq().order().limit().maybeSingle() →
        //    loadDefaultPipeline (account's oldest pipeline).
        //  - .select('id, name').eq(...), awaited directly (no
        //    .maybeSingle) → resolveHotelCategoryPipeline's full list,
        //    matched by name against the active reservation category.
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: h.state.pipeline, error: null }),
          then: (onFulfilled: (v: unknown) => unknown) =>
            Promise.resolve({ data: h.state.pipelines ?? [], error: null }).then(onFulfilled),
        }
        return chain
      }
      if (table === 'pipeline_stages') {
        return selectManyChain(() => h.state.stages)
      }
      if (table === 'ai_action_log') {
        // Two read shapes share this table:
        //  - autoScheduleAppointment's idempotency guard:
        //    .select('input').eq().eq().eq().order().limit(20) → prior
        //    successful schedule_appointment rows for the contact.
        //  - autoSendCategoryBanner's AND autoSendProductPhoto's dedup
        //    guards: .select('input, created_at').eq().eq(), awaited
        //    directly (no .limit()) → prior send_category_banner /
        //    send_photo rows. The mock doesn't filter by `action` (the
        //    real query does), so both guards read the same
        //    `dedupeActionLogRows` bucket.
        //  - guestNameKnown: .eq('action', 'set_contact_name')…limit(1)
        //    → `guestNameLogged` (the only read that filters by action).
        let action: unknown = null
        const readChain: Record<string, unknown> = {
          select: () => readChain,
          eq: (col: string, val: unknown) => {
            if (col === 'action') action = val
            return readChain
          },
          gte: () => readChain,
          order: () => readChain,
          limit: () =>
            Promise.resolve({
              data: action === 'set_contact_name'
                ? (h.state.guestNameLogged ? [{ id: 'log-name' }] : [])
                : h.state.priorScheduleBookings ?? [],
              error: null,
            }),
          then: (onFulfilled: (v: unknown) => unknown) =>
            Promise.resolve({ data: h.state.dedupeActionLogRows ?? [], error: null }).then(onFulfilled),
        }
        return {
          ...readChain,
          insert: (payload: Record<string, unknown>) => {
            h.state.aiActionLogInserts.push(payload)
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      if (table === 'contacts') {
        // .select('lead_temperature' | 'name, phone').eq()...maybeSingle()
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: h.state.contact, error: null }),
        }
        return {
          ...chain,
          update: (payload: Record<string, unknown>) => {
            h.state.contactUpdates.push(payload)
            const updateChain = { eq: () => updateChain }
            return updateChain
          },
        }
      }
      if (table === 'google_calendar_config') {
        // .select('status').eq('account_id', ...).maybeSingle()
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({
              data: h.state.gcalStatus ? { status: h.state.gcalStatus } : null,
              error: null,
            }),
        }
        return chain
      }
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: h.state.account, error: h.state.accountError }),
            }),
          }),
        }
      }
      if (table === 'quick_replies') {
        // .select('id, content_text').eq('id', ...).eq('account_id', ...).eq('kind', 'text').maybeSingle()
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: h.state.quickReplyRow, error: null }),
        }
        return chain
      }
      if (table === 'products') {
        // .select('id, name').eq('account_id', ...).eq('is_active', true) → thenable
        // AND .select('category_id').eq('id', ...).maybeSingle() → sendHotelBookingNudge's cold-start lookup.
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          then: (onFulfilled: (v: unknown) => unknown) =>
            Promise.resolve({ data: h.state.products, error: null }).then(onFulfilled),
          maybeSingle: () =>
            Promise.resolve({
              data: h.state.products[0] ? { category_id: h.state.products[0].category_id ?? null } : null,
              error: null,
            }),
        }
        return chain
      }
      if (table === 'product_categories') {
        // Two shapes share this table:
        //  - .select('name').eq('id', ...).maybeSingle() →
        //    sendHotelBookingNudge's cold-start lookup for one category.
        //  - .select('...').eq('account_id', ...), awaited directly →
        //    loadHotelCategoryBanners / autoSendCategoryBanner's full
        //    account-wide list.
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({
              data: h.state.productCategoryName ? { name: h.state.productCategoryName } : null,
              error: null,
            }),
          then: (onFulfilled: (v: unknown) => unknown) =>
            Promise.resolve({ data: h.state.categories ?? [], error: null }).then(onFulfilled),
        }
        return chain
      }
      if (table === 'reservation_requests') {
        // Three shapes share this table:
        //  - .select(...).eq(...).eq(...).eq(...).eq(...).maybeSingle() →
        //    sendHotelBookingNudge's/sendQuoteFollowUp's own-row lookup.
        //  - .select(...).eq(...).eq(...).eq(...).eq(...).order(...) → an
        //    array, awaited directly (no .maybeSingle) →
        //    loadActiveReservationsSummary's handoff-recap query.
        //  - .select(...).eq(...).eq(...).eq(...).in(...).not(...).not(...)
        //    .order(...).limit(...).maybeSingle() → loadHotelStayEstimate /
        //    computeStayEstimateStatus's own lookup (`.in`/`.not` are
        //    plain passthroughs here, same as every other filter above).
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          not: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => Promise.resolve({ data: h.state.reservationRow, error: null }),
          then: (onFulfilled: (v: unknown) => unknown) =>
            Promise.resolve({ data: h.state.activeReservationRows, error: null }).then(onFulfilled),
          update: (patch: Record<string, unknown>) => {
            h.state.reservationRequestUpdates.push(patch)
            const updateChain: Record<string, unknown> = {
              eq: () => updateChain,
              then: (onFulfilled: (v: unknown) => unknown) =>
                Promise.resolve({ error: null }).then(onFulfilled),
            }
            return updateChain
          },
          // `upsertReservationRequest`'s insert path (no existing row for
          // this conversation/category — the common case, since
          // `h.state.reservationRow` defaults to null).
          insert: (payload: Record<string, unknown>) => {
            h.state.reservationRequestInserts.push(payload)
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id: 'rr-new-1' }, error: null }),
              }),
            }
          },
        }
        return chain
      }
      if (table === 'product_rates') {
        // .select(...).eq('account_id', ...).eq('product_id', ...) →
        // computeStayEstimateStatus's / loadHotelStayEstimate's rate lookup.
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          then: (onFulfilled: (v: unknown) => unknown) =>
            Promise.resolve({ data: h.state.productRates, error: null }).then(onFulfilled),
        }
        return chain
      }
      if (table === 'profiles') {
        // .select('user_id').eq('account_id', ...).in('account_role', [...]) →
        // notifyHandoffUnassigned's recipient lookup.
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          in: () => Promise.resolve({ data: h.state.accountProfiles, error: null }),
        }
        return chain
      }
      if (table === 'notifications') {
        return {
          insert: (payload: Record<string, unknown>[]) => {
            h.state.notificationInserts.push(...payload)
            return Promise.resolve({ error: null })
          },
        }
      }
      if (table === 'messages') {
        // handOffToHuman's best-effort internal-note insert +
        // tryRecoverTransientHandoff's "did a human reply?" read.
        const readChain = {
          select: () => readChain,
          eq: () => readChain,
          neq: () => readChain,
          gt: () => readChain,
          limit: () => readChain,
          maybeSingle: () =>
            Promise.resolve({ data: h.state.humanMsgAfterHandoff, error: null }),
        }
        return {
          ...readChain,
          insert: (payload: Record<string, unknown>) => {
            h.state.messageInserts.push(payload)
            return Promise.resolve({ error: null })
          },
        }
      }
      // conversations
      return {
        select: (cols: string) => ({
          eq: () => ({
            maybeSingle: () => {
              // Simulate "code deployed ahead of its migration": the full
              // eligibility select (which names the newest column) 42703s,
              // the stable-columns retry succeeds.
              if (
                h.state.convFullSelectError &&
                cols.includes('ai_flow_directive')
              ) {
                return Promise.resolve({
                  data: null,
                  error: { code: '42703', message: 'column c.ai_flow_directive does not exist' },
                })
              }
              return Promise.resolve({ data: h.state.conv, error: null })
            },
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          // Chainable + thenable: `handOffToHuman` awaits `.update().eq()`
          // (→ { error }); `tryRecoverTransientHandoff` does
          // `.update().eq().eq().select('id')` (→ { data: rows }).
          const chain: Record<string, unknown> = {
            eq: () => chain,
            or: () => chain,
            is: () => chain,
            select: () =>
              Promise.resolve({ data: h.state.recoveryUpdateRows, error: null }),
            then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
              Promise.resolve({ error: null }).then(onF, onR),
          }
          return chain
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import { dispatchInboundToAiReply, parseChildAges } from './auto-reply'
import { SendCatalogError } from '@/lib/products/send-catalog'
import { CLOSE_AVAILABILITY_AND_TOTAL_LINE, CLOSE_AVAILABILITY_LINE } from './hotel-stay-estimate'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    autoScheduleAppointmentsEnabled: false,
    askCustomerTaxInfo: false,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
    ai_handoff_transient: null,
    ai_handoff_at: null,
  }
  h.state.humanMsgAfterHandoff = null
  h.state.convFullSelectError = false
  h.state.recoveryUpdateRows = [{ id: 'conv-1' }]
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.state.openDeal = null
  h.state.openDealsByPipeline = null
  h.state.stages = []
  h.state.aiActionLogInserts = []
  h.state.guestNameLogged = true
  h.state.pipeline = null
  h.state.pipelines = []
  h.state.contact = { lead_temperature: null, name: 'Juan Pérez', phone: '50255551234', email: null }
  h.state.account = { default_currency: 'USD' }
  h.state.accountError = null
  h.state.dealInserts = []
  h.state.createdDeal = { id: 'new-deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
  h.state.contactUpdates = []
  h.state.gcalStatus = null
  h.state.priorScheduleBookings = []
  h.state.quickReplyRow = null
  h.state.products = []
  h.state.reservationRow = null
  h.state.activeReservationRows = []
  h.state.productCategoryName = null
  h.state.categories = []
  h.state.productRates = []
  h.state.reservationRequestUpdates = []
  h.state.reservationRequestInserts = []
  h.state.dedupeActionLogRows = []
  h.state.accountProfiles = [{ user_id: 'user-1' }, { user_id: 'user-2' }]
  h.state.notificationInserts = []
  h.state.messageInserts = []
  h.createQuote.mockReset()
  h.sendQuoteAsText.mockReset().mockResolvedValue(undefined)
  h.sendQuoteToConversation.mockReset().mockResolvedValue(undefined)
  h.sendQuoteByAccountPreference.mockReset().mockResolvedValue({ mode: 'message', pdfUrl: null })
  h.sendMessageToConversation.mockReset().mockResolvedValue({ messageId: 'm1', whatsappMessageId: 'wamid1' })
  h.upsertReservationRequest.mockReset().mockResolvedValue('rr-mock-1')
  h.checkFreeBusy.mockReset().mockResolvedValue([])
  h.createEvent.mockReset().mockResolvedValue({ eventId: 'evt-1', htmlLink: 'https://calendar.google.com/evt-1', meetLink: 'https://meet.google.com/abc' })
  h.waitForQuietPeriod.mockReset().mockResolvedValue(true)
  h.loadTrailingOutbound.mockReset().mockResolvedValue({ lastCustomerAt: '2026-09-26T10:00:00.000Z', humanSince: '2026-09-26T10:00:00.000Z', rows: [] })
  h.countHumanRepliesAfter.mockReset().mockResolvedValue(0)
  h.teammateTookOver.mockReset().mockResolvedValue(false)
  h.teammateRepliedRecently.mockReset().mockResolvedValue(false)
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.loadCatalogContext.mockResolvedValue(null)
  h.loadQuickReplyContext.mockResolvedValue(null)
  h.loadClinicAppointmentContext.mockResolvedValue(null)
  h.transitionAppointment.mockResolvedValue({
    ok: true,
    appointment: { id: 'appt-clinic-1', status: 'CONFIRMED' },
  })
  h.generateReply.mockResolvedValue({
    text: 'Hello!',
    handoff: false,
    markDealWon: false,
    moveToStageName: null,
    sendCatalog: false,
    sendRestaurantMenu: false,
  })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.moveDeal.mockResolvedValue({
    deal: { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-b', status: 'open' },
    isWonStage: false,
  })
  h.dispatchWebhookEvent.mockResolvedValue(undefined)
  h.sendCatalogToConversation.mockResolvedValue({ catalogUrl: 'https://example.com/catalog/acct-1' })
  h.sendRestaurantMenuToConversation.mockReset().mockResolvedValue(undefined)
})

describe('dispatchInboundToAiReply — debounce', () => {
  it('does nothing when superseded by a newer inbound before the quiet period elapses', async () => {
    h.waitForQuietPeriod.mockResolvedValue(false)
    await dispatchInboundToAiReply(ARGS)
    expect(h.loadAiConfig).not.toHaveBeenCalled()
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('waits for its conversation specifically', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.waitForQuietPeriod).toHaveBeenCalledWith('conv-1')
  })

  it('waits 3 minutes after the latest hotel message before the AI generates (owner, 2026-10-14)', async () => {
    h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel' }
    await dispatchInboundToAiReply(ARGS)
    expect(h.waitForQuietPeriod).toHaveBeenCalledWith('conv-1', 180_000)
  })

  it('passes the recent staff exchange to the hotel generation prompt', async () => {
    h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel' }
    h.buildConversationContext.mockResolvedValue([
      { role: 'assistant', content: 'El traslado del aeropuerto está pendiente.' },
      { role: 'user', content: '¿A qué hora es el check-in?' },
      { role: 'assistant', content: 'El check-in es a las 3 pm.' },
      { role: 'user', content: '¿Por qué?' },
    ])
    await dispatchInboundToAiReply(ARGS)
    const prompt = h.generateReply.mock.calls[0][0].systemPrompt
    const grounding = prompt.slice(prompt.indexOf('RECENT CONVERSATION GROUNDING'))
    expect(grounding).toContain('El check-in es a las 3 pm.')
    expect(grounding).toContain('¿Por qué?')
    expect(grounding).not.toContain('El traslado del aeropuerto está pendiente.')
  })

  it('never calls stopTyping for a call superseded before the quiet period elapses — the winner still needs the loop running', async () => {
    h.waitForQuietPeriod.mockResolvedValue(false)
    const stopTyping = vi.fn()
    await dispatchInboundToAiReply({ ...ARGS, stopTyping })
    expect(stopTyping).not.toHaveBeenCalled()
  })

  it('calls stopTyping once its own work is done, win or lose', async () => {
    const stopTyping = vi.fn()
    await dispatchInboundToAiReply({ ...ARGS, stopTyping })
    expect(stopTyping).toHaveBeenCalledTimes(1)
  })
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('never stands down for automations — Angel\'s explicit product decision (2026-08-19): the AI must always reply regardless of what automations exist on the account', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('keeps replying in DEGRADED mode when the eligibility select 42703s (column deployed ahead of its migration)', async () => {
    h.state.convFullSelectError = true
    await dispatchInboundToAiReply(ARGS)
    // The stable-columns retry carried the eligibility check, so the bot
    // still generated and sent a reply instead of going account-wide silent.
    expect(h.generateReply).toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('hands off instead of going silent when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('dificultad temporal') }),
    )
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('límite de')
  })

  it('alerts (critical) when even the continuity fallback message itself fails to send', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    h.engineSendText.mockRejectedValueOnce(new Error('channel down'))

    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()

    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        source: 'ai_dispatch_error',
        dedupKey: 'ai_fallback_send_failed:acct-1',
      }),
    )
    // The handoff itself must still happen — the fallback failing to
    // send is not a reason to leave the bot stuck replying forever.
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
  })

  it('sends a deterministic fallback when the account-wide AI limit is reached', async () => {
    vi.mocked(checkSharedRateLimit).mockResolvedValueOnce({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      limit: 30,
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('dificultad temporal') }),
    )
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      ai_handoff_transient: true,
    })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('límite de generación')
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('stands down without calling the model when a racing dispatch already answered (2026-09-03/04 incident)', async () => {
    // The newest message is the bot's own reply, not the customer's —
    // the signal that an earlier debounced dispatch for this same
    // burst already ran and answered. Regenerating here risks a
    // duplicate reply; erroring risks an unnecessary handoff (Anthropic
    // 400s a transcript that doesn't end on `user`, unretryable).
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Se dedica a dar créditos' },
      { role: 'assistant', content: '¡Buenos días! Contame más...' },
    ])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toBeNull()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('appends a recap of this conversation\'s active hotel requests to the handoff summary and internal note', async () => {
    h.state.activeReservationRows = [
      {
        category: 'habitaciones',
        service_name: 'Suite Premium',
        guests: 2,
        check_in: '2026-10-01',
        check_out: '2026-10-03',
        use_date: null,
        duration_minutes: null,
        hall: null,
        estimated_price: null,
      },
    ]
    h.generateReply.mockResolvedValue({ text: '', handoff: true, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    const expectedRecap =
      'Solicitudes activas de este cliente:\n- Habitación: Suite Premium · 01/10/2026 → 03/10/2026 · 2 personas'
    expect(h.state.updatePayload?.ai_handoff_summary).toEqual(
      expect.stringContaining(expectedRecap),
    )
    expect(h.state.messageInserts).toEqual([
      expect.objectContaining({ content_text: h.state.updatePayload?.ai_handoff_summary }),
    ])
  })

  it('lists an earlier still-pending request a newer one retired in the handoff recap (drip test 2026-09-26)', async () => {
    h.state.activeReservationRows = [
      { category: 'paquetes', service_name: 'Paquete Romántico', guests: 2, check_in: '2026-10-10', check_out: '2026-10-11', use_date: null, duration_minutes: null, hall: null, estimated_price: null, is_active_build: false },
      { category: 'paquetes', service_name: 'Paquete Romántico', guests: 2, check_in: '2026-12-20', check_out: '2026-12-21', use_date: null, duration_minutes: null, hall: null, estimated_price: null, is_active_build: true },
    ]
    h.generateReply.mockResolvedValue({ text: '', handoff: true, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload?.ai_handoff_summary).toEqual(
      expect.stringContaining('10/10/2026 → 11/10/2026 · 2 personas · solicitud anterior, sigue pendiente'),
    )
    expect(h.state.updatePayload?.ai_handoff_summary).toEqual(expect.stringContaining('20/12/2026 → 21/12/2026'))
  })

  it('leaves the handoff summary untouched when there is nothing active to recap (non-hotel, or nothing captured yet)', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload?.ai_handoff_summary).not.toContain('Solicitudes activas')
  })

  it('disables auto-reply, writes a summary, and never uses the normal AI-reply send path on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'La IA transfirió la conversación',
    )
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('acknowledges the transfer to the customer instead of leaving them with silence — real gap found 2026-09-20', async () => {
    // The model is told to emit ONLY [[HANDOFF]] on this turn (no other
    // text), so `outboundText` is empty here, same as every other test
    // in this block — before this fix, the guest who just confirmed
    // "sí, pásame con alguien" got nothing at all until a human opened
    // the thread.
    h.generateReply.mockResolvedValue({ text: '', handoff: true, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        conversationId: 'conv-1',
        messageType: 'text',
        contentText: expect.stringContaining('en un momento'),
      }),
    )
  })

  it('sends whatever text the model left alongside the sentinel instead of the default, if any', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Con gusto, ya le conecto.',
      handoff: true,
      markDealWon: false,
      moveToStageName: null,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ contentText: 'Con gusto, ya le conecto.' }),
    )
  })

  it('still hands off even when the acknowledgment send itself fails', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true, markDealWon: false, moveToStageName: null })
    h.sendMessageToConversation.mockRejectedValue(new Error('network blip'))
    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
    // Assigning fires the existing on_conversation_assigned trigger —
    // notifyHandoffUnassigned would be redundant, so it must not fire.
    expect(h.state.notificationInserts).toEqual([])
  })

  it('notifies every agent+ teammate directly when the handoff lands on nobody (migration 136)', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.notificationInserts).toEqual([
      expect.objectContaining({
        account_id: 'acct-1',
        user_id: 'user-1',
        type: 'ai_handoff',
        conversation_id: 'conv-1',
        title: 'AI needs a human',
      }),
      expect.objectContaining({
        account_id: 'acct-1',
        user_id: 'user-2',
        type: 'ai_handoff',
        conversation_id: 'conv-1',
      }),
    ])
  })

  it('does not notify when the conversation already has a human owner', async () => {
    h.state.conv = { assigned_agent_id: 'existing-agent', ai_autoreply_disabled: false }
    h.generateReply.mockResolvedValue({ text: '', handoff: true, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.notificationInserts).toEqual([])
  })

  it('leaves an internal_note message in the thread explaining the handoff, matching the banner summary (migration 083)', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.messageInserts).toEqual([
      expect.objectContaining({
        conversation_id: 'conv-1',
        sender_type: 'bot',
        content_type: 'internal_note',
        content_text: h.state.updatePayload?.ai_handoff_summary,
      }),
    ])
  })

  it('an EXPLICIT handoff is not transient — the flag is cleared, no auto-recovery', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload?.ai_handoff_transient).toBeNull()
  })

  it('the reply-cap handoff IS marked transient', async () => {
    h.state.conv = { assigned_agent_id: null, ai_autoreply_disabled: false, ai_reply_count: 3 }
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      ai_handoff_transient: true,
    })
  })
})

describe('dispatchInboundToAiReply — transient-handoff auto-recovery', () => {
  const OLD = new Date(Date.now() - 60 * 60_000).toISOString() // 60 min ago
  const RECENT = new Date(Date.now() - 5 * 60_000).toISOString() // 5 min ago

  it('resets a capped conversation so recovery does not immediately pause it again', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 3,
      ai_handoff_transient: true,
      ai_handoff_at: OLD,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello!' }),
    )
  })

  it('re-enables the bot and replies when the grace period passed and no human engaged', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
      ai_handoff_transient: true,
      ai_handoff_at: OLD,
    }
    await dispatchInboundToAiReply(ARGS)
    // first update = the recovery (re-enable + consume the flag)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: false,
      ai_handoff_transient: null,
      ai_reply_count: 0,
    })
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('does NOT recover before the grace period', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
      ai_handoff_transient: true,
      ai_handoff_at: RECENT,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toBeNull()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does NOT recover when a human already replied after the handoff', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
      ai_handoff_transient: true,
      ai_handoff_at: OLD,
    }
    h.state.humanMsgAfterHandoff = { id: 'msg-agent-1' }
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toBeNull()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does NOT recover a non-transient (explicit) handoff', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
      ai_handoff_transient: null,
      ai_handoff_at: OLD,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toBeNull()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does NOT recover if the guarded UPDATE matched no row (a concurrent explicit handoff won)', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
      ai_handoff_transient: true,
      ai_handoff_at: OLD,
    }
    h.state.recoveryUpdateRows = [] // update matched nothing
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — provider failure handling', () => {
  // Keep the retry instant so these cases don't each sleep the real
  // backoff, and pin the retry count so the assertions are exact.
  beforeEach(() => {
    process.env.AI_AUTOREPLY_RETRY_DELAY_MS = '0'
    process.env.AI_AUTOREPLY_MAX_RETRIES = '2'
  })
  afterEach(() => {
    delete process.env.AI_AUTOREPLY_RETRY_DELAY_MS
    delete process.env.AI_AUTOREPLY_MAX_RETRIES
  })

  it('retries a transient provider error, then sends the recovered reply', async () => {
    h.generateReply
      .mockRejectedValueOnce(new AiError('overloaded', { code: 'provider_error' }))
      .mockResolvedValueOnce({
        text: 'Recuperado!',
        handoff: false,
        markDealWon: false,
        moveToStageName: null,
        sendCatalog: false,
      })

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalledTimes(2)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Recuperado!' }),
    )
    // A recovered call must not also trip the failure handoff.
    expect(h.state.updatePayload).toBeNull()
  })

  it('hands off to a human when a transient provider error outlives every retry', async () => {
    h.generateReply.mockRejectedValue(new AiError('529 overloaded', { code: 'provider_error' }))

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('dificultad temporal') }),
    )
    expect(h.state.rpcCalls).toHaveLength(0) // never claimed a reply slot
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('error temporal')
    // …and leaves the matching internal note in the thread.
    expect(h.state.messageInserts).toEqual([
      expect.objectContaining({
        content_type: 'internal_note',
        content_text: h.state.updatePayload?.ai_handoff_summary,
      }),
    ])
  })

  it('routes the failure handoff to the configured agent', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockRejectedValue(new AiError('timed out', { code: 'timeout' }))

    await dispatchInboundToAiReply(ARGS)

    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })

  it('does not retry, but sends a deterministic fallback and hands off on an invalid-key error', async () => {
    h.generateReply.mockRejectedValue(new AiError('rejected', { code: 'invalid_key' }))

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('dificultad temporal') }),
    )
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      ai_handoff_transient: true,
    })
  })

  it('never throws out of dispatch even when generation keeps failing', async () => {
    h.generateReply.mockRejectedValue(new AiError('boom', { code: 'network_error' }))
    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
  })
})

describe('dispatchInboundToAiReply — marker-only reply (no customer-facing text) retries once', () => {
  // Real incident, 2026-09-20 (Villa San Ricardo, live test): on a
  // reservation-confirmation turn, gpt-5.4-mini twice in a row wrote ONLY
  // the trailing action markers (record_reservation, confirm_reservation,
  // temperature) with no customer-facing prose. The raw completion isn't
  // blank, so providers/openai.ts's own `empty_response` check never
  // fires — only `parseGeneration` stripping every marker reveals nothing
  // is left. This must retry once, same as a thrown error would, before
  // falling back.
  beforeEach(() => {
    process.env.AI_AUTOREPLY_RETRY_DELAY_MS = '0'
    process.env.AI_AUTOREPLY_MAX_RETRIES = '2'
  })
  afterEach(() => {
    delete process.env.AI_AUTOREPLY_RETRY_DELAY_MS
    delete process.env.AI_AUTOREPLY_MAX_RETRIES
  })

  it('retries once and uses the recovered reply when the first generation is markers-only', async () => {
    h.generateReply
      .mockResolvedValueOnce({ text: '', handoff: false, markDealWon: false, moveToStageName: null })
      .mockResolvedValueOnce({
        text: '¡Con gusto! Le confirmo el registro de su solicitud.',
        handoff: false,
        markDealWon: false,
        moveToStageName: null,
      })

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalledTimes(2)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: '¡Con gusto! Le confirmo el registro de su solicitud.' }),
    )
    expect(h.dispatchSystemAlert).not.toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'ai_blank_after_markers:acct-1' }),
    )
    // The empty-reply fallback path must not also fire.
    expect(h.state.updatePayload).toBeNull()
  })

  it('alerts and falls back to the continuity message when the retry is ALSO markers-only', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: false, markDealWon: false, moveToStageName: null })

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalledTimes(2)
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warning',
        dedupKey: 'ai_blank_after_markers:acct-1',
      }),
    )
    // Falls through to the existing empty-reply fallback unchanged.
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('dificultad temporal') }),
    )
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true, ai_handoff_transient: true })
  })

  it('does not retry when handoff is true, even with blank text — that shape is expected', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true, markDealWon: false, moveToStageName: null })

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.dispatchSystemAlert).not.toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'ai_blank_after_markers:acct-1' }),
    )
  })

  it('hands off normally when the retry itself throws', async () => {
    h.generateReply
      .mockResolvedValueOnce({ text: '', handoff: false, markDealWon: false, moveToStageName: null })
      .mockRejectedValue(new AiError('overloaded', { code: 'provider_error' }))

    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()

    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('dificultad temporal') }),
    )
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
  })
})

describe('dispatchInboundToAiReply — reply SEND failure hands off (non-clinic)', () => {
  // 2026-09-19 real incident: generation succeeded but the channel send
  // itself failed (a Zernio API timeout) — every vertical except clinic
  // used to just re-throw to the outer catch, which only raises a
  // `warning` alert with no retry, no holding message, and no hand-off.
  // The conversation sat unanswered for 1h45min+ with nothing but a
  // background alert. This must now behave like the clinic
  // send-after-mutation case: alert critical, attempt a holding message,
  // and hand off so a human actually sees it — but only once the retry
  // below (real incident, 2026-09-23) also comes up empty.
  //
  // Keep the retry instant so these cases don't each sleep the real
  // backoff.
  beforeEach(() => {
    process.env.AI_SEND_RETRY_DELAY_MS = '0'
  })
  afterEach(() => {
    delete process.env.AI_SEND_RETRY_DELAY_MS
    delete process.env.AI_SEND_MAX_RETRIES
  })

  it('retries a transient channel-send timeout once, then delivers the SAME already-generated reply', async () => {
    // Real incident, 2026-09-23 (Villa San Ricardo): the model had
    // already read the guest's question and generated a real answer —
    // only the Zernio SEND itself timed out. The old behavior handed
    // off immediately, leaving the guest unanswered until a human
    // noticed or the guest wrote in again on their own. A retry should
    // recover this without ever reaching the hand-off/fallback path.
    h.generateReply.mockResolvedValue({
      text: 'Le comparto la Junior Suite Familiar para 4 personas: Q1,160.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
    })
    h.engineSendText.mockRejectedValueOnce(new Error('Zernio API request timed out.'))

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalledTimes(2)
    expect(h.engineSendText).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'Le comparto la Junior Suite Familiar para 4 personas: Q1,160.' }),
    )
    expect(h.dispatchSystemAlert).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toBeNull() // never handed off
  })

  it('does not retry a non-transient send error (e.g. WhatsApp not configured) — same one attempt as before', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Con gusto le ayudo.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
    })
    h.engineSendText.mockRejectedValueOnce(new Error('WhatsApp not configured for this account'))

    await dispatchInboundToAiReply(ARGS)

    // One failed attempt at the real reply, then one holding-message
    // attempt — never a second try at the same doomed config error.
    expect(h.engineSendText).toHaveBeenCalledTimes(2)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
  })

  it('alerts critical, sends a holding message, and hands off once the retry also fails', async () => {
    h.generateReply.mockResolvedValue({
      text: 'La Junior Suite Familiar no trae desayuno incluido en esa tarifa.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
    })
    h.engineSendText.mockRejectedValue(new Error('Zernio API request timed out.'))

    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()

    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        source: 'ai_dispatch_error',
        dedupKey: 'ai_send_failed:acct-1',
      }),
    )
    // The real reply was attempted twice (initial + 1 retry) before the
    // holding message goes out on the SAME channel via the
    // self-contained continuity fallback (never the raw failed reply).
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('dificultad temporal') }),
    )
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      ai_handoff_transient: true,
    })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('el envío falló')
  })

  it('still hands off even when the holding message ALSO fails to send', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Con gusto le ayudo.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
    })
    h.engineSendText.mockRejectedValue(new Error('channel completely down'))

    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()

    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'critical', dedupKey: 'ai_send_failed:acct-1' }),
    )
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'critical', dedupKey: 'ai_fallback_send_failed:acct-1' }),
    )
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
  })
})

describe('dispatchInboundToAiReply — deal-stage prompt context', () => {
  it('tells the model the current stage and the other non-won stages it can move to', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
      { id: 'stage-c', name: 'Convencimiento' },
    ]
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('"Cotización"')
    expect(systemPrompt).toContain('"Negociación"')
    expect(systemPrompt).toContain('"Convencimiento"')
  })

  it('says nothing about stage options when the contact has no open deal and no pipeline is configured', async () => {
    h.state.openDeal = null
    h.state.pipeline = null
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('ACTION:move_deal')
  })

  it('offers the default pipeline\'s stages to create a deal into when the contact has none yet', async () => {
    h.state.openDeal = null
    h.state.pipeline = { id: 'pipe-1' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('does not have a deal yet')
    expect(systemPrompt).toContain('"Cotización"')
    expect(systemPrompt).toContain('"Negociación"')
  })

  it('says nothing about stage options when the deal has no other stage to offer', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [{ id: 'stage-a', name: 'Cotización' }]
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('ACTION:move_deal')
  })

  it('excludes a non-won stage positioned after the won stage (e.g. a post-sale "delivery follow-up" stage)', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización', is_won: false },
      { id: 'stage-b', name: 'Convencimiento', is_won: false },
      { id: 'stage-c', name: 'Venta cerrada', is_won: true },
      { id: 'stage-d', name: 'Seguimiento entrega', is_won: false },
    ]
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('"Convencimiento"')
    expect(systemPrompt).not.toContain('Seguimiento entrega')
  })

  // Real incident, 2026-09-23: the contact's only open deal sits in the
  // Habitaciones pipeline, but THIS conversation is currently about
  // Spa — the prompt must offer Spa's own "no deal yet" stage options,
  // never leak the Habitaciones deal's current stage into a completely
  // unrelated category's context.
  it('offers the CURRENT category\'s own "no deal yet" stages, not a different category\'s open deal', async () => {
    h.state.pipelines = [
      { id: 'pipe-habitaciones', name: 'Habitaciones' },
      { id: 'pipe-spa', name: 'Spa' },
    ]
    h.state.openDealsByPipeline = {
      'pipe-habitaciones': { id: 'deal-hab-1', pipeline_id: 'pipe-habitaciones', stage_id: 'stage-a' },
    }
    h.state.reservationRow = { category: 'spa' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('does not have a deal yet')
    expect(systemPrompt).toContain('"Cotización"')
    expect(systemPrompt).toContain('"Negociación"')
  })
})

describe('dispatchInboundToAiReply — purchase confirmation hands off to close', () => {
  it('pauses the bot, assigns the handoff agent, and logs flag_deal_closing — never touches the deal', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({
      text: 'All set, thanks!',
      handoff: false,
      markDealWon: true,
      moveToStageName: null,
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'All set, thanks!' }),
    )
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(h.state.aiActionLogInserts).toEqual([
      expect.objectContaining({
        account_id: 'acct-1',
        actor_user_id: 'user-1',
        action: 'flag_deal_closing',
        target_id: 'conv-1',
        input: { source: 'auto_reply_autonomous' },
      }),
    ])
  })

  it('leaves the conversation unassigned when no handoff agent is configured', async () => {
    h.generateReply.mockResolvedValue({
      text: 'All set!',
      handoff: false,
      markDealWon: true,
      moveToStageName: null,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
    expect(h.state.aiActionLogInserts).toHaveLength(1)
  })

  it('hotel: only logs flag_deal_closing — no hand-off, no assignment, no second team note (live QA 2026-09-30)', async () => {
    h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel' }
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({
      text: '¡Perfecto, Diego! Queda solicitada su Suite Premium.',
      handoff: false,
      markDealWon: true,
      moveToStageName: null,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload ?? {}).not.toHaveProperty('assigned_agent_id')
    expect(h.state.updatePayload ?? {}).not.toHaveProperty('ai_handoff_at')
    expect(h.state.messageInserts.filter((m) => String(m.content_text ?? '').includes('confirmó explícitamente la compra'))).toHaveLength(0)
    expect(h.state.aiActionLogInserts.filter((r) => r.action === 'flag_deal_closing')).toHaveLength(1)
  })

  it('does not touch any deal when the model does not signal confirmation', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    await dispatchInboundToAiReply(ARGS) // default mock: markDealWon: false
    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(h.state.aiActionLogInserts).toEqual([])
  })
})

describe('dispatchInboundToAiReply — autonomous move_deal', () => {
  it('advances the deal to the named stage and logs it', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Perfecto, seguimos.',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Negociación',
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.moveDeal).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'deal-1', 'stage-b')
    expect(h.state.aiActionLogInserts).toEqual([
      expect.objectContaining({
        account_id: 'acct-1',
        actor_user_id: 'user-1',
        action: 'move_deal',
        target_id: 'deal-1',
        input: { stageId: 'stage-b', stageName: 'Negociación', source: 'auto_reply_autonomous' },
      }),
    ])
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'deal.stage_changed',
      expect.objectContaining({ deal_id: 'deal-1', source: 'auto_reply_autonomous' }),
    )
  })

  it('matches the stage name case-insensitively', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'negociación',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.moveDeal).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'deal-1', 'stage-b')
  })

  it('does nothing when the named stage does not match any of the pipeline\'s non-won stages', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [{ id: 'stage-a', name: 'Cotización' }]
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Etapa inventada',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(h.state.aiActionLogInserts).toEqual([])
  })

  it('refuses to move into a post-sale stage even if the model names it exactly', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización', is_won: false },
      { id: 'stage-c', name: 'Venta cerrada', is_won: true },
      { id: 'stage-d', name: 'Seguimiento entrega', is_won: false },
    ]
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Seguimiento entrega',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(h.state.aiActionLogInserts).toEqual([])
  })

  it('does nothing when the named stage is already the deal\'s current stage', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Cotización',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.moveDeal).not.toHaveBeenCalled()
  })

  it('creates a deal at the named stage instead of moving one, when the contact has no open deal', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Sure thing!',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Negociación',
    })
    h.state.openDeal = null
    h.state.pipeline = { id: 'pipe-1' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalled()
    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(h.state.dealInserts).toHaveLength(1)
    expect(h.state.dealInserts[0]).toMatchObject({
      account_id: 'acct-1',
      pipeline_id: 'pipe-1',
      stage_id: 'stage-b',
      contact_id: 'contact-1',
      title: 'Juan Pérez',
      value: 0,
      currency: 'USD',
      status: 'open',
    })
    expect(h.state.aiActionLogInserts).toEqual([
      expect.objectContaining({ action: 'create_deal', target_id: 'new-deal-1' }),
    ])
  })

  it('swallows a moveDeal failure — the already-sent reply is unaffected', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Sure thing!',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Negociación',
    })
    h.moveDeal.mockRejectedValue(new Error('deal not found in this pipeline'))

    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
    expect(h.engineSendText).toHaveBeenCalled()
    expect(h.state.aiActionLogInserts).toEqual([])
  })

  it('a purchase confirmation takes priority over a same-turn stage-move signal', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'All set!',
      handoff: false,
      markDealWon: true,
      moveToStageName: 'Negociación',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(h.state.aiActionLogInserts).toEqual([
      expect.objectContaining({ action: 'flag_deal_closing' }),
    ])
  })

  // Real incident, 2026-09-23 (7-case live QA run, DEMO account): moves
  // a deal that already exists IN THIS CONVERSATION'S OWN CATEGORY
  // pipeline — the fix's positive case, mirrored by the "different
  // pipeline" negative case in the create_deal block below.
  it('moves the deal already open in the CURRENT category\'s own pipeline, when one exists there', async () => {
    h.state.pipelines = [
      { id: 'pipe-default', name: 'Ventas' },
      { id: 'pipe-spa', name: 'Spa' },
    ]
    h.state.reservationRow = { category: 'spa' }
    h.state.openDealsByPipeline = {
      'pipe-spa': { id: 'deal-spa-1', pipeline_id: 'pipe-spa', stage_id: 'stage-a' },
    }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Negociación',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.moveDeal).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'deal-spa-1', 'stage-b')
    expect(h.state.dealInserts).toHaveLength(0)
  })
})

describe('dispatchInboundToAiReply — autonomous create_deal', () => {
  it('does nothing when no pipeline is configured at all', async () => {
    h.state.openDeal = null
    h.state.pipeline = null
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Negociación',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.dealInserts).toEqual([])
    expect(h.state.aiActionLogInserts).toEqual([])
  })

  it('does nothing when the named stage does not match any of the default pipeline\'s stages', async () => {
    h.state.openDeal = null
    h.state.pipeline = { id: 'pipe-1' }
    h.state.stages = [{ id: 'stage-a', name: 'Cotización' }]
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Etapa inventada',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.dealInserts).toEqual([])
    expect(h.state.aiActionLogInserts).toEqual([])
  })

  it('falls back to the phone number as the title when the contact has no name', async () => {
    h.state.openDeal = null
    h.state.pipeline = { id: 'pipe-1' }
    h.state.stages = [{ id: 'stage-a', name: 'Cotización' }]
    h.state.contact = { lead_temperature: null, name: '', phone: '50255551234' } as unknown as typeof h.state.contact
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Cotización',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.dealInserts[0]).toMatchObject({ title: '50255551234' })
  })

  it('dispatches deal.stage_changed for a newly created deal', async () => {
    h.state.openDeal = null
    h.state.pipeline = { id: 'pipe-1' }
    h.state.stages = [{ id: 'stage-a', name: 'Cotización' }]
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Cotización',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'deal.stage_changed',
      expect.objectContaining({ deal_id: 'new-deal-1', source: 'auto_reply_autonomous' }),
    )
  })

  it('routes a new deal to the pipeline matching this conversation\'s active reservation category, not the default one', async () => {
    h.state.openDeal = null
    h.state.pipeline = { id: 'pipe-default' } // would be used if category routing found nothing
    h.state.pipelines = [
      { id: 'pipe-default', name: 'Ventas' },
      { id: 'pipe-spa', name: 'Spa' },
    ]
    h.state.reservationRow = { category: 'spa' }
    h.state.stages = [{ id: 'stage-a', name: 'Cotización' }]
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Cotización',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.dealInserts[0]).toMatchObject({ pipeline_id: 'pipe-spa' })
  })

  // Real incident, 2026-09-23 (7-case live QA run, DEMO account): a
  // contact's open deal in ONE category's pipeline (Habitaciones) used
  // to get reused — and its stage yanked around — for every OTHER
  // category the same contact asked about in the same conversation,
  // because the old lookup was "the contact's most recently updated
  // open deal", full stop, with no pipeline filter. Angel's own "un
  // pipeline por categoría" pipelines (2026-09-17) need a SEPARATE deal
  // per category to actually mean anything.
  it('creates a NEW deal in the category\'s own pipeline instead of reusing/moving an open deal that belongs to a DIFFERENT pipeline', async () => {
    h.state.pipelines = [
      { id: 'pipe-habitaciones', name: 'Habitaciones' },
      { id: 'pipe-spa', name: 'Spa' },
    ]
    // The contact already has an open deal — but in Habitaciones, not Spa.
    h.state.openDealsByPipeline = {
      'pipe-habitaciones': { id: 'deal-hab-1', pipeline_id: 'pipe-habitaciones', stage_id: 'stage-a' },
    }
    h.state.reservationRow = { category: 'spa' }
    h.state.stages = [{ id: 'stage-a', name: 'Cotización' }]
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Cotización',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(h.state.dealInserts).toHaveLength(1)
    expect(h.state.dealInserts[0]).toMatchObject({ pipeline_id: 'pipe-spa' })
  })

  it('falls back to the default pipeline when the active category has no matching pipeline', async () => {
    h.state.openDeal = null
    h.state.pipeline = { id: 'pipe-default' }
    h.state.pipelines = [{ id: 'pipe-default', name: 'Ventas' }] // no "Eventos" pipeline
    h.state.reservationRow = { category: 'eventos' }
    h.state.stages = [{ id: 'stage-a', name: 'Cotización' }]
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Cotización',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.dealInserts[0]).toMatchObject({ pipeline_id: 'pipe-default' })
  })

  it('falls back to the default pipeline for a non-hotel account (no active reservation category at all)', async () => {
    h.state.openDeal = null
    h.state.pipeline = { id: 'pipe-default' }
    h.state.pipelines = [{ id: 'pipe-default', name: 'Ventas' }]
    h.state.reservationRow = null
    h.state.stages = [{ id: 'stage-a', name: 'Cotización' }]
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Cotización',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.dealInserts[0]).toMatchObject({ pipeline_id: 'pipe-default' })
  })
})

describe('dispatchInboundToAiReply — autonomous set_temperature', () => {
  it('sets the temperature and logs it when the model signals a new value', async () => {
    h.state.contact = { lead_temperature: null, name: 'Juan Pérez', phone: '50255551234', email: null }
    h.generateReply.mockResolvedValue({
      text: 'Claro que sí!',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      leadTemperature: 'hot',
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.state.contactUpdates).toEqual([
      expect.objectContaining({ lead_temperature: 'hot' }),
    ])
    expect(h.state.aiActionLogInserts).toEqual([
      expect.objectContaining({
        action: 'set_lead_temperature',
        target_id: 'contact-1',
        input: { temperature: 'hot', source: 'auto_reply_autonomous' },
      }),
    ])
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'contact.lead_temperature_changed',
      expect.objectContaining({ contact_id: 'contact-1', lead_temperature: 'hot' }),
    )
  })

  it('does nothing when the model does not signal a temperature', async () => {
    await dispatchInboundToAiReply(ARGS) // default mock: no leadTemperature
    expect(h.state.contactUpdates).toEqual([])
  })

  it('skips the write when the temperature is unchanged', async () => {
    h.state.contact = { lead_temperature: 'warm', name: 'Juan Pérez', phone: '50255551234', email: null }
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      leadTemperature: 'warm',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.contactUpdates).toEqual([])
    expect(h.state.aiActionLogInserts).toEqual([])
  })

  it('fires independently alongside an autonomous stage move in the same turn', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Perfecto, seguimos.',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Negociación',
      leadTemperature: 'hot',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.moveDeal).toHaveBeenCalled()
    expect(h.state.contactUpdates).toEqual([
      expect.objectContaining({ lead_temperature: 'hot' }),
    ])
  })
})

describe('dispatchInboundToAiReply — autonomous schedule_appointment', () => {
  it('never mentions scheduling in the prompt when the toggle is off, even with Calendar connected', async () => {
    h.state.gcalStatus = 'connected'
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('ACTION:schedule_appointment')
    expect(h.checkFreeBusy).not.toHaveBeenCalled()
  })

  it('never mentions scheduling when the toggle is on but Calendar is not connected', async () => {
    h.state.gcalStatus = null
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: true }))
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('ACTION:schedule_appointment')
    expect(h.checkFreeBusy).not.toHaveBeenCalled()
  })

  it('offers real free/busy data and the contact email in the prompt when toggle is on and Calendar is connected', async () => {
    h.state.gcalStatus = 'connected'
    h.state.contact = { lead_temperature: null, name: 'Ana', phone: '502...', email: 'ana@example.com' }
    h.checkFreeBusy.mockResolvedValue([{ start: '2026-06-01T10:00:00Z', end: '2026-06-01T11:00:00Z' }])
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: true }))
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('ACTION:schedule_appointment')
    expect(systemPrompt).toContain('ana@example.com')
    // Reformatted with an explicit offset (falls back to UTC here since
    // the mocked account has no `timezone` field) — never a bare "Z".
    expect(systemPrompt).toContain('2026-06-01T10:00:00+00:00')
  })

  it('formats "now" using the account\'s real timezone, not bare UTC', async () => {
    h.state.gcalStatus = 'connected'
    h.state.account = { default_currency: 'USD', timezone: 'America/Guatemala' }
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: true }))
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('America/Guatemala')
    expect(systemPrompt).toContain('-06:00')
    expect(systemPrompt).not.toMatch(/is \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/)
  })

  it('books the event, logs it, and dispatches the webhook when the model proposes a free slot', async () => {
    h.state.gcalStatus = 'connected'
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: true }))
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const start = future.toISOString()
    const end = new Date(future.getTime() + 60 * 60 * 1000).toISOString()
    h.generateReply.mockResolvedValue({
      text: 'Listo, tu cita queda confirmada.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      appointmentProposal: { start, end, email: 'ana@example.com' },
    })
    h.checkFreeBusy.mockResolvedValue([]) // both the prompt-time and pre-booking re-check see it free

    await dispatchInboundToAiReply(ARGS)

    expect(h.createEvent).toHaveBeenCalledWith(
      expect.anything(), 'acct-1',
      expect.objectContaining({ startISO: start, endISO: end, attendeeEmail: 'ana@example.com', timeZone: 'UTC' }),
    )
    expect(h.state.aiActionLogInserts).toContainEqual(
      expect.objectContaining({
        action: 'schedule_appointment', target_id: 'contact-1',
        input: expect.objectContaining({ attendeeEmail: 'ana@example.com', source: 'auto_reply_autonomous' }),
      }),
    )
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(), 'acct-1', 'appointment.scheduled',
      expect.objectContaining({ contact_id: 'contact-1', event_id: 'evt-1', source: 'auto_reply_autonomous' }),
    )
  })

  it('never books when the toggle is off, even if the model output somehow contains a proposal', async () => {
    h.state.gcalStatus = 'connected'
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: false }))
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      appointmentProposal: {
        start: future.toISOString(),
        end: new Date(future.getTime() + 60 * 60 * 1000).toISOString(),
        email: 'ana@example.com',
      },
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.createEvent).not.toHaveBeenCalled()
  })

  it('skips booking when the fresh free/busy re-check shows the slot is no longer free', async () => {
    h.state.gcalStatus = 'connected'
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: true }))
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      appointmentProposal: { start: start.toISOString(), end: end.toISOString(), email: 'ana@example.com' },
    })
    // Prompt-time freebusy sees it free; the pre-booking re-check (2nd
    // call) sees it's since been taken.
    h.checkFreeBusy.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { start: start.toISOString(), end: end.toISOString() },
    ])
    await dispatchInboundToAiReply(ARGS)
    expect(h.createEvent).not.toHaveBeenCalled()
  })

  it('does not re-book or false-alarm when the same slot is already booked for the contact', async () => {
    // Real incident (2026-09-01): after the customer replied "gracias",
    // the model emitted the schedule marker again for the SAME slot; the
    // freebusy re-check then saw the event this flow had just created as
    // a conflict and handed off with a misleading "slot no longer
    // available" note. The idempotency guard makes the repeat a no-op.
    h.state.gcalStatus = 'connected'
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: true }))
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    h.state.priorScheduleBookings = [
      { input: { startTime: start.toISOString(), endTime: end.toISOString(), attendeeEmail: 'ana@example.com' } },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Perfecto, tu cita queda confirmada.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      appointmentProposal: { start: start.toISOString(), end: end.toISOString(), email: 'ana@example.com' },
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.createEvent).not.toHaveBeenCalled()
    // Only the prompt-time freebusy ran — no pre-booking re-check.
    expect(h.checkFreeBusy).toHaveBeenCalledTimes(1)
    // No "couldn't schedule" handoff note left in the thread.
    expect(h.state.messageInserts).not.toContainEqual(
      expect.objectContaining({ content_type: 'internal_note' }),
    )
  })

  it('skips booking when the proposed email is invalid', async () => {
    h.state.gcalStatus = 'connected'
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: true }))
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000)
    h.generateReply.mockResolvedValue({
      text: 'ok',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      appointmentProposal: {
        start: future.toISOString(),
        end: new Date(future.getTime() + 60 * 60 * 1000).toISOString(),
        email: 'not-an-email',
      },
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.createEvent).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — catalog context in prompt', () => {
  it('retains catalog grounding when knowledge retrieval fails', async () => {
    h.retrieveKnowledge.mockRejectedValue(new Error('knowledge unavailable'))
    h.loadCatalogContext.mockResolvedValue(['- Suite Familiar (Q950)'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply.mock.calls[0][0].systemPrompt).toContain('Suite Familiar (Q950)')
  })
  it('includes catalog lines in the system prompt when the account has active products', async () => {
    h.loadCatalogContext.mockResolvedValue(['- Camisa (Q150)', '- Pantalón (Q250)'])
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Camisa (Q150)')
    expect(systemPrompt).toContain('Pantalón (Q250)')
  })

  it('says nothing about a catalog when the account has no active products', async () => {
    h.loadCatalogContext.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('ACTION:send_catalog')
    expect(systemPrompt).not.toContain('Product catalog')
  })
})

describe('dispatchInboundToAiReply — autonomous send_catalog', () => {
  beforeEach(() => {
    // The marker only counts when the customer actually asked for it.
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '¿Me manda el catálogo?' }])
  })

  it('sends the catalog when the model asks for it', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Claro, aquí tienes nuestro catálogo.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: true,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendCatalogToConversation).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'conv-1', 'agent')
  })

  it('suppresses the marker when the customer only asked a price (2026-10-06, owner rule)', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Buenas noches' },
      { role: 'user', content: 'Quisiera saber el costo por noche ?' },
    ])
    h.generateReply.mockResolvedValue({
      text: 'Con gusto le comparto las tarifas. ¿Para qué fechas y cuántas personas?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: true,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendCatalogToConversation).not.toHaveBeenCalled()
  })

  it('sends the catalog when the customer accepts the bot\'s own offer', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Hola' },
      { role: 'assistant', content: '¡Hola! ¿Te gustaría que te comparta nuestro catálogo de camas?' },
      { role: 'user', content: 'Sí, porfa' },
    ])
    h.generateReply.mockResolvedValue({
      text: '¡Con mucho gusto!',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: true,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendCatalogToConversation).toHaveBeenCalled()
  })

  it('does not send the catalog when the model does not ask for it', async () => {
    await dispatchInboundToAiReply(ARGS) // default mock: sendCatalog false
    expect(h.sendCatalogToConversation).not.toHaveBeenCalled()
  })

  it('still sends the catalog when the model forgets the marker but the customer plainly asked for it (2026-09-11 incident)', async () => {
    h.loadCatalogContext.mockResolvedValue(['- Suite Premium (Q350)'])
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Me envían su catálogo porfavor?' }])
    h.generateReply.mockResolvedValue({
      text: 'Claro, te comparto el catálogo 😊', // the marker never made it into the raw output
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.sendCatalogToConversation).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'conv-1', 'agent')
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'ai_marker_missed_send_catalog:acct-1' }),
    )
  })

  it('does not force-send when there is no catalog to offer, even if the customer asks', async () => {
    h.loadCatalogContext.mockResolvedValue(null)
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '¿Tienen catálogo?' }])
    await dispatchInboundToAiReply(ARGS) // default mock: sendCatalog false
    expect(h.sendCatalogToConversation).not.toHaveBeenCalled()
  })

  it('fires alongside an autonomous stage move in the same turn', async () => {
    h.state.openDeal = { id: 'deal-1', pipeline_id: 'pipe-1', stage_id: 'stage-a' }
    h.state.stages = [
      { id: 'stage-a', name: 'Cotización' },
      { id: 'stage-b', name: 'Negociación' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes el catálogo, y seguimos negociando.',
      handoff: false,
      markDealWon: false,
      moveToStageName: 'Negociación',
      sendCatalog: true,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendCatalogToConversation).toHaveBeenCalled()
    expect(h.moveDeal).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'deal-1', 'stage-b')
  })

  it('swallows a send failure and alerts — the already-sent reply is unaffected', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: true,
    })
    h.sendCatalogToConversation.mockRejectedValue(new SendCatalogError('No active products in the catalog yet.'))

    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
    expect(h.engineSendText).toHaveBeenCalled()
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warning',
        dedupKey: 'ai_send_catalog_failed:acct-1',
        detail: expect.objectContaining({ message: 'No active products in the catalog yet.' }),
      }),
    )
  })

  it('does not cascade — a non-SendCatalogError still alerts but lets an independent same-turn action run', async () => {
    h.state.contact = { lead_temperature: null, name: 'Juan Pérez', phone: '50255551234', email: null }
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes el catálogo.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: true,
      leadTemperature: 'hot',
    })
    h.sendCatalogToConversation.mockRejectedValue(new Error('network blip'))

    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()

    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Aquí tienes el catálogo.' }),
    )
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'ai_send_catalog_failed:acct-1' }),
    )
    // Previously this rethrew a non-SendCatalogError straight to the
    // outer catch, silently skipping every autonomous action listed
    // after send_catalog — including this one.
    expect(h.state.contactUpdates).toEqual([
      expect.objectContaining({ lead_temperature: 'hot' }),
    ])
  })
})

describe('dispatchInboundToAiReply — autonomous send_photo', () => {
  it('sends the matched product\'s photo when the model asks for one', async () => {
    h.state.products = [
      { id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Claro, aquí la tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        conversationId: 'conv-1',
        messageType: 'image',
        mediaUrl: 'https://cdn.example.com/suite.jpg',
        senderType: 'bot',
      }),
    )
  })

  it('does not send anything when the model does not ask for a photo', async () => {
    await dispatchInboundToAiReply(ARGS) // default mock: sendPhotoProductName undefined
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('matches the product name case-insensitively', async () => {
    h.state.products = [
      { id: 'p1', name: 'Paquete Romántico', image_url: 'https://cdn.example.com/romantico.jpg' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'paquete romántico',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ mediaUrl: 'https://cdn.example.com/romantico.jpg' }),
    )
  })

  it('sends every photo in the product\'s gallery, not just the first', async () => {
    h.state.products = [
      {
        id: 'p1',
        name: 'Junior Suite Familiar',
        image_url: 'https://cdn.example.com/familiar-1.jpg',
        image_urls: [
          'https://cdn.example.com/familiar-1.jpg',
          'https://cdn.example.com/familiar-2.jpg',
          'https://cdn.example.com/familiar-3.jpg',
        ],
      },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Con gusto le comparto las fotos.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Junior Suite Familiar',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(3)
    ;['familiar-1', 'familiar-2', 'familiar-3'].forEach((slug, i) => {
      expect(h.sendMessageToConversation).toHaveBeenNthCalledWith(
        i + 1,
        expect.anything(),
        'acct-1',
        expect.objectContaining({
          conversationId: 'conv-1',
          messageType: 'image',
          mediaUrl: `https://cdn.example.com/${slug}.jpg`,
          senderType: 'bot',
        }),
      )
    })
  })

  it('only captions the FIRST photo of a multi-image gallery — real incident 2026-09-21: repeating the product name on all 5 bubbles read like a glitch', async () => {
    h.state.products = [
      {
        id: 'p1',
        name: 'Suite Clásica (Individual o Pareja)',
        image_url: 'https://cdn.example.com/clasica-1.jpg',
        image_urls: [
          'https://cdn.example.com/clasica-1.jpg',
          'https://cdn.example.com/clasica-2.jpg',
        ],
      },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Claro, le envío la foto.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Clásica (Individual o Pareja)',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        mediaUrl: 'https://cdn.example.com/clasica-1.jpg',
        contentText: 'Suite Clásica (Individual o Pareja)',
      }),
    )
    expect(h.sendMessageToConversation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        mediaUrl: 'https://cdn.example.com/clasica-2.jpg',
        contentText: undefined,
      }),
    )
  })

  it('falls back to the single image_url when the gallery is empty (pre-migration data)', async () => {
    h.state.products = [
      { id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg', image_urls: [] },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ mediaUrl: 'https://cdn.example.com/suite.jpg' }),
    )
  })

  it('sends nothing when the name matches no real active product — never an arbitrary image', async () => {
    h.state.products = [{ id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg' }]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Producto Inventado',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('sends nothing when the matched product has no photo on file — not an error', async () => {
    h.state.products = [{ id: 'p1', name: 'Suite Premium', image_url: null }]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(h.dispatchSystemAlert).not.toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'ai_send_photo_failed:acct-1' }),
    )
  })

  it('never sends the same product\'s photo twice in one conversation', async () => {
    h.state.products = [{ id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg' }]
    h.state.dedupeActionLogRows = [
      { input: { conversation_id: 'conv-1', product_name: 'Suite Premium' }, created_at: '2026-09-01T00:00:00.000Z' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tiene de nuevo.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('a prior photo send in a DIFFERENT conversation does not block sending in this one', async () => {
    h.state.products = [{ id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg' }]
    h.state.dedupeActionLogRows = [
      { input: { conversation_id: 'some-other-conv' }, created_at: '2026-09-01T00:00:00.000Z' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tiene.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalled()
  })

  it('a reset (ai_context_reset_at) allows the product photo to be sent again', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
      ai_handoff_transient: null,
      ai_handoff_at: null,
      ai_context_reset_at: '2026-09-18T17:00:00.000Z',
    }
    h.state.products = [{ id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg' }]
    h.state.dedupeActionLogRows = [
      // Sent BEFORE the reset — must not count.
      { input: { conversation_id: 'conv-1' }, created_at: '2026-09-10T00:00:00.000Z' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tiene.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalled()
  })

  it('swallows an actual send failure and alerts — the already-sent reply is unaffected', async () => {
    h.state.products = [{ id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg' }]
    h.generateReply.mockResolvedValue({
      text: 'Aquí la tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    h.sendMessageToConversation.mockRejectedValue(new Error('network blip'))

    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Aquí la tienes.' }),
    )
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'ai_send_photo_failed:acct-1' }),
    )
  })

  it('non-hotel account: sends the photo and nothing else (no booking nudge)', async () => {
    h.state.products = [{ id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg' }]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1)
  })

  it('hotel vertical, no reservation started yet: nudges for the category\'s missing fields', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '¿Tiene fotos de la Suite Premium?' }])
    h.state.account = { default_currency: 'USD', industry_vertical: 'hotel' }
    h.state.products = [
      { id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg', category_id: 'cat-1' },
    ]
    h.state.productCategoryName = 'Habitaciones'
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(2)
    expect(h.sendMessageToConversation).toHaveBeenLastCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        messageType: 'text',
        contentText:
          '¿Le gustaría reservarla? Con mucho gusto se la dejo lista; solo necesito las fechas de entrada y salida y el número de personas. 😊',
      }),
    )
  })

  it('hotel vertical, a reservation is already in progress for this product: only names what is still missing', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '¿Tiene fotos de la Suite Premium?' }])
    h.state.account = { default_currency: 'USD', industry_vertical: 'hotel' }
    h.state.products = [
      { id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg', category_id: 'cat-1' },
    ]
    h.state.productCategoryName = 'Habitaciones'
    h.state.reservationRow = {
      category: 'habitaciones',
      guests: null,
      check_in: '2026-10-01',
      check_out: '2026-10-03',
      use_date: null,
      hall: null,
    }
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenLastCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        contentText: '¿Le gustaría reservarla? Con mucho gusto se la dejo lista; solo necesito el número de personas. 😊',
      }),
    )
  })

  it('hotel vertical, the exact same nudge was already sent: does not repeat it — real incident 2026-09-21: the same "me falta las fechas..." nudge fired twice within two minutes for two different rooms', async () => {
    h.state.account = { default_currency: 'USD', industry_vertical: 'hotel' }
    h.state.products = [
      { id: 'p1', name: 'Suite Clásica (Individual o Pareja)', image_url: 'https://cdn.example.com/clasica.jpg', category_id: 'cat-1' },
    ]
    h.state.productCategoryName = 'Habitaciones'
    h.state.priorScheduleBookings = [
      {
        input: {
          // Sent with a DIFFERENT wording variant; the dedupe keys on the
          // signature (what is missing), not the rotating text.
          text: 'Si le gusta, será un placer apartársela. ¿Me comparte las fechas de entrada y salida y el número de personas?',
          signature: '¿Le gustaría reservarla? Con mucho gusto se la dejo lista; solo necesito las fechas de entrada y salida y el número de personas. 😊',
        },
        created_at: '2026-09-21T16:32:00.000Z',
      },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Claro, le envío la foto de la Suite Clásica.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Clásica (Individual o Pareja)',
    })
    await dispatchInboundToAiReply(ARGS)
    // The photo still sends — only the repeated text nudge is skipped.
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1)
    expect(h.sendMessageToConversation).not.toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ messageType: 'text' }),
    )
  })

  it('hotel vertical, reservation already complete: no recap/"¿Confirmamos?" nudge after the photo (2026-09-24 test run)', async () => {
    h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel' }
    h.state.products = [
      { id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg', category_id: 'cat-1' },
    ]
    h.state.productCategoryName = 'Habitaciones'
    h.state.reservationRow = {
      category: 'habitaciones',
      service_name: 'Suite Premium',
      guests: 2,
      check_in: '2026-10-01',
      check_out: '2026-10-03',
      use_date: null,
      hall: null,
      estimated_price: 1200,
    }
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ contentText: expect.stringContaining('Perfecto, esto sería') }),
    )
  })

  it('hotel vertical, a booking message naming a room is not a photo request: no photo (owner, 2026-09-24)', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Quiero 2 Suite Premium del 24 al 26 de octubre' }])
    h.state.account = { default_currency: 'USD', industry_vertical: 'hotel' }
    h.state.products = [
      { id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg', category_id: 'cat-1' },
    ]
    h.state.productCategoryName = 'Habitaciones'
    h.generateReply.mockResolvedValue({
      text: 'Con gusto le ayudo con las dos Suite Premium.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ messageType: 'image' }),
    )
  })

  it('hotel vertical, the reply promises the photo: it still goes out even without a photo request', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Quiero la Suite Premium' }])
    h.state.account = { default_currency: 'USD', industry_vertical: 'hotel' }
    h.state.products = [
      { id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg', category_id: 'cat-1' },
    ]
    h.state.productCategoryName = 'Habitaciones'
    h.generateReply.mockResolvedValue({
      text: 'Le envío la foto de la Suite Premium.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ messageType: 'image', mediaUrl: 'https://cdn.example.com/suite.jpg' }),
    )
  })

  it('hotel vertical, "si" to the bot photo offer with a marker-only reply: sends the photo and a short line, not the fallback (live test 2026-09-24)', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'y como es?' },
      { role: 'assistant', content: 'La Suite Premium es ideal para parejas. ¿Le gustaría que le comparta una foto de la habitación?' },
      { role: 'user', content: 'si' },
    ])
    h.state.account = { default_currency: 'USD', industry_vertical: 'hotel' }
    h.state.products = [
      { id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg', category_id: 'cat-1' },
    ]
    h.state.productCategoryName = 'Habitaciones'
    h.generateReply.mockResolvedValue({
      text: '',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Premium',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ messageType: 'image', mediaUrl: 'https://cdn.example.com/suite.jpg' }),
    )
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: '¡Con mucho gusto! Aquí puede ver la Suite Premium. 😊' }),
    )
    expect(h.engineSendText).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('dificultad temporal') }),
    )
  })

  it('hotel vertical, "y como es?" without naming the room: sends the photo of the room the guest just asked about', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'cuanto sale la premium' },
      { role: 'assistant', content: 'Tiene tarifa de Q700 de domingo a jueves. ¿Para qué fechas la desea?' },
      { role: 'user', content: 'y como es?' },
    ])
    h.state.account = { default_currency: 'USD', industry_vertical: 'hotel' }
    h.state.products = [
      { id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg', category_id: 'cat-1' },
      { id: 'p2', name: 'Junior Suite Familiar', image_url: 'https://cdn.example.com/junior.jpg', category_id: 'cat-1' },
    ]
    h.state.productCategoryName = 'Habitaciones'
    h.generateReply.mockResolvedValue({
      text: 'Es ideal para parejas, con 2 camas Queen y baño privado. ¿Para qué fechas la desea?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ messageType: 'image', mediaUrl: 'https://cdn.example.com/suite.jpg' }),
    )
  })

  it('hotel vertical, product is in a non-bookable category: no nudge, just the photo', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '¿Me muestra el llavero?' }])
    h.state.account = { default_currency: 'USD', industry_vertical: 'hotel' }
    h.state.products = [
      { id: 'p1', name: 'Llavero recuerdo', image_url: 'https://cdn.example.com/llavero.jpg', category_id: 'cat-9' },
    ]
    h.state.productCategoryName = 'Souvenirs'
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Llavero recuerdo',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1)
  })

  it('resolves a shortened name against a product with a trailing parenthetical qualifier', async () => {
    h.state.products = [
      { id: 'p1', name: 'Suite Clásica (Individual o Pareja)', image_url: 'https://cdn.example.com/clasica.jpg' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Claro, aquí tiene la foto de la Suite Clásica.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: 'Suite Clásica', // the marker itself dropped the qualifier
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ mediaUrl: 'https://cdn.example.com/clasica.jpg' }),
    )
  })

  it("sends the photo anyway when the model's own reply promises one but forgets the marker (auto-corrected, 2026-09-17 Villa San Ricardo incident)", async () => {
    h.state.products = [
      { id: 'p1', name: 'Suite Master Deluxe', image_url: 'https://cdn.example.com/deluxe.jpg' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Con gusto, le comparto la foto de la Suite Master Deluxe.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: null, // the marker never showed up
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ mediaUrl: 'https://cdn.example.com/deluxe.jpg' }),
    )
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'ai_marker_missed_send_photo:acct-1' }),
    )
  })

  it('does not guess when the reply text plausibly names more than one product', async () => {
    h.state.products = [
      { id: 'p1', name: 'Suite Clásica', image_url: 'https://cdn.example.com/clasica.jpg' },
      { id: 'p2', name: 'Suite Clásica Doble', image_url: 'https://cdn.example.com/doble.jpg' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Con gusto le comparto la foto de la Suite Clásica y también de la Suite Clásica Doble.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: null,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('does not self-heal when the reply text never promised a photo', async () => {
    h.state.products = [
      { id: 'p1', name: 'Suite Clásica', image_url: 'https://cdn.example.com/clasica.jpg' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'La Suite Clásica cuesta Q300 por noche.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendPhotoProductName: null,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — autonomous send_category_banner', () => {
  beforeEach(() => {
    h.state.account = { default_currency: 'USD', industry_vertical: 'hotel' }
    // These banner/dedup fixtures represent a stay already qualified.
    h.state.reservationRow = { check_in: '2026-10-26', check_out: '2026-10-28', guests: 2 }
    // A guest genuinely quoting rooms — the only time a banner may go out (owner, 2026-10-09).
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Quiero ver si tienen habitaciones?' }])
  })

  it('no banner when the guest is not quoting that category, even if the model asks for one', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Los masajes serian sábado por la tarde?' }])
    h.generateReply.mockResolvedValue({
      text: 'Sí, el sábado por la tarde.',
      handoff: false, markDealWon: false, moveToStageName: null, sendCatalog: false, sendPhotoProductName: null,
      sendCategoryBannerName: 'Spa',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ messageType: 'image' }))
  })

  it('sends the matched category\'s default banner when the model asks for one', async () => {
    h.state.categories = [{ id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/rooms.jpg' }]
    h.generateReply.mockResolvedValue({
      text: 'Con gusto le comparto las opciones.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendCategoryBannerName: 'Habitaciones',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        conversationId: 'conv-1',
        messageType: 'image',
        mediaUrl: 'https://cdn.example.com/rooms.jpg',
        contentText: 'Habitaciones',
        senderType: 'bot',
      }),
    )
  })

  // Owner, 2026-10-08: a thread the hotel staff is already handling gets
  // no promotional banner unless the guest asks for a new quote.
  it('skips the banner when a teammate is already handling the thread', async () => {
    h.state.categories = [{ id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/rooms.jpg' }]
    h.teammateTookOver.mockResolvedValue(true)
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Esque si necesitamos las 10 habitaciones' }])
    h.generateReply.mockResolvedValue({
      text: 'Entiendo, para esas fechas solo quedan 3.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendCategoryBannerName: 'Habitaciones',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('still sends it in a thread in progress when the guest asks for a new option', async () => {
    h.state.categories = [{ id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/rooms.jpg' }]
    h.teammateTookOver.mockResolvedValue(true)
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Gracias mire y una opción que sea con hospedaje el domingo aunque no me quede?' },
    ])
    h.generateReply.mockResolvedValue({
      text: 'Le comparto las habitaciones.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendCategoryBannerName: 'Habitaciones',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ mediaUrl: 'https://cdn.example.com/rooms.jpg' }),
    )
  })

  it('does not send anything when the guest is not quoting a category', async () => {
    h.state.categories = [{ id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/rooms.jpg' }]
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
    await dispatchInboundToAiReply(ARGS) // default mock: sendCategoryBannerName undefined
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  // Real request, 2026-09-23 (Angel): sends every banner a category has
  // on file — both the weekday and weekend price sheet together — never
  // picks just one, so the guest can see every rate without the bot
  // guessing which date applies.
  it('sends only the weekday sheet matching the qualified stay', async () => {
    h.state.categories = [
      {
        id: 'cat-1',
        name: 'Habitaciones',
        banner_url: 'https://cdn.example.com/weekday.jpg',
        banner_url_weekend: 'https://cdn.example.com/weekend.jpg',
      },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Le comparto las opciones.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendCategoryBannerName: 'Habitaciones',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ mediaUrl: 'https://cdn.example.com/weekday.jpg' }),
    )
    expect(h.sendMessageToConversation).not.toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ mediaUrl: 'https://cdn.example.com/weekend.jpg' }),
    )
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1)
  })

  it('sends just the one banner on file when there is no weekend variant', async () => {
    h.state.categories = [
      { id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/weekday.jpg' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Le comparto las opciones.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendCategoryBannerName: 'Habitaciones',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ mediaUrl: 'https://cdn.example.com/weekday.jpg' }),
    )
  })

  it('never sends the same category\'s banner twice in one conversation', async () => {
    h.state.categories = [{ id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/rooms.jpg' }]
    h.state.dedupeActionLogRows = [
      { input: { conversation_id: 'conv-1', category_name: 'Habitaciones' }, created_at: '2026-09-01T00:00:00.000Z' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tiene de nuevo.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendCategoryBannerName: 'Habitaciones',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('a prior send in a DIFFERENT conversation does not block sending in this one', async () => {
    h.state.categories = [{ id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/rooms.jpg' }]
    h.state.dedupeActionLogRows = [
      { input: { conversation_id: 'some-other-conv' }, created_at: '2026-09-01T00:00:00.000Z' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tiene.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendCategoryBannerName: 'Habitaciones',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalled()
  })

  it('a reset (ai_context_reset_at) allows the banner to be sent again', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
      ai_handoff_transient: null,
      ai_handoff_at: null,
      ai_context_reset_at: '2026-09-18T17:00:00.000Z',
    }
    h.state.categories = [{ id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/rooms.jpg' }]
    h.state.dedupeActionLogRows = [
      // Sent BEFORE the reset — must not count.
      { input: { conversation_id: 'conv-1' }, created_at: '2026-09-10T00:00:00.000Z' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tiene.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendCategoryBannerName: 'Habitaciones',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalled()
  })

  it('sends nothing when the name matches no real category — never an arbitrary image', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
    h.state.categories = [{ id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/rooms.jpg' }]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tiene.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendCategoryBannerName: 'Categoría Inventada',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('logs the send with the conversation_id so the dedup guard can find it later', async () => {
    h.state.categories = [{ id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/rooms.jpg' }]
    h.generateReply.mockResolvedValue({
      text: 'Aquí tiene.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendCategoryBannerName: 'Habitaciones',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.aiActionLogInserts).toContainEqual(
      expect.objectContaining({
        action: 'send_category_banner',
        target_id: 'cat-1',
        input: expect.objectContaining({ conversation_id: 'conv-1', category_name: 'Habitaciones' }),
      }),
    )
  })
})

describe('dispatchInboundToAiReply — autoRecordReservation never trusts a model-supplied precio for habitaciones/paquetes', () => {
  // Real incident, 2026-09-20: the model wrote servicio="Suite Clásica",
  // which matched TWO real products ambiguously, so the deterministic
  // price calculator gave up — and the model then guessed a price
  // itself (Q800, a single-night reference rate) instead of the real
  // 2-night total (Q1,200). `upsertReservationRequest` only recomputes
  // the price when the caller leaves `estimated_price` unset, so that
  // guess silently overwrote what should have been the real number.
  // `autoRecordReservation` must now strip `precio` before it ever
  // reaches `upsertReservationRequest`, for habitaciones/paquetes only.
  beforeEach(() => {
    h.state.account = { default_currency: 'USD', industry_vertical: 'hotel' }
  })

  it('drops a model-supplied precio for habitaciones', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Le comparto la solicitud.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [
        { category: 'habitaciones', fields: { servicio: 'Suite Clásica', personas: '2', precio: '800' }, confirmed: false },
      ],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.upsertReservationRequest).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ category: 'habitaciones', service_name: 'Suite Clásica', guests: 2 }),
    )
    const input = h.upsertReservationRequest.mock.calls[0][2] as Record<string, unknown>
    expect(input).not.toHaveProperty('estimated_price')
  })

  it('drops a model-supplied precio for paquetes too', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Le comparto la solicitud.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [
        { category: 'paquetes', fields: { servicio: 'Paquete Romántico', personas: '2', precio: '1100' }, confirmed: false },
      ],
    })
    await dispatchInboundToAiReply(ARGS)
    const input = h.upsertReservationRequest.mock.calls[0][2] as Record<string, unknown>
    expect(input).not.toHaveProperty('estimated_price')
  })

  it('still honors a model-supplied precio for spa, actividades, and eventos — no automatic calculator exists for those', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Le comparto la solicitud.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [{ category: 'spa', fields: { personas: '1', precio: '275' }, confirmed: false }],
    })
    await dispatchInboundToAiReply(ARGS)
    const input = h.upsertReservationRequest.mock.calls[0][2] as Record<string, unknown>
    expect(input).toMatchObject({ estimated_price: 275 })
  })
})

describe('dispatchInboundToAiReply — hotel findings, 20-chat test run 2026-09-25', () => {
  beforeEach(() => {
    h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel' }
  })

  it('an explicit "quiero hablar con una persona" hands off silently without asking or acknowledging again', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'quiero hablar con una persona por favor' }])
    h.generateReply.mockResolvedValue({
      text: '¿Le gustaría que le conecte con alguien del equipo?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.state.updatePayload).not.toHaveProperty('ai_autoreply_disabled')
    expect(h.state.updatePayload?.ai_handoff_summary).toEqual(expect.any(String))
  })

  it('a non-hotel account keeps the two-step protocol', async () => {
    h.state.account = { default_currency: 'GTQ', industry_vertical: 'generic' }
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'quiero hablar con una persona por favor' }])
    h.generateReply.mockResolvedValue({
      text: '¿Le gustaría que le conecte con alguien del equipo?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: '¿Le gustaría que le conecte con alguien del equipo?' }),
    )
  })

  it('no canned booking nudge after the photo when the reply already invites the missing details (live test 2026-09-25)', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '¿tiene fotos de la Suite Premium?' }])
    h.state.products = [
      { id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg', category_id: 'cat-1' },
    ]
    h.state.productCategoryName = 'Habitaciones'
    h.generateReply.mockResolvedValue({
      text: 'Claro, aquí se la comparto. Es muy cómoda. Si me indica sus fechas, con gusto le ayudo a dejar su solicitud lista.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendPhotoProductName: 'Suite Premium',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1) // the photo only
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ messageType: 'image' }),
    )
  })

  it('no canned booking nudge after the photo when the reply already brings up the dates in any wording (live test 2026-09-25)', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '¿tiene fotos del Paquete Romántico?' }])
    h.state.products = [
      { id: 'p1', name: 'Paquete Romántico', image_url: 'https://cdn.example.com/romantico.jpg', category_id: 'cat-1' },
    ]
    h.state.productCategoryName = 'Paquetes'
    h.generateReply.mockResolvedValue({
      text: 'Claro, aquí le comparto una imagen del Paquete Romántico. Si desea, también puedo ayudarle con las fechas para dejar lista su solicitud.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendPhotoProductName: 'Paquete Romántico',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1) // the photo only
  })

  it('drops a trailing photo offer when the item photo already went out', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '¿cómo es la Suite Premium?' }])
    h.state.products = [
      { id: 'p1', name: 'Suite Premium', image_url: 'https://cdn.example.com/suite.jpg', category_id: 'cat-1' },
    ]
    h.state.productCategoryName = 'Habitaciones'
    h.generateReply.mockResolvedValue({
      text: 'Es ideal para parejas, con 2 camas Queen. ¿Le gustaría que le comparta una foto de esta habitación?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendPhotoProductName: 'Suite Premium',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ messageType: 'image' }),
    )
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Es ideal para parejas, con 2 camas Queen.' }),
    )
  })
})

describe('dispatchInboundToAiReply — adults/children split in the reservation marker (migration 160)', () => {
  beforeEach(() => {
    h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel' }
  })

  it('adultos + edades_ninos (accented key too) reach the request, with the total headcount', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Perfecto, ¿para qué fechas?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [
        { category: 'habitaciones', fields: { servicio: 'Junior Suite Familiar', adultos: '4', edades_ninos: '8' }, confirmed: false },
      ],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.upsertReservationRequest).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ adults: 4, children_ages: [8], guests: 5 }),
    )
  })

  it('ninos=0 records "no children"', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Perfecto, ¿para qué fechas?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [
        { category: 'habitaciones', fields: { servicio: 'Junior Suite Familiar', adultos: '3', ninos: '0' }, confirmed: false },
      ],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.upsertReservationRequest).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ adults: 3, children_ages: [], guests: 3 }),
    )
  })

  it('parseChildAges reads loose wording and drops adults-range numbers', () => {
    expect(parseChildAges('8, 10')).toEqual([8, 10])
    expect(parseChildAges('3 años y 7')).toEqual([3, 7])
    expect(parseChildAges('ninguno')).toBeUndefined()
    expect(parseChildAges('30')).toBeUndefined()
  })
})

describe('dispatchInboundToAiReply — hotel reply claims "queda anotada" without a record_reservation marker', () => {
  // Live test 2026-09-24: after a post-close change the bot wrote "Queda
  // anotada la Suite Clásica Doble para 3 personas…" with no marker, so
  // the saved request stayed Suite Premium for 2 and the team never knew.
  beforeEach(() => {
    h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel' }
  })
  const NOTED = {
    text: 'Entendido. Queda anotada la Suite Clásica Doble para 3 personas, del 21/10/2026 al 23/10/2026.',
    handoff: false,
    markDealWon: false,
    moveToStageName: null,
  }

  it('retries once and uses the reply that carries the marker', async () => {
    h.generateReply
      .mockResolvedValueOnce(NOTED)
      .mockResolvedValueOnce({
        ...NOTED,
        reservationProposals: [
          { category: 'habitaciones', fields: { servicio: 'Suite Clásica Doble', personas: '3', entrada: '2026-10-21', salida: '2026-10-23' }, confirmed: false },
        ],
      })
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(2)
    expect(h.generateReply.mock.calls[1][0].systemPrompt).toContain('SYSTEM CHECK')
    expect(h.upsertReservationRequest).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ service_name: 'Suite Clásica Doble', guests: 3 }),
    )
  })

  it('alerts when the retry still saves nothing, and still answers the guest', async () => {
    h.generateReply.mockResolvedValue(NOTED)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(2)
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'ai_noted_without_marker:acct-1' }),
    )
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Entendido.\n\nYa le pasé su solicitud al equipo del hotel') }))
    // …and the team actually gets it (nothing was saved to a reservation).
    expect(h.state.messageInserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content_type: 'internal_note', content_text: expect.stringContaining('no pudo guardar') }),
      ]),
    )
  })

  it('does not retry when the reply already carries the marker', async () => {
    h.generateReply.mockResolvedValue({
      ...NOTED,
      reservationProposals: [{ category: 'habitaciones', fields: { personas: '3' }, confirmed: false }],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
  })

  it('captures an airport request even when the draft only offers to note it', async () => {
    h.state.reservationRow = { notes: 'cumpleaños' }
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'para el 14 pueden recogernos en el aeropuerto?' }])
    h.generateReply.mockResolvedValueOnce({ ...NOTED, text: 'Si desea, lo dejo anotado.' })
      .mockResolvedValueOnce({ ...NOTED, text: 'Queda anotado el traslado, pendiente de confirmación.', reservationProposals: [
        { category: 'paquetes', fields: { nota: 'traslado desde aeropuerto pendiente de confirmación' }, confirmed: false },
      ] })
    await dispatchInboundToAiReply(ARGS)
    expect(h.upsertReservationRequest).toHaveBeenCalledWith(expect.anything(), 'acct-1', expect.objectContaining({
      notes: 'cumpleaños; traslado desde aeropuerto pendiente de confirmación',
    }))
    expect(h.upsertReservationRequest.mock.invocationCallOrder[0]).toBeLessThan(h.engineSendText.mock.invocationCallOrder[0])
  })

  it('does not claim success when saving fails', async () => {
    h.generateReply.mockResolvedValue({ ...NOTED, reservationProposals: [
      { category: 'paquetes', fields: { nota: 'traslado desde aeropuerto pendiente' }, confirmed: false },
    ] })
    h.upsertReservationRequest.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('No pude guardar') }))
  })
})

describe('dispatchInboundToAiReply — autoRecordReservation tolerates a DD/MM/AAAA date in the marker', () => {
  // Real incident, 2026-09-22: the 2026-09-21 change taught the model to
  // write customer-facing dates as DD/MM/AAAA while keeping YYYY-MM-DD
  // inside marker fields. In one live conversation the guest gave clear
  // dates, the bot's own reply recapped them correctly as DD/MM/AAAA, but
  // entrada/salida stayed null in the database — the model had reused
  // the DD/MM/AAAA string inside the marker too, and the strict
  // YYYY-MM-DD-only parser silently dropped it. Accepting DD/MM/AAAA as a
  // fallback (and normalizing it) means a guest's date is captured even
  // when the model mixes the two formats up.
  beforeEach(() => {
    h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel' }
  })

  it('normalizes a DD/MM/AAAA entrada/salida to YYYY-MM-DD instead of dropping it', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Perfecto, ya quedó anotado del 25/09/2026 al 27/09/2026.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [
        {
          category: 'habitaciones',
          fields: { servicio: 'Junior Suite Familiar', personas: '3', entrada: '25/09/2026', salida: '27/09/2026' },
          confirmed: false,
        },
      ],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.upsertReservationRequest).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ check_in: '2026-09-25', check_out: '2026-09-27' }),
    )
  })

  it('still accepts the correct YYYY-MM-DD form as before', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Perfecto, ya quedó anotado.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [
        { category: 'habitaciones', fields: { entrada: '2026-09-25', salida: '2026-09-27' }, confirmed: false },
      ],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.upsertReservationRequest).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ check_in: '2026-09-25', check_out: '2026-09-27' }),
    )
  })

  it('drops a garbled date that matches neither format', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Entendido.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [
        { category: 'habitaciones', fields: { entrada: '25 de septiembre', salida: '2026-09-27' }, confirmed: false },
      ],
    })
    await dispatchInboundToAiReply(ARGS)
    const input = h.upsertReservationRequest.mock.calls[0][2] as Record<string, unknown>
    expect(input).not.toHaveProperty('check_in')
    expect(input).toMatchObject({ check_out: '2026-09-27' })
  })
})

describe('dispatchInboundToAiReply — proactive stay-estimate follow-up', () => {
  // Fixture dates are September 2026: pin "today" before them so the
  // past-date guard (test run 2026-09-24) doesn't treat them as expired.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-01T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // The other half of the 2026-09-20 fix: `hotelStayEstimate` (the
  // prompt-context figure) is always one turn stale — computed BEFORE
  // the very turn that completes or changes it — so the model alone can
  // never relay a fresh number on that same turn. This sends it
  // deterministically instead, the moment `computeStayEstimateStatus`
  // says it's clean and complete.
  const COMPLETE_ROW = {
    id: 'rr-1',
    category: 'habitaciones',
    service_name: 'Master Suite Deluxe',
    product_id: null,
    guests: 2,
    check_in: '2026-09-09', // Wednesday
    check_out: '2026-09-10',
    estimated_price: null,
  }
  const COUPLE_RATES = [
    { day_of_week: 'wed', occupancy: 'couple', price: 500, date_from: null, date_to: null },
  ]

  beforeEach(() => {
    h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel', deposit_percent: 50 }
  })

  function habReservationProposal() {
    return [{ category: 'habitaciones' as const, fields: { personas: '2' }, confirmed: false }]
  }

  it('sends the computed total proactively the moment it is clean and complete', async () => {
    h.state.reservationRow = COMPLETE_ROW
    h.state.products = [{ id: 'p1', name: 'Master Suite Deluxe' }]
    h.state.productRates = COUPLE_RATES
    h.generateReply.mockResolvedValue({
      text: 'Entendido, se lo dejo anotado.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: habReservationProposal(),
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        conversationId: 'conv-1',
        messageType: 'text',
        contentText: expect.stringContaining('500'),
      }),
    )
    expect(h.state.aiActionLogInserts).toContainEqual(
      expect.objectContaining({ action: 'send_stay_estimate', target_id: 'rr-1', result: { total: 500 } }),
    )
  })

  it('never sends the SAME total twice in one conversation', async () => {
    h.state.reservationRow = COMPLETE_ROW
    h.state.products = [{ id: 'p1', name: 'Master Suite Deluxe' }]
    h.state.productRates = COUPLE_RATES
    h.state.dedupeActionLogRows = [
      { input: { conversation_id: 'conv-1' }, result: { total: 500 }, created_at: '2026-09-01T00:00:00.000Z' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Entendido.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: habReservationProposal(),
    })
    await dispatchInboundToAiReply(ARGS)
    // The request closed this turn, so only the availability line goes
    // out — the total the guest already has is not repeated.
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ contentText: expect.stringContaining(CLOSE_AVAILABILITY_LINE.replace(' en breve. 😊', '.')) }),
    )
  })

  it('alerts an owner when the stay is complete but genuinely unpriceable (e.g. an ambiguous name) instead of staying silent', async () => {
    h.state.reservationRow = { ...COMPLETE_ROW, service_name: 'Suite Clásica' }
    h.state.products = [
      { id: 'p1', name: 'Suite Clásica (Individual o Pareja)' },
      { id: 'p2', name: 'Suite Clásica Doble' },
    ]
    h.state.productRates = COUPLE_RATES
    h.generateReply.mockResolvedValue({
      text: 'Entendido.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: habReservationProposal(),
    })
    await dispatchInboundToAiReply(ARGS)
    // No total to share: the close ends with the team confirming both.
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ contentText: expect.stringContaining(CLOSE_AVAILABILITY_AND_TOTAL_LINE.replace(' en breve. 😊', '.')) }),
    )
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupKey: 'ai_stay_unpriceable:conv-1',
        detail: expect.objectContaining({ reason: 'no_product_match' }),
      }),
    )
  })

  it('stays silent (no send, no alert) while the stay is still incomplete', async () => {
    h.state.reservationRow = { ...COMPLETE_ROW, check_out: null }
    h.generateReply.mockResolvedValue({
      text: '¿Para qué fecha de salida sería?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: habReservationProposal(),
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(h.dispatchSystemAlert).not.toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'ai_stay_unpriceable:conv-1' }),
    )
  })

  it('never checks for a stay estimate when the turn touched no habitaciones/paquetes proposal', async () => {
    h.state.reservationRow = COMPLETE_ROW
    h.state.products = [{ id: 'p1', name: 'Master Suite Deluxe' }]
    h.state.productRates = COUPLE_RATES
    h.generateReply.mockResolvedValue({
      text: 'Con gusto le ayudo con el spa.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [{ category: 'spa', fields: { personas: '1' }, confirmed: false }],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — deterministic category banner (tied to record_reservation, not the model)', () => {
  // Real gap found 2026-09-20 testing the Villa San Ricardo prompt fusion:
  // gpt-5.4-mini repeatedly gave concrete category options in text without
  // ever emitting SEND_CATEGORY_BANNER_SENTINEL, so the banner PR #175 made
  // "mandatory" silently never sent. record_reservation fires reliably every
  // time the guest engages with a category, so the banner is now tied to
  // THAT instead of trusting the model to also remember its own marker.
  beforeEach(() => {
    h.state.account = { default_currency: 'USD', industry_vertical: 'hotel' }
    // These banner/dedup fixtures represent a stay already qualified.
    h.state.reservationRow = { check_in: '2026-10-26', check_out: '2026-10-28', guests: 2 }
  })

  it('sends the banner image BEFORE the text reply, not after — Angel, 2026-09-20: "quisiera que primero mande el banner y luego el mensaje... para que sea más natural"', async () => {
    h.state.categories = [{ id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/rooms.jpg' }]
    h.generateReply.mockResolvedValue({
      text: 'Con gusto, en Habitaciones tenemos Suite Master Deluxe, Suite Premium... ¿Cuál le interesa?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      reservationProposals: [{ category: 'habitaciones', fields: {}, confirmed: false }],
    })
    await dispatchInboundToAiReply(ARGS)
    const bannerCallOrder = h.sendMessageToConversation.mock.invocationCallOrder[0]
    const textCallOrder = h.engineSendText.mock.invocationCallOrder[0]
    expect(bannerCallOrder).toBeLessThan(textCallOrder)
  })

  it('sends the banner the moment a record_reservation proposal names a category that has one — no marker from the model needed', async () => {
    h.state.categories = [{ id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/rooms.jpg' }]
    h.generateReply.mockResolvedValue({
      text: 'Con gusto — tenemos Master Deluxe, Premium y Clásica Doble. ¿Cuál le interesa?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      // No sendCategoryBannerName — the model never asked for it.
      reservationProposals: [{ category: 'habitaciones', fields: { personas: '2' }, confirmed: false }],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        conversationId: 'conv-1',
        messageType: 'image',
        mediaUrl: 'https://cdn.example.com/rooms.jpg',
        contentText: 'Habitaciones',
      }),
    )
  })

  it('sends the banner the moment the reply itself names one of the category\'s products — no record_reservation proposal needed yet. Real gap found 2026-09-21 (conversation 97052a12-...): "habitaciones por favor" got a room list back with nothing to record yet, so the banner never fired until a specific room+dates existed several turns later, landing next to an unrelated message', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'habitaciones por favor' }])
    h.state.categories = [{ id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/rooms.jpg' }]
    h.state.products = [
      { id: 'p1', name: 'Suite Master Deluxe', category_id: 'cat-1' },
      { id: 'p2', name: 'Suite Premium', category_id: 'cat-1' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Mucho gusto. Con gusto le ayudo con habitaciones. Tenemos Suite Master Deluxe, Suite Premium, Suite Clásica, Suite Clásica Doble y Junior Suite Familiar. ¿Cuál le interesa?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [], // nothing to record yet — no specific room/fields
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ mediaUrl: 'https://cdn.example.com/rooms.jpg' }),
    )
  })

  it('does not fire on the generic opening menu that just lists every category name, before any product is named', async () => {
    h.state.categories = [{ id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/rooms.jpg' }]
    h.state.products = [{ id: 'p1', name: 'Suite Master Deluxe', category_id: 'cat-1' }]
    h.generateReply.mockResolvedValue({
      text: '¿Le gustaría conocer Habitaciones, Paquetes, Spa, Actividades al aire libre o Eventos?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('sends the banner when the GUEST asks about one category, even if the reply names no product — real gap 2026-09-24 (conversation bac7922e-…): "las habitaciones cuanto cuestan?" got the catalog link and no banner until a turn later', async () => {
    h.state.categories = [{ id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/rooms.jpg' }]
    h.state.products = [{ id: 'p1', name: 'Suite Master Deluxe', category_id: 'cat-1' }]
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'las habitaciones cuanto cuestan?' }])
    h.generateReply.mockResolvedValue({
      text: 'Con gusto. Le comparto el catálogo para que vea las opciones.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ mediaUrl: 'https://cdn.example.com/rooms.jpg' }),
    )
  })

  it('does not send a banner when the guest asks about several categories at once', async () => {
    h.state.categories = [
      { id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/rooms.jpg' },
      { id: 'cat-2', name: 'Spa', banner_url: 'https://cdn.example.com/spa.jpg' },
    ]
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'quiero una habitación y un masaje' }])
    h.generateReply.mockResolvedValue({
      text: 'Con gusto le ayudo con ambas cosas.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('sends the item photo when the guest asks about one specific item, BEFORE the text — real gap 2026-09-24: "tiene fotos de la habitación deluxe?"', async () => {
    h.state.products = [
      { id: 'p1', name: 'Suite Master Deluxe', image_url: 'https://cdn.example.com/deluxe.jpg', category_id: 'cat-1' },
      { id: 'p2', name: 'Suite Premium', image_url: 'https://cdn.example.com/premium.jpg', category_id: 'cat-1' },
    ]
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'tiene fotos de la habitación deluxe?' }])
    h.generateReply.mockResolvedValue({
      text: 'Claro que sí. La Suite Master Deluxe tiene jacuzzi y vista al jardín. ¿Le gustaría reservarla?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ messageType: 'image', mediaUrl: 'https://cdn.example.com/deluxe.jpg' }),
    )
    const photoOrder = h.sendMessageToConversation.mock.invocationCallOrder[0]
    const textOrder = h.engineSendText.mock.invocationCallOrder[0]
    expect(photoOrder).toBeLessThan(textOrder)
    // The reply already asked to book — no canned second question after it.
    const texts = h.sendMessageToConversation.mock.calls.filter(
      (c: unknown[]) => (c[2] as { messageType?: string }).messageType === 'text',
    )
    expect(texts).toHaveLength(0)
  })

  it('never sends a photo the reply only offered conditionally — real incident 2026-09-24: "Si me confirma, le envío la foto" followed three seconds later by the photo', async () => {
    h.state.products = [
      { id: 'p1', name: 'Suite Master Deluxe', image_url: 'https://cdn.example.com/deluxe.jpg', category_id: 'cat-1' },
      { id: 'p2', name: 'Suite Premium', image_url: 'https://cdn.example.com/premium.jpg', category_id: 'cat-1' },
    ]
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'tiene fotos de las suites?' }])
    h.generateReply.mockResolvedValue({
      text: '¿Se refiere a la Suite Master Deluxe? Si me confirma, le envío la foto de esa habitación.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ messageType: 'image' }),
    )
  })

  it('sends the banner when products share a leading word the model naturally drops while listing them — Real gap found 2026-09-21: "Tenemos estos paquetes: Romántico, San Vicente, San Ricardo y Luna de Miel" never contains the full "Paquete Romántico" product name, so a plain substring match against full names alone missed it entirely, twice in the same live conversation (a5340ecc-...)', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'quisiera información de los paquetes' }])
    h.state.categories = [{ id: 'cat-1', name: 'Paquetes', banner_url: 'https://cdn.example.com/paquetes.jpg' }]
    h.state.products = [
      { id: 'p1', name: 'Paquete Romántico', category_id: 'cat-1' },
      { id: 'p2', name: 'Paquete San Vicente', category_id: 'cat-1' },
      { id: 'p3', name: 'Paquete San Ricardo', category_id: 'cat-1' },
      { id: 'p4', name: 'Paquete Luna de Miel', category_id: 'cat-1' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Con gusto, Sandia. Tenemos Romántico, San Vicente, San Ricardo y Luna de Miel. ¿Cuál de ellos le interesa?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ mediaUrl: 'https://cdn.example.com/paquetes.jpg' }),
    )
  })

  it('does not strip a leading word unless every product in the category shares the exact same one', async () => {
    h.state.categories = [{ id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/rooms.jpg' }]
    h.state.products = [
      { id: 'p1', name: 'Suite Master Deluxe', category_id: 'cat-1' },
      { id: 'p2', name: 'Junior Suite Familiar', category_id: 'cat-1' }, // does not start with "Suite"
    ]
    h.generateReply.mockResolvedValue({
      // Names a room from a DIFFERENT, unconfigured category-less product
      // ("Familiar" alone) — must not match, since "Suite" was not
      // stripped (not every product shares it) and "Familiar" alone was
      // never added as a standalone match target.
      text: 'Contamos con una opción muy buena para familias grandes.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('does not fire on the welcome greeting even when the account name accidentally matches a stripped product name — real gap found 2026-09-21: "Bienvenido a Hotel San Ricardo... ¿Cuál de estas opciones le interesa: Habitaciones, Spa, Actividades al aire libre, Paquetes o Eventos?" fired the Paquetes banner on a bare "Hola", because "Paquete San Ricardo" strips to "San Ricardo" — also the hotel\'s own name', async () => {
    h.state.account = { default_currency: 'USD', industry_vertical: 'hotel', name: 'Villa San Ricardo' }
    h.state.categories = [
      { id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/rooms.jpg' },
      { id: 'cat-2', name: 'Spa', banner_url: 'https://cdn.example.com/spa.jpg' },
      { id: 'cat-3', name: 'Paquetes', banner_url: 'https://cdn.example.com/paquetes.jpg' },
    ]
    h.state.products = [
      { id: 'p1', name: 'Paquete Romántico', category_id: 'cat-3' },
      { id: 'p2', name: 'Paquete San Vicente', category_id: 'cat-3' },
      { id: 'p3', name: 'Paquete San Ricardo', category_id: 'cat-3' },
      { id: 'p4', name: 'Paquete Luna de Miel', category_id: 'cat-3' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Bienvenido a Hotel San Ricardo, le saluda Angela su asistente el día de hoy 😊 ¿Con quién tengo el gusto?\n¿Cuál de estas opciones le interesa: Habitaciones, Spa, Actividades al aire libre, Paquetes o Eventos?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('excludes a stripped product name that collides with the account\'s own business name, even outside a generic menu turn', async () => {
    h.state.account = { default_currency: 'USD', industry_vertical: 'hotel', name: 'Villa San Ricardo' }
    h.state.categories = [{ id: 'cat-1', name: 'Paquetes', banner_url: 'https://cdn.example.com/paquetes.jpg' }]
    h.state.products = [
      { id: 'p1', name: 'Paquete Romántico', category_id: 'cat-1' },
      { id: 'p2', name: 'Paquete San Vicente', category_id: 'cat-1' },
      { id: 'p3', name: 'Paquete San Ricardo', category_id: 'cat-1' },
      { id: 'p4', name: 'Paquete Luna de Miel', category_id: 'cat-1' },
    ]
    h.generateReply.mockResolvedValue({
      // Only one category-ish mention (none of the literal category
      // labels, actually) plus the hotel's own name in a sign-off —
      // must not match on "San Ricardo" alone.
      text: 'Gracias por escribirle a Villa San Ricardo, en un momento le atiendo.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('does nothing when the proposal\'s category has no banner on file', async () => {
    h.state.categories = [] // no banner-holding categories at all
    h.generateReply.mockResolvedValue({
      text: 'Claro, cuénteme para cuántas personas.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [{ category: 'eventos', fields: {}, confirmed: false }],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  it('still respects the same-conversation dedupe — never resends a banner already sent', async () => {
    h.state.categories = [{ id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/rooms.jpg' }]
    h.state.dedupeActionLogRows = [
      { input: { conversation_id: 'conv-1', category_name: 'Habitaciones' }, created_at: '2026-09-01T00:00:00.000Z' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Claro, ¿qué fechas tiene en mente?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [{ category: 'habitaciones', fields: { personas: '2' }, confirmed: false }],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })

  // Real request, 2026-09-23 (Angel): a guest asking about habitaciones
  // in general — no dates given yet — needs to see BOTH price photos
  // to compare, not have the bot guess which single one applies. This
  // also sidesteps every weekday/weekend date-guessing bug found this
  // week (a leaked DD/MM/AAAA date, an off-by-one weekday): there's no
  // guess left to get wrong.
  it('sends only the applicable room banner after intake, based on the proposal\'s dates', async () => {
    h.state.categories = [
      {
        id: 'cat-1',
        name: 'Habitaciones',
        banner_url: 'https://cdn.example.com/weekday.jpg',
        banner_url_weekend: 'https://cdn.example.com/weekend.jpg',
      },
    ]
    h.generateReply.mockResolvedValue({
      text: '¿Para cuántas personas y qué fechas tiene en mente?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [{ category: 'habitaciones', fields: {}, confirmed: false }],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ mediaUrl: 'https://cdn.example.com/weekday.jpg', contentText: 'Habitaciones' }),
    )
    expect(h.sendMessageToConversation).not.toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ mediaUrl: 'https://cdn.example.com/weekend.jpg', contentText: undefined }),
    )
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1)
  })

  it('sends just the one banner on file for a category with no weekend variant', async () => {
    h.state.categories = [
      { id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/weekday.jpg' },
    ]
    h.generateReply.mockResolvedValue({
      text: '¿Para cuántas personas sería?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [{ category: 'habitaciones', fields: {}, confirmed: false }],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ mediaUrl: 'https://cdn.example.com/weekday.jpg' }),
    )
  })

  it('also fires deterministically for the SECOND category in a multi-intent turn', async () => {
    h.state.categories = [
      { id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/rooms.jpg' },
      { id: 'cat-2', name: 'Spa', banner_url: 'https://cdn.example.com/spa.jpg' },
    ]
    h.generateReply.mockResolvedValue({
      text: 'Con gusto le ayudo con ambas cosas.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      reservationProposals: [
        { category: 'habitaciones', fields: {}, confirmed: false },
        { category: 'spa', fields: {}, confirmed: false },
      ],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(), 'acct-1', expect.objectContaining({ mediaUrl: 'https://cdn.example.com/rooms.jpg' }),
    )
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(), 'acct-1', expect.objectContaining({ mediaUrl: 'https://cdn.example.com/spa.jpg' }),
    )
  })
})

describe('dispatchInboundToAiReply — reservation-complete handoff', () => {
  // Fixture dates are September 2026: pin "today" before them so the
  // past-date guard (test run 2026-09-24) doesn't treat them as expired.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-01T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    h.state.account = { default_currency: 'USD', industry_vertical: 'hotel' }
  })

  it('replaces a trailing permission question with a warm close and notifies the team without the confirm marker (test run 2026-09-24)', async () => {
    h.state.reservationRow = {
      id: 'rr-1',
      category: 'habitaciones',
      service_name: 'Suite Deluxe',
      guests: 1,
      check_in: '2026-10-13',
      check_out: '2026-10-14',
      use_date: null,
      hall: null,
    }
    h.generateReply.mockResolvedValue({
      text: 'La Suite Clásica es ideal para su viaje. ¿Desea que le deje registrada la solicitud para que el equipo le confirme disponibilidad y el total?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      reservationProposals: [{ category: 'habitaciones', fields: { servicio: 'Suite Deluxe', personas: '1', entrada: '2026-10-13', salida: '2026-10-14' }, confirmed: false }],
    })
    await dispatchInboundToAiReply(ARGS)
    const sent = h.engineSendText.mock.calls.map((c) => (c[0] as { text: string }).text).join(' ')
    expect(sent).toContain('La Suite Clásica es ideal para su viaje.')
    expect(sent).not.toContain('¿Desea que le deje registrada')
    expect(sent).toMatch(/equipo/)
    expect(h.state.aiActionLogInserts.filter((r) => r.action === 'auto_handoff_reservation_complete')).toHaveLength(1)
  })

  it('never closes a stay with no room chosen and no guest name, even with dates and guests (live chat 2026-09-29)', async () => {
    h.state.guestNameLogged = false
    h.state.reservationRow = {
      id: 'rr-3',
      category: 'habitaciones',
      guests: 2,
      check_in: '2026-10-16',
      check_out: '2026-10-17',
      use_date: null,
      hall: null,
    }
    h.generateReply.mockResolvedValue({
      text: 'Las opciones que se ajustan para ustedes son: Suite Master Deluxe, Suite Premium y Junior Suite Familiar. Para dejarle la solicitud lista, solo me hace falta saber cuántos adultos serían y si viajan con niños.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      reservationProposals: [{ category: 'habitaciones', fields: { personas: '2', entrada: '2026-10-16', salida: '2026-10-17' }, confirmed: false }],
    })
    await dispatchInboundToAiReply(ARGS)
    const sent = h.engineSendText.mock.calls.map((c) => (c[0] as { text: string }).text).join(' ')
    expect(sent).not.toMatch(/compañero|equipo le/)
    expect(h.state.aiActionLogInserts.filter((r) => r.action === 'auto_handoff_reservation_complete')).toHaveLength(0)
  })

  it('closes when the guest states their name this turn even if no set_contact_name log row exists (live QA 2026-09-30)', async () => {
    // Prod: the log insert failed the ai_action_log CHECK, so the reply
    // said "le dejo solicitada" while the hand-off nudged for the name.
    h.state.guestNameLogged = false
    h.state.reservationRow = {
      id: 'rr-4',
      category: 'habitaciones',
      service_name: 'Suite Premium',
      guests: 2,
      adults: 2,
      children_ages: [],
      check_in: '2026-10-16',
      check_out: '2026-10-17',
      use_date: null,
      hall: null,
      guest_confirmed_at: null,
    }
    h.generateReply.mockResolvedValue({
      text: '¡Mucho gusto, Diego! Le dejo solicitada su Suite Premium para 2 adultos del 16/10/2026 al 17/10/2026.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      contactName: 'Diego Ramírez',
      reservationProposals: [
        { category: 'habitaciones', fields: { servicio: 'Suite Premium', personas: '2', adultos: '2', ninos: '0', entrada: '2026-10-16', salida: '2026-10-17' }, confirmed: true },
      ],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.aiActionLogInserts.filter((r) => r.action === 'auto_handoff_reservation_complete')).toHaveLength(1)
    expect(h.state.aiActionLogInserts.filter((r) => r.action === 'reservation_nudge')).toHaveLength(0)
  })

  it('still closes a request completed AFTER the guest asked for a person (QA 2026-09-27, 2nd Romántico)', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 5,
      ai_handoff_transient: null,
      ai_handoff_at: '2026-08-31T10:00:00.000Z',
    }
    h.state.reservationRow = {
      id: 'rr-2',
      category: 'paquetes',
      service_name: 'Paquete Romántico',
      guests: 2,
      check_in: '2026-10-31',
      check_out: '2026-11-01',
      use_date: null,
      hall: null,
      guest_confirmed_at: null,
    }
    h.generateReply.mockResolvedValue({
      text: 'Queda solicitada su segunda reserva del Paquete Romántico del 31/10/2026 al 01/11/2026.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      reservationProposals: [
        { category: 'paquetes', fields: { personas: '2', entrada: '2026-10-31', salida: '2026-11-01', nueva: '1' }, confirmed: true },
      ],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.aiActionLogInserts.filter((r) => r.action === 'auto_handoff_reservation_complete')).toHaveLength(1)
    expect(h.state.messageInserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content_type: 'internal_note', content_text: expect.stringContaining('completó y confirmó') }),
      ]),
    )
  })

  it('does not re-notify a request already sent to the team, handoff or not', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 5,
      ai_handoff_transient: null,
      ai_handoff_at: '2026-08-31T10:00:00.000Z',
    }
    h.state.reservationRow = {
      id: 'rr-2',
      category: 'paquetes',
      service_name: 'Suite Deluxe',
      guests: 2,
      check_in: '2026-10-31',
      check_out: '2026-11-01',
      use_date: null,
      hall: null,
      guest_confirmed_at: '2026-08-31T11:00:00.000Z',
    }
    h.generateReply.mockResolvedValue({
      text: 'Con gusto, el desayuno está incluido.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      reservationProposals: [{ category: 'paquetes', fields: { personas: '2' }, confirmed: true }],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.aiActionLogInserts.filter((r) => r.action === 'auto_handoff_reservation_complete')).toHaveLength(0)
  })

  it('never closes a request dated in the past (test run 2026-09-24, prueba #16)', async () => {
    h.state.reservationRow = {
      id: 'rr-1',
      category: 'habitaciones',
      service_name: 'Suite Deluxe',
      guests: 2,
      check_in: '2026-08-10',
      check_out: '2026-08-12',
      use_date: null,
      hall: null,
    }
    h.generateReply.mockResolvedValue({
      text: 'Queda registrada su solicitud.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      reservationProposals: [{ category: 'habitaciones', fields: { personas: '2' }, confirmed: true }],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.aiActionLogInserts.filter((r) => r.action === 'auto_handoff_reservation_complete')).toHaveLength(0)
    // …and the guest is told, instead of believing it was registered.
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({ contentText: expect.stringContaining('ya pasó') }),
    )
  })

  it('does not notify the team twice when a follow-up turn re-emits the confirm marker for an already-sent request', async () => {
    h.state.reservationRow = {
      id: 'rr-1',
      category: 'habitaciones',
      service_name: 'Suite Deluxe',
      guests: 2,
      check_in: '2026-10-15',
      check_out: '2026-10-16',
      use_date: null,
      hall: null,
      guest_confirmed_at: '2026-09-24T02:42:00Z',
    }
    h.generateReply.mockResolvedValue({
      text: 'Sí, el desayuno está incluido. 😊',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      reservationProposals: [{ category: 'habitaciones', fields: { personas: '2' }, confirmed: true }],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.notificationInserts).toEqual([])
    expect(h.state.aiActionLogInserts.filter((r) => r.action === 'auto_handoff_reservation_complete')).toHaveLength(0)
  })

  it('does not repeat a canned closing line when the model already wrote its own close (2026-09-22 test run)', async () => {
    h.state.reservationRow = {
      id: 'rr-1',
      category: 'habitaciones',
      service_name: 'Suite Deluxe',
      guests: 4,
      check_in: '2026-09-18',
      check_out: '2026-09-19',
      use_date: null,
      hall: null,
    }
    h.generateReply.mockResolvedValue({
      text: '¡Qué buen plan, Carlos! Su solicitud ya está con nuestro equipo.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      reservationProposals: [{ category: 'habitaciones', fields: { personas: '4' }, confirmed: true }],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        conversationId: 'conv-1',
        messageType: 'text',
        contentText: expect.stringContaining('en breve le escribimos'),
      }),
    )
    // The bot keeps answering follow-up questions after the close: the team
    // is notified, the conversation is NOT paused or assigned.
    expect(h.state.updatePayload?.ai_autoreply_disabled).not.toBe(true)
    expect(h.state.notificationInserts.length).toBeGreaterThan(0)
  })

  // Real incident, 2026-09-23 (7-case live QA run, DEMO account): the
  // model emitted CONFIRM_RESERVATION_SENTINEL in the SAME reply where
  // its own text still asked "¿Desea que deje esta solicitud
  // lista...?" — the marker alone (2026-09-18's fix for the same
  // failure) isn't enough on its own when the model contradicts itself
  // this way. A second, deterministic guard: never hand off on a turn
  // where the bot's own reply still ends in "?", even if `confirmed`
  // is set.
  it('does not hand off (or mark guest_confirmed_at) when confirmed is set but the bot\'s own reply this turn still ends in "?"', async () => {
    h.state.reservationRow = {
      id: 'rr-1',
      category: 'habitaciones',
      service_name: 'Suite Deluxe',
      guests: 4,
      check_in: '2026-09-18',
      check_out: '2026-09-19',
      use_date: null,
      hall: null,
    }
    h.generateReply.mockResolvedValue({
      text: '¿Desea que deje esta solicitud lista para que un compañero confirme disponibilidad y el total final?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      // The model got this wrong (see incident above) — confirmed:true
      // alongside a reply that is still a question.
      reservationProposals: [{ category: 'habitaciones', fields: { personas: '4' }, confirmed: true }],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toBeNull()
    expect(h.state.reservationRequestUpdates).not.toContainEqual(
      expect.objectContaining({ guest_confirmed_at: expect.anything() }),
    )
  })

  // Real incident, 2026-09-23 (7-case live QA run, DEMO account): a
  // guest confirming a reservation never changed `status` (only a
  // human approve/deny in the inbox does), so a later "reiniciar
  // memoria de la IA" on the same thread deleted the row as if it were
  // an abandoned draft — 6 of 7 confirmed test bookings were silently
  // lost this way. `guest_confirmed_at` is the fix's other half (see
  // reset-ai.ts): this marks the row the instant the guest confirms.
  it('marks the reservation_requests row guest_confirmed_at the moment the guest explicitly confirms', async () => {
    h.state.reservationRow = {
      id: 'rr-1',
      category: 'habitaciones',
      service_name: 'Suite Deluxe',
      guests: 4,
      check_in: '2026-09-18',
      check_out: '2026-09-19',
      use_date: null,
      hall: null,
    }
    h.generateReply.mockResolvedValue({
      text: '¡Perfecto! Quedó registrada su solicitud.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      reservationProposals: [{ category: 'habitaciones', fields: { personas: '4' }, confirmed: true }],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.reservationRequestUpdates).toContainEqual(
      expect.objectContaining({ guest_confirmed_at: expect.any(String) }),
    )
  })

  it('does not hand off (and sends no closing message) when every field is known but the guest has not explicitly confirmed', async () => {
    h.state.reservationRow = {
      category: 'habitaciones',
      service_name: 'Suite Deluxe',
      guests: 4,
      check_in: '2026-09-18',
      check_out: '2026-09-19',
      use_date: null,
      hall: null,
    }
    h.generateReply.mockResolvedValue({
      text: 'Para 4 personas el estimado es GTQ 1,500. ¿Le gustaría confirmarla?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      // confirmed: false — the bot is still asking, not closing.
      reservationProposals: [{ category: 'habitaciones', fields: { personas: '4' }, confirmed: false }],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toBeNull()
  })

  it('does not hand off while a required field is still missing, even if confirmed is set — instead tells the guest what is missing (real incident, 2026-09-22: silently doing nothing here left a "Paquete Romántico" guest thinking their request was already with the team while it sat stuck, missing dates, with no one told)', async () => {
    h.state.reservationRow = {
      category: 'habitaciones',
      guests: null,
      check_in: null,
      check_out: null,
      use_date: null,
      hall: null,
    }
    h.generateReply.mockResolvedValue({
      text: '¿Para cuántas personas sería?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      reservationProposals: [{ category: 'habitaciones', fields: {}, confirmed: true }],
    })
    await dispatchInboundToAiReply(ARGS)
    // The model's own reply goes out via engineSendText as always; this
    // is the SEPARATE deterministic nudge, not a hand-off.
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      expect.objectContaining({
        messageType: 'text',
        contentText:
          '¿Le gustaría reservarla? Con mucho gusto se la dejo lista; solo necesito la habitación que desea, las fechas de entrada y salida y el número de personas. 😊',
      }),
    )
    expect(h.state.updatePayload).toBeNull()
  })

  it('two complete proposals in one turn (multi-intent) both close — the second no longer needs its own marker (test run 2026-09-24, prueba #13)', async () => {
    h.state.reservationRow = {
      category: 'habitaciones',
      service_name: 'Suite Deluxe',
      guests: 4,
      check_in: '2026-09-18',
      check_out: '2026-09-19',
      use_date: null,
      hall: null,
    }
    h.generateReply.mockResolvedValue({
      text: 'Con gusto le ayudo con ambas cosas.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      reservationProposals: [
        { category: 'habitaciones', fields: { personas: '4' }, confirmed: true },
        { category: 'spa', fields: { personas: '2' }, confirmed: false },
      ],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.aiActionLogInserts.filter((r) => r.action === 'auto_handoff_reservation_complete')).toHaveLength(2)
    // The bot keeps answering follow-up questions after the close: the team
    // is notified, the conversation is NOT paused or assigned.
    expect(h.state.updatePayload?.ai_autoreply_disabled).not.toBe(true)
    expect(h.state.notificationInserts.length).toBeGreaterThan(0)
  })
})

describe('dispatchInboundToAiReply — autonomous send_restaurant_menu', () => {
  it('sends the menu when the model asks for it and a menu URL is configured', async () => {
    h.state.account = { default_currency: 'USD', restaurant_menu_url: 'https://x/menu.pdf' }
    h.generateReply.mockResolvedValue({
      text: 'Claro, aquí tienes el menú.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendRestaurantMenu: true,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendRestaurantMenuToConversation).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'conv-1', 'agent')
  })

  it('does not send the menu when no menu URL is configured, even if the model asks', async () => {
    h.state.account = { default_currency: 'USD' } // no restaurant_menu_url
    h.generateReply.mockResolvedValue({
      text: 'Aquí tienes el menú.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendRestaurantMenu: true,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendRestaurantMenuToConversation).not.toHaveBeenCalled()
  })

  it('does not send the menu when the model does not ask for it', async () => {
    h.state.account = { default_currency: 'USD', restaurant_menu_url: 'https://x/menu.pdf' }
    await dispatchInboundToAiReply(ARGS) // default mock: sendRestaurantMenu false
    expect(h.sendRestaurantMenuToConversation).not.toHaveBeenCalled()
  })

  it('still sends the menu when the model forgets the marker but the customer plainly asked for it', async () => {
    h.state.account = { default_currency: 'USD', restaurant_menu_url: 'https://x/menu.pdf' }
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'me pueden compartir el menú?' }])
    h.generateReply.mockResolvedValue({
      text: 'Claro, te lo envío enseguida',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendRestaurantMenu: false,
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.sendRestaurantMenuToConversation).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'conv-1', 'agent')
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({ dedupKey: 'ai_marker_missed_send_restaurant_menu:acct-1' }),
    )
  })

  it('swallows a send failure and alerts, without cancelling the already-sent reply', async () => {
    h.state.account = { default_currency: 'USD', restaurant_menu_url: 'https://x/menu.pdf' }
    h.generateReply.mockResolvedValue({
      text: 'Claro, aquí tienes el menú.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      sendCatalog: false,
      sendRestaurantMenu: true,
    })
    h.sendRestaurantMenuToConversation.mockRejectedValueOnce(new Error('pdf host unreachable'))

    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()

    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Claro, aquí tienes el menú.' }),
    )
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warning',
        dedupKey: 'ai_send_restaurant_menu_failed:acct-1',
      }),
    )
  })
})

describe('dispatchInboundToAiReply — quick replies in the prompt', () => {
  it('includes quick-reply lines in the system prompt when the account has some', async () => {
    h.loadQuickReplyContext.mockResolvedValue([{ id: 'qr-1', title: 'Horario', preview: 'Abrimos 8am-6pm.' }])
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('qr-1')
    expect(systemPrompt).toContain('Horario')
    expect(systemPrompt).toContain('Abrimos 8am-6pm.')
  })

  it('says nothing about quick replies when the account has none', async () => {
    h.loadQuickReplyContext.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('QUICK_REPLY')
  })
})

describe('dispatchInboundToAiReply — autonomous send_quick_reply', () => {
  it('sends the quick reply\'s own stored text, not the model\'s own text, and logs it', async () => {
    h.state.quickReplyRow = { id: 'qr-1', content_text: 'Abrimos de lunes a sábado, 8am a 6pm.' }
    h.generateReply.mockResolvedValue({
      text: 'this should never be sent',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      quickReplyId: 'qr-1',
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Abrimos de lunes a sábado, 8am a 6pm.' }),
    )
    expect(h.state.aiActionLogInserts).toEqual([
      expect.objectContaining({
        account_id: 'acct-1',
        actor_user_id: 'user-1',
        action: 'send_quick_reply',
        target_id: 'qr-1',
        input: { quick_reply_id: 'qr-1', source: 'auto_reply_autonomous' },
      }),
    ])
  })

  it('falls back to the model\'s own text when the id does not resolve to a real quick reply (hallucinated / stale id)', async () => {
    h.state.quickReplyRow = null
    h.generateReply.mockResolvedValue({
      text: 'Written by the model itself.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      quickReplyId: 'ghost-id',
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Written by the model itself.' }),
    )
    expect(h.state.aiActionLogInserts).toEqual([])
  })

  it('does not send or log anything quick-reply related when the model does not use the marker', async () => {
    await dispatchInboundToAiReply(ARGS) // default mock: no quickReplyId
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello!' }),
    )
    expect(h.state.aiActionLogInserts).toEqual([])
  })
})

describe('dispatchInboundToAiReply — autonomous create_quote_chat', () => {
  const QUOTE_PROPOSAL = {
    format: 'text' as const,
    items: [{ name: 'Montessori Oslo Imperial', qty: 1 }],
    customerNit: '',
    customerEmail: '',
    customerAddress: 'Villa Canales',
  }

  beforeEach(() => {
    h.state.account.catalog_delivery_mode = 'photos'
    h.generateReply.mockResolvedValue({
      text: '¡Perfecto! Ya puedo prepararte la cotización.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      quoteProposal: QUOTE_PROPOSAL,
    })
  })

  it('creates and sends the quote when the item matches a real catalog product', async () => {
    h.state.products = [{ id: 'p1', name: 'Montessori Oslo Imperial' }]
    h.createQuote.mockResolvedValue({ quote: { id: 'quote-1', total: 2250 }, items: [] })

    await dispatchInboundToAiReply(ARGS)

    expect(h.createQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'contact-1',
        items: [{ product_id: 'p1', quantity: 1 }],
        allowFreeItems: false,
      }),
    )
    expect(h.sendQuoteByAccountPreference).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'quote-1',
      'conv-1',
      true, // proposal.format === 'text' forces a text quote
      true, // askFollowUp — this path bypasses the AI's own text generation entirely
      'agent', // non-hotel: unchanged sender
    )
    // A successful quote must never also trip the silent-failure handoff.
    expect(h.state.updatePayload).toBeNull()
  })

  it('hands off to a human instead of going silent when no item matches a real product (2026-08-25 incident)', async () => {
    h.state.products = [{ id: 'p1', name: 'Montessori Tree Individual' }] // no "Oslo Imperial"

    await dispatchInboundToAiReply(ARGS)

    expect(h.createQuote).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('Montessori Oslo Imperial')
  })

  it('hands off to a human when createQuote itself fails', async () => {
    h.state.products = [{ id: 'p1', name: 'Montessori Oslo Imperial' }]
    const { CreateQuoteError } = await import('@/lib/quotes/create-quote')
    h.createQuote.mockRejectedValue(new CreateQuoteError('customerPhone and customerAddress are required'))

    await dispatchInboundToAiReply(ARGS)

    expect(h.sendQuoteByAccountPreference).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('no se pudo crear la cotización')
  })

  it('hands off to a human when the quote is created but sending it fails', async () => {
    h.state.products = [{ id: 'p1', name: 'Montessori Oslo Imperial' }]
    h.createQuote.mockResolvedValue({ quote: { id: 'quote-1', total: 2250 }, items: [] })
    const { SendQuoteError } = await import('@/lib/quotes/send-quote')
    h.sendQuoteByAccountPreference.mockRejectedValue(new SendQuoteError('messaging window is closed'))

    await dispatchInboundToAiReply(ARGS)

    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('se creó pero no se pudo enviar')
  })

  it('does nothing quote-related when the catalog is delivered digitally (own self-service cart)', async () => {
    h.state.account.catalog_delivery_mode = 'digital'
    h.state.products = [{ id: 'p1', name: 'Montessori Oslo Imperial' }]

    await dispatchInboundToAiReply(ARGS)

    expect(h.createQuote).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toBeNull()
  })
})

describe('dispatchInboundToAiReply - clinic appointment safety', () => {
  beforeEach(() => {
    h.state.account = {
      default_currency: 'GTQ',
      industry_vertical: 'clinica',
      timezone: 'America/Guatemala',
    }
    h.loadClinicAppointmentContext.mockResolvedValue({
      id: 'appt-clinic-1',
      summary: 'Consulta, jueves 10 a las 9:00 a. m., con Dra. Ruiz',
      confirmationStatus: 'pending',
      status: 'SCHEDULED',
    })
    h.generateReply.mockResolvedValue({
      text: 'Tu cita quedó confirmada. Te esperamos.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
      appointmentAction: 'confirm',
    })
  })

  it('persists the confirmation before telling the patient it succeeded', async () => {
    await dispatchInboundToAiReply(ARGS)

    expect(h.transitionAppointment).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'user-1',
      'appt-clinic-1',
      'CONFIRMED',
      expect.objectContaining({ confirmation_status: 'confirmed' }),
    )
    expect(h.transitionAppointment.mock.invocationCallOrder[0]).toBeLessThan(
      h.engineSendText.mock.invocationCallOrder[0],
    )
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Tu cita quedó confirmada. Te esperamos.' }),
    )
    expect(h.state.aiActionLogInserts).toContainEqual(
      expect.objectContaining({
        action: 'appointment_action',
        target_id: 'appt-clinic-1',
        result: { status: 'CONFIRMED' },
      }),
    )
  })

  it('alerts (critical) and hands off — without a false "sent" claim — when the mutation succeeds but the send itself fails', async () => {
    h.engineSendText.mockRejectedValueOnce(new Error('WhatsApp send failed'))

    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()

    // The database mutation already committed before the send was attempted.
    expect(h.transitionAppointment).toHaveBeenCalledWith(
      expect.anything(), 'acct-1', 'user-1', 'appt-clinic-1', 'CONFIRMED',
      expect.objectContaining({ confirmation_status: 'confirmed' }),
    )
    expect(h.dispatchSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        dedupKey: 'ai_send_after_mutation_failed:appt-clinic-1',
      }),
    )
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      ai_handoff_transient: true,
    })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('no se pudo enviar el mensaje')
  })

  it('withholds a false success, sends a safe reply, and routes to reception when persistence fails', async () => {
    h.transitionAppointment.mockResolvedValue({
      ok: false,
      error: 'La cita cambió mientras se procesaba la respuesta',
      status: 409,
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('No pude actualizar tu cita') }),
    )
    expect(h.engineSendText).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Tu cita quedó confirmada. Te esperamos.' }),
    )
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      ai_handoff_transient: true,
    })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('base de datos rechazó')
  })

  it('does not expose generic Google Calendar booking to a clinic account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoScheduleAppointmentsEnabled: true }))
    h.state.gcalStatus = 'active'
    h.generateReply.mockResolvedValue({
      text: '¿Qué día prefieres?',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
    })

    await dispatchInboundToAiReply(ARGS)

    const prompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(prompt).not.toContain('[[SCHEDULE_APPOINTMENT:')
    expect(prompt).toContain('no live clinic-booking tool')
  })

  it('keeps medical safety limits when account metadata is temporarily unreadable', async () => {
    h.state.accountError = { code: '57014', message: 'statement timeout' }
    h.loadClinicAppointmentContext.mockResolvedValue(null)
    h.generateReply.mockResolvedValue({
      text: 'Un profesional de la clínica puede orientarte.',
      handoff: false,
      markDealWon: false,
      moveToStageName: null,
    })

    await dispatchInboundToAiReply(ARGS)

    const prompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(prompt).toContain('This is a medical clinic')
    expect(prompt).toContain('NEVER give a diagnosis')
    expect(h.engineSendText).toHaveBeenCalled()
  })

})

describe('dispatchInboundToAiReply — hotel vertical: ordinary assistance and explicit reception ownership', () => {
  beforeEach(() => {
    h.state.account = { default_currency: 'USD', industry_vertical: 'hotel' }
  })

  it('keeps replying when a human agent is assigned', async () => {
    h.state.conv = { assigned_agent_id: 'agent-9', ai_autoreply_disabled: false, ai_reply_count: 0 }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello!' }))
  })

  it('still stays quiet when a PERSON switched it off on the thread', async () => {
    h.state.conv = { assigned_agent_id: null, ai_autoreply_disabled: true, ai_reply_count: 0 }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('claims an unbounded slot — the reply budget is not a stop', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      { name: 'claim_ai_reply_slot', args: { conversation_id: 'conv-1', max_replies: 2147483647 } },
    ])
  })

  it('keeps replying at the reply budget and flags the thread to the team once', async () => {
    h.state.conv = { assigned_agent_id: null, ai_autoreply_disabled: false, ai_reply_count: 3 }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello!' }))
    expect(h.state.messageInserts).toEqual([
      expect.objectContaining({ content_type: 'internal_note', content_text: expect.stringContaining('Sigue respondiendo') }),
    ])
    expect(h.state.updatePayload?.ai_autoreply_disabled).not.toBe(true)
  })

  it('does not re-flag past the budget', async () => {
    h.state.conv = { assigned_agent_id: null, ai_autoreply_disabled: false, ai_reply_count: 4 }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello!' }))
    expect(h.state.messageInserts).toEqual([])
  })

  it('a reception handoff records the pending topic without requiring manual resumption', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).not.toHaveProperty('ai_autoreply_disabled')
    expect(h.state.updatePayload).toMatchObject({ ai_handoff_transient: null })
    expect(h.state.updatePayload?.ai_handoff_at).toEqual(expect.any(String))
  })

  it('records only an internal note for a hotel handoff', async () => {
    h.generateReply.mockResolvedValue({ text: 'Un compañero le atenderá.', handoff: true, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.messageInserts).toEqual([expect.objectContaining({ content_type: 'internal_note', content_text: expect.stringContaining('Pendiente de recepción') })])
  })
})

describe('dispatchInboundToAiReply — non-hotel verticals keep the long-standing behavior', () => {
  it('never runs the human-reply check', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.loadTrailingOutbound).not.toHaveBeenCalled()
    expect(h.countHumanRepliesAfter).not.toHaveBeenCalled()
  })

  it('a handoff still pauses the bot', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
  })
})

describe('dispatchInboundToAiReply — hotel: a teammate already answered (owner, 2026-10-07)', () => {
  const HUMAN_ROW = {
    sender_type: 'agent',
    content_type: 'text',
    content_text: 'Sí, tenemos parqueo gratis.',
    created_at: '2026-09-26T10:00:30.000Z',
  }
  const reply = (text: string) => ({ text, handoff: false, markDealWon: false, moveToStageName: null })

  beforeEach(() => {
    h.state.account = { default_currency: 'USD', industry_vertical: 'hotel' }
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: '¿Tienen parqueo?' },
      { role: 'assistant', content: 'Sí, tenemos parqueo gratis.' },
    ])
    h.loadTrailingOutbound.mockResolvedValue({ lastCustomerAt: '2026-09-26T10:00:00.000Z', humanSince: '2026-09-26T10:00:00.000Z', rows: [HUMAN_ROW] })
  })

  it('answers a new lead whose only reply so far is the app greeting echo (VSR 2026-10-08, Silvia)', async () => {
    // loadTrailingOutbound already dropped the echo, but the transcript
    // still ends on it.
    h.loadTrailingOutbound.mockResolvedValue({ lastCustomerAt: '2026-09-26T10:00:00.000Z', humanSince: '2026-09-26T10:00:15.000Z', rows: [] })
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Me puede dar información sobre su hospedaje?' },
      { role: 'assistant', content: 'Gracias por su mensaje. Nuestro horario de atención es de 8:00am a 8:00pm.' },
    ])
    h.generateReply.mockResolvedValueOnce(reply('¡Con gusto! Tenemos varias habitaciones.'))
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalled()
    expect(h.generateReply.mock.calls[0][0].messages.at(-1)).toEqual({ role: 'user', content: 'Me puede dar información sobre su hospedaje?' })
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('never answers a message a teammate already answered (owner, 2026-10-07)', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: '¿Tienen parqueo? ¿A qué hora es el check-in?' },
      { role: 'assistant', content: 'Sí, tenemos parqueo gratis.' },
    ])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('still stands down when the bot itself already answered (duplicate guard unchanged)', async () => {
    h.loadTrailingOutbound.mockResolvedValue({
      lastCustomerAt: '2026-09-26T10:00:00.000Z',
      humanSince: '2026-09-26T10:00:00.000Z',
      rows: [{ ...HUMAN_ROW, sender_type: 'bot' }],
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('drops its reply when a teammate answers while it is being generated', async () => {
    h.loadTrailingOutbound.mockResolvedValueOnce({ lastCustomerAt: '2026-09-26T10:00:00.000Z', humanSince: '2026-09-26T10:00:00.000Z', rows: [] })
    h.countHumanRepliesAfter.mockResolvedValueOnce(1)
    h.generateReply.mockResolvedValueOnce(reply('Sí, hay parqueo.'))
    h.buildConversationContext.mockResolvedValueOnce([{ role: 'user', content: '¿Tienen parqueo?' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.generateReply).toHaveBeenCalledTimes(1)
  })
})

describe('hotel discreet assistance regression', () => {
  beforeEach(() => { h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel' } })
  it('acknowledges a cancellation for hotel review without executing it after the staff window', async () => {
    h.teammateTookOver.mockResolvedValue(true)
    h.buildConversationContext.mockResolvedValue([{ role: 'assistant', content: 'Si hay Sr Santoyo las reservo' }, { role: 'user', content: 'Mañana cancelado' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('si es posible') }))
    expect(h.upsertReservationRequest).not.toHaveBeenCalled()
  })
  it('does not explain staff files as its own goodbye after three hours', async () => {
    h.teammateTookOver.mockResolvedValue(true)
    h.buildConversationContext.mockResolvedValue([{ role: 'assistant', senderType: 'agent', contentType: 'image', content: '(Archivo del hotel)' }, { role: 'user', content: 'Disculpe, no entiendo…' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
  it('keeps answering factual information after staff involvement', async () => {
    h.teammateTookOver.mockResolvedValue(true)
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '¿A qué hora es el desayuno?' }])
    h.generateReply.mockResolvedValue({ text: 'El desayuno se sirve de 7:00 a 11:30.', handoff: false, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: 'El desayuno se sirve de 7:00 a 11:30.' }))
  })
  it('does not save an inferred checkout or confirm Fanny’s one-night estimate', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Estoy interesada en alojamiento para el domingo 18 de octubre' }, { role: 'user', content: 'Somos 3 adultos y 2 niños de 4 y 2 años' }])
    h.generateReply.mockResolvedValue({ text: 'El total sería Q870 por una noche.', handoff: false, markDealWon: false, moveToStageName: null,
      reservationProposals: [{ category: 'habitaciones', fields: { servicio: 'Junior Suite Familiar', personas: '5', adultos: '3', edades_ninos: '4,2', entrada: '2026-10-18', salida: '2026-10-19' }, confirmed: true }] })
    await dispatchInboundToAiReply(ARGS)
    expect(h.upsertReservationRequest).toHaveBeenCalledWith(expect.anything(), 'acct-1', expect.not.objectContaining({ check_out: '2026-10-19' }))
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('fecha de salida') }))
    expect(h.engineSendText.mock.calls.map(c => c[0].text).join(' ')).not.toContain('Q870')
  })
})


describe('hotel silent reception ownership', () => {
  beforeEach(() => { h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel' } })
  it.each(['Le envío el comprobante del pago', 'Tengo un voucher de regalo', 'Necesito tarifa especial de tour operador', 'Necesito cotización para un grupo de 51 personas', 'Quiero hablar con recepción'])('records the pending topic without a whole-thread pause or guest message: %s', async (text) => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: text }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(h.sendCatalogToConversation).not.toHaveBeenCalled()
    expect(h.sendRestaurantMenuToConversation).not.toHaveBeenCalled()
    expect(h.createQuote).not.toHaveBeenCalled()
    expect(h.upsertReservationRequest).not.toHaveBeenCalled()
    expect(h.state.updatePayload).not.toHaveProperty('ai_autoreply_disabled')
    expect(h.state.updatePayload).toMatchObject({ ai_handoff_transient: null })
    expect(h.state.messageInserts).toEqual([expect.objectContaining({ content_type: 'internal_note', content_text: expect.stringContaining('Pendiente de recepción') })])
  })
  it('preserves the existing staff assignee', async () => {
    h.state.conv = { assigned_agent_id: 'agent-existing', ai_autoreply_disabled: false, ai_reply_count: 0 }
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-other' }))
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Quiero cancelar mi reserva' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })
  it('does not create a duplicate internal note when another takeover wins the guarded update', async () => {
    h.state.recoveryUpdateRows = []
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Tengo un voucher' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.messageInserts).toEqual([])
    expect(h.state.notificationInserts).toEqual([])
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
  })
  it('keeps a manual pause silent on later customer messages, including recovery', async () => {
    h.state.conv = { assigned_agent_id: null, ai_autoreply_disabled: true, ai_handoff_transient: null, ai_reply_count: 0 }
    await dispatchInboundToAiReply({ ...ARGS, skipDebounce: true })
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.messageInserts).toEqual([])
  })
  it('does not send any attachment or reservation mutation from a model handoff', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Estoy interesado en alojamiento para el domingo 18' }])
    h.generateReply.mockResolvedValue({ text: 'Recepción debe confirmar el total.', handoff: true, markDealWon: true, moveToStageName: null, sendCatalog: true, sendRestaurantMenu: true, sendPhotoProductName: 'Suite Premium', reservationProposals: [{ category: 'habitaciones', fields: { entrada: '2026-10-18', salida: '2026-10-19' }, confirmed: false }] })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(h.sendCatalogToConversation).not.toHaveBeenCalled()
    expect(h.sendRestaurantMenuToConversation).not.toHaveBeenCalled()
    expect(h.upsertReservationRequest).not.toHaveBeenCalled()
    expect(h.moveDeal).not.toHaveBeenCalled()
  })
})


describe('hotel normal information remains automatic', () => {
  beforeEach(() => { h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel' } })
  it.each([
    ['¿Qué formas de pago aceptan?', 'Puede consultar las formas de pago publicadas por el hotel.'],
    ['¿Cuál es la política de cancelación?', 'La política publicada requiere aviso previo.'],
    ['Quiero reservar una habitación para hoy', 'Para hoy recepción debe evaluar disponibilidad. Puede llamar al 41548804.'],
  ])('answers verified information without a transfer offer: %s', async (question, answer) => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: question }])
    h.generateReply.mockResolvedValue({ text: answer, handoff: false, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: answer }))
    expect(h.state.updatePayload?.ai_autoreply_disabled).not.toBe(true)
  })
})


describe('hotel reception control during the staff window', () => {
  beforeEach(() => { h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel' } })
  it('persists a staff-only operation even while the three-hour staff window is active', async () => {
    h.teammateRepliedRecently.mockResolvedValue(true)
    h.buildConversationContext.mockResolvedValue([{ role: 'assistant', senderType: 'agent', content: 'Estamos atendiendo su reserva.' }, { role: 'user', content: 'Quiero cancelar mi reserva' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.updatePayload).not.toHaveProperty('ai_autoreply_disabled')
    expect(h.state.updatePayload).toMatchObject({ ai_handoff_transient: null })
    expect(h.state.messageInserts).toHaveLength(1)
  })
  it('leaves an ordinary question to the existing staff window without permanently pausing it', async () => {
    h.teammateRepliedRecently.mockResolvedValue(true)
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '¿A qué hora sirven el desayuno?' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toBeNull()
    expect(h.state.messageInserts).toEqual([])
  })
  it('does not turn a thank-you after staff involvement into a pending case', async () => {
    h.teammateTookOver.mockResolvedValue(true)
    h.buildConversationContext.mockResolvedValue([{ role: 'assistant', senderType: 'agent', content: 'Gracias por visitarnos.' }, { role: 'user', content: 'Muchas gracias' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toBeNull()
    expect(h.state.messageInserts).toEqual([])
  })
  it('does not interrupt staff when the takeover state cannot be checked', async () => {
    h.teammateRepliedRecently.mockRejectedValue(new Error('temporarily unavailable'))
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toBeNull()
  })
})


describe('hotel automatic reception topic recovery', () => {
  const pendingAt = '2026-10-14T15:00:00.000Z'
  const pendingSummary = '🤝 Pendiente de recepción. Recepción debe revisar una cancelación.'
  const old = { role: 'user' as const, content: 'Quiero cancelar mi reserva', createdAt: '2026-10-14T14:55:00.000Z' }
  const fresh = (content: string) => ({ role: 'user' as const, content, createdAt: '2026-10-14T19:00:00.000Z' })
  beforeEach(() => {
    h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel' }
    h.state.conv = { assigned_agent_id: 'agent-existing', ai_autoreply_disabled: false, ai_handoff_transient: null, ai_reply_count: 0, ai_handoff_summary: pendingSummary, ai_handoff_at: pendingAt }
  })
  it('answers a new breakfast question after a cancellation without a button press or changing the booking', async () => {
    h.buildConversationContext.mockResolvedValue([old, fresh('¿A qué hora sirven el desayuno?')])
    h.generateReply.mockResolvedValue({ text: 'El desayuno se sirve de 7:00 a 11:30.', handoff: false, markDealWon: true, moveToStageName: 'Confirmado', quoteProposal: { format: 'text', items: [] }, reservationProposals: [{ category: 'habitaciones', fields: { entrada: '2026-10-18', salida: '2026-10-19' }, confirmed: true }] })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: 'El desayuno se sirve de 7:00 a 11:30.' }))
    expect(h.upsertReservationRequest).not.toHaveBeenCalled()
    expect(h.createQuote).not.toHaveBeenCalled()
    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(h.state.messageInserts).toEqual([])
    expect(h.generateReply.mock.calls[0][0].systemPrompt).toContain('older reception case remains pending')
  })
  it.each(['¿Ya cancelaron mi reserva?', 'Le mando el comprobante', 'Sí', 'Muchas gracias', '¿Y eso?'])('keeps the operation or ambiguous follow-up silent with no repeated internal note: %s', async (content) => {
    h.buildConversationContext.mockResolvedValue([old, fresh(content)])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(h.state.messageInserts).toEqual([])
    expect(h.state.notificationInserts).toEqual([])
  })
  it('does not release an informational question during the three-hour staff window', async () => {
    h.teammateRepliedRecently.mockResolvedValue(true)
    h.buildConversationContext.mockResolvedValue([old, fresh('¿A qué hora sirven el desayuno?')])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.messageInserts).toEqual([])
  })
  it('releases only a legacy application-created pause and answers the new informational question', async () => {
    h.state.conv!.ai_autoreply_disabled = true
    h.buildConversationContext.mockResolvedValue([old, fresh('¿Tienen parqueo?')])
    h.generateReply.mockResolvedValue({ text: 'Sí, contamos con parqueo.', handoff: false, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply({ ...ARGS, skipDebounce: true })
    expect(h.state.updatePayload).toEqual({ ai_autoreply_disabled: false })
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: 'Sí, contamos con parqueo.' }))
    expect(h.state.messageInserts).toEqual([])
  })
  it('leaves a legacy pending cancellation silent after releasing the obsolete whole-thread flag', async () => {
    h.state.conv!.ai_autoreply_disabled = true
    h.buildConversationContext.mockResolvedValue([old, fresh('¿Ya cancelaron mi reserva?')])
    await dispatchInboundToAiReply({ ...ARGS, skipDebounce: true })
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.messageInserts).toEqual([])
  })
  it('does not release a manual takeover even if it follows an automatic pending case', async () => {
    h.state.conv!.ai_autoreply_disabled = true
    h.state.conv!.ai_handoff_summary = '🤖 Ana tomó el control de esta conversación manualmente y pausó la IA.'
    await dispatchInboundToAiReply({ ...ARGS, skipDebounce: true })
    expect(h.state.updatePayload).toBeNull()
    expect(h.generateReply).not.toHaveBeenCalled()
  })
  it('stands down if a concurrent manual takeover wins the guarded legacy release', async () => {
    h.state.conv!.ai_autoreply_disabled = true
    h.state.recoveryUpdateRows = []
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
  it('acknowledges staff review without a rate-limit fallback or model', async () => {
    h.state.conv!.ai_handoff_summary = null
    h.buildConversationContext.mockResolvedValue([fresh('Necesito un reembolso')])
    vi.mocked(checkSharedRateLimit).mockResolvedValueOnce({ success: false, limit: 1, remaining: 0, reset: Date.now() + 60_000 })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('si es posible') }))
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(h.state.messageInserts).toHaveLength(1)
  })
})


it('does not reactivate a pending reception case for an uncaptioned customer photo', async () => {
  h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel' }
  h.state.conv = { assigned_agent_id: null, ai_autoreply_disabled: false, ai_handoff_transient: null, ai_reply_count: 0, ai_handoff_summary: '🤝 Pendiente de recepción. Un pago.', ai_handoff_at: '2026-10-14T15:00:00.000Z' }
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '(El cliente envió una foto.)', images: [{ mimeType: 'image/jpeg', dataBase64: 'AAAA' }], createdAt: '2026-10-14T19:00:00.000Z' }])
  await dispatchInboundToAiReply(ARGS)
  expect(h.generateReply).not.toHaveBeenCalled()
  expect(h.engineSendText).not.toHaveBeenCalled()
  expect(h.state.messageInserts).toEqual([])
})


it('preserves the pending reception case when a rate-limit fallback interrupts a later factual reply', async () => {
  h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel' }
  h.state.conv = { assigned_agent_id: null, ai_autoreply_disabled: false, ai_handoff_transient: null, ai_reply_count: 0, ai_handoff_summary: '🤝 Pendiente de recepción. Un pago.', ai_handoff_at: '2026-10-14T15:00:00.000Z' }
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '¿Tienen parqueo?', createdAt: '2026-10-14T19:00:00.000Z' }])
  vi.mocked(checkSharedRateLimit).mockResolvedValueOnce({ success: false, limit: 1, remaining: 0, reset: Date.now() + 60_000 })
  await dispatchInboundToAiReply(ARGS)
  expect(h.state.updatePayload).toBeNull()
  expect(h.state.messageInserts).toEqual([])
})


describe('hotel price validation before send (Mery regression)', () => {
  beforeEach(() => {
    vi.mocked(checkSharedRateLimit).mockReset().mockResolvedValue({ success: true, limit: 100, remaining: 99, reset: Date.now() + 60_000 })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T15:00:00Z'))
    h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel', deposit_percent: 50 }
    h.state.products = [{ id: 'p1', name: 'Junior Suite Familiar' }]
    h.state.productRates = [
      { day_of_week: 'sat', occupancy: 'quad', price: 1500, date_from: null, date_to: null },
      { day_of_week: 'sat', occupancy: 'quint', price: 1800, date_from: null, date_to: null },
      { day_of_week: 'sat', occupancy: 'child', price: 200, date_from: null, date_to: null },
    ]
    h.state.reservationRow = {
      id: 'rr-mery', category: 'habitaciones', service_name: 'Junior Suite Familiar', guests: 5,
      adults: 4, children_ages: [], check_in: '2026-10-17', check_out: '2026-10-18', estimated_price: null,
    }
    h.upsertReservationRequest.mockImplementation(async (_db, _account, input) => {
      h.state.reservationRow = { ...h.state.reservationRow, ...input }
      return 'rr-mery'
    })
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '4 adultos y un nino de 5 anos, entrada 17 y salida 18, una noche' }])
    h.generateReply.mockResolvedValue({
      text: 'Para la Junior Suite Familiar, 4 adultos y 1 ni\u00f1o de 5 a\u00f1os, la tarifa es Q1,800. El ni\u00f1o no paga. \u00bfA nombre de qui\u00e9n?',
      handoff: false, markDealWon: false, moveToStageName: null,
      reservationProposals: [{ category: 'habitaciones', fields: { servicio: 'Junior Suite Familiar', personas: '5', adultos: '4', ninos: '0', nota: '1 nino de 5 anos' }, confirmed: false }],
    })
  })
  afterEach(() => { vi.useRealTimers() })

  it('repairs the saved ages and sends only the correct total, preserving the missing-data question', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.upsertReservationRequest).toHaveBeenCalledWith(expect.anything(), 'acct-1', expect.objectContaining({ children_ages: [5], adults: 4, guests: 5 }))
    const sent = h.engineSendText.mock.calls.map((call) => call[0].text).join(' ')
    expect(sent).not.toContain('1,800')
    expect(sent).toContain('1,500')
    expect(sent).toContain('nombre de qui\u00e9n')
    expect(sent).toContain('Recepci\u00f3n debe verificar')
    expect(h.state.aiActionLogInserts).toContainEqual(expect.objectContaining({ action: 'send_stay_estimate', target_id: 'rr-mery', result: { total: 1500 } }))
    expect(h.sendMessageToConversation).not.toHaveBeenCalledWith(expect.anything(), 'acct-1', expect.objectContaining({ contentText: expect.stringContaining('1,500') }))
  })

  it('does not overwrite an explicit staff quote with a published-rate total', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'assistant', senderType: 'agent', content: 'La tarifa acordada es Q1,800.' },
      { role: 'user', content: 'Cual es el precio que acordamos?' },
    ])
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText.mock.calls[0][0].text).toContain('1,800')
    expect(h.sendMessageToConversation).not.toHaveBeenCalledWith(expect.anything(), 'acct-1', expect.objectContaining({ contentText: expect.stringContaining('1,500') }))
  })
})


describe('hotel pending operations from the conversation audit', () => {
  beforeEach(() => { h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel' } })
  it.each([
    'Solo que segun veo falta que me confirmen disponibilidad',
    'Ya no vamos a usar 1 habitacion doble, la distribucion quedara en 9 dobles y 4 sencillas',
    'Le comparto el menu de almuerzos para el grupo de hoy',
  ])('records an internal staff task instead of a generic sign-off: %s', async (content) => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content }, { role: 'user', content: 'Muchas gracias' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    if (content.includes('Ya no vamos')) expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('si es posible') }))
    else expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.upsertReservationRequest).not.toHaveBeenCalled()
    expect(h.state.messageInserts).toContainEqual(expect.objectContaining({ content_type: 'internal_note', content_text: expect.stringContaining('Pendiente de recepci\u00f3n') }))
  })
})


describe('account automatic attention window', () => {
  const schedule = { timeZone: 'America/Guatemala', startHour: 8, endHour: 20 }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.mocked(checkSharedRateLimit).mockReset().mockResolvedValue({ success: true, limit: 100, remaining: 99, reset: Date.now() + 60_000 })
    h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel' }
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplySchedule: schedule }))
  })
  afterEach(() => { vi.useRealTimers() })
  it.each(['2026-10-15T13:59:59Z', '2026-10-16T02:00:00Z', '2026-10-16T06:00:00Z'])('stays silent without generating, sending or pausing outside the window: %s', async (instant) => {
    vi.setSystemTime(new Date(instant))
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(h.upsertReservationRequest).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toBeNull()
  })
  it('answers at exactly 8 am Guatemala time', async () => {
    vi.setSystemTime(new Date('2026-10-15T14:00:00Z'))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalled()
  })
  it('drops a generation that finishes after 8 pm, including all attachments', async () => {
    vi.setSystemTime(new Date('2026-10-16T01:59:59Z'))
    h.generateReply.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date('2026-10-16T02:00:01Z'))
      return { text: 'Con gusto le comparto el menu.', handoff: false, markDealWon: false, moveToStageName: null, sendRestaurantMenu: true }
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(h.sendRestaurantMenuToConversation).not.toHaveBeenCalled()
    expect(h.upsertReservationRequest).not.toHaveBeenCalled()
  })
})


describe('Villa San Ricardo overnight attention', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.mocked(checkSharedRateLimit).mockReset().mockResolvedValue({ success: true, limit: 100, remaining: 99, reset: Date.now() + 60_000 })
    h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel' }
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplySchedule: { timeZone: 'America/Guatemala', startHour: 20, endHour: 8 } }))
  })
  afterEach(() => { vi.useRealTimers() })
  it.each([
    ['2026-10-15T13:59:59Z', true],
    ['2026-10-15T14:00:00Z', false],
    ['2026-10-16T01:59:59Z', false],
    ['2026-10-16T02:00:00Z', true],
  ])('leaves daytime to staff and answers overnight: %s', async (instant, allowed) => {
    vi.setSystemTime(new Date(instant))
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply.mock.calls.length > 0).toBe(allowed)
    expect(h.engineSendText.mock.calls.length > 0).toBe(allowed)
  })
})


describe('room intake before rate sheets (Ana)', () => {
  beforeEach(() => {
    h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel' }
    h.state.categories = [{ id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/weekday.jpg', banner_url_weekend: 'https://cdn.example.com/weekend.jpg' }]
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Quiero informacion para hospedarme' }])
    h.generateReply.mockResolvedValue({ text: 'Para que fechas de entrada y salida, y cuantas personas?', handoff: false, markDealWon: false, moveToStageName: null, reservationProposals: [{ category: 'habitaciones', fields: {}, confirmed: false }] })
  })
  it.each([null, { check_in: '2026-10-26', check_out: '2026-10-28' }, { guests: 2 }])('does not send either room banner while dates or party are missing: %j', async (row) => {
    h.state.reservationRow = row
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalledWith(expect.anything(), 'acct-1', expect.objectContaining({ messageType: 'image' }))
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('ind\u00edqueme') }))
  })
  it('does not borrow old stay dates when the guest starts a separate new request', async () => {
    h.state.reservationRow = { check_in: '2026-10-26', check_out: '2026-10-28', guests: 2 }
    h.generateReply.mockResolvedValue({ text: 'Para que fechas?', handoff: false, markDealWon: false, moveToStageName: null, reservationProposals: [{ category: 'habitaciones', fields: { nueva: '1' }, confirmed: false }] })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).not.toHaveBeenCalledWith(expect.anything(), 'acct-1', expect.objectContaining({ messageType: 'image' }))
  })
  it('uses fresh marker dates and guest count to send only the weekend sheet', async () => {
    h.generateReply.mockResolvedValue({ text: 'Le comparto la referencia para su visita.', handoff: false, markDealWon: false, moveToStageName: null, reservationProposals: [{ category: 'habitaciones', fields: { entrada: '2026-10-23', salida: '2026-10-25', personas: '2' }, confirmed: false }] })
    await dispatchInboundToAiReply(ARGS)
    expect(h.sendMessageToConversation).toHaveBeenCalledWith(expect.anything(), 'acct-1', expect.objectContaining({ mediaUrl: 'https://cdn.example.com/weekend.jpg' }))
    expect(h.sendMessageToConversation).not.toHaveBeenCalledWith(expect.anything(), 'acct-1', expect.objectContaining({ mediaUrl: 'https://cdn.example.com/weekday.jpg' }))
  })
  it('answers Ingrid\u2019s ordinary reference-price question after staff participation', async () => {
    h.teammateTookOver.mockResolvedValue(true)
    h.state.activeReservationRows = [{ category: 'habitaciones', guests: 2, rooms: 2, check_in: '2026-10-26', check_out: '2026-10-28' }]
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Preferiria 2 habitaciones con 1 cama, aunque depende del precio' }])
    h.generateReply.mockResolvedValue({ text: 'La referencia individual es Q300 por noche.', handoff: false, markDealWon: false, moveToStageName: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Q300') }))
  })
})


describe('event quotation triage before generation', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-17T16:00:00Z'))
    vi.mocked(checkSharedRateLimit).mockReset().mockResolvedValue({ success: true, limit: 100, remaining: 99, reset: Date.now() + 60_000 })
    h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel', timezone: 'America/Guatemala' }
  })
  afterEach(() => vi.useRealTimers())
  it('asks first without banners or forms', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Precios para una boda' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('en curso') }))
    expect(h.upsertReservationRequest).not.toHaveBeenCalled()
    expect(h.sendCatalogToConversation).not.toHaveBeenCalled()
  })
  it.each([['2026-10-17T16:00:00Z', '2 horas'], ['2026-10-18T03:00:00Z', 'horario h\u00e1bil']])('acknowledges existing quote at %s', async (instant, wording) => {
    vi.setSystemTime(new Date(instant))
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Tengo una cotizacion de evento' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining(wording) }))
    expect(h.state.messageInserts).toEqual([expect.objectContaining({ content_type: 'internal_note' })])
    expect(h.upsertReservationRequest).not.toHaveBeenCalled()
  })
  it('does not repeat the acknowledgement for later pending replies', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Tengo una cotizacion de boda' },
      { role: 'assistant', content: 'Un compa\u00f1ero del hotel dar\u00e1 seguimiento a su cotizaci\u00f3n en un m\u00e1ximo de 2 horas.' },
      { role: 'user', content: 'Gracias, espero' },
    ])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
  it('allows explicit new event quotations through the provider', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Quiero cotizar una boda para 50 personas' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: expect.stringContaining('EVENT NEW QUOTATION') }))
  })
  it('preserves staff priority when the new event also asks for a payment operation', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Quiero cotizar una boda y quiero pagar el anticipo' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})


describe('direct hotel service and staff-only changes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-18T03:00:00Z'))
    vi.mocked(checkSharedRateLimit).mockReset().mockResolvedValue({ success: true, limit: 100, remaining: 99, reset: Date.now() + 60_000 })
    h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel', timezone: 'America/Guatemala' }
  })
  afterEach(() => vi.useRealTimers())
  it.each(['Quiero cancelar mi reserva', 'Necesito cambiar mi reserva', 'Quiero modificar las cantidades de mi cotizacion'])('acknowledges %s without invoking model or mutating bookings', async content => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('si es posible') }))
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('horario h\u00e1bil') }))
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.upsertReservationRequest).not.toHaveBeenCalled()
    expect(h.state.reservationRequestUpdates).toEqual([])
    expect(h.state.reservationRequestInserts).toEqual([])
    expect(h.createQuote).not.toHaveBeenCalled()
    expect(h.moveDeal).not.toHaveBeenCalled()
  })
  it('blocks unauthorized model claims and all accompanying actions', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Me ayuda con mi solicitud?' }])
    h.generateReply.mockResolvedValue({ text: 'Le modifico las cantidades', handoff: false, markDealWon: true, moveToStageName: 'Confirmado', sendCatalog: true, reservationProposals: [{ category: 'habitaciones', fields: { entrada: '2026-10-25' }, confirmed: true }] })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('si es posible') }))
    expect(h.upsertReservationRequest).not.toHaveBeenCalled()
    expect(h.moveDeal).not.toHaveBeenCalled()
    expect(h.sendCatalogToConversation).not.toHaveBeenCalled()
  })
  it('does not ask Del Cid again for the explicitly stated party', async () => {
    h.state.categories = [{ id: 'cat-1', name: 'Habitaciones', banner_url: 'https://cdn.example.com/weekday.jpg' }]
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Cual es el precio para hospedarme dos personas' }])
    h.generateReply.mockResolvedValue({ text: 'Para cuantas personas y fechas?', handoff: false, markDealWon: false, moveToStageName: null, reservationProposals: [{ category: 'habitaciones', fields: {}, confirmed: false }] })
    await dispatchInboundToAiReply(ARGS)
    const text = h.engineSendText.mock.calls[0]?.[0]?.text
    expect(text).toContain('fecha de entrada')
    expect(text).not.toContain('personas')
    expect(h.generateReply).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: expect.stringContaining('HOTEL SERVICE PRIORITY') }))
  })
})


describe('sales versus hotel stay operations (Daris and Maria)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-18T03:00:00Z'))
    vi.mocked(checkSharedRateLimit).mockReset().mockResolvedValue({ success: true, limit: 100, remaining: 99, reset: Date.now() + 60_000 })
    h.state.account = { default_currency: 'GTQ', industry_vertical: 'hotel', timezone: 'America/Guatemala' }
  })
  afterEach(() => vi.useRealTimers())
  it('continues Daris new lodging sale', async () => {
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'me gustaria consultarte los precios para una estadia para 4 adultos' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalled()
    expect(h.state.messageInserts).toEqual([])
  })
  it('leaves Maria room assignment and dinner coordination to the hotel without model or guest messages', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Ya dentro de un ratito llegamos al hotel', createdAt: '2026-10-18T00:23:00Z' },
      { role: 'user', content: 'Ya no me dijeron el numero de habitacion?', createdAt: '2026-10-18T00:24:00Z' },
      { role: 'user', content: 'Hay cena disponible', createdAt: '2026-10-18T00:29:00Z' },
      { role: 'user', content: 'Para cenar ahi??' }, { role: 'user', content: 'Disculpe' },
    ])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.sendMessageToConversation).not.toHaveBeenCalled()
    expect(h.upsertReservationRequest).not.toHaveBeenCalled()
    expect(h.state.messageInserts).toContainEqual(expect.objectContaining({ content_type: 'internal_note' }))
  })
  it('retains guest context when a pending handoff isolates the latest dinner question', async () => {
    h.state.conv = { ai_autoreply_disabled: false, ai_reply_count: 0, ai_handoff_at: '2026-10-18T00:24:30Z', ai_handoff_summary: '\uD83E\uDD1D Pendiente de recepci\u00f3n. Asignar habitacion.' }
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Ya llegamos al hotel', createdAt: '2026-10-18T00:23:00Z' },
      { role: 'user', content: 'Para cenar ahi?', createdAt: '2026-10-18T00:29:00Z' },
    ])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})
