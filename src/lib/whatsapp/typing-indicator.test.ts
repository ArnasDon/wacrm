import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./meta-api', () => ({ sendTypingIndicator: vi.fn().mockResolvedValue(undefined) }))

import { sendTypingIndicator } from './meta-api'
import { startTypingIndicatorLoop } from './typing-indicator'

const h = vi.mocked({ sendTypingIndicator })

const BASE_ARGS = {
  phoneNumberId: 'phone-1',
  accessToken: 'token-1',
  messageId: 'wamid-1',
  startDelayMs: 7_000,
  refreshMs: 20_000,
  maxDurationMs: 120_000,
}

beforeEach(() => {
  vi.useFakeTimers()
  h.sendTypingIndicator.mockClear()
  h.sendTypingIndicator.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startTypingIndicatorLoop', () => {
  it('sends nothing before the start delay elapses', async () => {
    startTypingIndicatorLoop({ ...BASE_ARGS, conversationId: 'conv-1' })
    await vi.advanceTimersByTimeAsync(6_999)
    expect(h.sendTypingIndicator).not.toHaveBeenCalled()
  })

  it('sends the first indicator right at the start delay', async () => {
    startTypingIndicatorLoop({ ...BASE_ARGS, conversationId: 'conv-2' })
    await vi.advanceTimersByTimeAsync(7_000)
    expect(h.sendTypingIndicator).toHaveBeenCalledTimes(1)
    expect(h.sendTypingIndicator).toHaveBeenCalledWith({
      phoneNumberId: 'phone-1',
      accessToken: 'token-1',
      messageId: 'wamid-1',
    })
  })

  it('refreshes before Meta\'s auto-dismiss window, repeatedly', async () => {
    startTypingIndicatorLoop({ ...BASE_ARGS, conversationId: 'conv-3' })
    await vi.advanceTimersByTimeAsync(7_000) // 1st
    await vi.advanceTimersByTimeAsync(20_000) // 2nd
    await vi.advanceTimersByTimeAsync(20_000) // 3rd
    expect(h.sendTypingIndicator).toHaveBeenCalledTimes(3)
  })

  it('stop() halts further sends', async () => {
    const stop = startTypingIndicatorLoop({ ...BASE_ARGS, conversationId: 'conv-4' })
    await vi.advanceTimersByTimeAsync(7_000)
    expect(h.sendTypingIndicator).toHaveBeenCalledTimes(1)
    stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.sendTypingIndicator).toHaveBeenCalledTimes(1)
  })

  it('a second call for the same conversation joins the existing loop instead of starting another', async () => {
    const first = startTypingIndicatorLoop({ ...BASE_ARGS, conversationId: 'conv-5' })
    await vi.advanceTimersByTimeAsync(3_000)
    const second = startTypingIndicatorLoop({ ...BASE_ARGS, conversationId: 'conv-5' })
    expect(second).toBe(first)

    await vi.advanceTimersByTimeAsync(4_000) // total 7s since the first call
    expect(h.sendTypingIndicator).toHaveBeenCalledTimes(1)

    second() // stopping via the "joining" caller's handle still stops the one shared loop
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.sendTypingIndicator).toHaveBeenCalledTimes(1)
  })

  it('different conversations run fully independent loops', async () => {
    startTypingIndicatorLoop({ ...BASE_ARGS, conversationId: 'conv-6a' })
    startTypingIndicatorLoop({ ...BASE_ARGS, conversationId: 'conv-6b' })
    await vi.advanceTimersByTimeAsync(7_000)
    expect(h.sendTypingIndicator).toHaveBeenCalledTimes(2)
  })

  it('stops retrying after a single send failure instead of hammering a broken integration', async () => {
    h.sendTypingIndicator.mockRejectedValueOnce(new Error('invalid token'))
    startTypingIndicatorLoop({ ...BASE_ARGS, conversationId: 'conv-7' })
    await vi.advanceTimersByTimeAsync(7_000)
    expect(h.sendTypingIndicator).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.sendTypingIndicator).toHaveBeenCalledTimes(1)
  })

  it('never sends past the max duration ceiling even if stop() is never called', async () => {
    startTypingIndicatorLoop({
      ...BASE_ARGS,
      conversationId: 'conv-8',
      maxDurationMs: 30_000,
    })
    // 7s (1st) + 20s (2nd, at 27s) — a 3rd at 47s would be past the 30s ceiling
    await vi.advanceTimersByTimeAsync(200_000)
    expect(h.sendTypingIndicator).toHaveBeenCalledTimes(2)
  })
})
