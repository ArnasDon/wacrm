// Shared result shapes the dashboard's 4 KPI cards consume.

export interface LeadsTodayMetric {
  current: number
  previous: number
}

export interface FirstResponseMetric {
  /** Average minutes from a customer's first message in a conversation
   *  to the first subsequent agent/bot reply, over the trailing
   *  7-day window. Null when there are no paired samples yet. */
  avgMinutes: number | null
  sampleCount: number
}
