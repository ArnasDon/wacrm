// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ============================================================
// Playground reliability audit (Oct 2026) — the confirmed, demonstrated
// bug: with no client-side timeout and no cancellation, a slow/hung
// server request left `sending` stuck true forever, with Reset
// disabled and no way to submit a new message — "se queda esperando",
// exactly the reported symptom. These tests prove the fix: a bounded
// client timeout that always resolves the loading state, a Reset that
// can actually cancel an in-flight request, and that a genuinely empty
// reply is never silently invisible.
//
// Same "hanging fetch that respects AbortSignal" pattern as
// src/lib/whatsapp/meta-api.timeout.test.ts — real fake-timer control
// over the exact mechanism, not just an eventual generic error.
// ============================================================

const { toastMock } = vi.hoisted(() => ({ toastMock: { success: vi.fn(), error: vi.fn() } }))
vi.mock('sonner', () => ({ toast: toastMock }))

import { AiPlayground } from './ai-playground'

// jsdom doesn't implement scrollTo — the transcript's own autoscroll
// effect calls it on every render, unrelated to anything under test.
Element.prototype.scrollTo = vi.fn()

function hangingFetchThatRespectsAbort() {
  return vi.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new DOMException('This operation was aborted', 'AbortError')
        reject(err)
      })
    })
  })
}

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response
}

function textarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText('Type a customer message…') as HTMLTextAreaElement
}

async function sendMessage(text: string) {
  await act(async () => {
    fireEvent.change(textarea(), { target: { value: text } })
    fireEvent.keyDown(textarea(), { key: 'Enter' })
  })
}

describe('AiPlayground — reliability fixes', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    toastMock.error.mockClear()
    toastMock.success.mockClear()
  })

  it('a slow/hung request aborts after the bounded client timeout — loading state resolves, a clear error is shown, never stuck forever', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetchThatRespectsAbort())
    render(<AiPlayground />)

    await sendMessage('hola, tienen samsung?')
    expect(screen.getByText('Pensando…')).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })

    expect(toastMock.error).toHaveBeenCalled()
    expect(screen.queryByText('Pensando…')).toBeNull()
    // The user is never stuck: the input they typed is restored.
    expect(textarea().value).toBe('hola, tienen samsung?')
  })

  it('Reset cancels an in-flight request immediately — never waits for the hung request, and the abort is handled silently (no error toast)', async () => {
    vi.stubGlobal('fetch', hangingFetchThatRespectsAbort())
    render(<AiPlayground />)

    await sendMessage('hola')
    expect(screen.getByText('Pensando…')).toBeTruthy()

    // Reset must be clickable WHILE sending — this was the actual bug:
    // it used to be `disabled` whenever `sending` was true, so a stuck
    // request could never be escaped at all.
    const resetButton = screen.getByRole('button', { name: /reset/i }) as HTMLButtonElement
    expect(resetButton.disabled).toBe(false)
    await act(async () => {
      fireEvent.click(resetButton)
    })

    // Clears immediately — does not wait for the (never-resolving) fetch.
    expect(screen.queryByText('Pensando…')).toBeNull()
    expect(textarea().value).toBe('')

    // Give the aborted fetch's rejection a tick to be handled — it must
    // NOT surface as an error toast or re-populate the transcript Reset
    // already cleared.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('a second message cannot be submitted while one is already in flight (duplicate-call guard)', async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {})) // never resolves
    vi.stubGlobal('fetch', fetchMock)
    render(<AiPlayground />)

    await sendMessage('primero')
    await sendMessage('segundo') // ignored — sending is already true

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a normal error response (e.g. 400) resets the loading state and restores the input — not stuck', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'boom' }) }))
    render(<AiPlayground />)

    await sendMessage('hola')
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('boom'))
    expect(screen.queryByText('Pensando…')).toBeNull()
    expect(textarea().value).toBe('hola')
  })

  it('a genuinely empty, non-handoff reply shows an explicit placeholder — never a silently blank bubble', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ reply: '', handoff: false, tool_calls: [] })))
    render(<AiPlayground />)

    // Deliberately NOT a Spanish-detected message (see isSpanish()) —
    // this asserts the English placeholder text specifically.
    await sendMessage('test message')
    await waitFor(() => expect(screen.getByText('(no reply text)')).toBeTruthy())
  })

  it('a handoff reply never shows the empty-reply placeholder (handoff has its own indicator)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ reply: '', handoff: true, tool_calls: [] })))
    render(<AiPlayground />)

    await sendMessage('quiero hablar con una persona')
    await waitFor(() => expect(screen.getByText('Would hand off to a human here')).toBeTruthy())
    expect(screen.queryByText('(no reply text)')).toBeNull()
  })
})
