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

const {
  resolveWhatsAppService,
  resolveWhatsAppServiceForBroadcast,
  WhatsAppNotConfiguredError,
} = await import('./service');
const { MetaWhatsAppService } =
  await import('./providers/meta-whatsapp-service');
const { DemoWhatsAppService } =
  await import('./providers/demo-whatsapp-service');

function fakeDb(
  opts: {
    demoModeEnabled?: boolean | null;
    config?: Record<string, unknown> | null;
    updateSpy?: (row: unknown) => void;
  } = {}
) {
  const { demoModeEnabled = false, config = null, updateSpy } = opts;
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'accounts') {
              return {
                data: { demo_mode_enabled: demoModeEnabled },
                error: null,
              };
            }
            if (table === 'whatsapp_config') {
              return { data: config, error: null };
            }
            throw new Error(`unexpected table: ${table}`);
          },
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
  it('returns DemoWhatsAppService when Demo Mode is on, even if config also exists', async () => {
    const config = {
      id: 'cfg-1',
      phone_number_id: 'pn-1',
      access_token: 'enc-token',
    };
    const { service, isDemo } = await resolveWhatsAppService(
      fakeDb({ demoModeEnabled: true, config }),
      'acct-1'
    );
    expect(isDemo).toBe(true);
    expect(service).toBeInstanceOf(DemoWhatsAppService);
    // Demo Mode being on short-circuits before ever touching config —
    // no decrypt call, no whatsapp_config read needed.
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('returns MetaWhatsAppService, decrypted, when Demo Mode is off and config exists', async () => {
    const config = {
      id: 'cfg-1',
      phone_number_id: 'pn-1',
      access_token: 'enc-token',
    };
    const { service, isDemo } = await resolveWhatsAppService(
      fakeDb({ demoModeEnabled: false, config }),
      'acct-1'
    );
    expect(isDemo).toBe(false);
    expect(service).toBeInstanceOf(MetaWhatsAppService);
    expect(decrypt).toHaveBeenCalledWith('enc-token');
  });

  it('fails loudly when Demo Mode is off and no config exists — never silently simulates', async () => {
    await expect(
      resolveWhatsAppService(
        fakeDb({ demoModeEnabled: false, config: null }),
        'acct-1'
      )
    ).rejects.toBeInstanceOf(WhatsAppNotConfiguredError);
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
      fakeDb({
        demoModeEnabled: false,
        config,
        updateSpy: (row) => (updated = row),
      }),
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

describe('resolveWhatsAppServiceForBroadcast', () => {
  it('returns DemoWhatsAppService when the broadcast was originally demo, regardless of current config', async () => {
    const { service, isDemo } = await resolveWhatsAppServiceForBroadcast(
      fakeDb({
        config: {
          id: 'cfg-1',
          phone_number_id: 'pn-1',
          access_token: 'enc-token',
        },
      }),
      'acct-1',
      true
    );
    expect(isDemo).toBe(true);
    expect(service).toBeInstanceOf(DemoWhatsAppService);
  });

  it('returns MetaWhatsAppService when the broadcast was originally real and config still exists', async () => {
    const config = {
      id: 'cfg-1',
      phone_number_id: 'pn-1',
      access_token: 'enc-token',
    };
    const { service, isDemo } = await resolveWhatsAppServiceForBroadcast(
      fakeDb({ config }),
      'acct-1',
      false
    );
    expect(isDemo).toBe(false);
    expect(service).toBeInstanceOf(MetaWhatsAppService);
  });

  it('fails loudly resuming a real broadcast whose config has since been removed', async () => {
    await expect(
      resolveWhatsAppServiceForBroadcast(
        fakeDb({ config: null }),
        'acct-1',
        false
      )
    ).rejects.toBeInstanceOf(WhatsAppNotConfiguredError);
  });
});
