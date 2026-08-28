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
import type { MessageTemplate } from '@/types';

const CONN = {
  id: 'cfg-1',
  accountId: 'acct-1',
  provider: 'meta' as const,
  phoneNumberId: 'pn-1',
  credential: 'tok',
};

const TEMPLATE: MessageTemplate = {
  id: 'tmpl-1',
  user_id: 'u-1',
  name: 'promo',
  category: 'Marketing',
  body_text: 'Hello {{1}}',
  created_at: '2026-01-01T00:00:00Z',
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

interface ContactRow {
  phone: string;
  accountId: string;
}

interface ParentMessageRow {
  conversationId: string;
  providerMessageId: string | null;
}

interface CoreDbOptions {
  /** Telefone devolvido pelo join conversa→contato (caminho da inbox/API). */
  contactPhone?: string;
  contactRowId?: string;
  /**
   * Contatos endereçáveis por id, para o ramo `contactId` de
   * `loadContact` (caminho dos engines). Chave = id do contato. O fake
   * SÓ devolve a linha quando `account_id` no filtro bate com
   * `accountId` da linha — prova real do escopo por conta, não vácua.
   */
  contactsById?: Record<string, ContactRow>;
  /**
   * Mensagens-pai endereçáveis por id, para `resolveReplyTarget`. Chave
   * = nosso `messages.id`. Só resolve quando `conversation_id` do
   * filtro bate com a da linha.
   */
  messagesById?: Record<string, ParentMessageRow>;
}

function coreDb(writes: Writes, options: CoreDbOptions = {}): SupabaseClient {
  const {
    contactPhone = '5511999998888',
    contactRowId = 'ct-1',
    contactsById = {},
    messagesById = {},
  } = options;

  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        insert: (row: Record<string, unknown>) => {
          if (table === 'messages') writes.message = row;
          return builder;
        },
        update: (row: Record<string, unknown>) => {
          if (table === 'conversations') writes.conversation = row;
          if (table === 'contacts') writes.contact = row;
          return builder;
        },
        maybeSingle: async () => {
          if (table === 'contacts') {
            const row = contactsById[filters.id as string];
            if (row && row.accountId === filters.account_id) {
              return {
                data: { id: filters.id, phone: row.phone },
                error: null,
              };
            }
            return { data: null, error: null };
          }
          if (table === 'messages') {
            const row = messagesById[filters.id as string];
            if (row && row.conversationId === filters.conversation_id) {
              return {
                data: {
                  message_id: row.providerMessageId,
                  conversation_id: row.conversationId,
                },
                error: null,
              };
            }
            return { data: null, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => {
          if (table === 'conversations') {
            return {
              data: {
                id: filters.id ?? 'cv-1',
                contact: { id: contactRowId, phone: contactPhone },
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

    await sendViaConnection(coreDb({}, { contactPhone: '123' }), 'acct-1', {
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

  it('persiste template com content_type/template_name corretos e content_text = persistedText', async () => {
    const writes: Writes = {};
    createTransport.mockReturnValue(fakeTransport());

    await sendViaConnection(coreDb(writes), 'acct-1', {
      conversationId: 'cv-1',
      message: {
        kind: 'template',
        templateName: 'promo',
        language: 'en_US',
        template: TEMPLATE,
        params: ['Foo'],
        persistedText: 'Hello Foo',
      },
      senderType: 'agent',
    });

    expect(writes.message).toMatchObject({
      content_type: 'template',
      template_name: 'promo',
      content_text: 'Hello Foo',
      media_url: null,
      interactive_payload: null,
    });
  });

  it('persiste persistedText mesmo quando a linha local de template não vai no fio (caminho das Automations)', async () => {
    const writes: Writes = {};
    createTransport.mockReturnValue(fakeTransport());

    await sendViaConnection(coreDb(writes), 'acct-1', {
      conversationId: 'cv-1',
      message: {
        kind: 'template',
        templateName: 'promo',
        language: 'en',
        params: ['Foo'],
        persistedText: 'Hello Foo (Automations)',
      },
      senderType: 'bot',
    });

    expect(writes.message).toMatchObject({
      content_type: 'template',
      template_name: 'promo',
      content_text: 'Hello Foo (Automations)',
    });
  });

  it('grava content_text null e cai para [template] no preview quando persistedText está ausente', async () => {
    const writes: Writes = {};
    createTransport.mockReturnValue(fakeTransport());

    await sendViaConnection(coreDb(writes), 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'template', templateName: 'promo', language: 'en' },
      senderType: 'agent',
    });

    expect(writes.message).toMatchObject({ content_text: null });
    expect(writes.conversation).toMatchObject({
      last_message_text: '[template]',
    });
  });

  it('resolve o contato pelo contactId quando informado (caminho dos engines)', async () => {
    const writes: Writes = {};
    const calls: unknown[] = [];
    createTransport.mockReturnValue(fakeTransport({}, calls));

    const db = coreDb(writes, {
      contactsById: {
        'ct-eng': { phone: '5511977776666', accountId: 'acct-1' },
      },
    });

    const result = await sendViaConnection(db, 'acct-1', {
      conversationId: 'cv-1',
      contactId: 'ct-eng',
      message: { kind: 'text', text: 'oi' },
      senderType: 'bot',
    });

    expect(result.messageId).toBe('msg-1');
    expect(calls[0]).toMatchObject({ to: '5511977776666' });
  });

  it('rejeita com not_found/404 quando o contactId não pertence à conta (escopo por account_id)', async () => {
    createTransport.mockReturnValue(fakeTransport());

    const db = coreDb(
      {},
      {
        contactsById: {
          'ct-foreign': { phone: '5511900000000', accountId: 'acct-OTHER' },
        },
      }
    );

    await sendViaConnection(db, 'acct-1', {
      conversationId: 'cv-1',
      contactId: 'ct-foreign',
      message: { kind: 'text', text: 'oi' },
      senderType: 'bot',
    }).catch((e: SendMessageError) => {
      expect(e.code).toBe('not_found');
      expect(e.status).toBe(404);
      expect(e.reason).toBe('contact_not_found');
    });
    expect.assertions(3);
  });

  it('persiste reply_to_message_id e repassa o id de provedor do pai ao transporte', async () => {
    const writes: Writes = {};
    const calls: unknown[] = [];
    createTransport.mockReturnValue(fakeTransport({}, calls));

    const db = coreDb(writes, {
      messagesById: {
        'reply-1': {
          conversationId: 'cv-1',
          providerMessageId: 'wamid-parent',
        },
      },
    });

    await sendViaConnection(db, 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'text', text: 'oi' },
      senderType: 'agent',
      replyToMessageId: 'reply-1',
    });

    expect(writes.message).toMatchObject({ reply_to_message_id: 'reply-1' });
    expect(calls[0]).toMatchObject({
      replyToProviderMessageId: 'wamid-parent',
    });
  });

  it('rejeita quando o pai citado não pertence a esta conversa', async () => {
    createTransport.mockReturnValue(fakeTransport());

    const db = coreDb(
      {},
      {
        messagesById: {
          'reply-2': {
            conversationId: 'cv-OTHER',
            providerMessageId: 'wamid-x',
          },
        },
      }
    );

    await sendViaConnection(db, 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'text', text: 'oi' },
      senderType: 'agent',
      replyToMessageId: 'reply-2',
    }).catch((e: SendMessageError) => {
      expect(e.code).toBe('bad_request');
      expect(e.status).toBe(400);
      expect(e.message).toBe(
        'reply_to_message_id not found in this conversation'
      );
    });
    expect.assertions(3);
  });

  it('envia sem contexto de resposta quando o pai não tem message_id de provedor', async () => {
    const calls: unknown[] = [];
    createTransport.mockReturnValue(fakeTransport({}, calls));

    const db = coreDb(
      {},
      {
        messagesById: {
          'reply-3': { conversationId: 'cv-1', providerMessageId: null },
        },
      }
    );

    const result = await sendViaConnection(db, 'acct-1', {
      conversationId: 'cv-1',
      message: { kind: 'text', text: 'oi' },
      senderType: 'agent',
      replyToMessageId: 'reply-3',
    });

    expect(result.providerMessageId).toBe('pmid-1');
    expect(calls[0]).toMatchObject({ replyToProviderMessageId: undefined });
  });

  it('repassa link, caption e filename ao transporte no envio de mídia, normalizando caption vazia para undefined', async () => {
    const calls: unknown[] = [];
    createTransport.mockReturnValue(fakeTransport({}, calls));

    await sendViaConnection(coreDb({}), 'acct-1', {
      conversationId: 'cv-1',
      message: {
        kind: 'media',
        mediaKind: 'image',
        link: 'https://x/y.jpg',
        caption: '',
        filename: 'photo.jpg',
      },
      senderType: 'agent',
    });

    expect(calls[0]).toMatchObject({
      link: 'https://x/y.jpg',
      caption: undefined,
      filename: 'photo.jpg',
    });
  });

  it('repassa templateName, language, params e template ao transporte no envio de template', async () => {
    const calls: unknown[] = [];
    createTransport.mockReturnValue(fakeTransport({}, calls));

    await sendViaConnection(coreDb({}), 'acct-1', {
      conversationId: 'cv-1',
      message: {
        kind: 'template',
        templateName: 'promo',
        language: 'en_US',
        template: TEMPLATE,
        params: ['Foo'],
      },
      senderType: 'agent',
    });

    expect(calls[0]).toMatchObject({
      templateName: 'promo',
      language: 'en_US',
      params: ['Foo'],
      template: TEMPLATE,
    });
  });
});
