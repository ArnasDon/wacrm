import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const decrypt = vi.fn((v: string) => `decrypted:${v}`);
const encrypt = vi.fn((v: string) => v);
const isLegacyFormat = vi.fn<(v: string) => boolean>(() => false);

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => decrypt(v),
  encrypt: (v: string) => encrypt(v),
  isLegacyFormat: (v: string) => isLegacyFormat(v),
}));

const { resolveWhatsAppService } = await import('./service');
const { MetaWhatsAppService } =
  await import('./providers/meta-whatsapp-service');
const { DemoWhatsAppService } =
  await import('./providers/demo-whatsapp-service');

function dbWithConfig(
  config: Record<string, unknown> | null,
  updateSpy?: (row: unknown) => void
) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === 'whatsapp_config'
              ? { data: config, error: null }
              : { data: null, error: null },
        }),
      }),
      update: (row: unknown) => {
        updateSpy?.(row);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  } as unknown as SupabaseClient;
}

describe('resolveWhatsAppService', () => {
  it('returns DemoWhatsAppService when the account has no whatsapp_config row', async () => {
    const { service, isDemo } = await resolveWhatsAppService(
      dbWithConfig(null),
      'acct-1'
    );
    expect(isDemo).toBe(true);
    expect(service).toBeInstanceOf(DemoWhatsAppService);
  });

  it('returns MetaWhatsAppService, decrypted, when a config row exists', async () => {
    const config = {
      id: 'cfg-1',
      phone_number_id: 'pn-1',
      access_token: 'enc-token',
    };
    const { service, isDemo } = await resolveWhatsAppService(
      dbWithConfig(config),
      'acct-1'
    );
    expect(isDemo).toBe(false);
    expect(service).toBeInstanceOf(MetaWhatsAppService);
    expect(decrypt).toHaveBeenCalledWith('enc-token');
  });

  it('self-heals a legacy-format ciphertext in the background', async () => {
    isLegacyFormat.mockReturnValueOnce(true);
    let updated: unknown;
    const config = {
      id: 'cfg-1',
      phone_number_id: 'pn-1',
      access_token: 'legacy-token',
    };
    await resolveWhatsAppService(
      dbWithConfig(config, (row) => (updated = row)),
      'acct-1'
    );
    // The upgrade write is fire-and-forget (`void ...then(...)`); give
    // its microtask a tick to run before asserting.
    await new Promise((r) => setTimeout(r, 0));
    expect(updated).toEqual({ access_token: 'decrypted:legacy-token' });
  });

  it('propagates a real DB error rather than silently falling back to demo', async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { message: 'connection reset' },
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    await expect(resolveWhatsAppService(db, 'acct-1')).rejects.toThrow(
      'connection reset'
    );
  });
});
