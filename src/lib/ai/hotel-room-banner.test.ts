import { expect, it } from 'vitest'
import { roomBannerVariant } from './hotel-room-banner'

it.each([
  [{}, null],
  [{ check_in: '2026-10-26', check_out: '2026-10-28' }, null],
  [{ check_in: '2026-10-26', guests: 2 }, null],
  [{ check_in: '2026-10-26', check_out: '2026-10-28', guests: 2 }, 'weekday'],
  [{ check_in: '2026-10-16', check_out: '2026-10-18', guests: 2 }, 'weekend'],
  [{ check_in: '2026-10-15', check_out: '2026-10-17', guests: 2 }, null],
  [{ check_in: '2026-10-26', check_out: '2026-10-26', guests: 2 }, null],
  [{ check_in: '2026-02-30', check_out: '2026-03-04', guests: 2 }, null],
])('selects only a matching rate sheet after intake: %j', (stay, expected) => {
  expect(roomBannerVariant(stay)).toBe(expected)
})
