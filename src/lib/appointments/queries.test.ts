import { describe, it, expect } from 'vitest'
import { describeConflict } from './queries'
import type { AppointmentWithMeta } from './queries'

// ------------------------------------------------------------
// describeConflict — mensajes de error para el API. Test puro
// (no toca DB). Cubre el formato "Overlaps an existing
// appointment (span)" usado por el cliente para el 409.
// ------------------------------------------------------------

function app(partial: Partial<AppointmentWithMeta>): AppointmentWithMeta {
  return {
    id: 'a1',
    account_id: 'acc-1',
    contact_id: 'c1',
    assigned_user_id: 'u1',
    resource_id: null,
    start_at: '2026-08-14T10:00:00.000Z',
    end_at: '2026-08-14T10:30:00.000Z',
    status: 'scheduled',
    notes: null,
    created_at: '2026-08-14T09:00:00.000Z',
    updated_at: '2026-08-14T09:00:00.000Z',
    ...partial,
  }
}

describe('describeConflict', () => {
  it('returns null when there are no conflicts', () => {
    expect(describeConflict([])).toBeNull()
  })

  it('describes the first overlapping appointment with its time span', () => {
    const msg = describeConflict([app({ start_at: '2026-08-14T10:00:00Z', end_at: '2026-08-14T10:30:00Z' })])
    expect(msg).toMatch(/^Overlaps an existing appointment/)
    // en-GB + UTC: "14/08/2026, 10:00:00 – 14/08/2026, 10:30:00"
    expect(msg).toContain('14/08/2026')
    expect(msg).toContain('10:00:00')
  })

  it('returns null when given undefined (defensive)', () => {
    expect(describeConflict(undefined as unknown as AppointmentWithMeta[])).toBeNull()
  })
})
