import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendMessageToConversation,
  SendMessageError,
  type SendMessageParams,
} from './send-message';

// A db that explodes if touched — these tests cover the param
// validation that MUST short-circuit before any query runs.
function noDb(): SupabaseClient {
  return {
    from() {
      throw new Error('db should not be queried for invalid params');
    },
  } as unknown as SupabaseClient;
}

async function expectSendError(
  params: SendMessageParams,
  status: number,
  messageMatch?: RegExp
) {
  await expect(
    sendMessageToConversation(noDb(), 'acct-1', params)
  ).rejects.toBeInstanceOf(SendMessageError);
  await sendMessageToConversation(noDb(), 'acct-1', params).catch(
    (e: SendMessageError) => {
      expect(e.status).toBe(status);
      if (messageMatch) expect(e.message).toMatch(messageMatch);
    }
  );
}

describe('sendMessageToConversation — param validation (pre-DB)', () => {
  const base = { conversationId: 'cv-1' };

  it('requires conversation_id and message_type', async () => {
    await expectSendError({ conversationId: '', messageType: 'text' }, 400);
    await expectSendError({ conversationId: 'cv-1', messageType: '' }, 400);
  });

  it('rejects an unsupported message_type', async () => {
    await expectSendError(
      { ...base, messageType: 'carrier-pigeon' },
      400,
      /Unsupported message_type/
    );
  });

  it('requires content_text for text messages', async () => {
    await expectSendError(
      { ...base, messageType: 'text' },
      400,
      /content_text is required/
    );
  });

  it('requires template_name for template messages', async () => {
    await expectSendError(
      { ...base, messageType: 'template' },
      400,
      /template_name is required/
    );
  });

  it('requires media_url for media kinds', async () => {
    for (const kind of ['image', 'video', 'document', 'audio']) {
      await expectSendError(
        { ...base, messageType: kind },
        400,
        /media_url is required/
      );
    }
  });

  it('rejects an over-long media caption (non-audio)', async () => {
    await expectSendError(
      {
        ...base,
        messageType: 'image',
        mediaUrl: 'https://x/y.jpg',
        contentText: 'a'.repeat(1025),
      },
      400,
      /1024-character limit/
    );
  });

  it('requires a valid interactive payload for interactive messages', async () => {
    // Missing payload entirely.
    await expectSendError(
      { ...base, messageType: 'interactive' },
      400,
      /payload is required/
    );
    // Too many buttons.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
            { id: 'c', title: 'C' },
            { id: 'd', title: 'D' },
          ],
        },
      },
      400,
      /at most 3 buttons/
    );
    // Over-long button title.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [{ id: 'a', title: 'x'.repeat(21) }],
        },
      },
      400,
      /20-character limit/
    );
  });

  it('allows a long "caption" on audio (audio carries none) — so it reaches the DB', async () => {
    // Audio is exempt from the caption cap, so validation passes and we
    // proceed to the conversation lookup — proven by the stub throwing.
    const spy = vi.fn(() => {
      throw new Error('reached DB');
    });
    const db = { from: spy } as unknown as SupabaseClient;
    await expect(
      sendMessageToConversation(db, 'acct-1', {
        ...base,
        messageType: 'audio',
        mediaUrl: 'https://x/y.ogg',
        contentText: 'a'.repeat(2000),
      })
    ).rejects.toThrow('reached DB');
    expect(spy).toHaveBeenCalledWith('conversations');
  });
});

describe('SendMessageError', () => {
  it('carries a machine code and an HTTP status', () => {
    const e = new SendMessageError('meta_error', 'boom', 502);
    expect(e.code).toBe('meta_error');
    expect(e.status).toBe(502);
    expect(e).toBeInstanceOf(Error);
  });
});

// ============================================================
// Full send path — what actually lands in `messages` (issue #483).
// ============================================================

const sendTemplateMessage = vi.fn(async () => ({ messageId: 'wamid.1' }));

// Stub only the senders — the module also exports INTERACTIVE_LIMITS,
// which `interactive.ts` needs for the payload validation covered above.
vi.mock('@/lib/whatsapp/meta-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendTextMessage: vi.fn(async () => ({ messageId: 'wamid.text' })),
  sendTemplateMessage: (...args: unknown[]) =>
    (sendTemplateMessage as unknown as (...a: unknown[]) => unknown)(...args),
  sendMediaMessage: vi.fn(async () => ({ messageId: 'wamid.media' })),
  sendInteractiveButtons: vi.fn(async () => ({ messageId: 'wamid.btn' })),
  sendInteractiveList: vi.fn(async () => ({ messageId: 'wamid.list' })),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v,
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
}));

vi.mock('@/lib/flows/admin-client', () => ({
  // Only used for the best-effort "pause active flow run" write.
  supabaseAdmin: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      }),
    }),
  }),
}));

interface CapturedWrites {
  message?: Record<string, unknown>;
  conversation?: Record<string, unknown>;
}

/**
 * Supabase fake covering the tables the send path touches. Each table
 * gets a builder that is both chainable and awaitable, so the same
 * object serves `.single()` lookups and the bare `select().eq().eq()`
 * the template resolver uses.
 */
function sendPathDb(
  templateRows: unknown[],
  captured: CapturedWrites
): SupabaseClient {
  const conversation = {
    id: 'cv-1',
    contact: { id: 'ct-1', phone: '+15551234567' },
  };
  const config = {
    id: 'cfg-1',
    phone_number_id: 'pn-1',
    access_token: 'token',
  };

  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        insert: (row: Record<string, unknown>) => {
          if (table === 'messages') captured.message = row;
          return builder;
        },
        update: (row: Record<string, unknown>) => {
          if (table === 'conversations') captured.conversation = row;
          return builder;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => {
          if (table === 'conversations') {
            return { data: conversation, error: null };
          }
          if (table === 'whatsapp_config') return { data: config, error: null };
          if (table === 'messages') {
            return { data: { id: 'msg-1' }, error: null };
          }
          return { data: null, error: null };
        },
        // Bare-await result — only message_templates is read this way.
        then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
          resolve({
            data: table === 'message_templates' ? templateRows : [],
            error: null,
          }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const TEMPLATE_ROW = {
  id: 'tpl-1',
  user_id: 'u-1',
  name: 'order_update',
  category: 'Utility',
  language: 'en',
  body_text: 'Your order {{1}} ships on {{2}}',
  created_at: '2026-01-01T00:00:00Z',
};

describe('sendMessageToConversation — template persistence (#483)', () => {
  it('stores the substituted body when the caller sends no text', async () => {
    const captured: CapturedWrites = {};
    const result = await sendMessageToConversation(
      sendPathDb([TEMPLATE_ROW], captured),
      'acct-1',
      {
        conversationId: 'cv-1',
        messageType: 'template',
        templateName: 'order_update',
        templateParams: ['A123', 'Friday'],
      }
    );

    expect(result.whatsappMessageId).toBe('wamid.1');
    // Was NULL before the fix — the Inbox rendered an empty bubble.
    expect(captured.message?.content_text).toBe(
      'Your order A123 ships on Friday'
    );
    expect(captured.message?.template_name).toBe('order_update');
    // …and the conversation-list preview reads the body, not '[template]'.
    expect(captured.conversation?.last_message_text).toBe(
      'Your order A123 ships on Friday'
    );
  });

  it('reads body values out of the structured params shape too', async () => {
    const captured: CapturedWrites = {};
    await sendMessageToConversation(sendPathDb([TEMPLATE_ROW], captured), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'template',
      templateName: 'order_update',
      templateMessageParams: { body: ['B456', 'Monday'] },
    });
    expect(captured.message?.content_text).toBe(
      'Your order B456 ships on Monday'
    );
  });

  it("does not override the composer's pre-rendered text", async () => {
    const captured: CapturedWrites = {};
    await sendMessageToConversation(sendPathDb([TEMPLATE_ROW], captured), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'template',
      templateName: 'order_update',
      templateParams: ['A123', 'Friday'],
      contentText: 'rendered by the composer',
    });
    expect(captured.message?.content_text).toBe('rendered by the composer');
  });

  it("sends the local row's language when the caller names none", async () => {
    sendTemplateMessage.mockClear();
    const captured: CapturedWrites = {};
    await sendMessageToConversation(sendPathDb([TEMPLATE_ROW], captured), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'template',
      templateName: 'order_update',
      templateParams: ['A123', 'Friday'],
    });
    // Previously pinned to 'en_US', which matched no row and made Meta
    // reject the send as a missing translation.
    expect(
      (sendTemplateMessage.mock.calls[0] as unknown as [{ language: string }])[0]
        .language
    ).toBe('en');
  });

  it('leaves content_text null when the account has no local template row', async () => {
    const captured: CapturedWrites = {};
    await sendMessageToConversation(sendPathDb([], captured), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'template',
      templateName: 'never_synced',
      templateParams: ['A123'],
    });
    // Nothing to render from — the bubble falls back to the template
    // name rather than inventing a body.
    expect(captured.message?.content_text).toBeNull();
    expect(captured.conversation?.last_message_text).toBe('[template]');
  });
});

// ============================================================
// Punto 10, F-P10-2 — a manual send from a REAL, currently-authenticated
// human agent (`humanAgentUserId`) pauses the AI auto-reply bot the
// same way the inbox's "Take over" action already does. Dedicated fake
// DB (rather than reusing sendPathDb/CapturedWrites above) because
// isAccountMember() — never mocked in this file, it runs for real —
// needs a `profiles` table the shared fake doesn't model, and this
// path can issue a SECOND `conversations` update that the shared fake's
// single-slot `captured.conversation` would silently overwrite.
// ============================================================
function sendPathDbWithMembership(opts: {
  accountMembers: Set<string>;
  initialAssignedAgentId?: string | null;
}): { db: SupabaseClient; conversationUpdates: Record<string, unknown>[] } {
  const conversation = {
    id: 'cv-1',
    account_id: 'acct-1',
    assigned_agent_id: opts.initialAssignedAgentId ?? null,
    contact: { id: 'ct-1', phone: '+15551234567' },
  };
  const config = { id: 'cfg-1', phone_number_id: 'pn-1', access_token: 'token' };
  const conversationUpdates: Record<string, unknown>[] = [];

  const db = {
    from(table: string) {
      // isAccountMember()'s `.select('user_id').eq('account_id', X)
      // .eq('user_id', Y).maybeSingle()` — same fake shape already
      // established in src/lib/ai/auto-reply.test.ts for the same helper.
      if (table === 'profiles') {
        const filters: Record<string, string> = {};
        const api = {
          select: () => api,
          eq: (col: string, val: string) => {
            filters[col] = val;
            return api;
          },
          maybeSingle: async () => {
            const userId = filters.user_id;
            const isMember = !!userId && opts.accountMembers.has(userId);
            return { data: isMember ? { user_id: userId } : null, error: null };
          },
        };
        return api;
      }
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        insert: () => builder,
        update: (row: Record<string, unknown>) => {
          if (table === 'conversations') conversationUpdates.push(row);
          return builder;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => {
          if (table === 'conversations') return { data: conversation, error: null };
          if (table === 'whatsapp_config') return { data: config, error: null };
          if (table === 'messages') return { data: { id: 'msg-1' }, error: null };
          return { data: null, error: null };
        },
        then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: [], error: null }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;

  return { db, conversationUpdates };
}

describe('sendMessageToConversation — F-P10-2: human-agent takeover on manual send', () => {
  it('a valid same-account humanAgentUserId gets assigned and disables auto-reply', async () => {
    const { db, conversationUpdates } = sendPathDbWithMembership({
      accountMembers: new Set(['agent-1']),
    });
    await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'On my way!',
      humanAgentUserId: 'agent-1',
    });
    const takeOverUpdate = conversationUpdates.find((u) => 'assigned_agent_id' in u);
    expect(takeOverUpdate).toEqual({
      assigned_agent_id: 'agent-1',
      ai_autoreply_disabled: true,
    });
  });

  it('isolation: a humanAgentUserId that is NOT a member of this account is never assigned', async () => {
    const { db, conversationUpdates } = sendPathDbWithMembership({
      accountMembers: new Set(), // 'agent-1' is a real user, but of a different account
    });
    await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'On my way!',
      humanAgentUserId: 'agent-1',
    });
    for (const update of conversationUpdates) {
      expect(update).not.toHaveProperty('assigned_agent_id');
      expect(update).not.toHaveProperty('ai_autoreply_disabled');
    }
  });

  it('never stomps an existing assignment', async () => {
    const { db, conversationUpdates } = sendPathDbWithMembership({
      accountMembers: new Set(['agent-1']),
      initialAssignedAgentId: 'agent-already-owns-this',
    });
    await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'On my way!',
      humanAgentUserId: 'agent-1',
    });
    for (const update of conversationUpdates) {
      expect(update).not.toHaveProperty('assigned_agent_id');
      expect(update).not.toHaveProperty('ai_autoreply_disabled');
    }
  });

  it('the public API path (no humanAgentUserId) never touches assigned_agent_id or ai_autoreply_disabled', async () => {
    const { db, conversationUpdates } = sendPathDbWithMembership({
      accountMembers: new Set(['agent-1']),
    });
    await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'Your order shipped!',
      // humanAgentUserId intentionally omitted — this is what
      // /api/v1/messages does today (an API key has no live human
      // identity to pass).
    });
    for (const update of conversationUpdates) {
      expect(update).not.toHaveProperty('assigned_agent_id');
      expect(update).not.toHaveProperty('ai_autoreply_disabled');
    }
  });
});
