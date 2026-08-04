/**
 * Provider-agnostic shape a CalendarProvider needs to create/update
 * an external event. Deliberately small — extend as real providers
 * are added, not speculatively now.
 */
export interface CalendarEvent {
  title: string;
  description: string | null;
  /** ISO 8601 local instant (no timezone suffix — the account's own
   *  timezone is assumed, same as everywhere else in the app). */
  startAt: string;
  /** Null until the agenda has a real duration model; providers
   *  should default a reasonable length (e.g. 1h) when absent. */
  endAt: string | null;
  allDay: boolean;
}
