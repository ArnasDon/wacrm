import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { sendInstagramMessageToConversation } from './send-message';
import { SendMessageError } from '@/lib/messaging/types';
import { sendTextMessage as mockedSendTextMessage } from '@/lib/instagram/api';

function noDb(): SupabaseClient {
  return {
    from() {
      throw new Error('db should not be queried for invalid params');
    },
  } as unknown as SupabaseClient;
}

// Mirrors src/lib/whatsapp/send-message.test.ts's shape — same error
// family (SendMessageError), same pre-DB validation contract.
async function expectSendError(
  params: Parameters<typeof sendInstagramMessageToConversation>[2],
  status: number,
  messageMatch?: RegExp,
) {
  await sendInstagramMessageToConversation(noDb(), 'acct-1', params).catch(
    (e: SendMessageError) => {
      expect(e).toBeInstanceOf(SendMessageError);
      expect(e.status).toBe(status);
      if (messageMatch) expect(e.message).toMatch(messageMatch);
    },
  );
}

describe('sendInstagramMessageToConversation — param validation (pre-DB)', () => {
  const base = { conversationId: 'cv-1' };

  it('requires conversation_id', async () => {
    await expectSendError({ conversationId: '', messageType: 'text' }, 400);
  });

  it('rejects template — a WhatsApp-only concept', async () => {
    await expectSendError(
      { ...base, messageType: 'template', templateName: 'x' },
      400,
      /WhatsApp-only/,
    );
  });

  it('rejects interactive — not supported for Instagram yet', async () => {
    await expectSendError({ ...base, messageType: 'interactive' }, 400, /not supported for Instagram/);
  });

  it('rejects an unsupported message_type', async () => {
    await expectSendError({ ...base, messageType: 'carrier-pigeon' }, 400, /Unsupported message_type/);
  });

  it('requires content_text for text messages', async () => {
    await expectSendError({ ...base, messageType: 'text' }, 400, /content_text is required/);
  });

  it('requires media_url for media kinds', async () => {
    for (const kind of ['image', 'video', 'document', 'audio']) {
      await expectSendError({ ...base, messageType: kind }, 400, /media_url is required/);
    }
  });
});

// ============================================================
// Full send path.
// ============================================================

vi.mock('@/lib/instagram/api', () => ({
  sendTextMessage: vi.fn(async () => ({ messageId: 'ig-msg.text' })),
  sendMediaMessage: vi.fn(async () => ({ messageId: 'ig-msg.media' })),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v,
}));

vi.mock('@/lib/flows/admin-client', () => ({
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

function sendPathDb(
  captured: CapturedWrites,
  opts?: { noContact?: boolean; noConfig?: boolean; lastCustomerMessageAt?: string | null },
): SupabaseClient {
  const conversation = {
    id: 'cv-1',
    channel: 'instagram',
    contact: opts?.noContact ? { id: 'ct-1' } : { id: 'ct-1', instagram_id: 'igsid-1' },
  };
  const config = {
    id: 'cfg-1',
    ig_account_id: 'ig-acct-1',
    access_token: 'token',
  };

  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        // `isWithinMessagingWindow`'s chain — only reached for
        // `messages` when `humanAgentTag` is requested.
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({
          data: opts?.lastCustomerMessageAt === undefined
            ? null
            : opts.lastCustomerMessageAt
              ? { created_at: opts.lastCustomerMessageAt }
              : null,
          error: null,
        }),
        insert: (row: Record<string, unknown>) => {
          if (table === 'messages') captured.message = row;
          return builder;
        },
        update: (row: Record<string, unknown>) => {
          if (table === 'conversations') captured.conversation = row;
          return builder;
        },
        single: async () => {
          if (table === 'conversations') return { data: conversation, error: null };
          if (table === 'instagram_config') {
            return opts?.noConfig ? { data: null, error: { message: 'not found' } } : { data: config, error: null };
          }
          if (table === 'messages') return { data: { id: 'msg-1' }, error: null };
          return { data: null, error: null };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('sendInstagramMessageToConversation — send path', () => {
  it('sends a text message and persists it', async () => {
    const captured: CapturedWrites = {};
    const result = await sendInstagramMessageToConversation(sendPathDb(captured), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'Hi 👋',
    });

    expect(result).toEqual({ messageId: 'msg-1', whatsappMessageId: 'ig-msg.text' });
    expect(captured.message).toMatchObject({
      conversation_id: 'cv-1',
      sender_type: 'agent',
      content_type: 'text',
      content_text: 'Hi 👋',
      message_id: 'ig-msg.text',
      status: 'sent',
    });
    expect(captured.conversation).toMatchObject({ last_message_text: 'Hi 👋' });
  });

  it('sends a media message and persists media_url', async () => {
    const captured: CapturedWrites = {};
    const result = await sendInstagramMessageToConversation(sendPathDb(captured), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'image',
      mediaUrl: 'https://x/y.jpg',
    });

    expect(result.whatsappMessageId).toBe('ig-msg.media');
    expect(captured.message).toMatchObject({
      content_type: 'image',
      media_url: 'https://x/y.jpg',
      message_id: 'ig-msg.media',
    });
  });

  it('fails with instagram_not_configured when there is no config', async () => {
    const captured: CapturedWrites = {};
    await expect(
      sendInstagramMessageToConversation(sendPathDb(captured, { noConfig: true }), 'acct-1', {
        conversationId: 'cv-1',
        messageType: 'text',
        contentText: 'Hi',
      }),
    ).rejects.toMatchObject({ code: 'instagram_not_configured', status: 400 });
  });

  it("fails when the contact has no Instagram identity", async () => {
    const captured: CapturedWrites = {};
    await expect(
      sendInstagramMessageToConversation(sendPathDb(captured, { noContact: true }), 'acct-1', {
        conversationId: 'cv-1',
        messageType: 'text',
        contentText: 'Hi',
      }),
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
  });
});

describe('sendInstagramMessageToConversation — humanAgentTag (24h-window exception)', () => {
  it('applies the tag when the window has actually expired', async () => {
    const captured: CapturedWrites = {};
    const longAgo = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(); // 30h ago
    await sendInstagramMessageToConversation(
      sendPathDb(captured, { lastCustomerMessageAt: longAgo }),
      'acct-1',
      { conversationId: 'cv-1', messageType: 'text', contentText: 'Hi', humanAgentTag: true },
    );
    expect(mockedSendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ humanAgentTag: true }),
    );
  });

  it('does NOT apply the tag when the window is still open, even if the caller asked', async () => {
    const captured: CapturedWrites = {};
    const justNow = new Date().toISOString();
    await sendInstagramMessageToConversation(
      sendPathDb(captured, { lastCustomerMessageAt: justNow }),
      'acct-1',
      { conversationId: 'cv-1', messageType: 'text', contentText: 'Hi', humanAgentTag: true },
    );
    expect(mockedSendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ humanAgentTag: false }),
    );
  });

  it('never applies the tag unless the caller explicitly asked, even outside the window', async () => {
    const captured: CapturedWrites = {};
    await sendInstagramMessageToConversation(
      sendPathDb(captured, { lastCustomerMessageAt: null }),
      'acct-1',
      { conversationId: 'cv-1', messageType: 'text', contentText: 'Hi' },
    );
    expect(mockedSendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ humanAgentTag: false }),
    );
  });
});
