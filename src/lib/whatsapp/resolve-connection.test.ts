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

function configDb(
  row: Record<string, unknown> | null,
  captured: Captured = { updates: [] }
): SupabaseClient {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    update: (patch: Record<string, unknown>) => {
      captured.updates.push(patch);
      return builder;
    },
    single: async () => ({
      data: row,
      error: row ? null : { message: 'no rows' },
    }),
    // O self-heal faz `.update().eq().then()` — o builder precisa ser
    // "thenable" para que esse caminho resolva.
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ error: null }).then(resolve),
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

const ROW = {
  id: 'cfg-1',
  account_id: 'acct-1',
  phone_number_id: 'pn-1',
  access_token: 'cipher',
};

describe('resolveConnection', () => {
  it('devolve a conexão com a credencial decriptada', async () => {
    const conn = await resolveConnection(configDb(ROW), 'acct-1');
    expect(conn).toEqual({
      id: 'cfg-1',
      accountId: 'acct-1',
      provider: 'meta',
      phoneNumberId: 'pn-1',
      credential: 'decrypted:cipher',
    });
  });

  it('lança whatsapp_not_configured / 400 quando não há linha', async () => {
    await expect(
      resolveConnection(configDb(null), 'acct-1')
    ).rejects.toBeInstanceOf(SendMessageError);
    await resolveConnection(configDb(null), 'acct-1').catch(
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

  it('reescreve um ciphertext legado só quando selfHeal está ligado', async () => {
    const legacy = { ...ROW, access_token: 'legacy-cipher' };

    const off: Captured = { updates: [] };
    await resolveConnection(configDb(legacy, off), 'acct-1');
    expect(off.updates).toEqual([]);

    const on: Captured = { updates: [] };
    await resolveConnection(configDb(legacy, on), 'acct-1', { selfHeal: true });
    expect(on.updates).toEqual([
      { access_token: 'encrypted:decrypted:legacy-cipher' },
    ]);
  });

  it('não reescreve um ciphertext já moderno mesmo com selfHeal ligado', async () => {
    const captured: Captured = { updates: [] };
    await resolveConnection(configDb(ROW, captured), 'acct-1', {
      selfHeal: true,
    });
    expect(captured.updates).toEqual([]);
  });
});
