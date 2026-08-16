import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  reprocessFailedDataDeletionInserts: vi.fn(),
  getCronHeartbeat: vi.fn(),
  recordCronHeartbeat: vi.fn(),
  checkCronStaleness: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: h.createClient }))
vi.mock('@/lib/eter/data-deletion', () => ({
  reprocessFailedDataDeletionInserts: h.reprocessFailedDataDeletionInserts,
}))
vi.mock('@/lib/eter/repo/cron-heartbeats.repo', () => ({
  getCronHeartbeat: h.getCronHeartbeat,
  recordCronHeartbeat: h.recordCronHeartbeat,
}))
vi.mock('@/lib/eter/cron-liveness', () => ({
  checkCronStaleness: h.checkCronStaleness,
}))

import { GET } from './route'

const SECRET = 'test-cron-secret'

function req(secret: string | null = SECRET) {
  const headers: Record<string, string> = {}
  if (secret !== null) headers['x-cron-secret'] = secret
  return new Request('http://localhost/api/eter-agent/data-deletion-retries/cron', { headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.AUTOMATION_CRON_SECRET = SECRET
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  h.createClient.mockReturnValue({ marker: 'admin-client' })
  h.reprocessFailedDataDeletionInserts.mockResolvedValue({
    attempted: 0,
    recovered: 0,
    stillFailing: 0,
    gaveUp: 0,
  })
  h.getCronHeartbeat.mockResolvedValue(null)
  h.recordCronHeartbeat.mockResolvedValue(undefined)
  h.checkCronStaleness.mockResolvedValue(undefined)
})

describe('GET /api/eter-agent/data-deletion-retries/cron — auth', () => {
  it('401s on a missing/wrong secret', async () => {
    const res = await GET(req('wrong'))
    expect(res.status).toBe(401)
    expect(h.reprocessFailedDataDeletionInserts).not.toHaveBeenCalled()
  })

  it('503s when AUTOMATION_CRON_SECRET is not configured', async () => {
    delete process.env.AUTOMATION_CRON_SECRET
    const res = await GET(req())
    expect(res.status).toBe(503)
  })
})

describe('GET /api/eter-agent/data-deletion-retries/cron — happy path', () => {
  it('runs the reprocessing sweep, checks staleness, and records a heartbeat', async () => {
    h.reprocessFailedDataDeletionInserts.mockResolvedValue({
      attempted: 2,
      recovered: 1,
      stillFailing: 1,
      gaveUp: 0,
    })

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual(
      expect.objectContaining({ attempted: 2, recovered: 1, stillFailing: 1, gaveUp: 0 }),
    )
    expect(h.reprocessFailedDataDeletionInserts).toHaveBeenCalledWith(
      { marker: 'admin-client' },
      { limit: 50 },
    )
    expect(h.checkCronStaleness).toHaveBeenCalledWith(
      expect.objectContaining({ cronName: 'data-deletion-inserts-reprocess' }),
    )
    expect(h.recordCronHeartbeat).toHaveBeenCalledWith(
      { marker: 'admin-client' },
      'data-deletion-inserts-reprocess',
      expect.any(Object),
    )
  })
})
