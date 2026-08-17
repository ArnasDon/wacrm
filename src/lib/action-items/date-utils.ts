// Week-window math for "Follow-ups da Semana" (AGENTS.md §3/§4/§18).
// Deliberately separate from src/lib/dashboard/date-utils.ts — that
// file's WEEK_DAY_OFFSETS excludes Sunday on purpose (Agenda-specific:
// no Sunday column shown), which is the wrong week boundary here. A
// follow-up dated Sunday must still count as "this week". Reuses the
// same local-day primitives from that file for consistency though.
import { localDayKey, startOfLocalDay } from '@/lib/dashboard/date-utils';

/** Local-day key (YYYY-MM-DD) of the Sunday closing the Monday-start
 *  calendar week containing `d`. Follow-ups due on or before this date
 *  belong in the Central's weekly view; anything after it is a future
 *  week and stays on the Pipeline only. */
export function getCurrentWeekEndKey(d: Date = new Date()): string {
  const jsDow = d.getDay(); // 0 = Sunday … 6 = Saturday
  const mondayOffset = (jsDow + 6) % 7; // 0 = Monday … 6 = Sunday
  const sunday = startOfLocalDay(d);
  sunday.setDate(sunday.getDate() + (6 - mondayOffset));
  return localDayKey(sunday);
}

export function isOverdue(dueDateKey: string, todayKey: string = localDayKey(new Date())): boolean {
  return dueDateKey < todayKey;
}

export function isToday(dueDateKey: string, todayKey: string = localDayKey(new Date())): boolean {
  return dueDateKey === todayKey;
}

export { localDayKey };
