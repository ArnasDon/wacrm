import { describe, it, expect } from 'vitest'
import {
  buildSystemPrompt,
  RECORD_RESERVATION_SENTINEL_PREFIX,
} from './defaults'

describe('buildSystemPrompt — hotel reservation marker gate', () => {
  it('teaches RECORD_RESERVATION only in auto_reply mode with hotelReservations on', () => {
    const on = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: true })
    expect(on).toContain(RECORD_RESERVATION_SENTINEL_PREFIX)
    expect(on).toContain('habitaciones, spa, actividades, paquetes, eventos')
  })

  it('never mentions the marker when hotelReservations is off', () => {
    const off = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: false })
    expect(off).not.toContain(RECORD_RESERVATION_SENTINEL_PREFIX)
  })

  it('never mentions the marker in draft mode even for a hotel', () => {
    const draft = buildSystemPrompt({ userPrompt: null, mode: 'draft', hotelReservations: true })
    expect(draft).not.toContain(RECORD_RESERVATION_SENTINEL_PREFIX)
  })
})
