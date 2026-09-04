import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// Punto 10, F-P10-5 — the REAL first barrier, end to end.
//
// Every other webhook test file (route.test.ts, first-inbound-race
// .test.ts, status-update.test.ts) mocks
// `@/lib/whatsapp/webhook-signature` to `() => true` specifically so
// they can focus on message-processing logic — the signature logic
// ITSELF is exhaustively unit-tested, separately, in
// `src/lib/whatsapp/webhook-signature.test.ts`. Neither proves that
// `POST()` is actually WIRED to reject an invalid signature before any
// processing runs. This file is the one that does, using the REAL
// `verifyMetaWebhookSignature` (not mocked) against a REAL HMAC.
// ============================================================

const h = vi.hoisted(() => ({
  runAutomationsForTrigger: vi.fn(),
  dispatchInboundToFlows: vi.fn(),
  dispatchInboundToAiReply: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  fromCalls: [] as string[],
  afterCallbacks: [] as (() => Promise<void> | void)[],
}))

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.afterCallbacks.push(cb)
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      h.fromCalls.push(table)
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
      }
    },
  }),
}))

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: h.runAutomationsForTrigger,
}))
vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: h.dispatchInboundToFlows,
}))
vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: h.dispatchInboundToAiReply,
}))
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: h.dispatchWebhookEvent,
}))
vi.mock('@/lib/whatsapp/template-webhook', () => ({
  isTemplateWebhookField: () => false,
  handleTemplateWebhookChange: vi.fn(),
}))
// webhook-signature.ts is DELIBERATELY left unmocked — this file
// exists specifically to exercise the real one.

import { POST } from './route'

const TEST_SECRET = 'test-app-secret-for-signature-integration'

function sign(rawBody: string): string {
  return 'sha256=' + crypto.createHmac('sha256', TEST_SECRET).update(rawBody).digest('hex')
}

function postRequest(rawBody: string, signatureHeader?: string) {
  const headers: Record<string, string> = {}
  if (signatureHeader !== undefined) headers['x-hub-signature-256'] = signatureHeader
  return new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers,
    body: rawBody,
  })
}

const EMPTY_PAYLOAD = JSON.stringify({ entry: [] })

describe('POST /api/whatsapp/webhook — F-P10-5: real signature integration', () => {
  const originalSecret = process.env.META_APP_SECRET

  beforeEach(() => {
    process.env.META_APP_SECRET = TEST_SECRET
    h.runAutomationsForTrigger.mockReset()
    h.dispatchInboundToFlows.mockReset().mockResolvedValue({ consumed: false })
    h.dispatchInboundToAiReply.mockReset()
    h.dispatchWebhookEvent.mockReset()
    h.fromCalls.length = 0
    h.afterCallbacks.length = 0
  })

  afterEach(() => {
    process.env.META_APP_SECRET = originalSecret
  })

  it('1. valid payload + valid signature → 200, and processing is allowed to proceed (after() is scheduled)', async () => {
    const res = await POST(postRequest(EMPTY_PAYLOAD, sign(EMPTY_PAYLOAD)))
    expect(res.status).toBe(200)
    expect(h.afterCallbacks).toHaveLength(1)
    // Draining the scheduled callback on an empty entry[] payload
    // touches no tables and dispatches nothing — proves the real
    // signature check let a genuinely valid request all the way through
    // without itself doing anything destructive.
    await h.afterCallbacks[0]()
    expect(h.fromCalls).toHaveLength(0)
  })

  it('2. valid payload + INVALID signature → 401, processWebhook() never scheduled, nothing touched', async () => {
    const tamperedSignature = sign('a completely different body')
    const res = await POST(postRequest(EMPTY_PAYLOAD, tamperedSignature))
    expect(res.status).toBe(401)
    expect(h.afterCallbacks).toHaveLength(0)
    expect(h.fromCalls).toHaveLength(0)
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled()
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled()
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled()
    expect(h.dispatchWebhookEvent).not.toHaveBeenCalled()
  })

  it('3. valid payload + MISSING signature header → 401, processWebhook() never scheduled, nothing touched', async () => {
    const res = await POST(postRequest(EMPTY_PAYLOAD, undefined))
    expect(res.status).toBe(401)
    expect(h.afterCallbacks).toHaveLength(0)
    expect(h.fromCalls).toHaveLength(0)
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled()
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled()
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled()
    expect(h.dispatchWebhookEvent).not.toHaveBeenCalled()
  })
})
