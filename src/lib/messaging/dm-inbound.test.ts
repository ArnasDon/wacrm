import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingInstagramContact: vi.fn(),
  findExistingFacebookContact: vi.fn(),
  isUniqueViolation: () => false,
}))
vi.mock('@/lib/conversations/reopen', () => ({ reopenClosedConversation: vi.fn() }))
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: vi.fn() }))
vi.mock('@/lib/flows/engine', () => ({ dispatchInboundToFlows: vi.fn() }))
vi.mock('@/lib/ai/auto-reply', () => ({ dispatchInboundToAiReply: vi.fn() }))
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: vi.fn() }))

import {
  handleOutboundEchoMessage,
  handleOutboundEchoMessageForZernioConversation,
  ensureZernioConversationStarted,
} from './dm-inbound'

/** Minimal fixture-driven fake db covering only what these two
 *  functions touch: `conversations` (lookup by zernio_conversation_id
 *  or by contact_id, plus the last-message update) and `messages`
 *  (optional reply-parent lookup, then the idempotent upsert). */
function makeDb(fx: {
  conversation?: { id: string; contact_id: string } | null
  messageUpsertResult?: { id: string }[]
  replyParent?: { id: string } | null
  contact?: { id: string } | null
}) {
  const state = {
    upserts: [] as { row: Record<string, unknown>; options: unknown }[],
    conversationUpdates: [] as Record<string, unknown>[],
    conversationInserts: [] as Record<string, unknown>[],
  }

  const db = {
    from(table: string) {
      if (table === 'conversations') {
        const readChain = {
          select: () => readChain,
          eq: () => readChain,
          order: () => readChain,
          limit: () => Promise.resolve({ data: fx.conversation ? [fx.conversation] : [], error: null }),
          maybeSingle: () => Promise.resolve({ data: fx.conversation ?? null, error: null }),
        }
        return {
          ...readChain,
          update: (row: Record<string, unknown>) => {
            state.conversationUpdates.push(row)
            return { eq: () => Promise.resolve({ error: null }) }
          },
          insert: (row: Record<string, unknown>) => {
            state.conversationInserts.push(row)
            return { select: () => ({ single: () => Promise.resolve({ data: { id: 'new-conv', ...row }, error: null }) }) }
          },
        }
      }
      if (table === 'messages') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: fx.replyParent ?? null, error: null }),
              }),
            }),
          }),
          upsert: (row: Record<string, unknown>, options: unknown) => {
            state.upserts.push({ row, options })
            return { select: () => Promise.resolve({ data: fx.messageUpsertResult ?? [{ id: 'msg-1' }], error: null }) }
          },
        }
      }
      if (table === 'contacts') {
        return {
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: fx.contact, error: null }) }) }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }

  return { db: db as unknown as SupabaseClient, state }
}

describe('handleOutboundEchoMessageForZernioConversation', () => {
  it('records the message as an agent send when a conversation already exists', async () => {
    const { db, state } = makeDb({ conversation: { id: 'conv-1', contact_id: 'contact-1' } })

    await handleOutboundEchoMessageForZernioConversation(db, {
      channel: 'instagram',
      accountId: 'acct-1',
      zernioConversationId: 'zconv-1',
      mid: 'mid-1',
      contentText: 'de vuelta desde la app',
      mediaUrl: null,
      contentType: 'text',
      replyToMid: null,
    })

    expect(state.upserts).toHaveLength(1)
    expect(state.upserts[0].row).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'agent',
      content_text: 'de vuelta desde la app',
      message_id: 'mid-1',
      status: 'sent',
    })
    expect(state.upserts[0].options).toMatchObject({
      onConflict: 'conversation_id,message_id',
      ignoreDuplicates: true,
    })
    expect(state.conversationUpdates).toHaveLength(1)
    expect(state.conversationUpdates[0]).toMatchObject({ last_message_text: 'de vuelta desde la app' })
  })

  it('does nothing when no conversation exists yet for that zernio_conversation_id', async () => {
    const { db, state } = makeDb({ conversation: null })

    await handleOutboundEchoMessageForZernioConversation(db, {
      channel: 'instagram',
      accountId: 'acct-1',
      zernioConversationId: 'zconv-unknown',
      mid: 'mid-1',
      contentText: 'hola',
      mediaUrl: null,
      contentType: 'text',
      replyToMid: null,
    })

    expect(state.upserts).toHaveLength(0)
    expect(state.conversationUpdates).toHaveLength(0)
  })

  it('no-ops (no conversation bump) when the upsert reports a duplicate — e.g. wacrm itself already sent this message', async () => {
    const { db, state } = makeDb({
      conversation: { id: 'conv-1', contact_id: 'contact-1' },
      messageUpsertResult: [],
    })

    await handleOutboundEchoMessageForZernioConversation(db, {
      channel: 'instagram',
      accountId: 'acct-1',
      zernioConversationId: 'zconv-1',
      mid: 'mid-already-sent-by-wacrm',
      contentText: 'ya enviado por el CRM',
      mediaUrl: null,
      contentType: 'text',
      replyToMid: null,
    })

    expect(state.upserts).toHaveLength(1)
    expect(state.conversationUpdates).toHaveLength(0)
  })

  it('accepts channel "whatsapp" (Coexistence echoes have no contact-creation path here)', async () => {
    const { db, state } = makeDb({ conversation: { id: 'conv-1', contact_id: 'contact-1' } })

    await handleOutboundEchoMessageForZernioConversation(db, {
      channel: 'whatsapp',
      accountId: 'acct-1',
      zernioConversationId: 'zconv-1',
      mid: 'wamid-1',
      contentText: 'respondido desde la app oficial de whatsapp',
      mediaUrl: null,
      contentType: 'text',
      replyToMid: null,
    })

    expect(state.upserts).toHaveLength(1)
    expect(state.upserts[0].row).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'agent',
      content_text: 'respondido desde la app oficial de whatsapp',
      message_id: 'wamid-1',
    })
  })
})

describe('ensureZernioConversationStarted', () => {
  it('creates a brand-new contact + conversation from just the participantId, and sets zernio_conversation_id (2026-08-25 incident)', async () => {
    const { findExistingInstagramContact } = await import('@/lib/contacts/dedupe')
    vi.mocked(findExistingInstagramContact).mockResolvedValue(null)
    const { dispatchWebhookEvent } = await import('@/lib/webhooks/deliver')

    const { db, state } = makeDb({ conversation: null, contact: { id: 'contact-new' } })

    await ensureZernioConversationStarted(db, {
      channel: 'instagram',
      accountId: 'acct-1',
      configOwnerUserId: 'user-1',
      participantId: 'igsid-new',
      zernioConversationId: 'zconv-new',
      resolveProfile: async () => ({ name: 'Carmen', username: 'carmen_ig' }),
    })

    expect(state.conversationInserts).toHaveLength(1)
    expect(state.conversationInserts[0]).toMatchObject({ account_id: 'acct-1', contact_id: 'contact-new' })
    expect(state.conversationUpdates).toContainEqual({ zernio_conversation_id: 'zconv-new' })
    expect(dispatchWebhookEvent).toHaveBeenCalledWith(db, 'acct-1', 'conversation.created', expect.objectContaining({ contact_id: 'contact-new' }))
    expect(dispatchWebhookEvent).toHaveBeenCalledWith(db, 'acct-1', 'contact.created', expect.objectContaining({ contact_id: 'contact-new' }))
  })

  it('reuses an existing contact + conversation without re-dispatching creation webhooks', async () => {
    const { findExistingInstagramContact } = await import('@/lib/contacts/dedupe')
    vi.mocked(findExistingInstagramContact).mockResolvedValue({ id: 'contact-1' } as never)
    const { dispatchWebhookEvent } = await import('@/lib/webhooks/deliver')
    vi.mocked(dispatchWebhookEvent).mockClear()

    const { db, state } = makeDb({
      conversation: { id: 'conv-1', contact_id: 'contact-1' },
    })

    await ensureZernioConversationStarted(db, {
      channel: 'instagram',
      accountId: 'acct-1',
      configOwnerUserId: 'user-1',
      participantId: 'igsid-1',
      zernioConversationId: 'zconv-1',
      resolveProfile: async () => null,
    })

    expect(state.conversationInserts).toHaveLength(0)
    expect(dispatchWebhookEvent).not.toHaveBeenCalled()
    // Still self-heals zernio_conversation_id even on an existing row.
    expect(state.conversationUpdates).toContainEqual({ zernio_conversation_id: 'zconv-1' })
  })
})

describe('handleOutboundEchoMessage', () => {
  it('resolves the contact by the customer id (not the account id) and records an agent send', async () => {
    const { findExistingInstagramContact } = await import('@/lib/contacts/dedupe')
    vi.mocked(findExistingInstagramContact).mockResolvedValue({ id: 'contact-1' } as never)

    const { db, state } = makeDb({ conversation: { id: 'conv-1', contact_id: 'contact-1' } })

    await handleOutboundEchoMessage(db, {
      channel: 'instagram',
      accountId: 'acct-1',
      configOwnerUserId: 'user-1',
      customerId: 'igsid-customer',
      mid: 'mid-2',
      contentText: 'respondido desde la app nativa',
      mediaUrl: null,
      contentType: 'text',
      replyToMid: null,
      resolveProfile: async () => null,
    })

    expect(findExistingInstagramContact).toHaveBeenCalledWith(db, 'acct-1', 'igsid-customer')
    expect(state.upserts).toHaveLength(1)
    expect(state.upserts[0].row).toMatchObject({ sender_type: 'agent', content_text: 'respondido desde la app nativa' })
  })
})
