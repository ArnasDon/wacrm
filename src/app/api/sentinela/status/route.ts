import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

// ============================================================
// Types & Interfaces for Sentinela UI Status
// ============================================================

export interface SentinelaScheduledSendDetail {
  id: string
  contactId: string
  contactName: string
  templateName: string
  sendAt: string
  delayMinutes: number
}

export interface SentinelaAutomationDetail {
  id: string
  automationId: string
  automationName: string
  contactId: string | null
  contactName: string
  runAt: string
  delayMinutes: number
}

export interface SentinelaPausedLoteDetail {
  id: string
  envioId: string
  envioTitulo: string
  numeroLote: number
  quantidadeLeads: number
  status: string
}

export interface SentinelaStuckConversationDetail {
  id: string
  contactId: string
  contactName: string
  contactPhone: string
  reason: 'pending_human_timeout' | 'reply_limit_unassigned'
  aiTransferStatus: string | null
  aiTransferAt: string | null
  aiReplyCount: number
  assignedAgentId: string | null
  updatedAt: string
}

export interface SentinelaGhostDealDetail {
  id: string
  title: string
  value: number
  pipelineId: string
  stageId: string
  createdAt: string
}

export interface SentinelaStatusResponse {
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
  details: {
    scheduledSends: SentinelaScheduledSendDetail[]
    automations: SentinelaAutomationDetail[]
    pausedLotes: SentinelaPausedLoteDetail[]
    stuckConversations: SentinelaStuckConversationDetail[]
    ghostDeals: SentinelaGhostDealDetail[]
  }
  queryErrors: string[]
}

const SCHEDULED_SENDS_MAX_DELAY_MS = 15 * 60 * 1000
const AUTOMATIONS_MAX_DELAY_MS = 10 * 60 * 1000
const AI_HANDOFF_MAX_DELAY_MS = 10 * 60 * 1000
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

export async function GET(): Promise<NextResponse> {
  try {
    await getCurrentAccount()
  } catch (err) {
    return toErrorResponse(err)
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

  // 1. Scheduled sends stuck > 15m
  let scheduledSendsDetails: SentinelaScheduledSendDetail[] = []
  try {
    const { data, error } = await db
      .from('scheduled_sends')
      .select('id, contact_id, send_at, template_name, contacts(name, phone)')
      .eq('status', 'pending')
      .lt('send_at', fifteenMinAgoIso)
      .order('send_at', { ascending: true })

    if (error) {
      queryErrors.push(`scheduled_sends: ${error.message}`)
    } else {
      scheduledSendsDetails = (data ?? []).map((row: Record<string, unknown>) => {
        const contactObj = row.contacts as { name?: string; phone?: string } | null
        const sendAtStr = String(row.send_at ?? checkedAt)
        const delayMinutes = Math.max(
          1,
          Math.round((now - new Date(sendAtStr).getTime()) / 60000),
        )
        return {
          id: String(row.id),
          contactId: String(row.contact_id ?? ''),
          contactName: contactObj?.name || contactObj?.phone || 'Contato sem nome',
          templateName: String(row.template_name ?? 'Template'),
          sendAt: sendAtStr,
          delayMinutes,
        }
      })
    }
  } catch (err) {
    queryErrors.push(
      `scheduled_sends exception: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // 2. Automations stuck > 10m
  let automationsDetails: SentinelaAutomationDetail[] = []
  try {
    const { data, error } = await db
      .from('automation_pending_executions')
      .select('id, automation_id, contact_id, run_at, automations(name), contacts(name, phone)')
      .eq('status', 'pending')
      .lt('run_at', tenMinAgoIso)
      .order('run_at', { ascending: true })

    if (error) {
      queryErrors.push(`automation_pending_executions: ${error.message}`)
    } else {
      automationsDetails = (data ?? []).map((row: Record<string, unknown>) => {
        const autoObj = row.automations as { name?: string } | null
        const contactObj = row.contacts as { name?: string; phone?: string } | null
        const runAtStr = String(row.run_at ?? checkedAt)
        const delayMinutes = Math.max(
          1,
          Math.round((now - new Date(runAtStr).getTime()) / 60000),
        )
        return {
          id: String(row.id),
          automationId: String(row.automation_id ?? ''),
          automationName: autoObj?.name || 'Automação',
          contactId: row.contact_id ? String(row.contact_id) : null,
          contactName: contactObj?.name || contactObj?.phone || 'Lead',
          runAt: runAtStr,
          delayMinutes,
        }
      })
    }
  } catch (err) {
    queryErrors.push(
      `automation_pending_executions exception: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // 3. Paused envio_lotes
  let pausedLotesDetails: SentinelaPausedLoteDetail[] = []
  try {
    const { data, error } = await db
      .from('envio_lotes')
      .select('id, envio_id, numero_lote, quantidade_leads, status, envios(nome)')
      .eq('status', 'pausado')
      .order('numero_lote', { ascending: true })

    if (error) {
      queryErrors.push(`envio_lotes: ${error.message}`)
    } else {
      pausedLotesDetails = (data ?? []).map((row: Record<string, unknown>) => {
        const envioObj = row.envios as { nome?: string } | null
        return {
          id: String(row.id),
          envioId: String(row.envio_id ?? ''),
          envioTitulo: envioObj?.nome || 'Disparo em Lote',
          numeroLote: Number(row.numero_lote ?? 1),
          quantidadeLeads: Number(row.quantidade_leads ?? 0),
          status: String(row.status ?? 'pausado'),
        }
      })
    }
  } catch (err) {
    queryErrors.push(
      `envio_lotes exception: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // 4. Stuck AI / Clara conversations
  let pendingHumanCount = 0
  let replyLimitCount = 0
  const stuckConversationsMap = new Map<string, SentinelaStuckConversationDetail>()

  try {
    const { data: phRows, error: phErr } = await db
      .from('conversations')
      .select(
        'id, contact_id, assigned_agent_id, ai_transfer_status, ai_transfer_at, ai_reply_count, updated_at, contacts(name, phone)',
      )
      .neq('status', 'closed')
      .eq('ai_transfer_status', 'pending_human')
      .or(`ai_transfer_at.lt.${aiTenMinAgoIso},and(ai_transfer_at.is.null,updated_at.lt.${aiTenMinAgoIso})`)

    if (phErr) {
      queryErrors.push(`conversations (pending_human): ${phErr.message}`)
    } else {
      const rows = (phRows ?? []) as Array<Record<string, unknown>>
      pendingHumanCount = rows.length
      for (const row of rows) {
        const contactObj = row.contacts as { name?: string; phone?: string } | null
        const id = String(row.id)
        stuckConversationsMap.set(id, {
          id,
          contactId: String(row.contact_id ?? ''),
          contactName: contactObj?.name || contactObj?.phone || 'Lead sem nome',
          contactPhone: contactObj?.phone || '',
          reason: 'pending_human_timeout',
          aiTransferStatus: row.ai_transfer_status ? String(row.ai_transfer_status) : null,
          aiTransferAt: row.ai_transfer_at ? String(row.ai_transfer_at) : null,
          aiReplyCount: Number(row.ai_reply_count ?? 0),
          assignedAgentId: row.assigned_agent_id ? String(row.assigned_agent_id) : null,
          updatedAt: String(row.updated_at ?? checkedAt),
        })
      }
    }
  } catch (err) {
    queryErrors.push(
      `conversations (pending_human) exception: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  try {
    const { data: limRows, error: limErr } = await db
      .from('conversations')
      .select(
        'id, contact_id, assigned_agent_id, ai_transfer_status, ai_transfer_at, ai_reply_count, updated_at, contacts(name, phone)',
      )
      .neq('status', 'closed')
      .gte('ai_reply_count', AI_REPLY_SAFETY_LIMIT)
      .is('assigned_agent_id', null)

    if (limErr) {
      queryErrors.push(`conversations (ai_reply_count): ${limErr.message}`)
    } else {
      const rows = (limRows ?? []) as Array<Record<string, unknown>>
      replyLimitCount = rows.length
      for (const row of rows) {
        const contactObj = row.contacts as { name?: string; phone?: string } | null
        const id = String(row.id)
        if (!stuckConversationsMap.has(id)) {
          stuckConversationsMap.set(id, {
            id,
            contactId: String(row.contact_id ?? ''),
            contactName: contactObj?.name || contactObj?.phone || 'Lead sem nome',
            contactPhone: contactObj?.phone || '',
            reason: 'reply_limit_unassigned',
            aiTransferStatus: row.ai_transfer_status ? String(row.ai_transfer_status) : null,
            aiTransferAt: row.ai_transfer_at ? String(row.ai_transfer_at) : null,
            aiReplyCount: Number(row.ai_reply_count ?? 0),
            assignedAgentId: null,
            updatedAt: String(row.updated_at ?? checkedAt),
          })
        }
      }
    }
  } catch (err) {
    queryErrors.push(
      `conversations (ai_reply_count) exception: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // 5. Ghost deals (contact_id IS NULL)
  let ghostDealsDetails: SentinelaGhostDealDetail[] = []
  try {
    const { data, error } = await db
      .from('deals')
      .select('id, pipeline_id, stage_id, title, value, created_at')
      .is('contact_id', null)
      .order('created_at', { ascending: false })

    if (error) {
      queryErrors.push(`deals (ghosts): ${error.message}`)
    } else {
      ghostDealsDetails = (data ?? []).map((row: Record<string, unknown>) => ({
        id: String(row.id),
        title: String(row.title ?? 'Negócio sem título'),
        value: Number(row.value ?? 0),
        pipelineId: String(row.pipeline_id ?? ''),
        stageId: String(row.stage_id ?? ''),
        createdAt: String(row.created_at ?? checkedAt),
      }))
    }
  } catch (err) {
    queryErrors.push(
      `deals (ghosts) exception: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const stuckConversationsList = Array.from(stuckConversationsMap.values())
  const queuesTotal =
    scheduledSendsDetails.length + automationsDetails.length + pausedLotesDetails.length
  const aiTotal = stuckConversationsList.length
  const ghostsTotal = ghostDealsDetails.length
  const totalAnomalies = queuesTotal + aiTotal + ghostsTotal

  const response: SentinelaStatusResponse = {
    ok: true,
    checkedAt,
    anomaliesFound: totalAnomalies > 0,
    totalAnomalies,
    breakdown: {
      queues: {
        scheduledSendsStuck: scheduledSendsDetails.length,
        automationsStuck: automationsDetails.length,
        envioLotesPaused: pausedLotesDetails.length,
        total: queuesTotal,
      },
      aiClara: {
        pendingHumanTimeout: pendingHumanCount,
        replyLimitUnassigned: replyLimitCount,
        total: aiTotal,
      },
      ghosts: {
        dealsWithoutContact: ghostsTotal,
        total: ghostsTotal,
      },
    },
    details: {
      scheduledSends: scheduledSendsDetails,
      automations: automationsDetails,
      pausedLotes: pausedLotesDetails,
      stuckConversations: stuckConversationsList,
      ghostDeals: ghostDealsDetails,
    },
    queryErrors,
  }

  return NextResponse.json(response, { status: 200 })
}
