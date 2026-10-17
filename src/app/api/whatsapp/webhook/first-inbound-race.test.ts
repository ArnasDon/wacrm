import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// WHATSAPP B1 fix — see supabase/migrations/053_atomic_first_inbound_message.sql
// and the `insert_inbound_customer_message` RPC call in processMessage()
// (src/app/api/whatsapp/webhook/route.ts).
//
// Two DIFFERENT messages from the same brand-new contact, delivered by
// Meta as two separate webhook POSTs processed concurrently (each in
// its own `after()` invocation — real, independent serverless
// executions with no shared lock), used to both compute
// isFirstInboundMessage = true via a plain `SELECT count(*)` read
// before either had inserted, and both fire the `first_inbound_message`
// automation trigger.
//
// DETERMINISM, NOT TIMING: this file drives two concurrent POST() calls
// against a shared, mutable in-memory fake Postgres. Every mock here
// resolves via a *synchronous* body wrapped in `Promise.resolve(...)` —
// no `setTimeout`, no real I/O. JS is single-threaded, so no two of
// these mock function bodies can ever literally overlap: whichever of
// the two call chains reaches a given mock statement first runs that
// statement's entire body — including its state mutation — to
// completion before the other call's corresponding statement can run.
// That is exactly the property a real Postgres row lock gives the SQL
// function itself (see the migration), so the interleaving is
// deterministic and repeatable on every run, never flaky.
//
// This also exercises the pre-existing contact/conversation
// unique-index races (migrations 022/036) for real (unmocked
// findOrCreateContact / findOrCreateConversation, backed by a fake
// table that simulates their unique constraints with a 23505 error on
// conflict) — both concurrent deliveries must converge on the SAME
// single contact and the SAME single conversation before either can
// reach the message-count race this migration actually fixes.
// ============================================================

interface FakeContact {
  id: string
  account_id: string
  phone: string
  name: string | null
}
interface FakeConversation {
  id: string
  account_id: string
  contact_id: string
  created_at: string
  status?: string
}
interface FakeMessageRow {
  id: string
  conversation_id: string
  message_id: string | null
  sender_type: string
}

const h = vi.hoisted(() => ({
  state: {
    contacts: [] as FakeContact[],
    conversations: [] as FakeConversation[],
    messages: [] as FakeMessageRow[],
    afterCallbacks: [] as Array<() => Promise<void> | void>,
    seq: 0,
  },
  dispatchWebhookEvent: vi.fn(),
  runAutomationsForTrigger: vi.fn(),
  dispatchInboundToFlows: vi.fn(),
  dispatchInboundToAiReply: vi.fn(),
}))

function nextId(prefix: string): string {
  h.state.seq += 1
  return `${prefix}-${h.state.seq}`
}

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.state.afterCallbacks.push(cb)
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      if (table === 'whatsapp_config') {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [
                  {
                    account_id: 'acc-1',
                    user_id: 'user-1',
                    access_token: 'enc',
                    mirror_inbound_media: true,
                  },
                ],
                error: null,
              }),
          }),
        }
      }

      if (table === 'contacts') {
        return {
          // findExistingContact (src/lib/contacts/dedupe.ts, real
          // implementation, not mocked): select('*').eq('account_id',X).like('phone','%suffix')
          select: () => ({
            eq: () => ({
              like: (_col: string, pattern: string) => {
                const suffix = pattern.replace(/^%/, '')
                return Promise.resolve({
                  data: h.state.contacts.filter((c) => c.phone.endsWith(suffix)),
                  error: null,
                })
              },
            }),
          }),
          // findOrCreateContact's create path. Simulates the unique
          // index (migration 022) with a real 23505 on conflict —
          // isUniqueViolation() (also real, not mocked) recognizes it.
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: () => {
                const phone = row.phone as string
                const accountId = row.account_id as string
                const conflict = h.state.contacts.some(
                  (c) => c.account_id === accountId && c.phone === phone,
                )
                if (conflict) {
                  return Promise.resolve({
                    data: null,
                    error: { code: '23505', message: 'duplicate key value violates unique constraint' },
                  })
                }
                const created: FakeContact = {
                  id: nextId('contact'),
                  account_id: accountId,
                  phone,
                  name: (row.name as string) ?? null,
                }
                h.state.contacts.push(created)
                return Promise.resolve({ data: created, error: null })
              },
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
        }
      }

      if (table === 'conversations') {
        return {
          // findOrCreateConversation (route.ts, real implementation):
          //   select('*').eq('account_id',X).eq('contact_id',Y).order().limit()
          // — used both for the initial lookup and the post-conflict re-resolve.
          select: () => ({
            eq: (_c1: string, accountId: string) => ({
              eq: (_c2: string, contactId: string) => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({
                      data: h.state.conversations
                        .filter((c) => c.account_id === accountId && c.contact_id === contactId)
                        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
                      error: null,
                    }),
                }),
              }),
            }),
          }),
          // Simulates the unique index (migration 036) with a real
          // 23505 on conflict, same pattern as contacts above.
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: () => {
                const accountId = row.account_id as string
                const contactId = row.contact_id as string
                const conflict = h.state.conversations.some(
                  (c) => c.account_id === accountId && c.contact_id === contactId,
                )
                if (conflict) {
                  return Promise.resolve({
                    data: null,
                    error: { code: '23505', message: 'duplicate key value violates unique constraint' },
                  })
                }
                const created: FakeConversation = {
                  id: nextId('conv'),
                  account_id: accountId,
                  contact_id: contactId,
                  created_at: new Date(1700000000000 + h.state.seq).toISOString(),
                  status: 'open',
                }
                h.state.conversations.push(created)
                return Promise.resolve({ data: created, error: null })
              },
            }),
          }),
        }
      }

      if (table === 'broadcast_recipients') {
        // flagBroadcastReplyIfAny — no broadcasts exist in this test.
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                in: () => ({
                  order: () => ({
                    limit: () => Promise.resolve({ data: [], error: null }),
                  }),
                }),
              }),
            }),
          }),
        }
      }

      throw new Error(`unexpected table in B1 race test fake: ${table}`)
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name !== 'insert_inbound_customer_message') {
        return Promise.resolve({ data: null, error: null })
      }
      // Faithful simulation of migration 053's contract. The "lock" is
      // modeled by this entire body running as one uninterrupted
      // synchronous step (see the file header) — count, insert, and
      // report happen atomically from the caller's point of view,
      // exactly like the real function's lock-ordered transaction.
      const conversationId = args.p_conversation_id as string
      const messageId = args.p_message_id as string

      const replay = h.state.messages.some(
        (m) => m.conversation_id === conversationId && m.message_id === messageId,
      )
      if (replay) {
        return Promise.resolve({
          data: [{ message_id: null, was_inserted: false, is_first_customer_message: false }],
          error: null,
        })
      }

      const priorCount = h.state.messages.filter(
        (m) => m.conversation_id === conversationId && m.sender_type === 'customer',
      ).length

      const created: FakeMessageRow = {
        id: nextId('msg'),
        conversation_id: conversationId,
        message_id: messageId,
        sender_type: 'customer',
      }
      h.state.messages.push(created)

      return Promise.resolve({
        data: [
          {
            message_id: created.id,
            was_inserted: true,
            is_first_customer_message: priorCount === 0,
          },
        ],
        error: null,
      })
    },
  }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'plain-token',
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
}))
vi.mock('@/lib/whatsapp/webhook-signature', () => ({
  verifyMetaWebhookSignature: () => true,
}))
vi.mock('@/lib/whatsapp/template-webhook', () => ({
  isTemplateWebhookField: () => false,
  handleTemplateWebhookChange: vi.fn(),
}))
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.runAutomationsForTrigger,
}))
vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: h.dispatchInboundToFlows,
}))
vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: h.dispatchInboundToAiReply,
}))
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: h.dispatchWebhookEvent,
}))

import { POST } from './route'

function inboundRequest(messageId: string, phone = '15551230000') {
  const body = {
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'pn-1' },
              contacts: [{ wa_id: phone, profile: { name: 'Ada' } }],
              messages: [
                {
                  id: messageId,
                  from: phone,
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body: `hello from ${messageId}` },
                },
              ],
            },
          },
        ],
      },
    ],
  }
  return {
    text: async () => JSON.stringify(body),
    headers: { get: () => 'sha256=stub' },
  } as unknown as Request
}

/** POST once and return its queued after() callback, not yet run. */
async function postAndQueue(messageId: string, phone?: string) {
  const before = h.state.afterCallbacks.length
  await POST(inboundRequest(messageId, phone))
  return h.state.afterCallbacks[before]
}

function triggerFirings(triggerType: string) {
  return h.runAutomationsForTrigger.mock.calls.filter(
    (call) => (call[0] as { triggerType: string }).triggerType === triggerType,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.contacts = []
  h.state.conversations = []
  h.state.messages = []
  h.state.afterCallbacks = []
  h.state.seq = 0
  h.dispatchWebhookEvent.mockResolvedValue(undefined)
  h.dispatchInboundToFlows.mockResolvedValue({ consumed: false })
  h.dispatchInboundToAiReply.mockResolvedValue(undefined)
  h.runAutomationsForTrigger.mockResolvedValue(undefined)
})

describe('WhatsApp B1 — first_inbound_message race is closed by an atomic RPC', () => {
  it('1+2. two different messages from the same brand-new contact, processed concurrently: both land, exactly one is first, first_inbound_message and new_contact_created each fire exactly once', async () => {
    const cbA = await postAndQueue('wamid.A')
    const cbB = await postAndQueue('wamid.B')

    // Both webhook deliveries' background processing runs
    // CONCURRENTLY — this is the actual race, reproduced
    // deterministically (see the file header for why this is not
    // timing-dependent).
    await Promise.all([cbA(), cbB()])

    // Both messages actually landed — the fix must never lose one.
    expect(h.state.messages).toHaveLength(2)
    expect(h.state.messages.map((m) => m.message_id).sort()).toEqual(['wamid.A', 'wamid.B'])

    // Exactly one contact, exactly one conversation — the pre-existing
    // unique-index races (migrations 022/036) already guaranteed this;
    // asserted here as the precondition the B1 fix builds on top of.
    expect(h.state.contacts).toHaveLength(1)
    expect(h.state.conversations).toHaveLength(1)

    // The B1 property: exactly ONE of the two concurrent deliveries
    // fired first_inbound_message — never zero, never two.
    expect(triggerFirings('first_inbound_message')).toHaveLength(1)

    // new_contact_created was already race-safe before this fix
    // (contact creation is guarded by the unique index) — still fires
    // exactly once. Documents that this part was never broken.
    expect(triggerFirings('new_contact_created')).toHaveLength(1)
  })

  it('3. a contact that already has customer messages: two concurrent new messages never fire first_inbound_message', async () => {
    h.state.contacts.push({ id: 'contact-1', account_id: 'acc-1', phone: '15551230000', name: 'Ada' })
    h.state.conversations.push({
      id: 'conv-1',
      account_id: 'acc-1',
      contact_id: 'contact-1',
      created_at: new Date(0).toISOString(),
      status: 'open',
    })
    h.state.messages.push({ id: 'msg-0', conversation_id: 'conv-1', message_id: 'wamid.OLD', sender_type: 'customer' })

    const cbA = await postAndQueue('wamid.C')
    const cbB = await postAndQueue('wamid.D')
    await Promise.all([cbA(), cbB()])

    expect(h.state.messages).toHaveLength(3)
    expect(triggerFirings('first_inbound_message')).toHaveLength(0)
    expect(triggerFirings('new_contact_created')).toHaveLength(0)
  })

  it('4. replay: the same message_id delivered twice concurrently never duplicates the row and never double-fires first_inbound_message', async () => {
    const cbA = await postAndQueue('wamid.SAME')
    const cbB = await postAndQueue('wamid.SAME') // Meta redelivering the identical message
    await Promise.all([cbA(), cbB()])

    // ON CONFLICT (conversation_id, message_id) DO NOTHING still holds
    // inside insert_inbound_customer_message — only one row.
    expect(h.state.messages.filter((m) => m.message_id === 'wamid.SAME')).toHaveLength(1)

    // Exactly one of the two deliveries actually inserted (and so fired
    // first_inbound_message); the replay is a pure no-op downstream.
    expect(triggerFirings('first_inbound_message')).toHaveLength(1)
  })
})

// ============================================================
// Contraprueba (item 5 of the B1 authorization).
//
// Unlike A3 — where the fix only added a missing WHERE-scope to an
// otherwise-unchanged query, so the exact same test file could be run
// against a `git stash`-reverted route.ts — B1's fix changes the CALL
// SHAPE ENTIRELY: three separate calls (SELECT count, upsert, rpc
// bump) collapse into one RPC call. There is no single fake DB shape
// that both the pre-fix and post-fix route.ts can run against
// unmodified, so literally reverting route.ts and re-running the suite
// above isn't meaningful — it would just throw "unexpected table:
// messages" against this file's fake, which proves incompatibility,
// not the race.
//
// Instead, this isolates the exact mechanism migration 053 changes —
// independent of the webhook route, contacts, conversations, or any
// other mocking — and shows the old shape (a real await boundary
// between the count-read and the insert-write, exactly where the old
// code's separate upsert() round-trip was) genuinely races, while the
// new shape (no await boundary inside the critical section, modeling
// the real function's row lock) does not.
// ============================================================
describe('B1 contraprueba — the old check-then-act pattern races; the lock-ordered one does not', () => {
  interface Row {
    conversation_id: string
    message_id: string
    sender_type: string
  }

  it('OLD shape (SELECT count, an await boundary, THEN insert): two concurrent calls both see count=0', async () => {
    const rows: Row[] = []
    // Mirrors the exact pre-fix sequence in processMessage(): read the
    // count, THEN (after a real await — where the old code's upsert
    // round-trip was) write the row. The await boundary is what lets
    // the other concurrent call's read interleave before either write
    // has happened.
    async function oldInsert(conversationId: string, messageId: string): Promise<boolean> {
      const priorCount = rows.filter(
        (r) => r.conversation_id === conversationId && r.sender_type === 'customer',
      ).length
      await Promise.resolve() // the old code's separate upsert() round-trip
      rows.push({ conversation_id: conversationId, message_id: messageId, sender_type: 'customer' })
      return priorCount === 0
    }

    const [isFirstA, isFirstB] = await Promise.all([
      oldInsert('conv-X', 'wamid.A'),
      oldInsert('conv-X', 'wamid.B'),
    ])

    // Reproduces BUG B1 exactly: both concurrent calls conclude "I am
    // the conversation's first customer message."
    expect(isFirstA).toBe(true)
    expect(isFirstB).toBe(true)
  })

  it('NEW shape (lock scope covers count + insert, no await boundary between them): exactly one concurrent call sees count=0', async () => {
    const rows: Row[] = []
    // Mirrors insert_inbound_customer_message (migration 053): the
    // count and the insert are in the same synchronous critical
    // section — no await boundary between them — modeling the real
    // function's row lock, which serializes concurrent transactions
    // around exactly that section.
    function newInsert(conversationId: string, messageId: string): Promise<boolean> {
      const priorCount = rows.filter(
        (r) => r.conversation_id === conversationId && r.sender_type === 'customer',
      ).length
      rows.push({ conversation_id: conversationId, message_id: messageId, sender_type: 'customer' })
      return Promise.resolve(priorCount === 0)
    }

    const [isFirstA, isFirstB] = await Promise.all([
      newInsert('conv-X', 'wamid.A'),
      newInsert('conv-X', 'wamid.B'),
    ])

    // Exactly one is first — never both, never neither.
    expect([isFirstA, isFirstB].filter(Boolean)).toHaveLength(1)
  })
})
