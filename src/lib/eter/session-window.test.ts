import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({ getLastInboundMessageAt: vi.fn() }))
vi.mock('./repo/messages.repo', () => ({ getLastInboundMessageAt: h.getLastInboundMessageAt }))

import { isWithinSessionWindow } from './session-window'

const db = {} as SupabaseClient

describe('isWithinSessionWindow', () => {
  it('is false when the lead has never sent an inbound message', async () => {
    h.getLastInboundMessageAt.mockResolvedValue(null)
    expect(await isWithinSessionWindow(db, 'conv-1')).toBe(false)
  })

  it('is true just under 24h since the last inbound message', async () => {
    const now = new Date('2026-08-20T12:00:00Z')
    h.getLastInboundMessageAt.mockResolvedValue(new Date('2026-08-19T13:00:00Z'))
    expect(await isWithinSessionWindow(db, 'conv-1', now)).toBe(true)
  })

  it('is false exactly at / past the 24h boundary', async () => {
    const now = new Date('2026-08-20T12:00:00Z')
    h.getLastInboundMessageAt.mockResolvedValue(new Date('2026-08-19T12:00:00Z'))
    expect(await isWithinSessionWindow(db, 'conv-1', now)).toBe(false)
  })
})
