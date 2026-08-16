import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveWhatsAppConfig } from './resolve-config';

interface Fixture {
  /** Rows keyed by id — the fake's `.eq('id', ...)` branch looks one up here. */
  byId?: Record<string, Record<string, unknown>>;
  /** The row `.eq('is_default', true)` should resolve to, or null/undefined for none. */
  defaultRow?: Record<string, unknown> | null;
  /** The row the final "most recently connected" fallback should resolve to. */
  fallbackRow?: Record<string, unknown> | null;
}

/**
 * Mirrors resolveWhatsAppConfig's three query shapes precisely (rather
 * than a generic pass-everything-through fake) so this test doubles as
 * a contract check on the exact chain the function calls — a change
 * to the chain shape here should fail loudly rather than silently
 * resolving via an unrelated branch.
 */
function makeDb(fx: Fixture): SupabaseClient {
  return {
    from(table: string) {
      if (table !== 'whatsapp_config') throw new Error(`unexpected table: ${table}`);
      let idFilter: string | null = null;
      let sawIsDefaultFilter = false;
      let sawOrder = false;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          if (col === 'id') idFilter = val as string;
          if (col === 'is_default') sawIsDefaultFilter = true;
          return builder;
        },
        order: () => {
          sawOrder = true;
          return builder;
        },
        limit: () => builder,
        maybeSingle: async () => {
          if (idFilter) {
            return { data: fx.byId?.[idFilter] ?? null, error: null };
          }
          if (sawIsDefaultFilter) {
            return { data: fx.defaultRow ?? null, error: null };
          }
          if (sawOrder) {
            return { data: fx.fallbackRow ?? null, error: null };
          }
          throw new Error('unexpected query shape reached maybeSingle()');
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('resolveWhatsAppConfig', () => {
  it('returns the row matching an explicit whatsappConfigId', async () => {
    const db = makeDb({ byId: { 'cfg-b': { id: 'cfg-b', display_name: 'Support' } } });
    const result = await resolveWhatsAppConfig(db, 'acct-1', 'cfg-b');
    expect(result).toEqual({ id: 'cfg-b', display_name: 'Support' });
  });

  it('falls back to the account default when the explicit id no longer exists', async () => {
    // Simulates a conversation pinned to a number that was since deleted
    // (ON DELETE SET NULL doesn't retroactively fix already-loaded ids in
    // a stale reference) — the send should still go out on SOME number
    // rather than fail outright.
    const db = makeDb({
      byId: {},
      defaultRow: { id: 'cfg-default', is_default: true },
    });
    const result = await resolveWhatsAppConfig(db, 'acct-1', 'cfg-deleted');
    expect(result).toEqual({ id: 'cfg-default', is_default: true });
  });

  it('resolves the account default when no explicit id is given', async () => {
    const db = makeDb({ defaultRow: { id: 'cfg-default', is_default: true } });
    const result = await resolveWhatsAppConfig(db, 'acct-1', null);
    expect(result).toEqual({ id: 'cfg-default', is_default: true });
  });

  it('falls back to the most recently connected row when nothing is marked default', async () => {
    const db = makeDb({
      defaultRow: null,
      fallbackRow: { id: 'cfg-fallback', is_default: false },
    });
    const result = await resolveWhatsAppConfig(db, 'acct-1', null);
    expect(result).toEqual({ id: 'cfg-fallback', is_default: false });
  });

  it('returns null when the account has no WhatsApp connections at all', async () => {
    const db = makeDb({ defaultRow: null, fallbackRow: null });
    const result = await resolveWhatsAppConfig(db, 'acct-1', null);
    expect(result).toBeNull();
  });
});
