import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { sendFacebookMessageToConversation } from './send-message';

vi.mock('@/lib/zernio/api', () => ({
  sendZernioText: vi.fn(async () => ({ messageId: 'zmsg-1' })),
  sendZernioMedia: vi.fn(async () => ({ messageId: 'zmsg-2' })),
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

import { sendZernioText as mockedSendZernioText } from '@/lib/zernio/api';

function fakeDb(opts?: { lastCustomerMessageAt?: string | null }): SupabaseClient {
  const conversation = {
    id: 'cv-1',
    channel: 'facebook',
    zernio_conversation_id: 'zconv-1',
    contact: { id: 'ct-1', facebook_id: 'psid-1' },
  };
  const config = {
    id: 'cfg-1',
    zernio_api_key: 'key',
    zernio_account_id: 'zacct-1',
  };

  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({
          data: opts?.lastCustomerMessageAt ? { created_at: opts.lastCustomerMessageAt } : null,
          error: null,
        }),
        insert: () => builder,
        update: () => builder,
        single: async () => {
          if (table === 'conversations') return { data: conversation, error: null };
          if (table === 'facebook_config') return { data: config, error: null };
          if (table === 'messages') return { data: { id: 'msg-1' }, error: null };
          return { data: null, error: null };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('sendFacebookMessageToConversation — humanAgentTag (24h-window exception)', () => {
  it('applies the tag when the window has actually expired', async () => {
    const longAgo = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    await sendFacebookMessageToConversation(fakeDb({ lastCustomerMessageAt: longAgo }), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'Hi',
      humanAgentTag: true,
    });
    expect(mockedSendZernioText).toHaveBeenCalledWith(expect.objectContaining({ humanAgentTag: true }));
  });

  it('does NOT apply the tag when the window is still open, even if the caller asked', async () => {
    const justNow = new Date().toISOString();
    await sendFacebookMessageToConversation(fakeDb({ lastCustomerMessageAt: justNow }), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'Hi',
      humanAgentTag: true,
    });
    expect(mockedSendZernioText).toHaveBeenCalledWith(expect.objectContaining({ humanAgentTag: false }));
  });

  it('never applies the tag unless the caller explicitly asked, even outside the window', async () => {
    await sendFacebookMessageToConversation(fakeDb({ lastCustomerMessageAt: null }), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'Hi',
    });
    expect(mockedSendZernioText).toHaveBeenCalledWith(expect.objectContaining({ humanAgentTag: false }));
  });
});
