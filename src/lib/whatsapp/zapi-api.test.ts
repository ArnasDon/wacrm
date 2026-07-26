import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getInstance,
  getQrCode,
  sendDocument,
  sendReaction,
  sendText,
  updateAllWebhooks,
  type ZapiCredentials,
} from './zapi-api'
import { NodeExecutionTimeoutError, executeWithNodePolicy } from '@/lib/flows/execution-policy'

const credentials: ZapiCredentials = {
  instanceId: 'inst/1',
  instanceToken: 'tok/1',
  clientToken: 'client-1',
}

function mockJson(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  )
}

describe('zapi-api', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sends text with the Z-API base URL, Client-Token header and reply messageId', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => mockJson({ messageId: 'wamid-1', zaapId: 'zaap-1' }))

    const result = await sendText({
      credentials,
      phone: '15551234567',
      text: 'hello',
      replyTo: 'wamid-parent',
    })

    expect(result).toEqual({ messageId: 'wamid-1', zaapId: 'zaap-1' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.z-api.io/instances/inst%2F1/token/tok%2F1/send-text',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Client-Token': 'client-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phone: '15551234567',
          message: 'hello',
          messageId: 'wamid-parent',
        }),
      })
    )
  })

  it('passes the policy abort signal to fetch and does not retry a timed-out send', async () => {
    const signals: AbortSignal[] = []
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const signal = init?.signal as AbortSignal
      signals.push(signal)
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        })
      })
    })

    const error = await executeWithNodePolicy(
      (signal) =>
        sendText({
          credentials,
          phone: '15551234567',
          text: 'hello',
          signal,
        }),
      {
        retry: {
          max_attempts: 3,
          interval_ms: 0,
          backoff: 'fixed',
        },
        on_error: 'fail_run',
        timeout_ms: 25,
      }
    ).catch((caught) => caught)

    expect(error.cause).toBeInstanceOf(NodeExecutionTimeoutError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(true)
  })

  it('uses the document extension path and normalizes id fallback', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => mockJson({ id: 'doc-id' }))

    const result = await sendDocument({
      credentials,
      phone: '15551234567',
      url: 'https://example.com/file.docx',
      filename: 'contract.docx',
      caption: 'contract',
    })

    expect(result.messageId).toBe('doc-id')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/send-document/docx'),
      expect.objectContaining({
        body: JSON.stringify({
          phone: '15551234567',
          document: 'https://example.com/file.docx',
          fileName: 'contract.docx',
          caption: 'contract',
        }),
      })
    )
  })

  it('sends reactions with messageId and reaction fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => mockJson({}))

    const result = await sendReaction({
      credentials,
      phone: '15551234567',
      messageId: 'wamid-1',
      emoji: ':)',
    })

    expect(result.messageId).toBe('wamid-1')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/send-reaction'),
      expect.objectContaining({
        body: JSON.stringify({
          phone: '15551234567',
          messageId: 'wamid-1',
          reaction: ':)',
        }),
      })
    )
  })

  it('normalizes QR data URLs to base64 plus mimetype', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => mockJson({ value: 'data:image/jpeg;base64,abc123' }))

    await expect(getQrCode(credentials)).resolves.toEqual({
      value: 'abc123',
      mimetype: 'image/jpeg',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.z-api.io/instances/inst%2F1/token/tok%2F1/qr-code/image',
      expect.objectContaining({
        method: 'GET',
        headers: {
          'Client-Token': 'client-1',
          'Content-Type': 'application/json',
        },
      })
    )
  })

  it('loads instance data and updates all webhooks', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url).endsWith('/me')) {
        return mockJson({ connected: true, phone: '15551234567' })
      }
      return mockJson({ ok: true })
    })

    await expect(getInstance(credentials)).resolves.toMatchObject({
      connected: true,
      phone: '15551234567',
    })

    await updateAllWebhooks({
      credentials,
      url: 'https://crm.example.com/api/whatsapp/webhook?secret=x',
    })

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/update-every-webhooks'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          value: 'https://crm.example.com/api/whatsapp/webhook?secret=x',
          notifySentByMe: false,
        }),
      })
    )
  })
})
