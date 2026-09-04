import { describe, it, expect } from 'vitest'
import { contentLengthExceeds, fileExceeds, fileTooLargeResponse, MAX_UPLOAD_BYTES } from './size-limit'

function requestWithContentLength(value: string | null): Request {
  const headers = new Headers()
  if (value !== null) headers.set('content-length', value)
  // GET with no body — the point of this helper is testing the header
  // check in isolation, independent of whether a given runtime lets a
  // POST request's actual body override a manually-set Content-Length.
  return new Request('http://localhost/upload', { method: 'GET', headers })
}

describe('contentLengthExceeds', () => {
  it('true when Content-Length exceeds the limit', () => {
    expect(contentLengthExceeds(requestWithContentLength(String(MAX_UPLOAD_BYTES + 1)), MAX_UPLOAD_BYTES)).toBe(true)
  })

  it('false when Content-Length is exactly at the limit', () => {
    expect(contentLengthExceeds(requestWithContentLength(String(MAX_UPLOAD_BYTES)), MAX_UPLOAD_BYTES)).toBe(false)
  })

  it('false when Content-Length is well under the limit', () => {
    expect(contentLengthExceeds(requestWithContentLength('1024'), MAX_UPLOAD_BYTES)).toBe(false)
  })

  it('false (never blocks) when Content-Length is absent', () => {
    expect(contentLengthExceeds(requestWithContentLength(null), MAX_UPLOAD_BYTES)).toBe(false)
  })

  it('false (never blocks) when Content-Length is unparseable', () => {
    expect(contentLengthExceeds(requestWithContentLength('not-a-number'), MAX_UPLOAD_BYTES)).toBe(false)
  })
})

describe('fileExceeds', () => {
  it('true for a file larger than the limit', () => {
    const file = { size: MAX_UPLOAD_BYTES + 1 } as File
    expect(fileExceeds(file, MAX_UPLOAD_BYTES)).toBe(true)
  })

  it('false for a file exactly at the limit', () => {
    const file = { size: MAX_UPLOAD_BYTES } as File
    expect(fileExceeds(file, MAX_UPLOAD_BYTES)).toBe(false)
  })

  it('false for a small file', () => {
    const file = { size: 1024 } as File
    expect(fileExceeds(file, MAX_UPLOAD_BYTES)).toBe(false)
  })
})

describe('fileTooLargeResponse', () => {
  it('returns a 413 with a human-readable MB figure, defaulting to MAX_UPLOAD_BYTES', () => {
    const { body, status } = fileTooLargeResponse()
    expect(status).toBe(413)
    expect(body.error).toContain('25 MB')
  })

  it('reflects a custom limit when one is passed', () => {
    const { body } = fileTooLargeResponse(10 * 1024 * 1024)
    expect(body.error).toContain('10 MB')
  })
})
