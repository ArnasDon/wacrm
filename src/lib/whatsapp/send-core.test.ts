import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const resolveConnection = vi.fn();
const createTransport = vi.fn();
const flowPause = vi.fn();

vi.mock('@/lib/whatsapp/resolve-connection', () => ({
  resolveConnection: (...a: unknown[]) => resolveConnection(...a),
}));
vi.mock('@/lib/whatsapp/providers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createTransport: (...a: unknown[]) => createTransport(...a),
}));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({
          eq: () => ({
            eq: async () => {
              flowPause();
              return { error: null };
            },
          }),
        }),
      }),
    }),
  }),
}));

import { sendViaConnection } from './send-core';
import { SendMessageError } from './send-error';
import { UnsupportedCapabilityError } from './providers/types';
import type { WhatsAppTransport } from './providers/types';

const CONN = {
  id: 'cfg-1',
  accountId: 'acct-1',
  provider: 'meta' as const,
  phoneNumberId: 'pn-1',
  credential: 'tok',
};

/** Transporte falso: registra a chamada, devolve o que lhe mandarem. */
function fakeTransport(
  overrides: Partial<WhatsAppTransport> = {},
  calls: unknown[] = []
): WhatsAppTransport {
  const ok = async (args: unknown) => {
    calls.push(args);
    return { providerMessageId: 'pmid-1' };
  };
  return {
    provider: 'meta',
    capabilities: {
      templates: true,
      interactive: true,
      reactions: true,
      media: true,
    },
    sendText: ok,
    sendMedia: ok,
    sendInteractive: ok,
    sendTemplate: ok,
    sendReaction: ok,
    ...overrides,
  } as WhatsAppTransport;
}

interface Writes {
  message?: Record<string, unknown>;
  conversation?: Record<string, unknown>;
  contact?: Record<string, unknown>;
}

function coreDb(
  writes: Writes,
  contactPhone = '5511999998888'
): SupabaseClient {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        insert: (row: Record<string, unknown>) => {
          if (table === 'messages') writes.message = row;
          return builder;
        },
        update: (row: Record<string, unknown>) => {
          if (table === 'conversations') writes.conversation = row;
          if (table === 'contacts') writes.contact = row;
          return builder;
        },
        maybeSingle: async () => ({
          data:
            table === 'contacts' ? { id: 'ct-1', phone: contactPhone } : null,
          error: null,
        }),
        single: async () => {
          if (table === 'conversations') {
            return {
              data: {
                id: 'cv-1',
                contact: { id: 'ct-1', phone: contactPhone },
              },
              error: null,
            };
          }
          if (table === 'messages') {
            return { data: { id: 'msg-1' }, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ error: null }).then(resolve),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  resolveConnection.mockReset();
  createTransport.mockReset();
  flowPause.mockReset();
  resolveConnection.mockResolvedValue(CONN);
});

describe('sendViaConnection', () => {
  it('persiste a mensagem e atualiza a conversa no caminho de texto', async () => {
    const writes: Writes = {};
    createTransport.mockReturnValue(fakeTransport());

    const result = await sendViaConnection(coreDb(writes), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'text', text: 'olá' },
      senderType: 'agent',
    });

    expect(result).toEqual({ messageId: 'msg-1', providerMessageId: 'pmid-1' });
    expect(writes.message).toMatchObject({
      conversation_id: 'cv-1',
      sender_type: 'agent',
      content_type: 'text',
      content_text: 'olá',
      media_url: null,
      template_name: null,
      interactive_payload: null,
      message_id: 'pmid-1',
      status: 'sent',
      ai_generated: false,
      reply_to_message_id: null,
    });
    expect(writes.conversation).toMatchObject({ last_message_text: 'olá' });
  });

  it('rejeita com 400 quando o transporte não declara a capacidade', async () => {
    createTransport.mockReturnValue(
      fakeTransport({
        capabilities: {
          templates: false,
          interactive: true,
          reactions: true,
          media: true,
        },
      })
    );

    await sendViaConnection(coreDb({}), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'template', templateName: 'promo' },
      senderType: 'agent',
    }).catch((e: SendMessageError) => {
      expect(e).toBeInstanceOf(SendMessageError);
      expect(e.status).toBe(400);
      expect(e.reason).toBe('unsupported_capability');
      expect(e.cause).toBeInstanceOf(UnsupportedCapabilityError);
    });
    expect.assertions(4);
  });

  it('grava no contato o número que o transporte normalizou', async () => {
    const writes: Writes = {};
    createTransport.mockReturnValue(
      fakeTransport({
        sendText: async () => ({
          providerMessageId: 'pmid-2',
          normalizedRecipient: '55011999998888',
        }),
      })
    );

    await sendViaConnection(coreDb(writes), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'text', text: 'oi' },
      senderType: 'agent',
    });

    expect(writes.contact).toEqual({ phone: '55011999998888' });
  });

  it('não toca no contato quando o transporte não normalizou nada', async () => {
    const writes: Writes = {};
    createTransport.mockReturnValue(fakeTransport());
    await sendViaConnection(coreDb(writes), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'text', text: 'oi' },
      senderType: 'agent',
    });
    expect(writes.contact).toBeUndefined();
  });

  it('usa previewText quando o chamador o fornece, e o padrão quando não', async () => {
    createTransport.mockReturnValue(fakeTransport());

    const withOverride: Writes = {};
    await sendViaConnection(coreDb(withOverride), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'media', mediaKind: 'image', link: 'https://x/y.jpg' },
      senderType: 'bot',
      previewText: '[image]',
    });
    expect(withOverride.conversation).toMatchObject({
      last_message_text: '[image]',
    });

    const withDefault: Writes = {};
    await sendViaConnection(coreDb(withDefault), 'acct-1', {
      conversationId: 'cv-1',
      message: {
        kind: 'media',
        mediaKind: 'image',
        link: 'https://x/y.jpg',
        caption: 'legenda',
      },
      senderType: 'bot',
    });
    expect(withDefault.conversation).toMatchObject({
      last_message_text: 'legenda',
    });
  });

  it('só persiste media_url quando o chamador passa persistedMediaUrl', async () => {
    createTransport.mockReturnValue(fakeTransport());

    const semUrl: Writes = {};
    await sendViaConnection(coreDb(semUrl), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'media', mediaKind: 'image', link: 'https://x/y.jpg' },
      senderType: 'bot',
    });
    expect(semUrl.message).toMatchObject({ media_url: null });

    const comUrl: Writes = {};
    await sendViaConnection(coreDb(comUrl), 'acct-1', {
      conversationId: 'cv-1',
      message: {
        kind: 'media',
        mediaKind: 'image',
        link: 'https://x/y.jpg',
        persistedMediaUrl: 'https://x/y.jpg',
      },
      senderType: 'agent',
    });
    expect(comUrl.message).toMatchObject({ media_url: 'https://x/y.jpg' });
  });

  it('pausa o flow run ativo só quando pauseActiveFlowRun está ligado', async () => {
    createTransport.mockReturnValue(fakeTransport());

    await sendViaConnection(coreDb({}), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'text', text: 'oi' },
      senderType: 'bot',
    });
    expect(flowPause).not.toHaveBeenCalled();

    await sendViaConnection(coreDb({}), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'text', text: 'oi' },
      senderType: 'agent',
      pauseActiveFlowRun: true,
    });
    expect(flowPause).toHaveBeenCalledTimes(1);
  });

  it('rejeita telefone fora de E.164 antes de chamar o transporte', async () => {
    const transport = fakeTransport();
    const spy = vi.spyOn(transport, 'sendText');
    createTransport.mockReturnValue(transport);

    await sendViaConnection(coreDb({}, '123'), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'text', text: 'oi' },
      senderType: 'agent',
    }).catch((e: SendMessageError) => {
      expect(e.code).toBe('bad_request');
      expect(e.reason).toBe('contact_phone_invalid');
      expect(e.cause).toBe('123');
    });
    expect(spy).not.toHaveBeenCalled();
    expect.assertions(4);
  });

  it('embrulha uma falha do provedor em meta_error / 502 preservando a causa', async () => {
    const boom = new Error('(#132000) Template mismatch');
    createTransport.mockReturnValue(
      fakeTransport({
        sendText: async () => {
          throw boom;
        },
      })
    );

    await sendViaConnection(coreDb({}), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'text', text: 'oi' },
      senderType: 'agent',
    }).catch((e: SendMessageError) => {
      expect(e.code).toBe('meta_error');
      expect(e.status).toBe(502);
      expect(e.message).toBe('Meta API error: (#132000) Template mismatch');
      expect(e.reason).toBe('provider_error');
      expect(e.cause).toBe(boom);
    });
    expect.assertions(5);
  });
});
