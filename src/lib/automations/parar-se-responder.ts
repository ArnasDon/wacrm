// ============================================================
// "Aguardar — parar se o cliente responder" (18/09/2026).
//
// O pedido do operador, com o Kommo aberto ao lado: numa sequência de dez
// mensagens de recuperação, cada pausa lá tem DUAS saídas — o cronômetro e
// "até a mensagem recebida", que leva a "Parar robô". Aqui o "Aguardar" só
// contava tempo: o cliente respondia na mensagem 3 e recebia as outras sete.
//
// O desenho é o MENOR que cobre isso: uma caixa no passo "Aguardar". Marcada,
// a espera estacionada é CANCELADA quando o cliente manda qualquer mensagem —
// e, como o resto da automação só roda quando a espera acorda, cancelar a
// espera é parar a automação para aquele contato.
//
// ⚠️⚠️ A MARCA MORA NO `context` DA FILA, e só lá. Mesma escolha do contador
// de retentativa (`retentativa.ts`): `automation_pending_executions.context`
// já atravessa a execução, e coluna nova exigiria migration — com a armadilha
// de ordem de deploy junto, porque o INSERT da espera com coluna inexistente
// falharia para toda espera marcada. A invariante que sustenta isso:
//
//   a marca existe APENAS no contexto GRAVADO de uma espera estacionada,
//   nunca num contexto VIVO de execução.
//
// O contexto é copiado de ponta a ponta (a espera seguinte, a retentativa, o
// `run_automation` herdam `args.context`), então sem a limpeza na retomada a
// marca de uma espera vazaria para as seguintes — inclusive as que o operador
// NÃO marcou — e uma resposta do cliente cancelaria o que não devia. Por isso
// `contextoDaEspera` escreve a decisão a CADA estacionamento (marca ou
// limpa), e `semMarcaDeResposta` roda na retomada.
//
// ⚠️ O valor da marca é o ID DO PASSO "Aguardar", não `true`: é o que permite
// anotar no registro da execução QUAL espera foi interrompida.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { anotarInterrupcao, marcarExecucoesInterrompidas } from './interrupcao';

/** Sublinhado inicial: a convenção das chaves internas do contexto. */
export const CHAVE_PARAR_SE_RESPONDER = '_parar_se_responder';

/** O texto que fica no registro da execução (tela de histórico da automação). */
export const DETALHE_DA_INTERRUPCAO =
  'interrompida: o cliente respondeu durante a espera';

/**
 * O contexto sem a marca — para a RETOMADA, e base de todo estacionamento.
 *
 * Devolve o MESMO objeto quando não há marca: a maioria das esperas não é
 * marcada, e copiar o contexto à toa a cada retomada não compra nada.
 */
export function semMarcaDeResposta<T extends object>(context: T): T {
  if (!(CHAVE_PARAR_SE_RESPONDER in context)) return context;
  const copia = { ...context } as Record<string, unknown>;
  delete copia[CHAVE_PARAR_SE_RESPONDER];
  return copia as T;
}

/**
 * O contexto a gravar na fila quando um "Aguardar" estaciona.
 *
 * ⚠️ Só o booleano `true` liga (`"true"` e `1` são truthy em JS e chegam de
 * JSONB gravado por qualquer versão): ligar por engano PARA a sequência de
 * um cliente em silêncio — o modo de falha que ninguém vê.
 */
export function contextoDaEspera<T extends object>(
  context: T,
  cfg: { parar_se_responder?: unknown } | null | undefined,
  stepId: string
): T {
  const limpo = semMarcaDeResposta(context);
  if (cfg?.parar_se_responder !== true) return limpo;
  return { ...limpo, [CHAVE_PARAR_SE_RESPONDER]: stepId };
}

/**
 * O cliente escreveu: cancela as esperas MARCADAS deste contato.
 *
 * ⚠️⚠️ Chamar ANTES de despachar robôs e automações para a mensagem, nos
 * DOIS caminhos de ingestão (Evolution e Meta — produção roda os dois). Duas
 * razões, e as duas são a feature:
 *
 *   1. Depois do despacho, a automação que ESTA mensagem acabou de iniciar
 *      já pode ter estacionado a própria espera marcada — e ela seria
 *      cancelada pela mesma mensagem que a iniciou.
 *   2. Não pode depender de `flowConsumed`: o cliente respondeu, e isso é
 *      verdade mesmo quando um robô consumiu a resposta. (O gatilho "Nova
 *      mensagem recebida" é suprimido nesse caso, e era essa a fresta do
 *      contorno com duas automações.)
 *
 * ⚠️ As MESMAS cercas do passo `stop_automation` e do botão Parar: conta +
 * CONTATO + `status = 'pending'`. Sem o contato, a resposta de um cliente
 * pararia a sequência de todos. Espera que o agendador já reivindicou
 * (`running`) não é alcançada — a mensagem seguinte já está saindo, e essa
 * corrida de segundos é a mesma dos outros dois cancelamentos.
 *
 * ⚠️ `cancelled`, nunca `failed` (decisão da 936): cancelamento não é erro.
 * O desfecho do log NÃO é tocado — como nos outros cancelamentos —, mas a
 * interrupção é ANOTADA nos passos (`interrupcao.ts`): aqui ninguém clicou em
 * nada, e sem a anotação a sequência sumiria sem deixar dito por quê.
 *
 * ⚠️ NÃO compara a hora da mensagem com a hora em que a espera nasceu, de
 * propósito. O carimbo da mensagem vem do WhatsApp em SEGUNDOS e o da espera
 * é o `now()` do banco: a resposta dada um segundo depois da mensagem da
 * automação poderia parecer "anterior" e não cancelar — que é exatamente o
 * dano que a caixa existe para impedir (cobrar quem está falando). O erro do
 * outro lado — conexão represada entregando com atraso uma mensagem antiga, e
 * ela parar a sequência — custa menos: o cliente que ESCREVEU deixa de
 * receber a recuperação. Entre os dois, cancela.
 *
 * NUNCA lança: roda no caminho de ingestão, e uma falha aqui não pode custar
 * a mensagem do cliente. Devolve quantas esperas cancelou.
 */
export async function cancelarEsperasPorResposta(args: {
  db: SupabaseClient;
  accountId: string;
  contactId: string;
}): Promise<number> {
  const { db, accountId, contactId } = args;
  try {
    const { data, error } = await db
      .from('automation_pending_executions')
      .update({ status: 'cancelled' })
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'pending')
      .not(`context->>${CHAVE_PARAR_SE_RESPONDER}`, 'is', null)
      .select(`id, log_id, passo:context->>${CHAVE_PARAR_SE_RESPONDER}`);

    if (error) {
      console.error(
        '[automations] parar-se-responder: cancelamento falhou:',
        error.message
      );
      return 0;
    }

    const canceladas = (data ?? []) as unknown as {
      id: string;
      log_id: string | null;
      passo: string | null;
    }[];
    if (canceladas.length === 0) return 0;

    // ⚠️⚠️ A PARADA É DA EXECUÇÃO, não da linha (Codex, PR #223). Uma espera
    // marcada DENTRO DE UM RAMO não é a única ponta viva da execução: ramo em
    // espera não segura o escopo de fora, que segue e pode estacionar a SUA
    // espera — sem marca — mais adiante. Cancelando só a linha marcada, a irmã
    // acordava e a sequência continuava, com a caixa prometendo "parar a
    // automação". E espera dentro de ramo é a forma NORMAL das automações
    // deste escritório (a trava só gateia com o corpo dentro do ramo), então
    // recusar a opção ali não era saída. `log_id` é a identidade da execução.
    const execucoes = [
      ...new Set(
        canceladas
          .map((c) => c.log_id)
          .filter((id): id is string => typeof id === 'string')
      ),
    ];
    // ⚠️ A MARCA primeiro (1005): é ela que a retomada e o estacionamento
    // consultam. As linhas da fila são a foto de agora; a marca é o que segura
    // a continuação que ainda nem existe.
    await marcarExecucoesInterrompidas(db, execucoes, 'resposta');

    let irmas = 0;
    if (execucoes.length > 0) {
      const { data: outras, error: erroDasIrmas } = await db
        .from('automation_pending_executions')
        .update({ status: 'cancelled' })
        .in('log_id', execucoes)
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .eq('status', 'pending')
        .select('id');
      if (erroDasIrmas) {
        // A marcada já foi cancelada; a irmã que escapar aqui ainda é barrada
        // quando acordar (`execucaoJaInterrompida`, na retomada).
        console.error(
          '[automations] parar-se-responder: cancelamento das irmãs falhou:',
          erroDasIrmas.message
        );
      } else {
        irmas = (outras ?? []).length;
      }
    }

    // Uma anotação por EXECUÇÃO, com o passo da primeira espera marcada dela.
    const anotadas = new Set<string>();
    for (const espera of canceladas) {
      if (!espera.log_id || anotadas.has(espera.log_id)) continue;
      anotadas.add(espera.log_id);
      await anotarInterrupcao(
        db,
        espera.log_id,
        espera.passo,
        DETALHE_DA_INTERRUPCAO
      );
    }
    return canceladas.length + irmas;
  } catch (err) {
    console.error('[automations] parar-se-responder estourou:', err);
    return 0;
  }
}
