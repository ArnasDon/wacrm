import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureTrackedLinkTouch } from './tracked-links';

/**
 * Fake Supabase client covering every table this module touches:
 * `tracked_links` / `ad_campaigns` lookups (select().eq().maybeSingle())
 * plus the `attribution_events` insert and `contacts` update that
 * `recordTrackedLinkTouch` performs underneath. Chainable enough to
 * exercise the real capture path end-to-end rather than mocking it out.
 */
function fakeDb({
  trackedLink = null as {
    id: string;
    account_id: string;
    source: string;
    campaign_id: string | null;
  } | null,
  campaignExternalId = null as string | null,
} = {}) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const updates: Array<{
    table: string;
    row: Record<string, unknown>;
    filters: Array<[string, unknown]>;
  }> = [];
  const selectCalls: string[] = [];

  const db = {
    inserts,
    updates,
    selectCalls,
    from(table: string) {
      if (table === 'tracked_links') {
        selectCalls.push('tracked_links');
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: () => Promise.resolve({ data: trackedLink, error: null }),
        };
      }
      if (table === 'ad_campaigns') {
        selectCalls.push('ad_campaigns');
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: () =>
            Promise.resolve({
              data: campaignExternalId ? { external_id: campaignExternalId } : null,
              error: null,
            }),
        };
      }
      return {
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          return Promise.resolve({ error: null });
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

describe('captureTrackedLinkTouch', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('does not query the database when the text carries no ref tag', async () => {
    const db = fakeDb();
    const out = await captureTrackedLinkTouch({ db, ...base, text: 'Hola, quiero información' });

    expect(out).toBeNull();
    expect(db.selectCalls).toHaveLength(0);
    expect(db.inserts).toHaveLength(0);
  });

  it('returns null when the code matches no tracked link', async () => {
    const db = fakeDb({ trackedLink: null });
    const out = await captureTrackedLinkTouch({ db, ...base, text: 'Hola [#a1b2c3]' });

    expect(out).toBeNull();
    expect(db.inserts).toHaveLength(0);
  });

  it('does not attribute a code that belongs to a different account', async () => {
    // A customer forwarding a link meant for someone else's WhatsApp
    // number must not credit the wrong tenant's campaign.
    const db = fakeDb({
      trackedLink: { id: 'link-1', account_id: 'other-account', source: 'web', campaign_id: null },
    });
    const out = await captureTrackedLinkTouch({ db, ...base, text: 'Hola [#a1b2c3]' });

    expect(out).toBeNull();
    expect(db.inserts).toHaveLength(0);
  });

  it('records the touch for a link with no campaign', async () => {
    const db = fakeDb({
      trackedLink: { id: 'link-1', account_id: 'acc-1', source: 'organic', campaign_id: null },
    });
    const out = await captureTrackedLinkTouch({ db, ...base, text: 'Hola [#a1b2c3]' });

    expect(out).toMatchObject({ source: 'organic', campaignExternalId: null });
    expect(db.inserts[0].row).toMatchObject({
      source: 'organic',
      campaign_id: null,
      ad_id: null,
    });
    // No ad_campaigns lookup needed when the link has no campaign.
    expect(db.selectCalls).not.toContain('ad_campaigns');
  });

  it('resolves the linked campaign to its external_id', async () => {
    const db = fakeDb({
      trackedLink: {
        id: 'link-1',
        account_id: 'acc-1',
        source: 'google_ads',
        campaign_id: 'campaign-uuid-1',
      },
      campaignExternalId: 'google-search-brand',
    });
    const out = await captureTrackedLinkTouch({ db, ...base, text: 'Hola [#a1b2c3]' });

    expect(out).toMatchObject({ source: 'google_ads', campaignExternalId: 'google-search-brand' });
    expect(db.inserts[0].row).toMatchObject({ campaign_id: 'google-search-brand' });
    expect(db.updates[0].row).toMatchObject({ source_campaign_id: 'google-search-brand' });
  });

  it('coerces an unrecognised source value rather than throwing', async () => {
    const db = fakeDb({
      trackedLink: { id: 'link-1', account_id: 'acc-1', source: 'not-a-real-source', campaign_id: null },
    });
    const out = await captureTrackedLinkTouch({ db, ...base, text: 'Hola [#a1b2c3]' });
    expect(out?.source).toBe('unknown');
  });
});
