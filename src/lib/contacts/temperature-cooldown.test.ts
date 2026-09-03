import { describe, expect, it } from 'vitest'
import { coolerTemperature, decideCoolDown } from './temperature-cooldown'

const NOW = new Date('2026-09-02T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

describe('coolerTemperature', () => {
  it('steps one notch down', () => {
    expect(coolerTemperature('hot')).toBe('warm')
    expect(coolerTemperature('warm')).toBe('cold')
  })
})

describe('decideCoolDown', () => {
  it('cools a hot lead that has been silent and stable past the window', () => {
    const d = decideCoolDown({
      current: 'hot',
      lastActivityAt: daysAgo(20),
      temperatureUpdatedAt: daysAgo(20),
      now: NOW,
      cooldownDays: 14,
    })
    expect(d).toEqual({ from: 'hot', to: 'warm' })
  })

  it('cools warm → cold', () => {
    const d = decideCoolDown({
      current: 'warm',
      lastActivityAt: daysAgo(30),
      temperatureUpdatedAt: daysAgo(30),
      now: NOW,
      cooldownDays: 14,
    })
    expect(d).toEqual({ from: 'warm', to: 'cold' })
  })

  it('never touches a cold or unclassified lead', () => {
    expect(
      decideCoolDown({
        current: 'cold',
        lastActivityAt: daysAgo(90),
        temperatureUpdatedAt: daysAgo(90),
        now: NOW,
        cooldownDays: 14,
      }),
    ).toBeNull()
    expect(
      decideCoolDown({
        current: null,
        lastActivityAt: daysAgo(90),
        temperatureUpdatedAt: null,
        now: NOW,
        cooldownDays: 14,
      }),
    ).toBeNull()
  })

  it('waits while the thread is still active', () => {
    const d = decideCoolDown({
      current: 'hot',
      lastActivityAt: daysAgo(3),
      temperatureUpdatedAt: daysAgo(40),
      now: NOW,
      cooldownDays: 14,
    })
    expect(d).toBeNull()
  })

  it('gives a freshly (re)classified lead its own grace period', () => {
    // Silent for ages, but the temperature was just set 2 days ago.
    const d = decideCoolDown({
      current: 'hot',
      lastActivityAt: daysAgo(60),
      temperatureUpdatedAt: daysAgo(2),
      now: NOW,
      cooldownDays: 14,
    })
    expect(d).toBeNull()
  })

  it('falls back to lastActivity when the stability clock is missing', () => {
    const d = decideCoolDown({
      current: 'warm',
      lastActivityAt: daysAgo(20),
      temperatureUpdatedAt: null,
      now: NOW,
      cooldownDays: 14,
    })
    expect(d).toEqual({ from: 'warm', to: 'cold' })
  })

  it('cools a lead that has no activity on record at all', () => {
    const d = decideCoolDown({
      current: 'hot',
      lastActivityAt: null,
      temperatureUpdatedAt: null,
      now: NOW,
      cooldownDays: 14,
    })
    expect(d).toEqual({ from: 'hot', to: 'warm' })
  })

  it('treats a zero/negative cooldown as disabled', () => {
    expect(
      decideCoolDown({
        current: 'hot',
        lastActivityAt: daysAgo(90),
        temperatureUpdatedAt: daysAgo(90),
        now: NOW,
        cooldownDays: 0,
      }),
    ).toBeNull()
  })

  it('accepts Date instances as well as ISO strings', () => {
    const d = decideCoolDown({
      current: 'hot',
      lastActivityAt: new Date(NOW.getTime() - 20 * 86_400_000),
      temperatureUpdatedAt: new Date(NOW.getTime() - 20 * 86_400_000),
      now: NOW,
      cooldownDays: 14,
    })
    expect(d).toEqual({ from: 'hot', to: 'warm' })
  })
})
