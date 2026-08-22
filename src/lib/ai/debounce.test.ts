import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { waitForQuietPeriod } from './debounce'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('waitForQuietPeriod', () => {
  it('resolves true for a lone inbound once the quiet period elapses', async () => {
    const promise = waitForQuietPeriod('conv-1', 100)
    await vi.advanceTimersByTimeAsync(100)
    await expect(promise).resolves.toBe(true)
  })

  it('resolves false for every earlier call in a burst, true only for the last one', async () => {
    const first = waitForQuietPeriod('conv-1', 100)
    await vi.advanceTimersByTimeAsync(40)
    const second = waitForQuietPeriod('conv-1', 100)
    await vi.advanceTimersByTimeAsync(40)
    const third = waitForQuietPeriod('conv-1', 100)

    await vi.advanceTimersByTimeAsync(100)

    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(false)
    await expect(third).resolves.toBe(true)
  })

  it('tracks each conversation independently — a burst on one never supersedes another', async () => {
    const convA = waitForQuietPeriod('conv-a', 100)
    const convB = waitForQuietPeriod('conv-b', 100)
    await vi.advanceTimersByTimeAsync(100)

    await expect(convA).resolves.toBe(true)
    await expect(convB).resolves.toBe(true)
  })

  it('lets the same conversation be debounced again after a burst resolves', async () => {
    const first = waitForQuietPeriod('conv-1', 100)
    await vi.advanceTimersByTimeAsync(100)
    await expect(first).resolves.toBe(true)

    const second = waitForQuietPeriod('conv-1', 100)
    await vi.advanceTimersByTimeAsync(100)
    await expect(second).resolves.toBe(true)
  })
})
