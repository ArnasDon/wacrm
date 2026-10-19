import { describe, expect, it } from 'vitest'
import {
  canAdvanceMessageStatus,
  furthestReachableStatus,
  statusesAdvanceableTo,
} from './message-status'

describe('canAdvanceMessageStatus', () => {
  it('moves forward along sending → sent → delivered → read', () => {
    expect(canAdvanceMessageStatus('sending', 'sent')).toBe(true)
    expect(canAdvanceMessageStatus('sent', 'delivered')).toBe(true)
    expect(canAdvanceMessageStatus('sent', 'read')).toBe(true)
    expect(canAdvanceMessageStatus('delivered', 'read')).toBe(true)
  })

  it('never regresses or repeats a rung', () => {
    expect(canAdvanceMessageStatus('read', 'delivered')).toBe(false)
    expect(canAdvanceMessageStatus('read', 'sent')).toBe(false)
    expect(canAdvanceMessageStatus('delivered', 'delivered')).toBe(false)
  })

  it('accepts failed only before delivery', () => {
    expect(canAdvanceMessageStatus('sending', 'failed')).toBe(true)
    expect(canAdvanceMessageStatus('sent', 'failed')).toBe(true)
    expect(canAdvanceMessageStatus('delivered', 'failed')).toBe(false)
    expect(canAdvanceMessageStatus('read', 'failed')).toBe(false)
  })

  it('treats failed as terminal', () => {
    expect(canAdvanceMessageStatus('failed', 'read')).toBe(false)
    expect(canAdvanceMessageStatus('failed', 'failed')).toBe(false)
  })

  it('refuses statuses outside the messages CHECK constraint', () => {
    expect(canAdvanceMessageStatus('sent', 'deleted')).toBe(false)
    expect(canAdvanceMessageStatus('pending', 'sent')).toBe(false)
  })
})

describe('statusesAdvanceableTo', () => {
  it('lists the current statuses an update may overwrite', () => {
    expect(statusesAdvanceableTo('read')).toEqual(['sending', 'sent', 'delivered'])
    expect(statusesAdvanceableTo('delivered')).toEqual(['sending', 'sent'])
    expect(statusesAdvanceableTo('failed')).toEqual(['sending', 'sent'])
    expect(statusesAdvanceableTo('sending')).toEqual([])
    expect(statusesAdvanceableTo('bogus')).toEqual([])
  })
})

describe('furthestReachableStatus', () => {
  it('folds out-of-order statuses to the furthest valid one', () => {
    expect(furthestReachableStatus('sent', ['read', 'delivered'])).toBe('read')
  })

  it('applies a failure that arrived before the row existed', () => {
    expect(furthestReachableStatus('sent', ['failed'])).toBe('failed')
  })

  it('prefers a success rung over a later-processed failure', () => {
    expect(furthestReachableStatus('sent', ['failed', 'delivered'])).toBe('delivered')
  })

  it('returns null when nothing moves the row', () => {
    expect(furthestReachableStatus('read', ['delivered', 'sent'])).toBeNull()
    expect(furthestReachableStatus('sent', [])).toBeNull()
  })
})
