import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AI_ACCOUNT_STATUS_TTL_MS,
  fetchAiAccountStatus,
  invalidateAiAccountStatus,
} from './account-status-cache'

function configResponse(body: Record<string, unknown>, ok = true) {
  return { ok, json: async () => body } as Response
}

const LIVE = { configured: true, is_active: true, auto_reply_enabled: true }
const OFF = { configured: true, is_active: true, auto_reply_enabled: false }

let clock = 0
const now = () => clock

beforeEach(() => {
  invalidateAiAccountStatus()
  clock = 1_000
})

describe('fetchAiAccountStatus', () => {
  it('serves a cached status within the TTL', async () => {
    const fetchImpl = vi.fn(async () => configResponse(LIVE)) as unknown as typeof fetch
    expect(await fetchAiAccountStatus('acc', fetchImpl, now)).toEqual({ autoReplyOn: true })
    clock += AI_ACCOUNT_STATUS_TTL_MS - 1
    await fetchAiAccountStatus('acc', fetchImpl, now)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('refetches once the TTL has passed', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(configResponse(LIVE))
      .mockResolvedValueOnce(configResponse(OFF)) as unknown as typeof fetch
    await fetchAiAccountStatus('acc', fetchImpl, now)
    clock += AI_ACCOUNT_STATUS_TTL_MS
    expect(await fetchAiAccountStatus('acc', fetchImpl, now)).toEqual({ autoReplyOn: false })
  })

  it('refetches immediately after invalidation', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(configResponse(LIVE))
      .mockResolvedValueOnce(configResponse(OFF)) as unknown as typeof fetch
    await fetchAiAccountStatus('acc', fetchImpl, now)
    invalidateAiAccountStatus()
    expect(await fetchAiAccountStatus('acc', fetchImpl, now)).toEqual({ autoReplyOn: false })
  })

  it('keeps accounts separate and does not cache failures', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(configResponse({}, false))
      .mockResolvedValueOnce(configResponse(LIVE))
      .mockResolvedValueOnce(configResponse(OFF)) as unknown as typeof fetch
    expect(await fetchAiAccountStatus('a', fetchImpl, now)).toEqual({ autoReplyOn: false })
    expect(await fetchAiAccountStatus('a', fetchImpl, now)).toEqual({ autoReplyOn: true })
    expect(await fetchAiAccountStatus('b', fetchImpl, now)).toEqual({ autoReplyOn: false })
    expect(await fetchAiAccountStatus('a', fetchImpl, now)).toEqual({ autoReplyOn: true })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})
