// ============================================================
// Automação PRESA À ETAPA: "interromper se o card sair desta etapa"
// (18/09/2026).
//
// O caso que motivou: a recuperação de No Show manda dez mensagens com o link
// de agendamento. Na 3ª o cliente agenda, a automação do Calendly move o card
// para "Reunião Agendada" — e as outras sete saíam assim mesmo, cobrando o
// retorno de quem já tinha voltado. O "Aguardar" acordava e seguia, estivesse
// o card onde estivesse; a única defesa era uma condição "ainda está em No
// Show?" escrita à mão depois de CADA espera, com o resto aninhado dentro do
// ramo (ramo vazio não para o escopo de fora) — dez níveis para dez mensagens.
//
// A opção mora no GATILHO (`trigger_config.parar_ao_sair`), sem migration.
// Decisão do operador (18/09/2026): é uma caixa POR AUTOMAÇÃO, que nasce
// MARCADA nas automações de etapa novas — e não uma regra geral invisível,
// porque existe sequência que DEVE sobreviver à etapa: as boas-vindas de
// "Contrato Fechado", cujo card é transferido para o funil do Jurídico logo
// em seguida. Automação gravada antes disto não tem a chave = não muda.
//
// ⚠️⚠️ SÃO DUAS PONTAS, e nenhuma dispensa a outra:
//
//   1. NA RETOMADA (`cardSaiuDaEtapa`, chamada por `resumePendingExecution`):
//      a GARANTIA. Lê a etapa do banco na hora em que a espera acorda — vale
//      para qualquer caminho que tenha movido o card (são cinco escritores de
//      etapa), inclusive os que não geram evento, e para o card APAGADO.
//   2. NO EVENTO DE FUNIL (`cancelarEsperasAoSairDaEtapa`, chamada pelo
//      dreno): a HONESTIDADE DA TELA. Só com a ponta 1, a aba Automações da
//      conversa e a marca "tem robô rodando" continuariam dizendo "próxima
//      mensagem em 27 h" sobre quem já reagendou, até a espera acordar — e o
//      operador iria lá clicar em Parar, que é o trabalho manual que isto
//      existe para acabar. E há um ganho de verdade: o card que SAI e VOLTA
//      para a etapa antes de a espera acordar recomeça a sequência do zero
//      (execução nova) em vez de ficar com DUAS correndo.
//
// ⚠️ A regra vale para QUALQUER execução da automação presa, inclusive a
// disparada à mão pelo "Executar automação" — de propósito. O caso comum de
// hoje é o card que JÁ estava em No Show quando a automação foi criada: o
// operador a executa à mão, o cliente agenda, e a sequência tem de parar
// igual. O preço: executar à mão uma automação presa para quem NÃO está na
// etapa manda os passos até o primeiro "Aguardar" e para ali.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { anotarInterrupcao, marcarExecucoesInterrompidas } from './interrupcao';

export const DETALHE_SAIU_DA_ETAPA =
  'interrompida: o card saiu da etapa desta automação';

interface AutomacaoComGatilho {
  trigger_type: string;
  trigger_config: unknown;
}

/**
 * As etapas que PRENDEM esta automação, ou `null` quando ela não é presa.
 *
 * ⚠️ Três condições, todas necessárias:
 *   - gatilho de etapa (em qualquer outro a chave não significa nada);
 *   - `parar_ao_sair === true` ESTRITO (JSONB entrega `"true"` e `1`, que são
 *     truthy — ligar por engano mata uma sequência em silêncio);
 *   - pelo menos uma etapa nomeada: com `stage_ids` vazio o gatilho vale para
 *     QUALQUER etapa, e "sair da etapa" não tem de onde.
 */
export function etapasQuePrendem(
  automation: AutomacaoComGatilho
): string[] | null {
  if (automation.trigger_type !== 'deal_stage_changed') return null;
  const cfg = automation.trigger_config as
    | { stage_ids?: unknown; parar_ao_sair?: unknown }
    | null
    | undefined;
  if (cfg?.parar_ao_sair !== true) return null;
  const etapas = Array.isArray(cfg.stage_ids)
    ? cfg.stage_ids.filter(
        (e): e is string => typeof e === 'string' && e.trim() !== ''
      )
    : [];
  return etapas.length > 0 ? etapas : null;
}

/**
 * O card está FORA das etapas que prendem?
 *
 * `etapaAtual` nula = não há card (apagado, ou o contato não tem negócio
 * aberto): não está em etapa nenhuma, logo está fora. É fato, não ignorância
 * — o mesmo trato de `stageInScope` para contato sem negócio.
 */
export function estaFora(etapas: string[], etapaAtual: string | null): boolean {
  return etapaAtual === null || !etapas.includes(etapaAtual);
}

export type SituacaoNaEtapa =
  /** A automação não é presa a etapa: nada a conferir. */
  | 'nao_se_aplica'
  | 'na_etapa'
  | 'saiu'
  /** A leitura falhou. Quem chama decide — e NÃO pode tratar como 'na_etapa'. */
  | 'erro';

/**
 * PONTA 1 — a espera acordou: o card ainda está numa etapa desta automação?
 *
 * ⚠️ Lê o BANCO, nunca o contexto: `context.to_stage_id` é onde o card estava
 * quando o evento nasceu, e depois de um "Aguardar" de 30 horas isso é
 * história. Mesma razão da condição `deal_stage` do motor.
 *
 * O card é o do CONTEXTO (`deal_id`, que o evento de funil carimba) e, sem
 * ele — execução disparada à mão —, o negócio ABERTO mais recente do contato:
 * a mesma resolução de `negocioAlvo` no motor.
 *
 * ⚠️ Erro de leitura é `'erro'`, nunca `'na_etapa'` nem `'saiu'`: o primeiro
 * cobraria quem pode ter saído, o segundo mataria a sequência de quem ficou —
 * e os dois em silêncio. Quem chama falha de forma VISÍVEL.
 */
export async function cardSaiuDaEtapa(args: {
  db: SupabaseClient;
  automation: AutomacaoComGatilho & { account_id: string };
  contactId: string | null;
  dealId: string | null | undefined;
}): Promise<SituacaoNaEtapa> {
  const etapas = etapasQuePrendem(args.automation);
  if (!etapas) return 'nao_se_aplica';

  const { db, automation, contactId, dealId } = args;
  try {
    let etapaAtual: string | null = null;
    if (dealId) {
      const { data, error } = await db
        .from('deals')
        .select('stage_id')
        .eq('id', dealId)
        .eq('account_id', automation.account_id)
        .maybeSingle();
      if (error) return 'erro';
      etapaAtual = (data?.stage_id as string | undefined) ?? null;
    } else if (contactId) {
      const { data, error } = await db
        .from('deals')
        .select('stage_id')
        .eq('account_id', automation.account_id)
        .eq('contact_id', contactId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return 'erro';
      etapaAtual = (data?.stage_id as string | undefined) ?? null;
    }
    return estaFora(etapas, etapaAtual) ? 'saiu' : 'na_etapa';
  } catch (err) {
    console.error('[automations] so-na-etapa: leitura estourou:', err);
    return 'erro';
  }
}

interface ExecucaoCandidata {
  id: string;
  automation_id: string;
  automations: AutomacaoComGatilho | AutomacaoComGatilho[] | null;
}

/**
 * Das execuções VIVAS de automações de etapa deste contato, quais este
 * movimento encerra. PURO.
 *
 * ⚠️ A unidade é a EXECUÇÃO (o registro), não a espera (5ª rodada do Codex,
 * PR #223): entre o disparo e a primeira espera a execução está rodando e não
 * tem linha nenhuma na fila — e uma saída nesse instante não tinha onde se
 * gravar. O registro existe desde o primeiro passo.
 */
export function execucoesQueOMovimentoEncerra(
  candidatas: ExecucaoCandidata[],
  toStageId: string
): ExecucaoCandidata[] {
  return candidatas.filter((execucao) => {
    const automacao = Array.isArray(execucao.automations)
      ? execucao.automations[0]
      : execucao.automations;
    if (!automacao) return false;
    const etapas = etapasQuePrendem(automacao);
    if (!etapas) return false;
    // Entrou em OUTRA etapa que também prende esta automação (o cartão
    // "expandido" na grade): continua dentro.
    return estaFora(etapas, toStageId);
  });
}

/**
 * PONTA 2 — o card mudou de etapa: cancela JÁ as esperas presas que ficaram
 * para trás, em vez de deixá-las na tela até acordarem.
 *
 * ⚠️ Chamada pelo dreno ANTES das guardas de ciclo e de atraso: evento velho
 * ou de ciclo não DISPARA automação, mas o card saiu da etapa do mesmo jeito.
 * E antes do despacho, por clareza — as automações da etapa NOVA têm essa
 * etapa no gatilho, então nunca são alcançadas aqui.
 *
 * ⚠️ As MESMAS cercas dos outros cancelamentos: conta + CONTATO +
 * `status = 'pending'`. A execução que está RODANDO (a própria automação
 * presa que moveu o card com `move_deal_stage`) não é alcançada — os passos
 * até o próximo "Aguardar" saem; o que vier depois de uma espera, não.
 *
 * NUNCA lança: roda dentro do dreno do funil, e uma falha aqui não pode
 * custar o disparo das automações da etapa nova. A ponta 1 cobre o que
 * escapar.
 */
export async function cancelarEsperasAoSairDaEtapa(args: {
  db: SupabaseClient;
  accountId: string;
  contactId: string | null;
  dealId: string | null;
  toStageId: string | null;
  /**
   * `criado_em` do evento de funil — o instante em que o card se moveu.
   *
   * ⚠️⚠️ Só a execução que JÁ EXISTIA quando o card saiu (Codex, PR #223).
   * Os eventos não são processados em ordem garantida: o aviso imediato e o
   * cron drenam ao mesmo tempo, evento por evento, e o card que SAI e VOLTA
   * rápido pode ter a reentrada processada ANTES da saída. Sem este corte, a
   * saída atrasada enxergaria a execução NOVA — a que a reentrada acabou de
   * iniciar — e a mataria: o cliente voltou para No Show e ficaria sem a
   * sequência, em silêncio. Os dois carimbos são `now()` do MESMO banco.
   */
  movidoEm: string | null;
}): Promise<number> {
  const { db, accountId, contactId, dealId, toStageId, movidoEm } = args;
  if (!contactId || !dealId || !toStageId) return 0;
  try {
    // As execuções VIVAS (sem hora de fim) de automações de etapa deste
    // contato — inclusive a que está RODANDO agora, sem espera nenhuma.
    let consulta = db
      .from('automation_logs')
      .select('id, automation_id, automations!inner(trigger_type, trigger_config)')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .is('finalizado_em', null)
      .is('interrompida_em', null)
      .eq('automations.trigger_type', 'deal_stage_changed');
    if (movidoEm) consulta = consulta.lte('created_at', movidoEm);
    const { data, error } = await consulta;
    if (error) {
      console.error(
        '[automations] so-na-etapa: leitura das execuções falhou:',
        error.message
      );
      return 0;
    }
    const alvos = execucoesQueOMovimentoEncerra(
      (data ?? []) as unknown as ExecucaoCandidata[],
      toStageId
    );
    if (alvos.length === 0) return 0;

    // ⚠️ O registro não guarda o card. Numa conta em que o contato tem DOIS
    // negócios abertos em etapas presas, a saída de um marcaria a execução do
    // outro — aceito e escrito: "um card por contato" é a regra desta casa.
    const logIds = alvos.map((a) => a.id);
    const marcadas = await marcarExecucoesInterrompidas(db, logIds, 'etapa');

    // A foto de agora: toda espera pendente dessas execuções cai — sem corte
    // por data, porque a execução NOVA da reentrada é outro registro.
    const { data: canceladas, error: erroDoCancelamento } = await db
      .from('automation_pending_executions')
      .update({ status: 'cancelled' })
      .in('log_id', logIds)
      .eq('account_id', accountId)
      .eq('status', 'pending')
      .select('id');
    if (erroDoCancelamento) {
      console.error(
        '[automations] so-na-etapa: cancelamento falhou:',
        erroDoCancelamento.message
      );
    }

    for (const logId of logIds) {
      await anotarInterrupcao(db, logId, null, DETALHE_SAIU_DA_ETAPA);
    }
    return marcadas + (canceladas ?? []).length;
  } catch (err) {
    console.error('[automations] so-na-etapa estourou:', err);
    return 0;
  }
}
