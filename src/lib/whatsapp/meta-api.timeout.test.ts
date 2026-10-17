import { afterEach, describe, expect, it, vi } from 'vitest'
import { getMediaUrl, downloadMedia } from './meta-api'

// ============================================================
// Punto 10, F-P10-1 — every Meta API call now goes through an internal
// fetchWithTimeout() so a hung Meta response can never eat the caller's
// whole execution budget (the webhook's `after()` callback has
// maxDuration=60). This uses fake timers so the test itself runs
// instantly rather than actually waiting out the real timeout.
//
// A mock that only settles when its AbortSignal fires — exactly how a
// real hung `fetch()` behaves once AbortController.abort() is called —
// lets these tests prove the timeout mechanism itself, not just that
// some error eventually surfaces.
// ============================================================

function hangingFetchThatRespectsAbort() {
  return vi.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('This operation was aborted')
        err.name = 'AbortError'
        reject(err)
      })
    })
  })
}

describe('Meta API timeout (Punto 10, F-P10-1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('getMediaUrl aborts and throws a plain, catchable Error after the default timeout — never an unhandled AbortError, never a hang', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetchThatRespectsAbort())

    const promise = getMediaUrl({ mediaId: 'm1', accessToken: 'tok' })
    const assertion = expect(promise).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
  })

  it('downloadMedia gets the LONGER media-transfer timeout — still hanging at 10s, only aborts by 20s', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetchThatRespectsAbort())

    const promise = downloadMedia({ downloadUrl: 'https://cdn.example/x', accessToken: 'tok' })
    // Swallow the eventual rejection so it doesn't surface as an
    // unhandled rejection while we're still mid-assertion below.
    promise.catch(() => {})

    await vi.advanceTimersByTimeAsync(10_000)
    // Still pending — 10s alone must not abort a media transfer.
    let settled = false
    promise.then(
      () => (settled = true),
      () => (settled = true),
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(10_000) // total 20s
    await expect(promise).rejects.toThrow(/timed out/i)
  })

  it('a normal, fast response is unaffected by the timeout machinery', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ url: 'https://cdn.example/real', mime_type: 'image/jpeg', file_size: 100 }),
      })),
    )
    const result = await getMediaUrl({ mediaId: 'm1', accessToken: 'tok' })
    expect(result.url).toBe('https://cdn.example/real')
  })
})
