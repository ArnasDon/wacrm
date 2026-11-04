import { describe, expect, it } from 'vitest'
import { MAX_WEBHOOK_BODY_BYTES, readCappedBody } from './webhook-body'

function post(body: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers,
    body,
  })
}

function streamOf(chunks: Uint8Array[]) {
  let pulled = 0
  let cancelled = false
  const source: UnderlyingDefaultSource<Uint8Array> = {
    pull(controller) {
      if (pulled >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(chunks[pulled])
      pulled += 1
    },
    cancel() {
      cancelled = true
    },
  }
  const stream = new ReadableStream<Uint8Array>(source, { highWaterMark: 0 })
  return {
    stream,
    pulled: () => pulled,
    cancelled: () => cancelled,
  }
}

describe('readCappedBody', () => {
  it('returns the exact text of a body within the cap', async () => {
    const text = JSON.stringify({ entry: [{ id: 'WABA-1', name: 'Zoë' }] })
    expect(await readCappedBody(post(text))).toBe(text)
  })

  it('accepts a body exactly at the cap', async () => {
    const text = 'x'.repeat(MAX_WEBHOOK_BODY_BYTES)
    expect(await readCappedBody(post(text))).toBe(text)
  })

  it('rejects a body one byte over the cap', async () => {
    expect(await readCappedBody(post('x'.repeat(MAX_WEBHOOK_BODY_BYTES + 1)))).toBeNull()
  })

  it('counts bytes, not characters', async () => {
    expect(await readCappedBody(post('é'.repeat(3)), 5)).toBeNull()
    expect(await readCappedBody(post('é'.repeat(3)), 6)).toBe('ééé')
  })

  it('rejects on a declared Content-Length over the cap without reading the body', async () => {
    const s = streamOf([new Uint8Array(4)])
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-length': '11' },
      body: s.stream,
      duplex: 'half',
    } as RequestInit)
    expect(await readCappedBody(req, 10)).toBeNull()
    expect(s.pulled()).toBe(0)
  })

  it('stops reading and cancels a stream that outgrows the cap', async () => {
    const s = streamOf([new Uint8Array(6), new Uint8Array(6), new Uint8Array(6)])
    const req = new Request('http://localhost/', {
      method: 'POST',
      body: s.stream,
      duplex: 'half',
    } as RequestInit)
    expect(await readCappedBody(req, 10)).toBeNull()
    expect(s.cancelled()).toBe(true)
    expect(s.pulled()).toBeLessThan(3)
  })

  it('returns an empty string for a request with no body', async () => {
    expect(await readCappedBody(post(null))).toBe('')
  })
})
