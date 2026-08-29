import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `decrypted:${v}`,
  encrypt: (v: string) => `encrypted:${v}`,
  isLegacyFormat: (v: string) => v === 'legacy-cipher',
}));

import { resolveConnection } from './resolve-connection';
import { SendMessageError } from './send-error';

interface Captured {
  updates: Record<string, unknown>[];
}

/**
 * Fake do Supabase que distingue `conversations` de `whatsapp_connections`
 * e honra os `.eq()`/`.is()` acumulados no builder. `conversations` é um
 * mapa `id → { connection_id }`; `connections` é a lista de linhas
 * candidatas (cada uma com `archived_at`, `is_primary`, etc.).
 */
function db({
  conversations = {},
  connections = [],
  captured = { updates: [] as Record<string, unknown>[] },
}: {
  conversations?: Record<string, { connection_id: string | null }>;
  connections?: Array<Record<string, unknown>>;
  captured?: Captured;
}): SupabaseClient {
  return {
    from(table: string) {
      const filt: Record<string, unknown> = {};
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (k: string, v: unknown) => ((filt[k] = v), b),
        is: (k: string, v: unknown) => ((filt[`${k}__is`] = v), b),
        update: (patch: Record<string, unknown>) => (
          captured.updates.push(patch),
          b
        ),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ error: null }).then(resolve),
        maybeSingle: async () => {
          if (table === 'conversations') {
            return {
              data: conversations[filt.id as string] ?? null,
              error: null,
            };
          }
          const row = connections.find(
            (r) =>
              (filt.id === undefined || r.id === filt.id) &&
              (filt.account_id === undefined ||
                r.account_id === filt.account_id) &&
              (filt.is_primary === undefined ||
                r.is_primary === filt.is_primary) &&
              r.archived_at == null
          );
          return { data: row ?? null, error: null };
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

const PRIMARY = {
  id: 'cfg-1',
  account_id: 'acct-1',
  phone_number_id: 'pn-1',
  credential: 'cipher',
  provider: 'meta',
  is_primary: true,
  archived_at: null,
};

const UAZ = {
  id: 'cfg-uaz',
  account_id: 'acct-1',
  credential: 'uaz-cipher',
  provider: 'uazapi',
  uazapi_instance_id: 'inst-9',
  uazapi_base_url: 'https://uaz.example',
  is_primary: false,
  archived_at: null,
};

describe('resolveConnection', () => {
  it('devolve a primária (meta) com a credencial decriptada', async () => {
    const conn = await resolveConnection(
      db({ connections: [PRIMARY] }),
      'acct-1'
    );
    expect(conn).toEqual({
      id: 'cfg-1',
      accountId: 'acct-1',
      provider: 'meta',
      phoneNumberId: 'pn-1',
      credential: 'decrypted:cipher',
    });
  });

  it('resolve pela conversa de origem → variante uazapi', async () => {
    const conn = await resolveConnection(
      db({
        conversations: { 'conv-1': { connection_id: 'cfg-uaz' } },
        connections: [PRIMARY, UAZ],
      }),
      'acct-1',
      { conversationId: 'conv-1' }
    );
    expect(conn).toEqual({
      id: 'cfg-uaz',
      accountId: 'acct-1',
      provider: 'uazapi',
      instanceId: 'inst-9',
      baseUrl: 'https://uaz.example',
      credential: 'decrypted:uaz-cipher',
    });
  });

  it('conversa com connection_id NULL → cai para a primária', async () => {
    const conn = await resolveConnection(
      db({
        conversations: { 'conv-1': { connection_id: null } },
        connections: [PRIMARY, UAZ],
      }),
      'acct-1',
      { conversationId: 'conv-1' }
    );
    expect(conn).toMatchObject({ id: 'cfg-1', provider: 'meta' });
  });

  it('alvo arquivado → cai para a primária', async () => {
    const archived = {
      ...UAZ,
      id: 'cfg-arch',
      archived_at: '2026-01-01T00:00:00Z',
    };
    const conn = await resolveConnection(
      db({ connections: [PRIMARY, archived] }),
      'acct-1',
      { connectionId: 'cfg-arch' }
    );
    expect(conn).toMatchObject({ id: 'cfg-1', provider: 'meta' });
  });

  it('connectionId explícito válido → devolve essa conexão', async () => {
    const secondary = {
      ...PRIMARY,
      id: 'cfg-2',
      phone_number_id: 'pn-2',
      credential: 'cipher-2',
      is_primary: false,
    };
    const conn = await resolveConnection(
      db({ connections: [PRIMARY, secondary] }),
      'acct-1',
      { connectionId: 'cfg-2' }
    );
    expect(conn).toEqual({
      id: 'cfg-2',
      accountId: 'acct-1',
      provider: 'meta',
      phoneNumberId: 'pn-2',
      credential: 'decrypted:cipher-2',
    });
  });

  it('lança whatsapp_not_configured / 400 quando não há linha', async () => {
    await expect(
      resolveConnection(db({ connections: [] }), 'acct-1')
    ).rejects.toBeInstanceOf(SendMessageError);
    await resolveConnection(db({ connections: [] }), 'acct-1').catch(
      (e: SendMessageError) => {
        expect(e.code).toBe('whatsapp_not_configured');
        expect(e.status).toBe(400);
        expect(e.reason).toBe('not_configured');
        expect(e.message).toBe(
          'WhatsApp not configured. Please set up your WhatsApp integration first.'
        );
      }
    );
  });

  it('reescreve um ciphertext legado só quando selfHeal está ligado, keyed na linha resolvida', async () => {
    const legacy = { ...PRIMARY, credential: 'legacy-cipher' };

    const off: Captured = { updates: [] };
    await resolveConnection(
      db({ connections: [legacy], captured: off }),
      'acct-1'
    );
    expect(off.updates).toEqual([]);

    const on: Captured = { updates: [] };
    await resolveConnection(
      db({ connections: [legacy], captured: on }),
      'acct-1',
      { selfHeal: true }
    );
    expect(on.updates).toEqual([
      { credential: 'encrypted:decrypted:legacy-cipher' },
    ]);
  });

  it('não reescreve um ciphertext já moderno mesmo com selfHeal ligado', async () => {
    const captured: Captured = { updates: [] };
    await resolveConnection(
      db({ connections: [PRIMARY], captured }),
      'acct-1',
      { selfHeal: true }
    );
    expect(captured.updates).toEqual([]);
  });
});
