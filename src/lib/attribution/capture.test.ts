import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  recordReferralTouch,
  recordTrackedLinkTouch,
  referralToAttribution,
  trackedLinkToAttribution,
} from './capture';

describe('referralToAttribution', () => {
  it('maps a Click-to-WhatsApp ad to meta_ads and keeps the ad id', () => {
    const out = referralToAttribution({
      source_id: '120210000000000',
      source_type: 'ad',
      source_url: 'https://fb.me/abc',
      headline: 'Promo de verano',
      ctwa_clid: 'clid-123',
    });

    expect(out).toEqual({
      source: 'meta_ads',
      adId: '120210000000000',
      campaignExternalId: null,
      ctwaClid: 'clid-123',
      headline: 'Promo de verano',
      sourceUrl: 'https://fb.me/abc',
    });
  });

  it('treats an organic post click as organic, not as a paid lead', () => {
    // A post has no spend behind it. Counting it as meta_ads would
    // divide real spend by inflated leads and understate cost per lead.
    const out = referralToAttribution({
      source_id: 'post-1',
      source_type: 'post',
    });
    expect(out?.source).toBe('organic');
    expect(out?.adId).toBe('post-1');
  });

  it('treats an unrecognised source_type as paid rather than organic', () => {
    const out = referralToAttribution({
      source_id: 'x-1',
      source_type: 'some_future_placement',
    });
    expect(out?.source).toBe('meta_ads');
  });

  it('returns null when there is no referral at all', () => {
    expect(referralToAttribution(undefined)).toBeNull();
    expect(referralToAttribution(null)).toBeNull();
  });

  it('returns null for a referral carrying no usable id', () => {
    expect(referralToAttribution({ headline: 'just a headline' })).toBeNull();
    expect(referralToAttribution({ source_id: '   ' })).toBeNull();
  });

  it('still records a Status-placement ad, which omits ctwa_clid', () => {
    const out = referralToAttribution({ source_id: 'ad-9', source_type: 'ad' });
    expect(out?.source).toBe('meta_ads');
    expect(out?.ctwaClid).toBeNull();
  });

  it('normalises blank optional fields to null instead of empty strings', () => {
    const out = referralToAttribution({
      source_id: 'ad-1',
      headline: '',
      source_url: '   ',
    });
    expect(out?.headline).toBeNull();
    expect(out?.sourceUrl).toBeNull();
  });
});

/**
 * Fake Supabase client. `insert` resolves to whatever the test queues;
 * `update(...).eq(...).eq(...)` is thenable like the real builder, and
 * records the filters so we can assert the first-touch guard is applied.
 */
function fakeDb(insertResult: { error: unknown } = { error: null }) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const updates: Array<{
    table: string;
    row: Record<string, unknown>;
    filters: Array<[string, unknown]>;
  }> = [];

  const db = {
    inserts,
    updates,
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          return Promise.resolve(insertResult);
        },
        update(row: Record<string, unknown>) {
          const filters: Array<[string, unknown]> = [];
          updates.push({ table, row, filters });
          const builder = {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return builder;
            },
            then(resolve: (v: { error: null }) => unknown) {
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return builder;
        },
      };
    },
  };
  return db;
}

const base = {
  accountId: 'acc-1',
  contactId: 'contact-1',
  conversationId: 'conv-1',
  wamid: 'wamid.ABC',
};

describe('recordReferralTouch', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('does not touch the database for an ordinary message', async () => {
    const db = fakeDb();
    const out = await recordReferralTouch({ db, ...base, referral: undefined });

    expect(out).toBeNull();
    expect(db.inserts).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
  });

  it('logs the event and stamps the contact for an ad lead', async () => {
    const db = fakeDb();
    await recordReferralTouch({
      db,
      ...base,
      referral: { source_id: 'ad-1', source_type: 'ad', ctwa_clid: 'c-1' },
      occurredAt: new Date('2026-07-01T10:00:00.000Z'),
    });

    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0].table).toBe('attribution_events');
    expect(db.inserts[0].row).toMatchObject({
      account_id: 'acc-1',
      contact_id: 'contact-1',
      conversation_id: 'conv-1',
      wamid: 'wamid.ABC',
      source: 'meta_ads',
      ad_id: 'ad-1',
      ctwa_clid: 'c-1',
      occurred_at: '2026-07-01T10:00:00.000Z',
    });

    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].table).toBe('contacts');
    expect(db.updates[0].row).toMatchObject({
      source: 'meta_ads',
      source_ad_id: 'ad-1',
    });
  });

  it('only stamps a contact that is still unclassified (first-touch)', async () => {
    // The guard has to be a WHERE filter, not a read-then-write, or two
    // concurrent deliveries could let a later ad steal the credit.
    const db = fakeDb();
    await recordReferralTouch({
      db,
      ...base,
      referral: { source_id: 'ad-1', source_type: 'ad' },
    });

    expect(db.updates[0].filters).toEqual([
      ['id', 'contact-1'],
      ['source', 'unknown'],
    ]);
  });

  it('does not re-stamp the contact when Meta retries the same message', async () => {
    // Duplicate wamid -> unique violation on the event log. The first
    // delivery already did the work; a retry must not count twice.
    const db = fakeDb({ error: { code: '23505' } });
    const out = await recordReferralTouch({
      db,
      ...base,
      referral: { source_id: 'ad-1', source_type: 'ad' },
    });

    expect(out?.source).toBe('meta_ads');
    expect(db.inserts).toHaveLength(1);
    expect(db.updates).toHaveLength(0);
  });

  it('still stamps the contact when the event log write fails for another reason', async () => {
    // The contact stamp is what the reports read — losing the log is
    // survivable, losing the attribution is not.
    const db = fakeDb({ error: { code: '08006', message: 'connection lost' } });
    await recordReferralTouch({
      db,
      ...base,
      referral: { source_id: 'ad-1', source_type: 'ad' },
    });

    expect(db.updates).toHaveLength(1);
  });

  it('falls back to now when the webhook timestamp is unusable', async () => {
    // new Date(NaN).toISOString() throws — that must not cost us the lead.
    const db = fakeDb();
    await recordReferralTouch({
      db,
      ...base,
      referral: { source_id: 'ad-1', source_type: 'ad' },
      occurredAt: new Date(Number('not-a-timestamp') * 1000),
    });

    const occurredAt = db.inserts[0].row.occurred_at as string;
    expect(Number.isNaN(Date.parse(occurredAt))).toBe(false);
  });
});

describe('trackedLinkToAttribution', () => {
  it('carries the link source and campaign straight through, no async resolution needed', () => {
    // Unlike a Meta ad id, the campaign a tracked link belongs to is
    // known synchronously — the operator picked it when creating the
    // link — so campaignExternalId is set immediately, not left null
    // for a later sync to resolve.
    const out = trackedLinkToAttribution({
      source: 'google_ads',
      slug: 'a1b2c3',
      campaignExternalId: 'google-search-brand',
    });
    expect(out).toEqual({
      source: 'google_ads',
      adId: null,
      campaignExternalId: 'google-search-brand',
      ctwaClid: null,
      headline: null,
      sourceUrl: '/l/a1b2c3',
    });
  });

  it('still produces a valid attribution when the link has no campaign', () => {
    const out = trackedLinkToAttribution({
      source: 'web',
      slug: 'x9y8z7',
      campaignExternalId: null,
    });
    expect(out.campaignExternalId).toBeNull();
    expect(out.source).toBe('web');
  });
});

describe('recordTrackedLinkTouch', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('logs the event and stamps the contact with the linked campaign', async () => {
    const db = fakeDb();
    await recordTrackedLinkTouch({
      db,
      ...base,
      link: { source: 'google_ads', slug: 'a1b2c3', campaignExternalId: 'gc-1' },
      occurredAt: new Date('2026-07-01T10:00:00.000Z'),
    });

    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0].row).toMatchObject({
      source: 'google_ads',
      ad_id: null,
      campaign_id: 'gc-1',
      occurred_at: '2026-07-01T10:00:00.000Z',
    });

    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].row).toMatchObject({
      source: 'google_ads',
      source_campaign_id: 'gc-1',
    });
  });

  it('applies the same first-touch guard as a Meta referral', async () => {
    const db = fakeDb();
    await recordTrackedLinkTouch({
      db,
      ...base,
      link: { source: 'organic', slug: 'x1', campaignExternalId: null },
    });
    expect(db.updates[0].filters).toEqual([
      ['id', 'contact-1'],
      ['source', 'unknown'],
    ]);
  });

  it('does not re-stamp on a replayed wamid', async () => {
    const db = fakeDb({ error: { code: '23505' } });
    await recordTrackedLinkTouch({
      db,
      ...base,
      link: { source: 'web', slug: 'x2', campaignExternalId: null },
    });
    expect(db.updates).toHaveLength(0);
  });
});
