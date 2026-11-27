import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ConversationResolutionError,
  resolveConversationByPhone,
  resolveOrCreateConversation,
} from './resolve-conversation';
import { SendMessageError } from './send-message';

// ------------------------------------------------------------
// Chainable Supabase stub, scripted per table + rpc.
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
  existingConversation?: { id: string } | null;
  insertedConversationId?: string;
  rpcError?: { message?: string; code?: string } | null;
}

function makeDb(script: Script) {
  let table = '';
  let mode: 'select' | 'insert' | 'update' = 'select';
  let likeCalls = 0;
  const likeCols: string[] = [];

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
    like: (col: string) => {
      likeCols.push(col);
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
      return Promise.resolve({ data: null, error: null });
    },
    // Thenable: `await db.from().update().eq()` lands here.
    then: (resolve: (v: { data: null; error: null }) => void) =>
      resolve({ data: null, error: null }),
  };

  const rpc = vi.fn(
    async (fn: string, args: Record<string, unknown>) => {
      if (fn !== 'resolve_or_create_conversation') {
        throw new Error(`Unexpected rpc call: ${fn}`);
      }
      if (script.rpcError) {
        return { data: null, error: script.rpcError };
      }
      if (script.existingConversation) {
        return {
          data: {
            conversation: {
              ...script.existingConversation,
              account_id: args.p_account_id,
              contact_id: args.p_contact_id,
              status: args.p_status ?? 'open',
            },
            is_new: false,
          },
          error: null,
        };
      }
      return {
        data: {
          conversation: {
            id: script.insertedConversationId,
            account_id: args.p_account_id,
            user_id: args.p_user_id,
            contact_id: args.p_contact_id,
            status: args.p_status ?? 'open',
            assigned_agent_id: args.p_assigned_agent_id ?? null,
          },
          is_new: true,
        },
        error: null,
      };
    }
  );

  const db = {
    from: (t: string) => {
      table = t;
      mode = 'select';
      return builder;
    },
    rpc,
  } as unknown as SupabaseClient;

  return { db, rpc, likeCols };
}

describe('resolveOrCreateConversation', () => {
  it('calls resolve_or_create_conversation RPC and returns { conversation, is_new }', async () => {
    const { db, rpc } = makeDb({ insertedConversationId: 'cv-created' });
    const res = await resolveOrCreateConversation(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      contactId: 'contact-1',
    });

    expect(rpc).toHaveBeenCalledWith('resolve_or_create_conversation', {
      p_account_id: 'acct-1',
      p_user_id: 'user-1',
      p_contact_id: 'contact-1',
      p_status: 'open',
      p_assigned_agent_id: null,
    });
    expect(res.is_new).toBe(true);
    expect(res.conversation.id).toBe('cv-created');
  });

  it('returns is_new = false when an existing thread is returned', async () => {
    const { db } = makeDb({ existingConversation: { id: 'cv-existing' } });
    const res = await resolveOrCreateConversation(db, {
      accountId: 'acct-1',
      userId: 'user-1',
      contactId: 'contact-1',
    });

    expect(res.is_new).toBe(false);
    expect(res.conversation.id).toBe('cv-existing');
  });

  it('maps RPC 42501 error to ConversationResolutionError with status 403', async () => {
    const { db } = makeDb({
      rpcError: { message: 'Forbidden', code: '42501' },
    });
    await expect(
      resolveOrCreateConversation(db, {
        accountId: 'acct-1',
        userId: 'user-1',
        contactId: 'contact-1',
      })
    ).rejects.toMatchObject({
      name: 'ConversationResolutionError',
      code: '42501',
      status: 403,
    });
  });

  it('throws ConversationResolutionError on invalid RPC payload', async () => {
    const db = {
      rpc: vi.fn(async () => ({ data: {}, error: null })),
    } as unknown as SupabaseClient;
    await expect(
      resolveOrCreateConversation(db, {
        accountId: 'acct-1',
        userId: 'user-1',
        contactId: 'contact-1',
      })
    ).rejects.toBeInstanceOf(ConversationResolutionError);
  });
});

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
    const { db } = makeDb({ config: null });
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
    const { db, likeCols, rpc } = makeDb({
      config: { user_id: 'owner-1' },
      contactCandidates: [{ id: 'c1', phone: '14155550123' }],
      existingConversation: { id: 'cv1' },
    });
    const res = await resolveConversationByPhone(
      db,
      'acct',
      '+1 (415) 555-0123'
    );
    expect(likeCols).toEqual(['phone_normalized']);
    expect(rpc).toHaveBeenCalledWith('resolve_or_create_conversation', {
      p_account_id: 'acct',
      p_user_id: 'owner-1',
      p_contact_id: 'c1',
      p_status: 'open',
      p_assigned_agent_id: null,
    });
    expect(res).toEqual({
      conversationId: 'cv1',
      contactId: 'c1',
      contactCreated: false,
    });
  });

  it('creates contact + conversation when none exist', async () => {
    const { db } = makeDb({
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
    const { db } = makeDb({
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
});
