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

// ============================================================
// Follow-up fix found during PR #7's own review (Oct 2026) — a request
// whose fetch() had ALREADY resolved (so its own AbortController has no
// further effect) could still land after Reset and resurrect the
// transcript Reset had just cleared, or stomp a NEWER, still-in-flight
// generation's own turns. Fixed with a generation counter checked
// immediately before every state-mutating point.
//
// Every test here controls promise resolution order EXPLICITLY via a
// manually-resolved "deferred" — no real timers, no arbitrary delays —
// so the exact race window the bug lived in is reproduced on demand.
// ============================================================
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** A fetch() that resolves immediately to an ok Response whose OWN
 *  `.json()` call returns a separately-controlled, still-pending
 *  promise — models exactly "fetch() resolved, res.json() didn't yet". */
function fetchResolvedWithPendingJson() {
  const json = deferred<unknown>()
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => json.promise } as unknown as Response)
  return { fetchMock, resolveJson: json.resolve }
}

function emptyStateVisible() {
  return screen.queryByText('Send a message to see how your agent would reply.') !== null
}

describe('AiPlayground — follow-up fix: stale responses after Reset (PR #7 review finding)', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    toastMock.error.mockClear()
    toastMock.success.mockClear()
  })

  it('Caso 1 — fetch() resolves but res.json() is still pending; Reset fires; the late JSON must never repopulate the (now empty) conversation', async () => {
    const { fetchMock, resolveJson } = fetchResolvedWithPendingJson()
    vi.stubGlobal('fetch', fetchMock)
    render(<AiPlayground />)

    await sendMessage('hola')
    expect(screen.getByText('Pensando…')).toBeTruthy() // still awaiting res.json()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reset/i }))
    })
    expect(emptyStateVisible()).toBe(true)

    // The response arrives AFTER Reset — must be dropped, not applied.
    await act(async () => {
      resolveJson({ reply: 'respuesta tardía', handoff: false, tool_calls: [] })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.queryByText('respuesta tardía')).toBeNull()
    expect(emptyStateVisible()).toBe(true)
    expect(screen.queryByText('Pensando…')).toBeNull() // sending never got stuck true either
  })

  it('Caso 2 — the previous request FAILS after Reset: must not restore the old turns or overwrite the (now empty) state', async () => {
    // Establish real prior history first, so "restoring old turns"
    // would be observably different from the fresh empty state.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ reply: 'primera respuesta', handoff: false, tool_calls: [] })))
    render(<AiPlayground />)
    await sendMessage('primero')
    await waitFor(() => expect(screen.getByText('primera respuesta')).toBeTruthy())

    // Now a SECOND send that will fail, but only after Reset runs.
    const failing = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(failing.promise))
    await sendMessage('segundo') // closes over the pre-this-send `turns` (1 exchange)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reset/i }))
    })
    expect(emptyStateVisible()).toBe(true)

    // The old request fails NOW, after Reset.
    await act(async () => {
      failing.reject(new Error('network error'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(toastMock.error).not.toHaveBeenCalled() // superseded — never surfaced as a failure
    expect(emptyStateVisible()).toBe(true) // NOT restored to the 1-exchange state Reset cleared
    expect(screen.queryByText('primera respuesta')).toBeNull()
    expect(screen.queryByText('Pensando…')).toBeNull()
  })

  it('Caso 3 — Reset then a brand-new send: a late response from the OLD (superseded) request never affects the NEW conversation, and `sending` is never left stuck for either', async () => {
    const old = deferred<Response>()
    const fetchMock = vi.fn()
    fetchMock.mockReturnValueOnce(old.promise)
    vi.stubGlobal('fetch', fetchMock)
    render(<AiPlayground />)

    await sendMessage('hola, vieja consulta')
    expect(screen.getByText('Pensando…')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reset/i }))
    })
    expect(emptyStateVisible()).toBe(true)

    // A brand-new send right after Reset — `sending` must NOT be stuck
    // true from the old (superseded, still-pending) request, or this
    // second send() would be silently dropped by the `sending` guard.
    const fresh = deferred<Response>()
    fetchMock.mockReturnValueOnce(fresh.promise)
    await sendMessage('consulta nueva')
    expect(fetchMock).toHaveBeenCalledTimes(2) // the new send() really went out

    // The NEW request resolves first.
    await act(async () => {
      fresh.resolve({ ok: true, status: 200, json: async () => ({ reply: 'respuesta nueva', handoff: false, tool_calls: [] }) } as unknown as Response)
    })
    await waitFor(() => expect(screen.getByText('respuesta nueva')).toBeTruthy())

    // The OLD request's late success arrives AFTER — must not append,
    // duplicate, or replace anything in the now-active new generation.
    await act(async () => {
      old.resolve({ ok: true, status: 200, json: async () => ({ reply: 'respuesta vieja tardía', handoff: false, tool_calls: [] }) } as unknown as Response)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.queryByText('respuesta vieja tardía')).toBeNull()
    expect(screen.getByText('respuesta nueva')).toBeTruthy() // the new exchange is still intact
    expect(screen.queryByText('hola, vieja consulta')).toBeNull() // the old, reset conversation never reappeared
    expect(screen.queryByText('Pensando…')).toBeNull() // sending correctly settled, not stuck
  })
})
