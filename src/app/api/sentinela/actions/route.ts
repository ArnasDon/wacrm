import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getCurrentAccount } from '@/lib/auth/account'

// ============================================================
// Types & Interfaces (Strict TypeScript)
// ============================================================

export interface SentinelaActionRequestBody {
  action: 'fix_auto' | string
}

export interface AdminProfileLookupRow {
  user_id: string
  account_id: string | null
  full_name: string
  email: string
}

export interface PausedLoteRecord {
  id: string
  envio_id: string
  numero_lote: number
  status: string
}

export interface EnvioOwnerRow {
  id: string
  account_id: string
}

export interface StuckAiConversationIdRow {
  id: string
}

export interface UpdatedIdRow {
  id: string
}

export interface SentinelaActionResponse {
  ok: boolean
  status: number
  message: string
  executedAt: string
  remediation: {
    envioLotesResumed: number
    aiConversationsRecovered: number
    scheduledSendsRescheduled: number
    automationsRescheduled: number
  }
  errors: string[]
}

// ============================================================
// Constants & Helpers
// ============================================================

const ADMIN_EMAIL_DEFAULT = 'ronaldomeiracorretor@gmail.com'
const ADMIN_NAME_PATTERN = '%Ronaldo Meira%'

const SCHEDULED_SENDS_MAX_DELAY_MS = 15 * 60 * 1000 // 15 minutes
const AUTOMATIONS_MAX_DELAY_MS = 10 * 60 * 1000 // 10 minutes
const AI_HANDOFF_MAX_DELAY_MS = 10 * 60 * 1000 // 10 minutes
const ONE_MINUTE_MS = 60 * 1000 // +1 minute survival window
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

function getExpectedSecret(): string | null {
  return process.env.CRON_SECRET || process.env.AUTOMATION_CRON_SECRET || null
}

function isTokenAuthorized(request: Request, expectedSecret: string): boolean {
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

async function resolveAdminUserId(db: SupabaseClient): Promise<string | null> {
  if (process.env.SENTINELA_ADMIN_USER_ID) {
    return process.env.SENTINELA_ADMIN_USER_ID
  }

  const configuredAdminEmail = process.env.SENTINELA_ADMIN_EMAIL || ADMIN_EMAIL_DEFAULT

  const { data: profiles } = await db
    .from('profiles')
    .select('user_id, account_id, full_name, email')
    .or(`email.ilike.${configuredAdminEmail},full_name.ilike.${ADMIN_NAME_PATTERN}`)
    .limit(5)

  const typedProfiles = (profiles ?? []) as AdminProfileLookupRow[]
  const exactEmailMatch = typedProfiles.find(
    (p) => p.email.toLowerCase() === configuredAdminEmail.toLowerCase(),
  )
  if (exactEmailMatch) return exactEmailMatch.user_id

  const nameMatch = typedProfiles.find((p) =>
    p.full_name.toLowerCase().includes('ronaldo'),
  )
  return nameMatch?.user_id ?? null
}

// ============================================================
// POST /api/sentinela/actions
// ============================================================

export async function POST(request: Request): Promise<NextResponse> {
  const expectedSecret = getExpectedSecret()
  const authorizedByToken = expectedSecret
    ? isTokenAuthorized(request, expectedSecret)
    : false

  if (!authorizedByToken) {
    try {
      await getCurrentAccount()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let body: SentinelaActionRequestBody
  try {
    body = (await request.json()) as SentinelaActionRequestBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || body.action !== 'fix_auto') {
    return NextResponse.json(
      { error: 'Unsupported or missing action. Expected { action: "fix_auto" }' },
      { status: 400 },
    )
  }

  let db: SupabaseClient
  try {
    db = getSupabaseServiceClient()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Supabase initialization failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const nowPlusOneMinuteIso = new Date(now + ONE_MINUTE_MS).toISOString()
  const fifteenMinAgoIso = new Date(now - SCHEDULED_SENDS_MAX_DELAY_MS).toISOString()
  const tenMinAgoIso = new Date(now - AUTOMATIONS_MAX_DELAY_MS).toISOString()
  const aiTenMinAgoIso = new Date(now - AI_HANDOFF_MAX_DELAY_MS).toISOString()

  const errors: string[] = []
  let envioLotesResumed = 0
  let aiConversationsRecovered = 0
  let scheduledSendsRescheduled = 0
  let automationsRescheduled = 0

  // ------------------------------------------------------------
  // 1. Reativar envio_lotes pausados
  //    Respeita a constraint CHECK (status IN ('aguardando', 'em_andamento', 'pausado', 'concluido'))
  //    e o trigger check_single_active_lote (1 lote 'em_andamento' por conta),
  //    além de reagendar o primeiro envio_lead pendente na fila.
  // ------------------------------------------------------------
  try {
    const { data: pausedLotes, error: fetchPausedErr } = await db
      .from('envio_lotes')
      .select('id, envio_id, numero_lote, status')
      .eq('status', 'pausado')
      .order('numero_lote', { ascending: true })

    if (fetchPausedErr) {
      errors.push(`envio_lotes fetch: ${fetchPausedErr.message}`)
    } else if (pausedLotes && pausedLotes.length > 0) {
      const typedPaused = pausedLotes as PausedLoteRecord[]
      const envioIds = Array.from(new Set(typedPaused.map((l) => l.envio_id)))

      const { data: enviosData } = await db
        .from('envios')
        .select('id, account_id')
        .in('id', envioIds)

      const accountByEnvioId = new Map<string, string>(
        ((enviosData ?? []) as EnvioOwnerRow[]).map((e) => [e.id, e.account_id]),
      )

      const activatedAccounts = new Set<string>()

      for (const lote of typedPaused) {
        const accountId = accountByEnvioId.get(lote.envio_id)
        const targetStatus =
          accountId && activatedAccounts.has(accountId) ? 'aguardando' : 'em_andamento'

        const { error: updateLoteErr } = await db
          .from('envio_lotes')
          .update({
            status: targetStatus,
            ...(targetStatus === 'em_andamento' ? { iniciado_em: nowIso } : {}),
          })
          .eq('id', lote.id)
          .eq('status', 'pausado')

        if (updateLoteErr) {
          errors.push(`envio_lotes update (${lote.id}): ${updateLoteErr.message}`)
          continue
        }

        if (accountId && targetStatus === 'em_andamento') {
          activatedAccounts.add(accountId)
        }

        // Garante que o primeiro lead 'na_fila' tenha next_attempt_at agendado
        if (targetStatus === 'em_andamento') {
          const { data: nextLead } = await db
            .from('envio_leads')
            .select('id')
            .eq('lote_id', lote.id)
            .eq('status', 'na_fila')
            .is('next_attempt_at', null)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()

          if (nextLead?.id) {
            await db
              .from('envio_leads')
              .update({ next_attempt_at: nowPlusOneMinuteIso })
              .eq('id', (nextLead as UpdatedIdRow).id)
          }
        }

        envioLotesResumed += 1
      }
    }
  } catch (err) {
    errors.push(
      `envio_lotes exception: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // ------------------------------------------------------------
  // 2. Destravar conversas da IA / Clara (limite 8 ou pending_human > 10m)
  //    Atribui para o ID do administrador (Ronaldo Meira) e marca
  //    unread_count = 1 + last_ai_reply_at = NOW() (que ativa a coluna
  //    gerada needs_review = true no PostgreSQL).
  // ------------------------------------------------------------
  try {
    const adminUserId = await resolveAdminUserId(db)

    const { data: pendingHumanRows, error: phErr } = await db
      .from('conversations')
      .select('id')
      .neq('status', 'closed')
      .eq('ai_transfer_status', 'pending_human')
      .or(`ai_transfer_at.lt.${aiTenMinAgoIso},and(ai_transfer_at.is.null,updated_at.lt.${aiTenMinAgoIso})`)

    if (phErr) {
      errors.push(`conversations fetch (pending_human): ${phErr.message}`)
    }

    const { data: limitRows, error: limErr } = await db
      .from('conversations')
      .select('id')
      .neq('status', 'closed')
      .gte('ai_reply_count', AI_REPLY_SAFETY_LIMIT)
      .is('assigned_agent_id', null)

    if (limErr) {
      errors.push(`conversations fetch (ai_reply_count): ${limErr.message}`)
    }

    const targetConversationIds = Array.from(
      new Set<string>([
        ...((pendingHumanRows ?? []) as StuckAiConversationIdRow[]).map((r) => r.id),
        ...((limitRows ?? []) as StuckAiConversationIdRow[]).map((r) => r.id),
      ]),
    )

    if (targetConversationIds.length > 0) {
      const updatePayload: Record<string, unknown> = {
        unread_count: 1,
        ai_transfer_status: 'transferred',
        // Bumping last_ai_reply_at above last_reviewed_at makes the stored
        // generated column `needs_review` evaluate to true automatically.
        last_ai_reply_at: nowIso,
        updated_at: nowIso,
      }

      if (adminUserId) {
        updatePayload.assigned_agent_id = adminUserId
      }

      const { data: updatedConvs, error: convUpdateErr } = await db
        .from('conversations')
        .update(updatePayload)
        .in('id', targetConversationIds)
        .select('id')

      if (convUpdateErr) {
        errors.push(`conversations update: ${convUpdateErr.message}`)
      } else {
        aiConversationsRecovered = ((updatedConvs ?? []) as UpdatedIdRow[]).length
      }
    }
  } catch (err) {
    errors.push(
      `conversations recovery exception: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // ------------------------------------------------------------
  // 2b. Limpar deals fantasmas (contact_id IS NULL)
  // ------------------------------------------------------------
  try {
    const { error: ghostErr } = await db
      .from('deals')
      .delete()
      .is('contact_id', null)

    if (ghostErr) {
      errors.push(`ghost deals cleanup: ${ghostErr.message}`)
    }
  } catch (err) {
    errors.push(
      `ghost deals cleanup exception: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // ------------------------------------------------------------
  // 3. Reagendar filas atrasadas (send_at e run_at -> NOW() + 1 minute)
  //    Evita que automation_pending_executions caia na trava de 15m
  //    (MAX_STALENESS_MS) e dá sobrevida para os crons originais.
  // ------------------------------------------------------------
  try {
    const { data: updatedSends, error: sendsErr } = await db
      .from('scheduled_sends')
      .update({ send_at: nowPlusOneMinuteIso })
      .eq('status', 'pending')
      .lt('send_at', fifteenMinAgoIso)
      .select('id')

    if (sendsErr) {
      errors.push(`scheduled_sends reschedule: ${sendsErr.message}`)
    } else {
      scheduledSendsRescheduled = ((updatedSends ?? []) as UpdatedIdRow[]).length
    }
  } catch (err) {
    errors.push(
      `scheduled_sends exception: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  try {
    const { data: updatedAutos, error: autosErr } = await db
      .from('automation_pending_executions')
      .update({ run_at: nowPlusOneMinuteIso })
      .eq('status', 'pending')
      .lt('run_at', tenMinAgoIso)
      .select('id')

    if (autosErr) {
      errors.push(`automation_pending_executions reschedule: ${autosErr.message}`)
    } else {
      automationsRescheduled = ((updatedAutos ?? []) as UpdatedIdRow[]).length
    }
  } catch (err) {
    errors.push(
      `automation_pending_executions exception: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const responsePayload: SentinelaActionResponse = {
    ok: true,
    status: 200,
    message: 'Sentinela: Filas e conversas da IA reprocessadas com sucesso.',
    executedAt: nowIso,
    remediation: {
      envioLotesResumed,
      aiConversationsRecovered,
      scheduledSendsRescheduled,
      automationsRescheduled,
    },
    errors,
  }

  return NextResponse.json(responsePayload, { status: 200 })
}
