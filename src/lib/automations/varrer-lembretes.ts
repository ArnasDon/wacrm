import type { Automation, DateFieldTriggerConfig } from '@/types'
import { supabaseAdmin } from './admin-client'
import { dispararAutomacoes } from './engine'
import { janelaDeBusca, motivoDeConfigInvalida, travaDeveSerDevolvida } from './lembretes'

// ------------------------------------------------------------
// Varredura do gatilho de lembrete por data (migration 935).
//
// Roda a cada ciclo do cron. Para cada automação ativa deste tipo, pergunta ao
// banco quem tem o campo de data caindo na janela e dispara — uma vez só por
// (automação, contato, valor).
//
// ⚠️ ISTO NÃO PASSA PELA FILA `cb_automation_events`. Aquela existe porque o
// gatilho de funil nasce de uma ESCRITA feita no navegador, sem ponto único no
// servidor. Aqui não há escrita nenhuma: o disparo nasce da passagem do tempo,
// e o cron já é o lugar onde o tempo passa. Enfileirar seria dar uma volta
// para chegar no mesmo ponto.
// ------------------------------------------------------------

export interface ResultadoDaVarredura {
  /** Automações de lembrete examinadas neste ciclo. */
  examinadas: number
  /** Disparos feitos (uma por contato). */
  disparados: number
  /** Já disparados antes para o mesmo (automação, contato, valor). */
  repetidos: number
  /**
   * A trava foi devolvida: o motor recusou o disparo nos recortes (quase
   * sempre o escopo de etapa) e nada saiu, então o ciclo seguinte tenta de
   * novo. Sem isto o lembrete se perdia para sempre — ver
   * `travaDeveSerDevolvida`.
   */
  devolvidos: number
  falhas: number
}

/** Nunca lança: o cron não pode cair por causa de uma automação torta. */
export async function varrerLembretes(): Promise<ResultadoDaVarredura> {
  const saida: ResultadoDaVarredura = {
    examinadas: 0,
    disparados: 0,
    repetidos: 0,
    devolvidos: 0,
    falhas: 0,
  }
  try {
    const db = supabaseAdmin()

    const { data: automacoes, error } = await db
      .from('automations')
      .select('*')
      .eq('trigger_type', 'date_field_offset')
      .eq('is_active', true)

    if (error) {
      console.error('[automations] varredura de lembretes: leitura falhou', error)
      return saida
    }
    if (!automacoes || automacoes.length === 0) return saida

    const agora = Date.now()

    for (const bruta of automacoes as Automation[]) {
      saida.examinadas += 1
      const cfg = bruta.trigger_config as DateFieldTriggerConfig

      const invalida = motivoDeConfigInvalida(cfg)
      if (invalida) {
        // Não é falha de execução: é regra mal montada. A ativação já recusa
        // isto, então só chega aqui automação gravada antes da validação.
        console.warn('[automations] lembrete ignorado:', bruta.id, invalida)
        continue
      }

      const { de, ate } = janelaDeBusca(cfg, agora)

      // ------------------------------------------------------------
      // De onde vem a data (947).
      //
      // ⚠️ A fonte AUSENTE é `campo`, nunca `reuniao`. As automações que já
      // existem não têm o atributo, e tratá-las como agenda faria o lembrete do
      // Calendly parar de sair no dia do deploy — sem erro em lugar nenhum,
      // porque a varredura simplesmente não acharia mais alvo.
      //
      // As duas funções devolvem `(contact_id, valor)` de propósito: o resto do
      // caminho — trava anti-repetição e disparo — é idêntico e não precisa
      // saber de onde a data veio.
      // ------------------------------------------------------------
      const daAgenda = cfg.fonte === 'reuniao'

      const { data: alvos, error: erroAlvos } = daAgenda
        ? await db.rpc('cb_alvos_de_lembrete_reuniao', {
            p_account_id: bruta.account_id,
            p_de: de,
            p_ate: ate,
            // ⚠️ Follow-up ("depois") tem de aceitar reunião REALIZADA (952):
            // a janela cai depois do início, e marcar `realizada` é
            // exatamente o que o operador diligente faz nesse meio-tempo —
            // só com `agendada`, o follow-up saía apenas para quem NÃO
            // atualiza a agenda. `falta` e `cancelada` continuam fora nas
            // duas direções: mensagem sobre reunião que não houve.
            p_incluir_realizadas: cfg.direction === 'depois',
          })
        : await db.rpc('cb_alvos_de_lembrete', {
            p_account_id: bruta.account_id,
            p_custom_field_id: cfg.custom_field_id,
            p_de: de,
            p_ate: ate,
          })

      if (erroAlvos) {
        console.error('[automations] varredura: busca de alvos falhou', bruta.id, erroAlvos)
        saida.falhas += 1
        continue
      }

      for (const alvo of (alvos ?? []) as { contact_id: string; valor: string }[]) {
        // ⚠️ A TRAVA VEM ANTES DO DISPARO, e o INSERT é a própria
        // reivindicação. Ler-depois-escrever abriria janela para dois ciclos
        // sobrepostos mandarem o mesmo lembrete duas vezes ao cliente.
        const { data: trava, error: erroTrava } = await db
          .from('cb_automation_reminders')
          .insert({
            account_id: bruta.account_id,
            automation_id: bruta.id,
            contact_id: alvo.contact_id,
            valor: alvo.valor,
            // `motivo` separa esta linha da que o CANCELAMENTO do Calendly
            // pré-arma (1013): lá `disparado_em` estaria preenchido sem
            // envio nenhum.
            motivo: 'disparo',
          })
          .select('id')
          .maybeSingle()

        if (erroTrava) {
          // 23505 = já disparou para este (automação, contato, valor).
          // É o caso NORMAL de todo ciclo depois do primeiro.
          if (erroTrava.code === '23505') {
            saida.repetidos += 1
            continue
          }
          console.error('[automations] varredura: trava falhou', bruta.id, erroTrava)
          saida.falhas += 1
          continue
        }

        const resultado = await dispararAutomacoes({
          accountId: bruta.account_id,
          triggerType: 'date_field_offset',
          contactId: alvo.contact_id,
          // Sem canal: o lembrete nasce do relógio, não de uma mensagem. O
          // escopo de canal deixa passar (falha aberta, como todo disparo sem
          // canal) e o envio cai no canal da conversa do contato — que é o
          // número por onde ele fala, e é o certo aqui.
          //
          // ⚠️ `automation_id` é o que impede o leque: o dispatch é por TIPO,
          // e sem o carimbo o `triggerMatches` aceitava todas as automações
          // de lembrete da conta — o alvo de uma executava as outras, fora
          // das janelas delas. O motor só roda a carimbada (fail closed).
          context: {
            automation_id: bruta.id,
            vars: { _lembrete_valor: alvo.valor },
          },
        })

        // ⚠️ RECORTE NÃO PODE QUEIMAR A TRAVA. O disparo passa por conexão,
        // gatilho e escopo de etapa DEPOIS de a trava estar gravada; recusado
        // ali, nada saiu e o lembrete ficaria perdido para sempre. Devolve-se
        // a linha — pelo ID dela, nunca pela chave, para não alcançar por
        // engano uma trava pré-armada por cancelamento.
        if (travaDeveSerDevolvida(resultado)) {
          const id = trava?.id as string | undefined
          if (!id) {
            // Sem o id não há como devolver com segurança. Não é falha de
            // execução: a mensagem não saiu, e o registro fica como estava.
            console.warn('[automations] lembrete barrado sem id de trava:', bruta.id)
            saida.repetidos += 1
            continue
          }
          const { error: erroDevolucao } = await db
            .from('cb_automation_reminders')
            .delete()
            .eq('id', id)
          if (erroDevolucao) {
            console.error('[automations] devolução da trava falhou', bruta.id, erroDevolucao)
            saida.falhas += 1
            continue
          }
          saida.devolvidos += 1
          continue
        }
        saida.disparados += 1
      }
    }
  } catch (err) {
    console.error('[automations] varredura de lembretes falhou', err)
  }
  return saida
}

/**
 * Poda travas antigas. 90 dias: tempo de sobra para investigar "por que este
 * cliente não recebeu?", e curto o bastante para a tabela não virar arquivo.
 *
 * ⚠️ Podar cedo demais FAZ O LEMBRETE REPETIR: sem a trava, um valor de data
 * ainda dentro da janela dispararia de novo.
 */
export async function podarLembretesAntigos(): Promise<number> {
  try {
    const corte = new Date(Date.now() - 90 * 86_400_000).toISOString()
    const { data, error } = await supabaseAdmin()
      .from('cb_automation_reminders')
      .delete()
      .lt('disparado_em', corte)
      .select('id')
    if (error) {
      console.error('[automations] poda de lembretes falhou', error)
      return 0
    }
    return data?.length ?? 0
  } catch {
    return 0
  }
}
