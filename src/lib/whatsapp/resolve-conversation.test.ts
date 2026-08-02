import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveConversationByPhone } from './resolve-conversation';
import { SendMessageError } from './send-message';

// ------------------------------------------------------------
// Chainable Supabase stub, scripted per table. Terminal methods
// (like/maybeSingle/single) resolve to configured data; the builder
// itself is thenable so an awaited `update().eq()` resolves cleanly.
// ------------------------------------------------------------
type ContactRow = { id: string; phone: string; name?: string | null };

interface Script {
  config?: { user_id: string } | null; // whatsapp_config.maybeSingle
  contactCandidates?: ContactRow[]; // contacts .like (same every call)
  /** Per-call `.like` results — overrides contactCandidates. Lets a
   *  test simulate "miss, then hit" for the unique-race path. */
  contactCandidatesByCall?: ContactRow[][];
  insertedContactId?: string; // contacts insert -> single
  insertContactError?: { code?: string } | null;
  /** Conversation lookup result (oldest-first `.order().limit(1)`).
   *  A single row or null; wrapped into a one-element array internally. */
  existingConversation?: { id: string } | null; // conversations select.limit(1)
  /** Per-call conversation lookup results — overrides existingConversation.
   *  Lets a test simulate "miss, then hit" for the unique-race path. */
  existingConversationByCall?: (({ id: string } | null))[];
  insertedConversationId?: string; // conversations insert -> single
  insertConversationError?: { code?: string } | null;
}

function makeDb(script: Script): SupabaseClient {
  let table = '';
  let mode: 'select' | 'insert' | 'update' = 'select';
  let likeCalls = 0;
  let convLookupCalls = 0;

  const builder: Record<string, unknown> = {
    select: () => builder,
    insert: () => {
      mode = 'insert';
      return builder;
    },
    update: () => {
      mode = 'update';
      return builder;
    },
    eq: () => builder,
    order: () => builder,
    limit: () => {
      // Only the conversation lookup terminates on `.limit(1)`.
      if (table === 'conversations' && mode === 'select') {
        const row = script.existingConversationByCall
          ? (script.existingConversationByCall[convLookupCalls] ?? null)
          : (script.existingConversation ?? null);
        convLookupCalls++;
        return Promise.resolve({ data: row ? [row] : [], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
    like: () => {
      const data = script.contactCandidatesByCall
        ? (script.contactCandidatesByCall[likeCalls] ?? [])
        : (script.contactCandidates ?? []);
      likeCalls++;
      return Promise.resolve({ data, error: null });
    },
    maybeSingle: () => {
      if (table === 'whatsapp_config')
        return Promise.resolve({ data: script.config ?? null, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    single: () => {
      if (table === 'contacts' && mode === 'insert') {
        if (script.insertContactError)
          return Promise.resolve({
            data: null,
            error: script.insertContactError,
          });
        return Promise.resolve({
          data: { id: script.insertedContactId },
          error: null,
        });
      }
      if (table === 'conversations' && mode === 'insert') {
        if (script.insertConversationError)
          return Promise.resolve({
            data: null,
            error: script.insertConversationError,
          });
        return Promise.resolve({
          data: { id: script.insertedConversationId },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    // Thenable: `await db.from().update().eq()` lands here.
    then: (resolve: (v: { data: null; error: null }) => void) =>
      resolve({ data: null, error: null }),
  };

  return {
    from: (t: string) => {
      table = t;
      mode = 'select';
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('resolveConversationByPhone', () => {
  it('rejects an invalid phone before any DB call', async () => {
    const db = {
      from() {
        throw new Error('should not query');
      },
    } as unknown as SupabaseClient;
    await expect(
      resolveConversationByPhone(db, 'acct', 'not-a-phone')
    ).rejects.toBeInstanceOf(SendMessageError);
  });

  it('fails with whatsapp_not_configured when no config owner exists', async () => {
    const db = makeDb({ config: null });
    await resolveConversationByPhone(db, 'acct', '+14155550123').catch(
      (e: SendMessageError) => {
        expect(e.code).toBe('whatsapp_not_configured');
        expect(e.status).toBe(400);
      }
    );
    await expect(
      resolveConversationByPhone(db, 'acct', '+14155550123')
    ).rejects.toBeInstanceOf(SendMessageError);
  });

  it('returns the existing contact + conversation without creating', async () => {
    const db = makeDb({
      config: { user_id: 'owner-1' },
      contactCandidates: [{ id: 'c1', phone: '14155550123' }],
      existingConversation: { id: 'cv1' },
    });
    const res = await resolveConversationByPhone(
      db,
      'acct',
      '+1 (415) 555-0123'
    );
    expect(res).toEqual({
      conversationId: 'cv1',
      contactId: 'c1',
      contactCreated: false,
    });
  });

  it('creates contact + conversation when none exist', async () => {
    const db = makeDb({
      config: { user_id: 'owner-1' },
      contactCandidates: [],
      insertedContactId: 'c2',
      existingConversation: null,
      insertedConversationId: 'cv2',
    });
    const res = await resolveConversationByPhone(
      db,
      'acct',
      '+14155550199',
      'Jane'
    );
    expect(res).toEqual({
      conversationId: 'cv2',
      contactId: 'c2',
      contactCreated: true,
    });
  });

  it('re-resolves an existing contact when the insert loses a unique race', async () => {
    // First lookup misses (→ we attempt an insert), the insert hits a
    // 23505 unique violation, and the post-race re-lookup now returns
    // the row a concurrent writer created.
    const db = makeDb({
      config: { user_id: 'owner-1' },
      contactCandidatesByCall: [[], [{ id: 'c-raced', phone: '14155550123' }]],
      insertContactError: { code: '23505' },
      existingConversation: { id: 'cv-raced' },
    });
    const res = await resolveConversationByPhone(db, 'acct', '+14155550123');
    expect(res.contactId).toBe('c-raced');
    expect(res.contactCreated).toBe(false);
    expect(res.conversationId).toBe('cv-raced');
  });

  it('re-resolves the conversation when the insert loses a unique race', async () => {
    // Existing contact, conversation lookup misses first (→ attempt an
    // insert), the insert hits a 23505 from a concurrent create, and the
    // post-race re-lookup returns the winning conversation — no duplicate
    // conversation is created (issue #363).
    const db = makeDb({
      config: { user_id: 'owner-1' },
      contactCandidates: [{ id: 'c1', phone: '14155550123' }],
      existingConversationByCall: [null, { id: 'cv-raced' }],
      insertConversationError: { code: '23505' },
    });
    const res = await resolveConversationByPhone(db, 'acct', '+14155550123');
    expect(res).toEqual({
      conversationId: 'cv-raced',
      contactId: 'c1',
      contactCreated: false,
    });
  });
});
