import type { CbAutomationEvent } from '@/types'
import { supabaseAdmin } from './admin-client'
import { runAutomationsForTrigger, type AutomationContext } from './engine'
import { cancelarEsperasAoSairDaEtapa } from './so-na-etapa'

// ------------------------------------------------------------
// Drenagem da fila `cb_automation_events` (migration 933).
//
// A fila existe porque quem move card está no NAVEGADOR, sob RLS, em dois
// caminhos diferentes e sem função compartilhada no servidor. Um trigger de
// banco enche; este módulo esvazia.
//
// ⚠️ DUAS PONTAS CHAMAM AQUI, e é de propósito:
//   1. o aviso imediato de quem escreveu (`POST /api/automations/events/drain`),
//      que dá latência de segundos — sem ele, "moveu o card → manda a
//      mensagem" levaria até 15 minutos, que é o ciclo do agendador da VPS;
//   2. o cron de 15 min, como rede de segurança para o que o navegador não
//      conseguiu avisar (aba fechada, rede caindo, SQL rodado na mão).
//
// A reivindicação em dois passos é o que impede as duas de dispararem o mesmo
// evento — mesmo molde do cron de automações e do disparador de agendadas.
// ------------------------------------------------------------

/** Teto por ciclo. Igual ao do cron de automações. */
const LOTE = 50

/**
 * Idade máxima de um evento que ainda vale a pena disparar.
 *
 * ⚠️ Guarda de ATRASO, no molde da mensagem agendada (925). Agendador fora do
 * ar por horas + conserto despejaria a fila inteira de uma vez: o cliente
 * receberia de madrugada a mensagem do card que se moveu ontem de manhã, e a
 * automação de "24h antes da reunião" dispararia depois da reunião. Passado o
 * prazo, o evento é marcado com o motivo escrito e não dispara.
 */
const IDADE_MAXIMA_MS = 60 * 60 * 1000

/**
 * Monta o contexto que o motor recebe a partir de uma linha da fila.
 *
 * Puro, e separado da E/S porque é aqui que mora a decisão que o operador
 * enxerga: qual canal a automação vai considerar, e qual card as ações vão
 * mexer. Testável sem banco.
 */
/**
 * Chave deste evento na cadeia: o par (negócio, destino).
 *
 * É o par, e não só o negócio, que define o ciclo. Uma esteira legítima passa
 * o MESMO card por muitas etapas — barrar por negócio cortaria toda esteira no
 * segundo passo. O que não pode acontecer é o card VOLTAR a uma etapa por onde
 * este mesmo encadeamento já o levou.
 */
export function chaveDoEvento(
  evento: Pick<CbAutomationEvent, 'deal_id' | 'to_stage_id' | 'to_status' | 'tipo'>,
): string {
  const destino =
    evento.tipo === 'deal_status_changed' ? `status:${evento.to_status ?? ''}` : `stage:${evento.to_stage_id ?? ''}`
  return `deal:${evento.deal_id ?? ''}|${destino}`
}

/**
 * Este evento fecha um ciclo?
 *
 * ⚠️ SEM TETO DE PROFUNDIDADE, por decisão do operador (D13): esteira longa é
 * legítima e um teto a cortaria no meio, em silêncio. A guarda é a repetição —
 * um encadeamento que revisita um par (negócio, destino) já visitado está
 * girando, e girar aqui significa mandar mensagem ao cliente a cada volta.
 *
 * Cadeia vazia = ação de gente ou de conexão: começo novo, nunca é ciclo.
 */
export function fechaCiclo(evento: CbAutomationEvent): boolean {
  const cadeia = Array.isArray(evento.cadeia) ? evento.cadeia : []
  return cadeia.includes(chaveDoEvento(evento))
}

export function contextoDoEvento(evento: CbAutomationEvent): AutomationContext {
  const cadeia = Array.isArray(evento.cadeia) ? evento.cadeia : []
  return {
    // Canal da CONVERSA (D9), resolvido pelo trigger. Pode ser nulo — e aí
    // `channelInScope` deixa passar, como em todo disparo sem canal.
    channel_id: evento.channel_id,
    // O card EXATO. Sem isto, uma ação de funil teria de adivinhar qual
    // negócio mexer quando o contato tem mais de um aberto.
    deal_id: evento.deal_id,
    to_stage_id: evento.to_stage_id,
    from_stage_id: evento.from_stage_id,
    to_status: evento.to_status,
    // QUANDO o card entrou: amarra a execução a esta estadia na etapa (ver
    // `AutomationContext.evento_em` e `cardSaiuDaEtapa`).
    evento_em: evento.criado_em,
    vars: {
      // ⚠️ A cadeia CRESCE aqui, num lugar só. Se o motor também acrescentasse,
      // as duas pontas divergiriam e a guarda passaria a depender de qual
      // delas escreveu por último. O motor só lê e devolve ao banco.
      //
      // Viaja como `vars` porque é assim que o contexto sobrevive ao passo
      // `wait` — JSONB intacto em `automation_pending_executions.context`,
      // o mesmo transporte do `_tag_chain_depth`.
      _cadeia: [...cadeia, chaveDoEvento(evento)],
    },
  }
}

/**
 * O evento ainda deve disparar, ou envelheceu demais?
 *
 * Devolve o motivo quando NÃO deve — é ele que vai para a coluna `erro`, para
 * a próxima pessoa não precisar adivinhar por que a automação não rodou.
 */
export function motivoParaNaoDisparar(
  evento: Pick<CbAutomationEvent, 'criado_em' | 'contact_id'>,
  agoraMs: number,
): string | null {
  // Sem contato não há a quem responder: o motor exige `contactId` para
  // qualquer passo que mande mensagem, e o card de conversa de grupo (ou o
  // card cujo contato foi apagado, que vira SET NULL) cai aqui.
  if (!evento.contact_id) return 'evento sem contato — nada a disparar'

  const idade = agoraMs - new Date(evento.criado_em).getTime()
  if (Number.isFinite(idade) && idade > IDADE_MAXIMA_MS) {
    const horas = Math.floor(idade / 3_600_000)
    return `evento atrasado ${horas}h — não disparado para não despejar fila represada`
  }
  return null
}

export interface ResultadoDaDrenagem {
  /**
   * Eventos ENTREGUES ao motor — não automações que rodaram.
   *
   * ⚠️ O nome é literal de propósito. O motor ainda filtra por escopo de
   * canal, escopo de etapa e casamento do gatilho, então "entregues: 1" com
   * zero automações executadas é resultado normal e correto. Chamar isto de
   * "disparados" faria a rota afirmar que uma automação rodou quando nenhuma
   * rodou — e é `automation_logs` que responde essa pergunta.
   */
  entregues: number
  ignorados: number
  falhas: number
}

/**
 * Esvazia a fila. Nunca lança — as duas pontas que chamam são
 * fire-and-forget e não podem derrubar o arrastar do card nem o ciclo do cron.
 */
export async function drenarEventosDeFunil(): Promise<ResultadoDaDrenagem> {
  const saida: ResultadoDaDrenagem = { entregues: 0, ignorados: 0, falhas: 0 }
  try {
    const db = supabaseAdmin()

    const { data: pendentes, error } = await db
      .from('cb_automation_events')
      .select('*')
      .is('processado_em', null)
      // Ordem de chegada: a esteira do funil tem sequência, e disparar
      // "entrou em Proposta" depois de "entrou em Fechamento" contaria a
      // história ao contrário para quem lê os logs.
      .order('criado_em', { ascending: true })
      .limit(LOTE)

    if (error) {
      console.error('[automations] drenagem: leitura da fila falhou', error)
      return saida
    }
    if (!pendentes || pendentes.length === 0) return saida

    const agora = Date.now()

    for (const linha of pendentes as CbAutomationEvent[]) {
      // ⚠️ REIVINDICAÇÃO EM DOIS PASSOS. O `is('processado_em', null)` no
      // UPDATE é o que impede o aviso imediato e o cron de dispararem o mesmo
      // evento — sem ele o cliente receberia a mensagem duas vezes. Quem
      // carimbar primeiro leva; o outro vê 0 linhas e segue.
      const { data: reivindicado, error: erroClaim } = await db
        .from('cb_automation_events')
        .update({ processado_em: new Date().toISOString() })
        .eq('id', linha.id)
        .is('processado_em', null)
        .select('id')
        .maybeSingle()

      if (erroClaim) {
        console.error('[automations] drenagem: reivindicação falhou', linha.id, erroClaim)
        saida.falhas += 1
        continue
      }
      // Outra ponta pegou este evento primeiro. Não é erro.
      if (!reivindicado) continue

      // ⚠️ O card mudou de etapa: as esperas de automação PRESA à etapa que
      // ele deixou são canceladas JÁ (`so-na-etapa.ts`). ANTES das guardas de
      // ciclo e de atraso, de propósito: evento velho ou de ciclo não DISPARA
      // nada, mas o card saiu da etapa do mesmo jeito. Nunca lança; o que
      // escapar daqui é barrado quando a espera acordar.
      if (linha.tipo === 'deal_stage_changed') {
        await cancelarEsperasAoSairDaEtapa({
          db,
          accountId: linha.account_id,
          contactId: linha.contact_id,
          dealId: linha.deal_id,
          toStageId: linha.to_stage_id,
          // Só o que já existia quando o card saiu: evento atrasado não pode
          // cancelar a execução que uma reentrada posterior iniciou.
          movidoEm: linha.criado_em,
        })
      }

      // Ciclo antes de idade: um encadeamento girando produz eventos frescos,
      // então a guarda de atraso nunca o pegaria.
      const motivo = fechaCiclo(linha)
        ? `ciclo detectado (${chaveDoEvento(linha)} já visitado neste encadeamento) — não disparado`
        : motivoParaNaoDisparar(linha, agora)
      if (motivo) {
        await db
          .from('cb_automation_events')
          .update({ erro: motivo })
          .eq('id', linha.id)
        saida.ignorados += 1
        continue
      }

      try {
        await runAutomationsForTrigger({
          accountId: linha.account_id,
          triggerType: linha.tipo,
          contactId: linha.contact_id,
          context: contextoDoEvento(linha),
        })
        saida.entregues += 1
      } catch (err) {
        // `runAutomationsForTrigger` já promete nunca lançar, mas a promessa
        // não é do compilador. O evento fica marcado como processado (não
        // reprocessa: retentar mandaria mensagem repetida ao cliente) com o
        // motivo escrito.
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[automations] drenagem: disparo falhou', linha.id, err)
        await db
          .from('cb_automation_events')
          .update({ erro: msg.slice(0, 500), tentativas: linha.tentativas + 1 })
          .eq('id', linha.id)
        saida.falhas += 1
      }
    }
  } catch (err) {
    console.error('[automations] drenagem falhou', err)
  }
  return saida
}

/**
 * Poda o acervo já processado.
 *
 * A fila cresce para sempre sem isto. 30 dias é o suficiente para investigar
 * "por que essa automação não rodou?" e curto o bastante para a tabela não
 * virar um arquivo morto.
 */
export async function podarEventosAntigos(): Promise<number> {
  try {
    const corte = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const { data, error } = await supabaseAdmin()
      .from('cb_automation_events')
      .delete()
      .not('processado_em', 'is', null)
      .lt('processado_em', corte)
      .select('id')
    if (error) {
      console.error('[automations] poda da fila falhou', error)
      return 0
    }
    return data?.length ?? 0
  } catch (err) {
    console.error('[automations] poda da fila falhou', err)
    return 0
  }
}
