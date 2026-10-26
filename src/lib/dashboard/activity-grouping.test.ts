import { describe, expect, it } from 'vitest'
import { groupInboundMessages } from './activity-grouping'

describe('groupInboundMessages', () => {
  it('collapses messages from the same conversation into one entry', () => {
    const groups = groupInboundMessages([
      { id: 'm4', conversationId: 'c1', who: 'Arnas', at: '2026-10-16T10:04:00Z' },
      { id: 'm3', conversationId: 'c2', who: 'Maria', at: '2026-10-16T10:03:00Z' },
      { id: 'm2', conversationId: 'c1', who: 'Arnas', at: '2026-10-16T10:02:00Z' },
      { id: 'm1', conversationId: 'c1', who: 'Arnas', at: '2026-10-16T10:01:00Z' },
    ])
    expect(groups).toEqual([
      { id: 'm4', conversationId: 'c1', who: 'Arnas', at: '2026-10-16T10:04:00Z', count: 3 },
      { id: 'm3', conversationId: 'c2', who: 'Maria', at: '2026-10-16T10:03:00Z', count: 1 },
    ])
  })

  it('keeps the newest timestamp even when rows arrive out of order', () => {
    const [group] = groupInboundMessages([
      { id: 'old', conversationId: 'c1', who: 'A', at: '2026-10-16T09:00:00Z' },
      { id: 'new', conversationId: 'c1', who: 'A', at: '2026-10-16T11:00:00Z' },
    ])
    expect(group).toMatchObject({ id: 'new', at: '2026-10-16T11:00:00Z', count: 2 })
  })

  it('returns nothing for no messages', () => {
    expect(groupInboundMessages([])).toEqual([])
  })
})
