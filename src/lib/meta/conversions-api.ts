import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { META_API_BASE } from '@/lib/whatsapp/meta-api'

// ============================================================
// conversions-api.ts — Bloco 4: reporta à Meta, via Conversions API,
// os eventos de negócio de uma conversa vinda de um anúncio Click to
// WhatsApp (CTWA), ligados ao clique original pelo `ctwa_clid`
// guardado na conversa (Bloco 3-A, migração 045).
//
// Dois eventos, cada um disparado uma vez por conversa a partir do seu
// ponto de origem:
//   - 'Lead'     — quando checkHandoffReadiness (commercial-handoff.ts)
//                  passa a `ready: true` dentro de saveLeadDetailsHandler.
//   - 'Schedule' — quando bookCommercialMeetingHandler confirma uma
//                  reunião (outcome.status === 'booked').
//
// Contrato desta função (a mesma disciplina de notify-team.ts e
// crm/sync.ts): NUNCA lança. Chamar sempre fire-and-forget
// (`void sendCapiEvent(...).catch(...)`) — uma falha aqui não pode
// atrasar nem quebrar a resposta ao lead. Toda a falha fica registada
// em log (sem dados pessoais) e na tabela `meta_capi_events`
// (migração 055), nunca engolida em silêncio.
//
// Dedup: `event_id` é determinístico (`${conversationId}:${eventName}`)
// e a tabela tem uma UNIQUE nessa coluna — o INSERT inicial (reserva
// atómica, status='pending') funciona como uma trava contra duas
// chamadas concorrentes para o mesmo evento (mesmo padrão do
// claim_ai_reply_slot/commercial_welcome_sent_at do Bloco 3-A, mas via
// unique constraint em vez de UPDATE...IS NULL). Uma segunda chamada
// perde a reserva (unique violation) e desiste sem reenviar.
// ============================================================

/** Timeout curto — este envio nunca pode atrasar a resposta ao lead. */
const CAPI_REQUEST_TIMEOUT_MS = 5_000
const RESPONSE_SUMMARY_MAX = 500

export type CapiEventName = 'Lead' | 'Schedule'

export interface SendCapiEventArgs {
  db: SupabaseClient
  accountId: string
  conversationId: string
  eventName: CapiEventName
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Grava o resultado (sucesso ou falha) na linha já reservada pelo
 *  INSERT inicial. Nunca lança — uma falha a escrever a auditoria não
 *  pode propagar-se para cima de uma chamada que já terminou. */
async function recordOutcome(
  db: SupabaseClient,
  eventId: string,
  status: 'sent' | 'error',
  httpStatus: number | null,
  responseSummary: string | null,
): Promise<void> {
  try {
    const { error } = await db
      .from('meta_capi_events')
      .update({ status, http_status: httpStatus, response_summary: responseSummary })
      .eq('event_id', eventId)
    if (error) {
      console.error(`[meta capi] falha a registar o resultado do evento (event_id=${eventId}):`, error.message)
    }
  } catch (err) {
    console.error(
      `[meta capi] erro inesperado a registar o resultado do evento (event_id=${eventId}):`,
      err instanceof Error ? err.message : err,
    )
  }
}

/**
 * Envia um evento de conversão (`Lead` ou `Schedule`) à Meta Conversions
 * API para uma conversa CTWA, ligado pelo `ctwa_clid` guardado na
 * conversa. Sem `ctwa_clid` (conversa não veio de um anúncio) ou sem
 * `meta_capi_dataset_id` configurado na conta, não tenta a chamada —
 * regista o motivo e sai. Nunca lança.
 */
export async function sendCapiEvent(args: SendCapiEventArgs): Promise<void> {
  const { db, accountId, conversationId, eventName } = args
  const eventId = `${conversationId}:${eventName}`

  try {
    // Reserva atómica: perde a corrida (unique violation) → já foi
    // enviado, ou está a ser enviado agora por outra chamada
    // concorrente. Qualquer dos casos, não repetir.
    const { error: claimError } = await db
      .from('meta_capi_events')
      .insert({ conversation_id: conversationId, event_name: eventName, event_id: eventId, status: 'pending' })
    if (claimError) {
      if (isUniqueViolation(claimError)) return
      console.error(
        `[meta capi] falha a reservar o evento ${eventName} (conversation=${conversationId}):`,
        claimError.message,
      )
      return
    }

    const { data: conv, error: convError } = await db
      .from('conversations')
      .select('ctwa_clid')
      .eq('id', conversationId)
      .maybeSingle()
    const ctwaClid = (conv as { ctwa_clid?: string | null } | null)?.ctwa_clid
    if (convError || !ctwaClid) {
      await recordOutcome(db, eventId, 'error', null, 'no_ctwa_clid')
      return
    }

    const { data: aiConfig } = await db
      .from('ai_configs')
      .select('meta_capi_dataset_id, meta_capi_test_event_code')
      .eq('account_id', accountId)
      .maybeSingle()
    const datasetId = (aiConfig as { meta_capi_dataset_id?: string | null } | null)?.meta_capi_dataset_id
    if (!datasetId) {
      console.error(
        `[meta capi] sem meta_capi_dataset_id configurado (account=${accountId}) — evento ${eventName} não enviado.`,
      )
      await recordOutcome(db, eventId, 'error', null, 'dataset_not_configured')
      return
    }
    const testEventCode = (aiConfig as { meta_capi_test_event_code?: string | null } | null)
      ?.meta_capi_test_event_code

    const { data: waConfig, error: waError } = await db
      .from('whatsapp_config')
      .select('access_token')
      .eq('account_id', accountId)
      .maybeSingle()
    const encryptedToken = (waConfig as { access_token?: string | null } | null)?.access_token
    if (waError || !encryptedToken) {
      console.error(`[meta capi] whatsapp_config não encontrado (account=${accountId}) — evento ${eventName} não enviado.`)
      await recordOutcome(db, eventId, 'error', null, 'whatsapp_config_not_found')
      return
    }

    let accessToken: string
    try {
      accessToken = decrypt(encryptedToken)
    } catch (err) {
      console.error('[meta capi] falha a decifrar o access_token do WhatsApp:', err)
      await recordOutcome(db, eventId, 'error', null, 'access_token_decrypt_failed')
      return
    }

    const body: Record<string, unknown> = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'business_messaging',
          messaging_channel: 'whatsapp',
          user_data: { ctwa_clid: ctwaClid },
          event_id: eventId,
        },
      ],
    }
    if (testEventCode) body.test_event_code = testEventCode

    let response: Response
    try {
      response = await fetch(`${META_API_BASE}/${datasetId}/events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CAPI_REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[meta capi] falha a contactar a Conversions API (evento ${eventName}, conversation=${conversationId}):`, message)
      await recordOutcome(db, eventId, 'error', null, truncate(`request_failed: ${message}`, RESPONSE_SUMMARY_MAX))
      return
    }

    const responseText = await response.text().catch(() => '')
    if (!response.ok) {
      console.error(
        `[meta capi] a Meta respondeu ${response.status} ao evento ${eventName} (conversation=${conversationId}).`,
      )
      await recordOutcome(db, eventId, 'error', response.status, truncate(responseText, RESPONSE_SUMMARY_MAX))
      return
    }

    await recordOutcome(db, eventId, 'sent', response.status, truncate(responseText, RESPONSE_SUMMARY_MAX))
  } catch (err) {
    console.error(
      `[meta capi] erro inesperado a enviar o evento ${eventName} (conversation=${conversationId}):`,
      err instanceof Error ? err.message : err,
    )
    await recordOutcome(db, eventId, 'error', null, 'unexpected_error')
  }
}
