import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { writeEngagementEvent } from './engagement';

interface Insert {
  table: string;
  row: Record<string, unknown>;
}

function fakeDb(opts: {
  broadcast?: { content_id: string | null } | null;
  content?: { campaign_id: string | null } | null;
  insertError?: { message: string } | null;
}) {
  const inserts: Insert[] = [];
  const db = {
    inserts,
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (table === 'broadcasts') {
                return { data: opts.broadcast ?? null, error: null };
              }
              if (table === 'content') {
                return { data: opts.content ?? null, error: null };
              }
              return { data: null, error: null };
            },
          }),
        }),
        insert: async (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return { error: opts.insertError ?? null };
        },
      };
    },
  };
  return db as unknown as SupabaseClient & { inserts: Insert[] };
}

describe('writeEngagementEvent', () => {
  it('inserts with postId null and campaignId null when no broadcast is given', async () => {
    const db = fakeDb({});
    await writeEngagementEvent(db, {
      accountId: 'acct-1',
      memberId: 'contact-1',
      postId: null,
      eventType: 'REACTION',
      source: 'demo',
      metadata: { emoji: '👍' },
    });
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]).toEqual({
      table: 'engagement_events',
      row: expect.objectContaining({
        account_id: 'acct-1',
        member_id: 'contact-1',
        post_id: null,
        campaign_id: null,
        event_type: 'REACTION',
        event_value: null,
        source: 'demo',
        metadata: { emoji: '👍' },
      }),
    });
  });

  it('resolves campaign_id via broadcasts.content_id -> content.campaign_id', async () => {
    const db = fakeDb({
      broadcast: { content_id: 'content-1' },
      content: { campaign_id: 'campaign-1' },
    });
    await writeEngagementEvent(db, {
      accountId: 'acct-1',
      memberId: 'contact-1',
      postId: 'broadcast-1',
      eventType: 'READ',
      source: 'whatsapp',
    });
    expect(db.inserts[0].row).toMatchObject({
      post_id: 'broadcast-1',
      campaign_id: 'campaign-1',
      event_type: 'READ',
      source: 'whatsapp',
    });
  });

  it('leaves campaign_id null when the broadcast has no content_id (a template broadcast)', async () => {
    const db = fakeDb({ broadcast: { content_id: null } });
    await writeEngagementEvent(db, {
      accountId: 'acct-1',
      memberId: 'contact-1',
      postId: 'broadcast-1',
      eventType: 'DELIVERED',
      source: 'whatsapp',
    });
    expect(db.inserts[0].row).toMatchObject({ campaign_id: null });
  });

  it('defaults metadata to {} and event_value to null when omitted', async () => {
    const db = fakeDb({});
    await writeEngagementEvent(db, {
      accountId: 'acct-1',
      memberId: null,
      postId: null,
      eventType: 'REPLY',
      source: 'demo',
    });
    expect(db.inserts[0].row).toMatchObject({
      metadata: {},
      event_value: null,
    });
  });

  it('swallows an insert error rather than throwing', async () => {
    const db = fakeDb({ insertError: { message: 'connection reset' } });
    await expect(
      writeEngagementEvent(db, {
        accountId: 'acct-1',
        memberId: 'contact-1',
        postId: null,
        eventType: 'READ',
        source: 'whatsapp',
      })
    ).resolves.toBeUndefined();
  });

  it('swallows a thrown exception (e.g. a malformed db mock) rather than propagating', async () => {
    const throwing = {
      from: () => {
        throw new Error('boom');
      },
    } as unknown as SupabaseClient;
    await expect(
      writeEngagementEvent(throwing, {
        accountId: 'acct-1',
        memberId: 'contact-1',
        postId: null,
        eventType: 'READ',
        source: 'whatsapp',
      })
    ).resolves.toBeUndefined();
  });
});
