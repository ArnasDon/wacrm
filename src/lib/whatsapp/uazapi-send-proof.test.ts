// Prova a fiação UAZAPI de ponta a ponta pelo núcleo de envio:
// resolveConnection devolve a variante 'uazapi' → createTransport monta
// o transporte real (createUazapiTransport) → dispatchSend faz UM POST
// /send/text no baseUrl da conexão, com header `token` e { number, text }
// corretos, e o `messageid` da resposta (id endereçável do WhatsApp,
// formato 3EB0…) volta ao chamador em `providerMessageId` e é persistido
// como `messages.message_id`. O smoke real (número de verdade) fica com o
// operador, pós-merge.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const resolveConnection = vi.fn();
vi.mock('@/lib/whatsapp/resolve-connection', () => ({
  resolveConnection: (...a: unknown[]) => resolveConnection(...a),
}));
// IMPORTANTE: NÃO mockar '@/lib/whatsapp/providers' — queremos o
// createUazapiTransport real montado por createTransport.

import { sendViaConnection } from './send-core';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

interface Persisted {
  message?: Record<string, unknown>;
}

// Supabase fake mínimo: só os nós que o caminho de texto de
// sendViaConnection toca — o join conversa→contato (loadContact), o
// insert em `messages` e o update em `conversations`.
function makeDb(persisted: Persisted): SupabaseClient {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        insert: (row: Record<string, unknown>) => {
          if (table === 'messages') persisted.message = row;
          return builder;
        },
        update: () => builder,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => {
          if (table === 'conversations') {
            return {
              data: {
                id: 'conv-1',
                contact: { id: 'ct-1', phone: '+5511999998888' },
              },
              error: null,
            };
          }
          if (table === 'messages') {
            return { data: { id: 'm1' }, error: null };
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

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi
    .fn()
    .mockResolvedValue(
      jsonResponse({ messageid: '3EB0ABC123', id: 'uazapi-row-1' })
    );
  vi.stubGlobal('fetch', fetchMock);
  resolveConnection.mockResolvedValue({
    id: 'c-uaz',
    accountId: 'acct-1',
    credential: 'inst-token-plain',
    provider: 'uazapi',
    instanceId: 'inst-1',
    baseUrl: 'https://api.uazapi.com',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resolveConnection.mockReset();
});

describe('envio de texto sobre uma conexão UAZAPI', () => {
  it('faz um POST /send/text com token e { number, text }, e propaga o messageid', async () => {
    const persisted: Persisted = {};

    const result = await sendViaConnection(makeDb(persisted), 'acct-1', {
      conversationId: 'conv-1',
      message: { kind: 'text', text: 'Olá do CRM' },
      senderType: 'agent',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.uazapi.com/send/text');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).token).toBe(
      'inst-token-plain'
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      number: '5511999998888',
      text: 'Olá do CRM',
    });

    // O id endereçável do WhatsApp (`messageid`) é o que propaga e é
    // persistido — não o `id` interno da linha UAZAPI ('uazapi-row-1').
    expect(result.providerMessageId).toBe('3EB0ABC123');
    expect(persisted.message).toMatchObject({ message_id: '3EB0ABC123' });
  });
});
