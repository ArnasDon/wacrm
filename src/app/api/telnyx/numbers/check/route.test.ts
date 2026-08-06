import { beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/telnyx/numbers/check — valida número E.164 + lookup/reputación.
// agent+. Mockeamos requireRole (ctx.accountId) y la lib telnyx.

let callerRole = 'agent'
let lookupResult: { carrier: unknown; line_type: string | null } | null = null
let lookupError: Error | null = null
let reputationResult: { spam_risk: string | null; maturity_score: number | null; connection_score: number | null; engagement_score: number | null } | null = null
let reputationError: Error | null = null

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    requireRole: vi.fn(async () => ({ accountId: 'acct-1', accountRole: callerRole })),
  }
})

const lookupNumber = vi.fn(async (_n: string) => {
  if (lookupError) throw lookupError
  return lookupResult
})
const getReputation = vi.fn(async (_n: string) => {
  if (reputationError) throw reputationError
  return reputationResult
})
vi.mock('@/lib/telnyx/api', () => ({
  createTelnyxClient: vi.fn(() => ({ lookupNumber, getReputation })),
  loadTelnyxApiKey: vi.fn(async () => 'key-1'),
  reputationScore: (r: {
    spam_risk?: string | null
    maturity_score?: number | null
    connection_score?: number | null
    engagement_score?: number | null
  } | null) => {
    if (!r) return null
    if (r.spam_risk === 'high') return 20
    const scores = [r.maturity_score, r.connection_score, r.engagement_score].filter(
      (s): s is number => typeof s === 'number',
    )
    if (scores.length === 0) return null
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
  },
}))

import { POST } from './route'

function post(body: unknown) {
  const req = new Request('http://localhost/api/telnyx/numbers/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req as Parameters<typeof POST>[0])
}

beforeEach(() => {
  callerRole = 'agent'
  lookupResult = null
  lookupError = null
  reputationResult = null
  reputationError = null
  vi.clearAllMocks()
})

describe('POST /api/telnyx/numbers/check', () => {
  it('400 sin número', async () => {
    const res = await post({})
    expect(res.status).toBe(400)
  })

  it('400 con número no-E.164', async () => {
    const res = await post({ number: '12345' })
    expect(res.status).toBe(400)
  })

  it('devuelve carrier/line_type del lookup y score de reputación', async () => {
    lookupResult = { carrier: { name: 'Telnyx Wireless' }, line_type: 'Wireless' }
    reputationResult = { spam_risk: 'low', maturity_score: 72, connection_score: 80, engagement_score: 64 }

    const res = await post({ number: '+15550001111' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.number).toBe('+15550001111')
    expect(json.carrier).toBe('Telnyx Wireless')
    expect(json.line_type).toBe('Wireless')
    expect(json.score).toBe(72) // promedio (72+80+64)/3 = 72
    expect(json.blocked).toBe(false)
    expect(lookupNumber).toHaveBeenCalledWith('+15550001111')
    expect(getReputation).toHaveBeenCalledWith('+15550001111')
  })

  it('spam_risk high → score 20 → blocked true', async () => {
    lookupResult = { carrier: null, line_type: null }
    reputationResult = { spam_risk: 'high', maturity_score: null, connection_score: null, engagement_score: null }

    const res = await post({ number: '+15552223333' })
    const json = await res.json()
    expect(json.score).toBe(20)
    expect(json.blocked).toBe(true)
  })

  it('sin reputación → score null → no bloquea', async () => {
    const res = await post({ number: '+15554445555' })
    const json = await res.json()
    expect(json.score).toBeNull()
    expect(json.blocked).toBe(false)
  })

  it('error 5xx del lookup se propaga (no se traga)', async () => {
    lookupError = Object.assign(new Error('upstream'), { status: 502 })
    const res = await post({ number: '+15556667777' })
    expect(res.status).not.toBe(200)
  })
})
