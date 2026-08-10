import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendMessageToConversation,
  SendMessageError,
  type SendMessageParams,
} from './send-message';

// The persistence tests below drive the full send path, so the three
// side-effecting collaborators are stubbed: Meta (network), the token
// crypto (needs a real key), and the service-role client the flow-run
// pause uses. The validation tests above never reach any of them.
// Spread the real module so non-network exports (INTERACTIVE_LIMITS,
// consumed by the payload validator) keep working; only the senders
// are replaced.
vi.mock('./meta-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./meta-api')>()),
  sendTextMessage: vi.fn(async () => ({ messageId: 'wamid.TEXT' })),
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid.TEMPLATE' })),
  sendMediaMessage: vi.fn(async () => ({ messageId: 'wamid.MEDIA' })),
  sendInteractiveButtons: vi.fn(async () => ({ messageId: 'wamid.BUTTONS' })),
  sendInteractiveList: vi.fn(async () => ({ messageId: 'wamid.LIST' })),
}));

vi.mock('./encryption', () => ({
  decrypt: (v: string) => v,
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => {
    const chain: Record<string, unknown> = {
      update: () => chain,
      eq: () => chain,
      then: (resolve: (v: { error: null }) => unknown) =>
        Promise.resolve({ error: null }).then(resolve),
    };
    return { from: () => chain };
  },
}));

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

// ------------------------------------------------------------
// Chainable Supabase stub for the full send path, scripted per table.
// Captures the `messages` insert and the `conversations` update so a
// test can assert on what actually gets persisted.
// ------------------------------------------------------------
interface Captured {
  message?: Record<string, unknown>;
  conversationUpdate?: Record<string, unknown>;
}

const TEMPLATE_ROW = {
  id: 'tpl-1',
  user_id: 'usr-1',
  name: 'order_update',
  language: 'en',
  body_text: 'Hi {{1}}, your order {{2}} ships on {{3}}.',
};

function makeSendDb(
  templateRow: Record<string, unknown> | null,
  captured: Captured
): SupabaseClient {
  let table = '';
  let mode: 'select' | 'insert' | 'update' = 'select';

  const builder: Record<string, unknown> = {
    select: () => builder,
    insert: (payload: Record<string, unknown>) => {
      mode = 'insert';
      if (table === 'messages') captured.message = payload;
      return builder;
    },
    update: (payload: Record<string, unknown>) => {
      mode = 'update';
      if (table === 'conversations') captured.conversationUpdate = payload;
      return builder;
    },
    eq: () => builder,
    maybeSingle: () =>
      Promise.resolve({
        data: table === 'message_templates' ? templateRow : null,
        error: null,
      }),
    single: () => {
      if (table === 'conversations' && mode === 'select') {
        return Promise.resolve({
          data: {
            id: 'cv-1',
            account_id: 'acct-1',
            contact: { id: 'ct-1', phone: '+14155550123' },
          },
          error: null,
        });
      }
      if (table === 'whatsapp_config') {
        return Promise.resolve({
          data: { id: 'cfg-1', phone_number_id: 'pn-1', access_token: 'tok' },
          error: null,
        });
      }
      if (table === 'messages') {
        return Promise.resolve({ data: { id: 'msg-1' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    // Awaited chains that don't end in single/maybeSingle (the
    // conversations update) resolve through here.
    then: (resolve: (v: { data: null; error: null }) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve),
  };

  return {
    from: (t: string) => {
      table = t;
      mode = 'select';
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('sendMessageToConversation — template body persistence', () => {
  const templateSend: SendMessageParams = {
    conversationId: 'cv-1',
    messageType: 'template',
    templateName: 'order_update',
    templateLanguage: 'en',
    templateParams: ['Jane', 'A123', 'Friday'],
  };

  it('renders the template body when the caller sends no text', async () => {
    // The regression: an API caller passes only `template`, so
    // content_text used to persist as null and the Inbox rendered an
    // empty bubble even though Meta delivered the message.
    const captured: Captured = {};
    const db = makeSendDb(TEMPLATE_ROW, captured);

    const result = await sendMessageToConversation(db, 'acct-1', templateSend);

    expect(result.whatsappMessageId).toBe('wamid.TEMPLATE');
    expect(captured.message?.content_text).toBe(
      'Hi Jane, your order A123 ships on Friday.'
    );
    expect(captured.message?.template_name).toBe('order_update');
    expect(captured.conversationUpdate?.last_message_text).toBe(
      'Hi Jane, your order A123 ships on Friday.'
    );
  });

  it('reads body values from structured template_message_params', async () => {
    const captured: Captured = {};
    const db = makeSendDb(TEMPLATE_ROW, captured);

    await sendMessageToConversation(db, 'acct-1', {
      ...templateSend,
      templateParams: undefined,
      templateMessageParams: { body: ['Sam', 'B456', 'Monday'] },
    });

    expect(captured.message?.content_text).toBe(
      'Hi Sam, your order B456 ships on Monday.'
    );
  });

  it('keeps caller-supplied text — the dashboard pre-renders its own', async () => {
    const captured: Captured = {};
    const db = makeSendDb(TEMPLATE_ROW, captured);

    await sendMessageToConversation(db, 'acct-1', {
      ...templateSend,
      contentText: 'Composer-rendered copy',
    });

    expect(captured.message?.content_text).toBe('Composer-rendered copy');
    expect(captured.conversationUpdate?.last_message_text).toBe(
      'Composer-rendered copy'
    );
  });

  it('still sends when the template row is missing locally', async () => {
    // Never synced, or a language mismatch. We can't render a body, so
    // content_text stays null and the thread falls back to the template
    // name — but the send itself must not fail.
    const captured: Captured = {};
    const db = makeSendDb(null, captured);

    const result = await sendMessageToConversation(db, 'acct-1', templateSend);

    expect(result.messageId).toBe('msg-1');
    expect(captured.message?.content_text).toBeNull();
    expect(captured.conversationUpdate?.last_message_text).toBe('[template]');
  });

  it('leaves a plain text send untouched', async () => {
    const captured: Captured = {};
    const db = makeSendDb(null, captured);

    await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'Hello there',
    });

    expect(captured.message?.content_text).toBe('Hello there');
    expect(captured.message?.template_name).toBeNull();
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
