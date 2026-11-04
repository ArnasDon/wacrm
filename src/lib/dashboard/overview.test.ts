import { describe, expect, it, vi } from 'vitest'
import {
  bucketDate,
  busiestBucket,
  busiestHours,
  compare,
  loadOverview,
  minutesBetween,
  needsSetup,
  parseOverviewRange,
  ratio,
  setupSteps,
  splitDuration,
  waitTone,
  type SeriesPoint,
} from './overview'

const point = (t: string, incoming: number): SeriesPoint => ({
  t,
  incoming,
  outgoing: 0,
  newConversations: 0,
  resolved: 0,
  dealsWon: 0,
})

describe('parseOverviewRange', () => {
  it('accepts the four supported ranges', () => {
    expect(parseOverviewRange('1')).toBe(1)
    expect(parseOverviewRange('30')).toBe(30)
    expect(parseOverviewRange('90')).toBe(90)
  })

  it('falls back to 7 days for anything else', () => {
    expect(parseOverviewRange(null)).toBe(7)
    expect(parseOverviewRange('14')).toBe(7)
    expect(parseOverviewRange('abc')).toBe(7)
  })
})

describe('compare', () => {
  it('marks an increase as good when higher is better', () => {
    expect(compare(120, 100)).toEqual({ percent: 20, trend: 'up', tone: 'good' })
  })

  it('marks an increase as bad when lower is better', () => {
    expect(compare(6, 4, true)).toEqual({ percent: 50, trend: 'up', tone: 'bad' })
    expect(compare(3, 4, true)).toEqual({ percent: -25, trend: 'down', tone: 'good' })
  })

  it('has no percentage when the previous period was zero', () => {
    expect(compare(5, 0)).toEqual({ percent: null, trend: 'up', tone: 'good' })
  })

  it('is neutral when equal or when either side is missing', () => {
    expect(compare(4, 4)).toEqual({ percent: 0, trend: 'flat', tone: 'neutral' })
    expect(compare(null, 4)).toEqual({ percent: null, trend: 'flat', tone: 'neutral' })
    expect(compare(4, null, true)).toEqual({ percent: null, trend: 'flat', tone: 'neutral' })
  })
})

describe('ratio', () => {
  it('returns null instead of dividing by zero', () => {
    expect(ratio(3, 0)).toBeNull()
    expect(ratio(68, 100)).toBe(0.68)
  })
})

describe('splitDuration', () => {
  it('uses seconds under a minute', () => {
    expect(splitDuration(0.25)).toEqual({ unit: 'seconds', value: 15, remainder: 0 })
  })

  it('keeps one decimal under ten minutes', () => {
    expect(splitDuration(4.24)).toEqual({ unit: 'minutes', value: 4.2, remainder: 0 })
    expect(splitDuration(42.4)).toEqual({ unit: 'minutes', value: 42, remainder: 0 })
  })

  it('splits hours and days with a remainder', () => {
    expect(splitDuration(134)).toEqual({ unit: 'hours', value: 2, remainder: 14 })
    expect(splitDuration(1500)).toEqual({ unit: 'days', value: 1, remainder: 1 })
  })
})

describe('waitTone', () => {
  it('escalates at the target and at three times the target', () => {
    expect(waitTone(4, 5)).toBe('normal')
    expect(waitTone(5, 5)).toBe('warning')
    expect(waitTone(15, 5)).toBe('critical')
  })
})

describe('minutesBetween', () => {
  it('never goes negative for timestamps slightly in the future', () => {
    const now = Date.parse('2026-10-16T12:00:00Z')
    expect(minutesBetween('2026-10-16T11:30:00Z', now)).toBe(30)
    expect(minutesBetween('2026-10-16T12:00:05Z', now)).toBe(0)
  })
})

describe('series helpers', () => {
  const series = [point('2026-10-14T00:00', 3), point('2026-10-15T00:00', 9), point('2026-10-16T00:00', 0)]

  it('finds the busiest bucket by incoming volume', () => {
    expect(busiestBucket(series)?.t).toBe('2026-10-15T00:00')
    expect(busiestBucket([point('2026-10-16T00:00', 0)])).toBeNull()
  })

  it('ranks the busiest hours and skips empty ones', () => {
    const hourly = Array.from({ length: 24 }, () => 0)
    hourly[11] = 30
    hourly[17] = 25
    hourly[9] = 25
    expect(busiestHours(hourly)).toEqual([11, 9])
    expect(busiestHours(Array.from({ length: 24 }, () => 0))).toEqual([])
  })

  it('reads a bucket label as local wall-clock time', () => {
    const d = bucketDate('2026-10-16T13:00')
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 16, 13])
  })
})

describe('setup', () => {
  const base = {
    whatsappConnected: true,
    hasContacts: false,
    hasApprovedTemplate: false,
    memberCount: 1,
    hasConversations: false,
  }

  it('reports each step and where to finish it', () => {
    expect(setupSteps(base).map((s) => [s.id, s.done])).toEqual([
      ['whatsapp', true],
      ['contacts', false],
      ['template', false],
      ['teammate', false],
    ])
  })

  it('shows setup only until the first conversation exists', () => {
    expect(needsSetup(base)).toBe(true)
    expect(needsSetup({ ...base, hasConversations: true })).toBe(false)
  })
})

describe('loadOverview', () => {
  it('calls the RPC with the range and time zone', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { days: 30 }, error: null })
    const result = await loadOverview({ rpc } as never, 30, 'Europe/Vilnius')
    expect(rpc).toHaveBeenCalledWith('dashboard_overview', { p_days: 30, p_tz: 'Europe/Vilnius' })
    expect(result).toEqual({ days: 30 })
  })

  it('throws the RPC error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(loadOverview({ rpc } as never, 7, 'UTC')).rejects.toEqual({ message: 'boom' })
  })
})
