import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { captureCtwaReferral, type CtwaReferral } from './ctwa-referral';

// Mirrors the surface this module actually uses on the Supabase client
// (.from().update().eq().is()) — same style as template-webhook.test.ts.
function makeSupabaseStub(
  result: { error: { message: string } | null; count: number | null } = {
    error: null,
    count: 1,
  },
) {
  const calls: {
    table: string;
    update?: Record<string, unknown>;
    eq?: { column: string; value: unknown };
    is?: { column: string; value: unknown };
  }[] = [];

  const stub = {
    from(table: string) {
      const entry: (typeof calls)[number] = { table };
      calls.push(entry);
      return {
        update(payload: Record<string, unknown>) {
          entry.update = payload;
          return {
            eq(column: string, value: unknown) {
              entry.eq = { column, value };
              return {
                is(column: string, value: unknown) {
                  entry.is = { column, value };
                  return Promise.resolve(result);
                },
              };
            },
          };
        },
      };
    },
  };

  return { stub: stub as unknown as SupabaseClient, calls };
}

const sampleReferral: CtwaReferral = {
  source_id: '120210000000000',
  source_url: 'https://fb.me/example',
  source_type: 'ad',
  headline: 'Flat no Bessa a 150m do mar',
  body: 'A partir de R$400k',
  media_type: 'image',
  image_url: 'https://scontent.example/ad-image.jpg',
  ctwa_clid: 'clid-abc123',
};

describe('captureCtwaReferral', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('persists the referral on a conversation with no origin yet', async () => {
    const { stub, calls } = makeSupabaseStub();
    await captureCtwaReferral(stub, { id: 'conv-1' }, sampleReferral);

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('conversations');
    expect(calls[0].update).toEqual({ ctwa_referral: sampleReferral });
    expect(calls[0].eq).toEqual({ column: 'id', value: 'conv-1' });
    expect(calls[0].is).toEqual({ column: 'ctwa_referral', value: null });
  });

  it('does not touch the DB when the conversation already has an origin (first-touch wins)', async () => {
    const { stub, calls } = makeSupabaseStub();
    await captureCtwaReferral(
      stub,
      { id: 'conv-1', ctwa_referral: { source_id: 'already-set' } },
      sampleReferral,
    );

    expect(calls).toHaveLength(0);
  });

  it('tolerates a referral with only some fields present', async () => {
    const { stub, calls } = makeSupabaseStub();
    const sparse: CtwaReferral = { source_type: 'ad' };
    await captureCtwaReferral(stub, { id: 'conv-2' }, sparse);

    expect(calls[0].update).toEqual({ ctwa_referral: sparse });
  });

  it('logs an error but does not throw when the update fails', async () => {
    const { stub } = makeSupabaseStub({
      error: { message: 'db unavailable' },
      count: null,
    });
    await expect(
      captureCtwaReferral(stub, { id: 'conv-3' }, sampleReferral),
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
