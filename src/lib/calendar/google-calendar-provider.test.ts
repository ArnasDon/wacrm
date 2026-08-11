import { describe, expect, it } from 'vitest';
import { toGoogleEvent } from './google-calendar-provider';
import type { CalendarEvent } from './calendar-event';

describe('toGoogleEvent', () => {
  it('maps a timed event to dateTime + the server timezone', () => {
    const event: CalendarEvent = {
      title: 'Visita ao imóvel',
      description: 'Levar as chaves',
      startAt: '2026-03-10T14:30:00',
      endAt: '2026-03-10T15:00:00',
      allDay: false,
    };
    const result = toGoogleEvent(event);
    expect(result.summary).toBe('Visita ao imóvel');
    expect(result.description).toBe('Levar as chaves');
    expect(result.start).toEqual({
      dateTime: '2026-03-10T14:30:00',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    expect(result.end).toEqual({
      dateTime: '2026-03-10T15:00:00',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it('defaults a 1h duration when endAt is missing, in the same local wall-clock (not UTC-shifted)', () => {
    const event: CalendarEvent = {
      title: 'Ligação',
      description: null,
      startAt: '2026-03-10T09:00:00',
      endAt: null,
      allDay: false,
    };
    const result = toGoogleEvent(event);
    // Regression check: a naive round-trip through .toISOString() would
    // shift this by the server's UTC offset instead of staying exactly
    // 1h after the (local) start — see toLocalIsoString's doc comment.
    expect(result.end).toEqual({
      dateTime: '2026-03-10T10:00:00',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it('maps an all-day event to a date-only, end-exclusive range with no timeZone', () => {
    const event: CalendarEvent = {
      title: 'Fechamento de contrato',
      description: null,
      startAt: '2026-03-10T00:00:00',
      endAt: null,
      allDay: true,
    };
    const result = toGoogleEvent(event);
    expect(result.start).toEqual({ date: '2026-03-10' });
    // Google's all-day `end` is exclusive: a single-day event ends the
    // *next* calendar day.
    expect(result.end).toEqual({ date: '2026-03-11' });
  });

  it('omits description entirely (not null) when the event has none', () => {
    const event: CalendarEvent = {
      title: 'Sem descrição',
      description: null,
      startAt: '2026-03-10T09:00:00',
      endAt: '2026-03-10T09:30:00',
      allDay: false,
    };
    const result = toGoogleEvent(event);
    expect(result.description).toBeUndefined();
  });
});
