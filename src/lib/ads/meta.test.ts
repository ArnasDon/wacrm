import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  extractMessagingStarted,
  fetchCampaignInsights,
  listCampaigns,
  verifyAdAccount,
} from './meta'

// Each entry is one queued response, consumed in order, so a test can
// model a multi-page reply by queueing a `paging.next` then a final page.
type Queued =
  | { ok: true; body: unknown }
  | { ok: false; status: number; body: unknown }
  | { timeout: true }

let queue: Queued[] = []
let requestedUrls: string[] = []

const fetchMock = vi.fn(async (url: string | URL) => {
  requestedUrls.push(String(url))
  const next = queue.shift()
  if (!next) throw new Error(`unexpected fetch: ${url}`)

  if ('timeout' in next) {
    // What AbortSignal.timeout() actually produces when it fires.
    const err = new Error('The operation was aborted due to timeout')
    err.name = 'TimeoutError'
    throw err
  }

  return {
    ok: next.ok,
    status: 'status' in next ? next.status : 200,
    json: async () => next.body,
  } as Response
})

beforeEach(() => {
  queue = []
  requestedUrls = []
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listCampaigns', () => {
  it('follows paging.next and returns every page', async () => {
    queue = [
      {
        ok: true,
        body: {
          data: [{ id: '1', name: 'A' }],
          paging: { next: 'https://graph.facebook.com/next-page-1' },
        },
      },
      { ok: true, body: { data: [{ id: '2', name: 'B' }] } },
    ]

    const campaigns = await listCampaigns({ adAccountId: 'act_1', accessToken: 't' })

    expect(campaigns.map((c) => c.id)).toEqual(['1', '2'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The cursor URL is used verbatim; it already carries fields+params.
    expect(requestedUrls[1]).toBe('https://graph.facebook.com/next-page-1')
  })

  it('stops when there is no next cursor', async () => {
    queue = [{ ok: true, body: { data: [{ id: '1', name: 'A' }] } }]
    await listCampaigns({ adAccountId: 'act_1', accessToken: 't' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces Meta\'s own error message', async () => {
    queue = [
      {
        ok: false,
        status: 400,
        body: { error: { message: 'Invalid OAuth access token.' } },
      },
    ]
    await expect(listCampaigns({ adAccountId: 'act_1', accessToken: 'bad' })).rejects.toThrow(
      'Invalid OAuth access token.',
    )
  })

  it('falls back to its own message when the body is not JSON', async () => {
    queue = [
      {
        ok: false,
        status: 500,
        get body(): never {
          throw new Error('not json')
        },
      },
    ]
    await expect(listCampaigns({ adAccountId: 'act_1', accessToken: 't' })).rejects.toThrow(
      'Failed to list campaigns',
    )
  })
})

describe('fetchCampaignInsights', () => {
  it('pages through insights', async () => {
    // The case that made truncation dangerous: insights are per campaign
    // per day, so a real account overflows one page and the dropped rows
    // read as less spend, i.e. inflated ROI.
    queue = [
      {
        ok: true,
        body: {
          data: [{ campaign_id: 'c1', date_start: '2026-07-25', spend: '10' }],
          paging: { next: 'https://graph.facebook.com/insights-page-2' },
        },
      },
      {
        ok: true,
        body: { data: [{ campaign_id: 'c2', date_start: '2026-07-25', spend: '20' }] },
      },
    ]

    const insights = await fetchCampaignInsights({
      adAccountId: 'act_1',
      accessToken: 't',
      since: '2026-07-22',
      until: '2026-07-25',
    })

    expect(insights).toHaveLength(2)
    expect(insights.map((i) => i.spend)).toEqual(['10', '20'])
  })

  it('asks for a daily breakdown over the requested range', async () => {
    queue = [{ ok: true, body: { data: [] } }]
    await fetchCampaignInsights({
      adAccountId: 'act_9',
      accessToken: 't',
      since: '2026-07-22',
      until: '2026-07-25',
    })

    const url = requestedUrls[0]
    expect(url).toContain('act_9/insights')
    expect(url).toContain('time_increment=1')
    expect(url).toContain(encodeURIComponent('"since":"2026-07-22"'))
    expect(url).toContain(encodeURIComponent('"until":"2026-07-25"'))
  })

  it('names Meta when the request times out', async () => {
    queue = [{ timeout: true }]
    await expect(
      fetchCampaignInsights({
        adAccountId: 'act_1',
        accessToken: 't',
        since: '2026-07-22',
        until: '2026-07-25',
      }),
    ).rejects.toThrow(/Meta did not respond within \d+s/)
  })
})

describe('verifyAdAccount', () => {
  it('returns name, currency and timezone', async () => {
    queue = [
      {
        ok: true,
        body: { name: 'Kibo Ads', currency: 'PEN', timezone_name: 'America/Lima' },
      },
    ]

    const account = await verifyAdAccount({ adAccountId: 'act_1', accessToken: 't' })

    expect(account).toEqual({ name: 'Kibo Ads', currency: 'PEN', timezone: 'America/Lima' })
    expect(requestedUrls[0]).toContain('timezone_name')
  })

  it('tolerates an account with no timezone reported', async () => {
    queue = [{ ok: true, body: { name: 'Kibo Ads', currency: 'PEN' } }]
    const account = await verifyAdAccount({ adAccountId: 'act_1', accessToken: 't' })
    expect(account.timezone).toBeNull()
  })
})

describe('extractMessagingStarted', () => {
  it('finds the conversations-started action whatever its window suffix', () => {
    expect(
      extractMessagingStarted([
        { action_type: 'link_click', value: '10' },
        {
          action_type: 'onsite_conversion.messaging_conversation_started_7d',
          value: '4',
        },
      ]),
    ).toBe(4)
  })

  it('distinguishes "Meta reported zero" from "we do not know"', () => {
    expect(extractMessagingStarted([{ action_type: 'x.messaging_conversation_started', value: '0' }])).toBe(0)
    expect(extractMessagingStarted(undefined)).toBeNull()
    expect(extractMessagingStarted([{ action_type: 'link_click', value: '3' }])).toBeNull()
  })
})
