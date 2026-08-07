import { describe, it, expect, vi } from 'vitest'
import { executeToolCallWithTimeout } from './execute'
import type { ToolCall } from './loop-types'

const call: ToolCall = { id: 'call-1', name: 'check_availability', input: {} }

describe('executeToolCallWithTimeout', () => {
  it('returns the executor result on success', async () => {
    const result = await executeToolCallWithTimeout(
      call,
      async () => ({ content: 'ok', isError: false }),
      1000,
    )
    expect(result).toEqual({ content: 'ok', isError: false })
  })

  it('turns a thrown error into an isError result instead of propagating', async () => {
    const result = await executeToolCallWithTimeout(
      call,
      async () => {
        throw new Error('boom')
      },
      1000,
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('boom')
  })

  it('times out a slow executor and returns an isError result', async () => {
    vi.useFakeTimers()
    const executor = () => new Promise<never>(() => {}) // never resolves
    const promise = executeToolCallWithTimeout(call, executor, 50)
    await vi.advanceTimersByTimeAsync(60)
    const result = await promise
    expect(result.isError).toBe(true)
    expect(result.content).toContain('check_availability')
    vi.useRealTimers()
  })

  it('passes through an explicit isError result from the executor', async () => {
    const result = await executeToolCallWithTimeout(
      call,
      async () => ({ content: 'not found', isError: true }),
      1000,
    )
    expect(result).toEqual({ content: 'not found', isError: true })
  })
})
