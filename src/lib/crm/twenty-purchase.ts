import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getTwentyPerson } from './twenty-client'
import { sendPurchaseCapiEvent, type PurchaseUserData } from '@/lib/meta/conversions-api'

// ============================================================
// Bloco 5: negócio ganho no Twenty ("Cliente") → Purchase na Meta
// Conversions API, ligado ao clique original do anúncio via
// `ctwa_clid`. Chamado a partir de dois pontos de entrada:
//   - src/app/api/crm/twenty/webhook/route.ts (webhook do Twenty,
//     quando configurado — ver esse ficheiro para o estado da
//     configuração do lado do Twenty).
//   - src/app/api/crm/twenty/purchases-cron/route.ts (fallback: cron
//     de 15 em 15 minutos que reconcilia negócios ganhos nas últimas
//     24h, para o caso do webhook não estar activo ou ter falhado).
//
// Ambos os chamadores partilham esta função para que a lógica de
// "que fase conta como ganho", "como encontrar a conversa" e "qual
// user_data usar" exista num único sítio, testado uma única vez.
//
// Fail-safe: nunca lança. Qualquer falha fica registada em log (sem
// dados pessoais) e devolvida no resultado, nunca propagada.
// ============================================================

/** Único valor de `opportunity.stage` que conta como negócio ganho —
 *  ver /Users/ricardo/twenty-crm/API.md, secção "Fases do pipeline". */
const WON_STAGE = 'CLIENTE'

export function isWonStage(stage: string | null | undefined): boolean {
  return stage === WON_STAGE
}

export type HandleOpportunityWonResult =
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'sent'; userDataKind: PurchaseUserData['kind'] }

export interface HandleOpportunityWonArgs {
  db: SupabaseClient
  opportunityId: string
  stage: string | null | undefined
  amountMicros: number
  currencyCode: string
  pointOfContactId: string | null
}

function hashForMeta(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex')
}

/**
 * Processa uma opportunity do Twenty potencialmente ganha. Devolve
 * sempre um resultado descritivo (nunca lança) para o chamador poder
 * decidir o que fazer a seguir (o webhook devolve-o na resposta HTTP,
 * o cron agrega-o num contador).
 */
export async function handleOpportunityWon(args: HandleOpportunityWonArgs): Promise<HandleOpportunityWonResult> {
  const { db, opportunityId, stage, amountMicros, currencyCode, pointOfContactId } = args

  if (!isWonStage(stage)) {
    return { outcome: 'skipped', reason: 'not_won_stage' }
  }
  if (!pointOfContactId) {
    return { outcome: 'skipped', reason: 'no_point_of_contact' }
  }

  // A conversa é encontrada pelo `crm_person_id` gravado pelo Bloco
  // 3 (sync.ts) — só existe quando esta pessoa foi criada no Twenty a
  // partir de uma conversa do EterWA. Sem conversa, não há
  // account_id/ctwa_clid a usar, portanto não há nada a enviar.
  const { data: conv, error: convError } = await db
    .from('conversations')
    .select('id, account_id, ctwa_clid')
    .eq('crm_person_id', pointOfContactId)
    .maybeSingle()
  if (convError) {
    console.error(`[crm purchase] falha a procurar conversa por crm_person_id (opportunity=${opportunityId}):`, convError.message)
    return { outcome: 'skipped', reason: 'conversation_lookup_failed' }
  }
  const conversation = conv as { id: string; account_id: string; ctwa_clid: string | null } | null
  if (!conversation) {
    return { outcome: 'skipped', reason: 'no_matching_conversation' }
  }

  let userData: PurchaseUserData
  if (conversation.ctwa_clid) {
    const { data: waConfig } = await db
      .from('whatsapp_config')
      .select('waba_id')
      .eq('account_id', conversation.account_id)
      .maybeSingle()
    const wabaId = (waConfig as { waba_id?: string | null } | null)?.waba_id
    if (!wabaId) {
      return { outcome: 'skipped', reason: 'waba_id_not_found' }
    }
    userData = { kind: 'ctwa', ctwaClid: conversation.ctwa_clid, wabaId }
  } else {
    // Sem ctwa_clid (lead do site ou outro canal, não veio de um clique
    // de anúncio): cai para o caminho `system_generated`, hasheando o
    // email/telefone que a pessoa tem no Twenty neste momento.
    let person
    try {
      person = await getTwentyPerson(pointOfContactId)
    } catch (err) {
      console.error(`[crm purchase] falha a ler a pessoa no Twenty (opportunity=${opportunityId}):`, err instanceof Error ? err.message : err)
      return { outcome: 'skipped', reason: 'twenty_person_lookup_failed' }
    }
    if (!person || (!person.email && !person.phone)) {
      return { outcome: 'skipped', reason: 'no_email_or_phone' }
    }
    userData = {
      kind: 'system_generated',
      emailHash: person.email ? hashForMeta(person.email) : null,
      phoneHash: person.phone ? hashForMeta(person.phone) : null,
    }
  }

  await sendPurchaseCapiEvent({
    db,
    accountId: conversation.account_id,
    conversationId: conversation.id,
    opportunityId,
    amountEur: amountMicros / 1_000_000,
    currencyCode,
    userData,
  })

  return { outcome: 'sent', userDataKind: userData.kind }
}
