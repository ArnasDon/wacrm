import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import webpush from 'web-push'

// ============================================================
// Types & Interfaces (Strict TypeScript)
// ============================================================

export interface StuckScheduledSendRow {
  id: string
  account_id: string
  contact_id: string
  send_at: string
  template_name: string
}

export interface StuckAutomationExecutionRow {
  id: string
  account_id: string
  automation_id: string
  contact_id: string | null
  run_at: string
}

export interface PausedEnvioLoteRow {
  id: string
  envio_id: string
  numero_lote: number
  quantidade_leads: number
  status: string
}

export interface StuckConversationRow {
  id: string
  account_id: string
  contact_id: string
  status: string
  assigned_agent_id: string | null
  ai_transfer_status: string | null
  ai_transfer_at: string | null
  ai_reply_count: number | null
  updated_at: string
}

export interface GhostDealRow {
  id: string
  account_id: string
  pipeline_id: string
  stage_id: string
  title: string
  value: number
  created_at: string
}

export interface AdminProfileRow {
  user_id: string
  account_id: string | null
  full_name: string
  email: string
}

export interface PushSubscriptionRow {
  id: string
  user_id: string
  account_id: string
  endpoint: string
  p256dh: string
  auth_key: string
}

export interface SentinelaNotificationAction {
  action: 'fix_auto' | 'open_dashboard'
  title: string
}

export interface SentinelaPushPayload {
  title: string
  body: string
  url: string
  tag: string
  actions: SentinelaNotificationAction[]
  data: {
    url: string
    actionToken: string
    summary: {
      scheduledSends: number
      automationExecutions: number
      pausedLotes: number
      stuckConversations: number
      ghostDeals: number
      totalAnomalies: number
    }
  }
}

export interface SentinelaCronResponse {
  ok: boolean
  checkedAt: string
  anomaliesFound: boolean
  totalAnomalies: number
  breakdown: {
    queues: {
      scheduledSendsStuck: number
      automationsStuck: number
      envioLotesPaused: number
      total: number
    }
    aiClara: {
      pendingHumanTimeout: number
      replyLimitUnassigned: number
      total: number
    }
    ghosts: {
      dealsWithoutContact: number
      total: number
    }
  }
  push: {
    triggered: boolean
    adminUsersMatched: number
    subscriptionsTargeted: number
    sent: number
    pruned: number
  }
  queryErrors: string[]
}

// ============================================================
// Constants & Helpers
// ============================================================

const ADMIN_EMAIL_DEFAULT = 'ronaldomeiracorretor@gmail.com'
const ADMIN_NAME_PATTERN = '%Ronaldo Meira%'

const SCHEDULED_SENDS_MAX_DELAY_MS = 15 * 60 * 1000 // 15 minutes
const AUTOMATIONS_MAX_DELAY_MS = 10 * 60 * 1000 // 10 minutes
const AI_HANDOFF_MAX_DELAY_MS = 10 * 60 * 1000 // 10 minutes
const AI_REPLY_SAFETY_LIMIT = 8

let _adminClient: SupabaseClient | null = null

function getSupabaseServiceClient(): SupabaseClient {
  if (_adminClient) return _adminClient

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  _adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  return _adminClient
}

let _vapidReady = false

function configureVapid(): boolean {
  if (_vapidReady) return true
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT

  if (!publicKey || !privateKey || !subject) {
    return false
  }

  webpush.setVapidDetails(subject, publicKey, privateKey)
  _vapidReady = true
  return true
}

function getExpectedCronSecret(): string | null {
  return process.env.CRON_SECRET || process.env.AUTOMATION_CRON_SECRET || null
}

function isAuthorizedRequest(request: Request, expectedSecret: string): boolean {
  const authHeader = request.headers.get('authorization') ?? ''
  const cronHeader = request.headers.get('x-cron-secret') ?? ''

  const tokenFromBearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : authHeader.trim()

  const candidate = tokenFromBearer || cronHeader
  if (!candidate) return false

  const candidateBuf = Buffer.from(candidate)
  const expectedBuf = Buffer.from(expectedSecret)

  if (candidateBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(candidateBuf, expectedBuf)
}

// ============================================================
// GET /api/sentinela/cron
// ============================================================

export async function GET(request: Request): Promise<NextResponse> {
  const expectedSecret = getExpectedCronSecret()
  if (!expectedSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured on the server' },
      { status: 503 },
    )
  }

  if (!isAuthorizedRequest(request, expectedSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let db: SupabaseClient
  try {
    db = getSupabaseServiceClient()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Supabase initialization failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const now = Date.now()
  const checkedAt = new Date(now).toISOString()
  const fifteenMinAgoIso = new Date(now - SCHEDULED_SENDS_MAX_DELAY_MS).toISOString()
  const tenMinAgoIso = new Date(now - AUTOMATIONS_MAX_DELAY_MS).toISOString()
  const aiTenMinAgoIso = new Date(now - AI_HANDOFF_MAX_DELAY_MS).toISOString()

  const queryErrors: string[] = []

  // ------------------------------------------------------------
  // A) Filas travadas:
  //    1. scheduled_sends (status = 'pending' AND send_at < NOW() - 15m)
  //    2. automation_pending_executions (status = 'pending' AND run_at < NOW() - 10m)
  //    3. envio_lotes (status = 'pausado')
  // ------------------------------------------------------------
  let stuckScheduledSends: StuckScheduledSendRow[] = []
  try {
    const { data, error } = await db
      .from('scheduled_sends')
      .select('id, account_id, contact_id, send_at, template_name')
      .eq('status', 'pending')
      .lt('send_at', fifteenMinAgoIso)

    if (error) {
      queryErrors.push(`scheduled_sends: ${error.message}`)
    } else {
      stuckScheduledSends = (data ?? []) as StuckScheduledSendRow[]
    }
  } catch (err) {
    queryErrors.push(
      `scheduled_sends exception: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  let stuckAutomations: StuckAutomationExecutionRow[] = []
  try {
    const { data, error } = await db
      .from('automation_pending_executions')
      .select('id, account_id, automation_id, contact_id, run_at')
      .eq('status', 'pending')
      .lt('run_at', tenMinAgoIso)

    if (error) {
      queryErrors.push(`automation_pending_executions: ${error.message}`)
    } else {
      stuckAutomations = (data ?? []) as StuckAutomationExecutionRow[]
    }
  } catch (err) {
    queryErrors.push(
      `automation_pending_executions exception: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  let pausedLotes: PausedEnvioLoteRow[] = []
  try {
    const { data, error } = await db
      .from('envio_lotes')
      .select('id, envio_id, numero_lote, quantidade_leads, status')
      .eq('status', 'pausado')

    if (error) {
      queryErrors.push(`envio_lotes: ${error.message}`)
    } else {
      pausedLotes = (data ?? []) as PausedEnvioLoteRow[]
    }
  } catch (err) {
    queryErrors.push(
      `envio_lotes exception: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // ------------------------------------------------------------
  // B) IA / Clara travada:
  //    1. conversations com ai_transfer_status = 'pending_human' há > 10m
  //    2. conversations com ai_reply_count >= 8 e assigned_agent_id IS NULL
  // ------------------------------------------------------------
  let pendingHumanStuck: StuckConversationRow[] = []
  try {
    const { data, error } = await db
      .from('conversations')
      .select(
        'id, account_id, contact_id, status, assigned_agent_id, ai_transfer_status, ai_transfer_at, ai_reply_count, updated_at',
      )
      .neq('status', 'closed')
      .eq('ai_transfer_status', 'pending_human')
      .or(`ai_transfer_at.lt.${aiTenMinAgoIso},and(ai_transfer_at.is.null,updated_at.lt.${aiTenMinAgoIso})`)

    if (error) {
      queryErrors.push(`conversations (pending_human): ${error.message}`)
    } else {
      pendingHumanStuck = (data ?? []) as StuckConversationRow[]
    }
  } catch (err) {
    queryErrors.push(
      `conversations (pending_human) exception: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  let replyLimitStuck: StuckConversationRow[] = []
  try {
    const { data, error } = await db
      .from('conversations')
      .select(
        'id, account_id, contact_id, status, assigned_agent_id, ai_transfer_status, ai_transfer_at, ai_reply_count, updated_at',
      )
      .neq('status', 'closed')
      .gte('ai_reply_count', AI_REPLY_SAFETY_LIMIT)
      .is('assigned_agent_id', null)

    if (error) {
      queryErrors.push(`conversations (ai_reply_count): ${error.message}`)
    } else {
      replyLimitStuck = (data ?? []) as StuckConversationRow[]
    }
  } catch (err) {
    queryErrors.push(
      `conversations (ai_reply_count) exception: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const uniqueStuckConversationIds = new Set<string>([
    ...pendingHumanStuck.map((c) => c.id),
    ...replyLimitStuck.map((c) => c.id),
  ])

  // ------------------------------------------------------------
  // C) Fantasmas:
  //    deals com contact_id IS NULL
  // ------------------------------------------------------------
  let ghostDeals: GhostDealRow[] = []
  try {
    const { data, error } = await db
      .from('deals')
      .select('id, account_id, pipeline_id, stage_id, title, value, created_at')
      .is('contact_id', null)

    if (error) {
      queryErrors.push(`deals (ghosts): ${error.message}`)
    } else {
      ghostDeals = (data ?? []) as GhostDealRow[]
    }
  } catch (err) {
    queryErrors.push(
      `deals (ghosts) exception: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // ------------------------------------------------------------
  // Consolidate Metrics
  // ------------------------------------------------------------
  const queuesCount =
    stuckScheduledSends.length + stuckAutomations.length + pausedLotes.length
  const aiClaraCount = uniqueStuckConversationIds.size
  const ghostsCount = ghostDeals.length
  const totalAnomalies = queuesCount + aiClaraCount + ghostsCount
  const anomaliesFound = totalAnomalies > 0

  // ------------------------------------------------------------
  // D) Disparo de Web Push EXCLUSIVO para o Administrador (Ronaldo Meira)
  // ------------------------------------------------------------
  let pushTriggered = false
  let adminUsersMatched = 0
  let subscriptionsTargeted = 0
  let pushSent = 0
  let pushPruned = 0

  if (anomaliesFound) {
    try {
      const configuredAdminEmail = process.env.SENTINELA_ADMIN_EMAIL || ADMIN_EMAIL_DEFAULT
      const configuredAdminUserId = process.env.SENTINELA_ADMIN_USER_ID || null

      // Resolve exclusively Ronaldo Meira's user_id from profiles
      const { data: adminProfiles, error: profileErr } = await db
        .from('profiles')
        .select('user_id, account_id, full_name, email')
        .or(`email.ilike.${configuredAdminEmail},full_name.ilike.${ADMIN_NAME_PATTERN}`)

      if (profileErr) {
        queryErrors.push(`profiles (admin lookup): ${profileErr.message}`)
      }

      const adminUserIds = new Set<string>()
      if (configuredAdminUserId) {
        adminUserIds.add(configuredAdminUserId)
      }
      for (const profile of (adminProfiles ?? []) as AdminProfileRow[]) {
        const isRonaldoEmail =
          profile.email.toLowerCase() === configuredAdminEmail.toLowerCase()
        const isRonaldoName = profile.full_name.toLowerCase().includes('ronaldo')
        if (isRonaldoEmail || isRonaldoName) {
          adminUserIds.add(profile.user_id)
        }
      }

      adminUsersMatched = adminUserIds.size

      if (adminUserIds.size > 0 && configureVapid()) {
        const { data: subs, error: subsErr } = await db
          .from('push_subscriptions')
          .select('id, user_id, account_id, endpoint, p256dh, auth_key')
          .in('user_id', Array.from(adminUserIds))

        if (subsErr) {
          queryErrors.push(`push_subscriptions: ${subsErr.message}`)
        } else if (subs && subs.length > 0) {
          const typedSubs = subs as PushSubscriptionRow[]
          subscriptionsTargeted = typedSubs.length
          pushTriggered = true

          const bodyParts: string[] = []
          if (queuesCount > 0) bodyParts.push(`${queuesCount} fila(s) travada(s)`)
          if (aiClaraCount > 0) bodyParts.push(`${aiClaraCount} conversa(s) IA/Clara`)
          if (ghostsCount > 0) bodyParts.push(`${ghostsCount} deal(s) fantasma(s)`)

          const notificationPayload: SentinelaPushPayload = {
            title: '🚨 Sentinela CRM: Falhas Detectadas',
            body: `${totalAnomalies} anomalia(s): ${bodyParts.join(' • ')}`,
            url: '/sentinela',
            tag: 'sentinela-crm-alert',
            actions: [
              { action: 'fix_auto', title: 'Reprocessar Filas e IA' },
              { action: 'open_dashboard', title: 'Ver Diagnóstico' },
            ],
            data: {
              url: '/sentinela',
              actionToken: expectedSecret,
              summary: {
                scheduledSends: stuckScheduledSends.length,
                automationExecutions: stuckAutomations.length,
                pausedLotes: pausedLotes.length,
                stuckConversations: aiClaraCount,
                ghostDeals: ghostsCount,
                totalAnomalies,
              },
            },
          }

          const staleSubscriptionIds: string[] = []

          await Promise.all(
            typedSubs.map(async (sub) => {
              try {
                await webpush.sendNotification(
                  {
                    endpoint: sub.endpoint,
                    keys: {
                      p256dh: sub.p256dh,
                      auth: sub.auth_key,
                    },
                  },
                  JSON.stringify(notificationPayload),
                )
                pushSent += 1
              } catch (pushErr: unknown) {
                const statusCode = (pushErr as { statusCode?: number })?.statusCode
                if (statusCode === 404 || statusCode === 410) {
                  staleSubscriptionIds.push(sub.id)
                } else {
                  console.error('[sentinela/cron] Web Push send error:', pushErr)
                }
              }
            }),
          )

          if (staleSubscriptionIds.length > 0) {
            await db.from('push_subscriptions').delete().in('id', staleSubscriptionIds)
            pushPruned = staleSubscriptionIds.length
          }
        }
      }
    } catch (err) {
      queryErrors.push(
        `push dispatch exception: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const responsePayload: SentinelaCronResponse = {
    ok: true,
    checkedAt,
    anomaliesFound,
    totalAnomalies,
    breakdown: {
      queues: {
        scheduledSendsStuck: stuckScheduledSends.length,
        automationsStuck: stuckAutomations.length,
        envioLotesPaused: pausedLotes.length,
        total: queuesCount,
      },
      aiClara: {
        pendingHumanTimeout: pendingHumanStuck.length,
        replyLimitUnassigned: replyLimitStuck.length,
        total: aiClaraCount,
      },
      ghosts: {
        dealsWithoutContact: ghostsCount,
        total: ghostsCount,
      },
    },
    push: {
      triggered: pushTriggered,
      adminUsersMatched,
      subscriptionsTargeted,
      sent: pushSent,
      pruned: pushPruned,
    },
    queryErrors,
  }

  return NextResponse.json(responsePayload, { status: 200 })
}
