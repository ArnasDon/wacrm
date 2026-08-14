import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveConversationByInstagramId } from './resolve-conversation';
import { SendMessageError } from '@/lib/messaging/types';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v,
}));
// Best-effort profile fetch — stubbed to a fixed value so tests never
// hit the network; irrelevant to the resolve logic under test.
vi.mock('@/lib/instagram/api', () => ({
  getIgUserProfile: vi.fn(async () => ({ name: 'Jane', username: 'jane_ig' })),
}));

// Mirrors src/lib/whatsapp/resolve-conversation.test.ts's chainable
// Supabase stub, scripted per table — swapping the phone-based
// `.like()` contact lookup for the IGSID's exact `.eq().maybeSingle()`.
interface ContactRow {
  id: string;
  instagram_id: string;
  instagram_username?: string | null;
}

interface Script {
  instagramConfig?: { id: string; access_token: string } | null;
  whatsappConfigOwner?: { user_id: string } | null; // resolveAuditUserId's first lookup
  accountOwner?: { owner_user_id: string } | null; // resolveAuditUserId's fallback
  existingContact?: ContactRow | null;
  /** Per-call override — lets a test simulate "miss, then hit" for the unique-race path. */
  existingContactByCall?: (ContactRow | null)[];
  insertedContactId?: string;
  insertContactError?: { code?: string } | null;
  existingConversation?: { id: string } | null;
  existingConversationByCall?: (({ id: string } | null))[];
  insertedConversationId?: string;
  insertConversationError?: { code?: string } | null;
}

function makeDb(script: Script): SupabaseClient {
  let table = '';
  let mode: 'select' | 'insert' = 'select';
  let contactLookupCalls = 0;
  let convLookupCalls = 0;

  const builder: Record<string, unknown> = {
    select: () => builder,
    insert: () => {
      mode = 'insert';
      return builder;
    },
    eq: () => builder,
    order: () => builder,
    limit: () => {
      if (table === 'conversations' && mode === 'select') {
        const row = script.existingConversationByCall
          ? (script.existingConversationByCall[convLookupCalls] ?? null)
          : (script.existingConversation ?? null);
        convLookupCalls++;
        return Promise.resolve({ data: row ? [row] : [], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
    maybeSingle: () => {
      if (table === 'instagram_config') {
        return Promise.resolve({ data: script.instagramConfig ?? null, error: null });
      }
      if (table === 'whatsapp_config') {
        return Promise.resolve({ data: script.whatsappConfigOwner ?? null, error: null });
      }
      if (table === 'accounts') {
        return Promise.resolve({ data: script.accountOwner ?? null, error: null });
      }
      if (table === 'contacts' && mode === 'select') {
        const row = script.existingContactByCall
          ? (script.existingContactByCall[contactLookupCalls] ?? null)
          : (script.existingContact ?? null);
        contactLookupCalls++;
        return Promise.resolve({ data: row, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    single: () => {
      if (table === 'contacts' && mode === 'insert') {
        if (script.insertContactError) {
          return Promise.resolve({ data: null, error: script.insertContactError });
        }
        return Promise.resolve({ data: { id: script.insertedContactId }, error: null });
      }
      if (table === 'conversations' && mode === 'insert') {
        if (script.insertConversationError) {
          return Promise.resolve({ data: null, error: script.insertConversationError });
        }
        return Promise.resolve({ data: { id: script.insertedConversationId }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    update: () => builder,
    then: (resolve: (v: { data: null; error: null }) => void) => resolve({ data: null, error: null }),
  };

  return {
    from: (t: string) => {
      table = t;
      mode = 'select';
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('resolveConversationByInstagramId', () => {
  it('rejects an empty igsid before any DB call', async () => {
    const db = {
      from() {
        throw new Error('should not query');
      },
    } as unknown as SupabaseClient;
    await expect(resolveConversationByInstagramId(db, 'acct', '')).rejects.toBeInstanceOf(SendMessageError);
  });

  it('fails with instagram_not_configured when no config exists', async () => {
    const db = makeDb({ instagramConfig: null });
    await resolveConversationByInstagramId(db, 'acct', 'igsid-1').catch((e: SendMessageError) => {
      expect(e.code).toBe('instagram_not_configured');
      expect(e.status).toBe(400);
    });
  });

  it('returns the existing contact + conversation without creating', async () => {
    const db = makeDb({
      instagramConfig: { id: 'cfg-1', access_token: 'tok' },
      whatsappConfigOwner: { user_id: 'owner-1' },
      existingContact: { id: 'c1', instagram_id: 'igsid-1' },
      existingConversation: { id: 'cv1' },
    });
    const res = await resolveConversationByInstagramId(db, 'acct', 'igsid-1');
    expect(res).toEqual({ conversationId: 'cv1', contactId: 'c1', contactCreated: false });
  });

  it('falls back to the account owner when there is no WhatsApp config owner', async () => {
    const db = makeDb({
      instagramConfig: { id: 'cfg-1', access_token: 'tok' },
      whatsappConfigOwner: null,
      accountOwner: { owner_user_id: 'acct-owner-1' },
      existingContact: null,
      insertedContactId: 'c2',
      existingConversation: null,
      insertedConversationId: 'cv2',
    });
    const res = await resolveConversationByInstagramId(db, 'acct', 'igsid-2', 'newbie_ig');
    expect(res).toEqual({ conversationId: 'cv2', contactId: 'c2', contactCreated: true });
  });

  it('creates contact + conversation when none exist, tagging the conversation as instagram', async () => {
    const db = makeDb({
      instagramConfig: { id: 'cfg-1', access_token: 'tok' },
      whatsappConfigOwner: { user_id: 'owner-1' },
      existingContact: null,
      insertedContactId: 'c3',
      existingConversation: null,
      insertedConversationId: 'cv3',
    });
    const res = await resolveConversationByInstagramId(db, 'acct', 'igsid-3');
    expect(res).toEqual({ conversationId: 'cv3', contactId: 'c3', contactCreated: true });
  });

  it('re-resolves an existing contact when the insert loses a unique race', async () => {
    const db = makeDb({
      instagramConfig: { id: 'cfg-1', access_token: 'tok' },
      whatsappConfigOwner: { user_id: 'owner-1' },
      existingContactByCall: [null, { id: 'c-raced', instagram_id: 'igsid-4' }],
      insertContactError: { code: '23505' },
      existingConversation: { id: 'cv-raced' },
    });
    const res = await resolveConversationByInstagramId(db, 'acct', 'igsid-4');
    expect(res.contactId).toBe('c-raced');
    expect(res.contactCreated).toBe(false);
    expect(res.conversationId).toBe('cv-raced');
  });

  it('re-resolves the conversation when the insert loses a unique race', async () => {
    const db = makeDb({
      instagramConfig: { id: 'cfg-1', access_token: 'tok' },
      whatsappConfigOwner: { user_id: 'owner-1' },
      existingContact: { id: 'c1', instagram_id: 'igsid-5' },
      existingConversationByCall: [null, { id: 'cv-raced' }],
      insertConversationError: { code: '23505' },
    });
    const res = await resolveConversationByInstagramId(db, 'acct', 'igsid-5');
    expect(res).toEqual({ conversationId: 'cv-raced', contactId: 'c1', contactCreated: false });
  });
});
