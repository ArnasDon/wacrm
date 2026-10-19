import type { SupabaseClient } from '@supabase/supabase-js'

export const OVERVIEW_RANGES = [1, 7, 30, 90] as const
export type OverviewRange = (typeof OVERVIEW_RANGES)[number]
export const DEFAULT_OVERVIEW_RANGE: OverviewRange = 7

export interface FailedMessage {
  id: string
  conversationId: string
  contactName: string | null
  contactPhone: string | null
  preview: string | null
  errorCode: number | null
  errorTitle: string | null
  at: string
}

export interface QueueItem {
  conversationId: string
  contactName: string | null
  contactPhone: string | null
  avatarUrl: string | null
  preview: string | null
  waitingSince: string
  windowClosesAt: string
  assignedAgentId: string | null
  handedOff: boolean
}

export interface OverviewAttention {
  waiting: number
  oldestWaitingSince: string | null
  waitingOverTarget: number
  unassigned: number
  windowsClosing: number
  failed: number
  failedMessages: FailedMessage[]
  queue: QueueItem[]
}

export interface TeamMemberStat {
  userId: string
  name: string | null
  avatarUrl: string | null
  role: string | null
  presence: 'online' | 'away' | null
  lastSeenAt: string | null
  open: number
  replies: number
  medianMinutes: number | null
}

export interface OverviewReplies {
  medianHuman: number | null
  medianHumanPrevious: number | null
  team: TeamMemberStat[]
  ai: { replies: number; medianMinutes: number | null }
}

export interface SeriesPoint {
  t: string
  incoming: number
  outgoing: number
  newConversations: number
  resolved: number
  dealsWon: number
}

export interface OverviewVolume {
  series: SeriesPoint[]
  hourly: number[]
}

export interface OverviewKpis {
  newConversations: number
  newConversationsPrevious: number
  resolved: number
  resolvedPrevious: number
  dealsWon: number
  dealsWonPrevious: number
  dealsWonValue: number
  broadcastDelivered: number
  broadcastRead: number
  broadcastDeliveredPrevious: number
  broadcastReadPrevious: number
}

export interface PipelineStageStat {
  id: string
  pipelineId: string
  name: string
  color: string
  dealCount: number
  totalValue: number
}

export interface PipelineStats {
  pipelineId: string
  won: number
  lost: number
  avgDaysToWin: number | null
  idleDeals: number
}

export interface OverviewPipeline {
  pipelines: { id: string; name: string }[]
  stages: PipelineStageStat[]
  stats: PipelineStats[]
}

export interface LatestBroadcast {
  id: string
  name: string
  status: string
  at: string
  recipients: number
  delivered: number
  read: number
  replied: number
  failed: number
}

export interface OverviewCampaigns {
  latestBroadcast: LatestBroadcast | null
  automationRuns: number
  automationFailed: number
  flowFailed: number
  topFailingFlow: { id: string; name: string; failed: number } | null
  templatesApproved: number
  templatesRejected: number
}

export interface OverviewSetup {
  whatsappConnected: boolean
  hasContacts: boolean
  hasApprovedTemplate: boolean
  memberCount: number
  hasConversations: boolean
}

export interface DashboardOverview {
  generatedAt: string
  timeZone: string
  days: OverviewRange
  unit: 'hour' | 'day'
  periodStart: string
  previousStart: string
  previousEnd: string
  replyTargetMinutes: number
  attention: OverviewAttention
  replies: OverviewReplies
  volume: OverviewVolume
  kpis: OverviewKpis
  pipeline: OverviewPipeline
  campaigns: OverviewCampaigns
  setup: OverviewSetup
}

export function isOverviewRange(value: number): value is OverviewRange {
  return (OVERVIEW_RANGES as readonly number[]).includes(value)
}

export function parseOverviewRange(raw: string | null | undefined): OverviewRange {
  const n = Number(raw)
  return isOverviewRange(n) ? n : DEFAULT_OVERVIEW_RANGE
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export async function loadOverview(
  db: SupabaseClient,
  days: OverviewRange,
  timeZone: string,
): Promise<DashboardOverview> {
  const { data, error } = await db.rpc('dashboard_overview', { p_days: days, p_tz: timeZone })
  if (error) throw error
  return data as DashboardOverview
}

export type Trend = 'up' | 'down' | 'flat'
export type TrendTone = 'good' | 'bad' | 'neutral'

export interface Change {
  percent: number | null
  trend: Trend
  tone: TrendTone
}

export function compare(
  current: number | null,
  previous: number | null,
  lowerIsBetter = false,
): Change {
  if (current == null || previous == null) return { percent: null, trend: 'flat', tone: 'neutral' }
  if (current === previous) return { percent: 0, trend: 'flat', tone: 'neutral' }
  const trend: Trend = current > previous ? 'up' : 'down'
  const improved = lowerIsBetter ? current < previous : current > previous
  const percent = previous === 0 ? null : Math.round(((current - previous) / previous) * 100)
  return { percent, trend, tone: improved ? 'good' : 'bad' }
}

export function ratio(part: number, whole: number): number | null {
  if (!whole) return null
  return part / whole
}

export function minutesBetween(fromIso: string, now: number): number {
  return Math.max(0, (now - new Date(fromIso).getTime()) / 60_000)
}

export interface DurationParts {
  unit: 'seconds' | 'minutes' | 'hours' | 'days'
  value: number
  remainder: number
}

export function splitDuration(minutes: number): DurationParts {
  if (minutes < 1) return { unit: 'seconds', value: Math.round(minutes * 60), remainder: 0 }
  if (minutes < 60) {
    const value = minutes < 10 ? Math.round(minutes * 10) / 10 : Math.round(minutes)
    return { unit: 'minutes', value, remainder: 0 }
  }
  if (minutes < 1440) {
    const total = Math.round(minutes)
    return { unit: 'hours', value: Math.floor(total / 60), remainder: total % 60 }
  }
  const hours = Math.round(minutes / 60)
  return { unit: 'days', value: Math.floor(hours / 24), remainder: hours % 24 }
}

export type WaitTone = 'critical' | 'warning' | 'normal'

export function waitTone(waitedMinutes: number, targetMinutes: number): WaitTone {
  if (waitedMinutes >= targetMinutes * 3) return 'critical'
  if (waitedMinutes >= targetMinutes) return 'warning'
  return 'normal'
}

export function seriesValues(
  series: SeriesPoint[],
  key: keyof Omit<SeriesPoint, 't'>,
): number[] {
  return series.map((p) => p[key])
}

export function busiestBucket(series: SeriesPoint[]): SeriesPoint | null {
  let best: SeriesPoint | null = null
  for (const p of series) {
    if (p.incoming > 0 && (!best || p.incoming > best.incoming)) best = p
  }
  return best
}

export function busiestHours(hourly: number[], take = 2): number[] {
  return hourly
    .map((count, hour) => ({ count, hour }))
    .filter((h) => h.count > 0)
    .sort((a, b) => b.count - a.count || a.hour - b.hour)
    .slice(0, take)
    .map((h) => h.hour)
}

export function bucketDate(t: string): Date {
  const [date, time = '00:00'] = t.split('T')
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm)
}

export interface SetupStep {
  id: 'whatsapp' | 'contacts' | 'template' | 'teammate'
  done: boolean
  href: string
}

export function setupSteps(setup: OverviewSetup): SetupStep[] {
  return [
    { id: 'whatsapp', done: setup.whatsappConnected, href: '/settings?tab=whatsapp' },
    { id: 'contacts', done: setup.hasContacts, href: '/contacts' },
    { id: 'template', done: setup.hasApprovedTemplate, href: '/settings?tab=templates' },
    { id: 'teammate', done: setup.memberCount > 1, href: '/settings?tab=members' },
  ]
}

export function needsSetup(setup: OverviewSetup): boolean {
  return !setup.hasConversations
}
