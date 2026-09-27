import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { loadChannelForConversation, loadDefaultChannel } from './channels';

type Row = Record<string, unknown>;

// Minimal Supabase stub: `.eq()` filters rows, `.maybeSingle()` returns
// the first match, and awaiting the builder returns every match.
function makeDb(tables: Record<string, Row[]>): SupabaseClient {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (col: string, val: unknown) => {
          rows = rows.filter((r) => r[col] === val);
          return b;
        },
        order: () => b,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (r: { data: Row[]; error: null }) => unknown) =>
          resolve({ data: rows, error: null }),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

const A = { id: 'ch-a', account_id: 'acct', is_default: false, status: 'disconnected' };
const B = { id: 'ch-b', account_id: 'acct', is_default: false, status: 'connected' };
const C = { id: 'ch-c', account_id: 'acct', is_default: true, status: 'connected' };
const OTHER = { id: 'ch-x', account_id: 'other', is_default: true, status: 'connected' };

describe('loadDefaultChannel', () => {
  it('prefers the row flagged is_default', async () => {
    const db = makeDb({ whatsapp_config: [A, B, C, OTHER] });
    expect((await loadDefaultChannel(db, 'acct'))?.id).toBe('ch-c');
  });

  it('falls back to the oldest connected row, then the oldest row', async () => {
    expect((await loadDefaultChannel(makeDb({ whatsapp_config: [A, B] }), 'acct'))?.id).toBe('ch-b');
    expect((await loadDefaultChannel(makeDb({ whatsapp_config: [A] }), 'acct'))?.id).toBe('ch-a');
  });

  it('returns null when the account has no channel', async () => {
    const db = makeDb({ whatsapp_config: [OTHER] });
    expect(await loadDefaultChannel(db, 'acct')).toBeNull();
  });
});

describe('loadChannelForConversation', () => {
  it('replies through the channel the conversation is linked to', async () => {
    const db = makeDb({
      whatsapp_config: [A, B, C],
      conversations: [{ id: 'cv-1', account_id: 'acct', whatsapp_config_id: 'ch-b' }],
    });
    expect((await loadChannelForConversation(db, 'acct', 'cv-1'))?.id).toBe('ch-b');
  });

  it('uses a channel id the caller already has without re-reading the conversation', async () => {
    const db = makeDb({ whatsapp_config: [A, B, C] });
    expect((await loadChannelForConversation(db, 'acct', 'cv-1', 'ch-a'))?.id).toBe('ch-a');
  });

  it('falls back to the default when the linked channel was removed', async () => {
    const db = makeDb({
      whatsapp_config: [B, C],
      conversations: [{ id: 'cv-1', account_id: 'acct', whatsapp_config_id: 'ch-gone' }],
    });
    expect((await loadChannelForConversation(db, 'acct', 'cv-1'))?.id).toBe('ch-c');
  });

  it("never resolves another account's channel", async () => {
    const db = makeDb({
      whatsapp_config: [B, OTHER],
      conversations: [{ id: 'cv-1', account_id: 'acct', whatsapp_config_id: 'ch-x' }],
    });
    expect((await loadChannelForConversation(db, 'acct', 'cv-1'))?.id).toBe('ch-b');
  });
});
