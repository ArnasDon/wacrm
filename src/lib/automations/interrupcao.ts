// ============================================================
// A ANOTAÇÃO de uma execução interrompida por REGRA (18/09/2026).
//
// Dois cancelamentos novos acontecem sem ninguém clicar em nada: a resposta
// do cliente (`parar-se-responder.ts`) e o card que saiu da etapa
// (`so-na-etapa.ts`). Nos cancelamentos antigos — o botão Parar e o passo
// "Parar automação" — alguém DECIDIU, e por isso o registro da execução nem
// era tocado. Aqui, sem a anotação, a sequência sumiria da conversa sem
// deixar dito por quê, e "por que o cliente não recebeu a mensagem 4?" não
// teria resposta em tela nenhuma.
//
// ⚠️ Só ACRESCENTA a `steps_executed`. `status`, `desfecho` e
// `finalizado_em` NÃO são tocados — o precedente da 936 para todo
// cancelamento. A execução interrompida não aparece no fio nem no "Já rodou":
// não há desfecho que a descreva sem mentir (`concluida` e `barrada` dizem
// outra coisa), e um 4º desfecho pede migration no CHECK da 985 mais os
// consumidores — vale para os QUATRO cancelamentos, e ficou de fora.
//
// `skipped` num passo `wait`: `sinaisDoHistorico` ignora `wait` por inteiro,
// então a anotação não muda desfecho nenhum.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** Quantas vezes a anotação tenta de novo quando outro escritor chega antes. */
const TENTATIVAS_DA_ANOTACAO = 3;

/**
 * Melhor esforço, e NUNCA lança: quando isto roda a espera JÁ foi cancelada,
 * e anotação que falha não pode desfazer o cancelamento nem derrubar quem
 * chamou (a ingestão de mensagem, o dreno do funil, a retomada do agendador).
 *
 * ⚠️⚠️ GRAVA SÓ SE NINGUÉM ACRESCENTOU NADA DESDE A LEITURA (Codex, PR #223).
 * `steps_executed` é um array que todo escritor lê, acrescenta e regrava — o
 * `appendResults` do motor inclusive —, e esta anotação pode correr com ele:
 * a espera marcada dentro de um RAMO é cancelada enquanto o escopo de fora da
 * MESMA execução ainda roda (ramo em espera não segura o escopo de fora), ou
 * enquanto uma espera irmã é retomada. Regravando às cegas, o array lido
 * antes apagaria os passos que o motor acabou de gravar — e são eles que
 * decidem o desfecho (`sinaisDoHistorico`).
 *
 * A cerca é `steps_executed->>N IS NULL`, com N = quantos passos foram lidos:
 * todo escritor só ACRESCENTA, então "a posição N continua vazia" quer dizer
 * "ninguém escreveu desde que li". Zero linhas = alguém chegou antes → relê e
 * tenta de novo; esgotadas as tentativas, DESISTE da anotação. A garantia é
 * de mão única e é a que importa: esta função nunca apaga passo do motor. O
 * inverso ainda pode acontecer (o motor leu antes e regrava por cima, e a
 * anotação some) — custa uma linha explicativa, não o registro da execução.
 * Fechar esse lado pede append atômico no banco para TODOS os escritores
 * (uma RPC + o `appendResults`), que é outra obra. Forma do filtro MEDIDA
 * contra o PostgREST real em 18/09/2026.
 */
export async function anotarInterrupcao(
  db: SupabaseClient,
  logId: string | null,
  stepId: string | null,
  detalhe: string
): Promise<void> {
  if (!logId) return;
  try {
    for (let tentativa = 0; tentativa < TENTATIVAS_DA_ANOTACAO; tentativa++) {
      const { data, error } = await db
        .from('automation_logs')
        .select('steps_executed')
        .eq('id', logId)
        .maybeSingle();
      if (error || !data) return;

      const passos = Array.isArray(data.steps_executed)
        ? data.steps_executed
        : [];
      // ⚠️ IDEMPOTENTE por motivo: uma execução é interrompida UMA vez. Quem
      // chama já deduplica dentro da própria chamada, mas há o caso entre
      // chamadas — duas esperas irmãs da mesma execução que ACORDAM em horas
      // diferentes com o card fora da etapa, ou o dreno seguido da retomada —,
      // e a segunda linha igual contaria uma interrupção como duas. A leitura
      // já está em mãos: custa zero.
      const jaAnotada = passos.some(
        (p) =>
          !!p &&
          typeof p === 'object' &&
          (p as { detail?: unknown }).detail === detalhe &&
          (p as { status?: unknown }).status === 'skipped'
      );
      if (jaAnotada) return;
      const { data: gravadas, error: erroDaNota } = await db
        .from('automation_logs')
        .update({
          steps_executed: [
            ...passos,
            {
              step_id: stepId ?? '',
              step_type: 'wait',
              status: 'skipped',
              detail: detalhe,
            },
          ],
        })
        .eq('id', logId)
        .is(`steps_executed->>${passos.length}`, null)
        .select('id');
      if (erroDaNota) {
        console.error(
          '[automations] anotação da interrupção falhou:',
          erroDaNota.message
        );
        return;
      }
      if (gravadas && gravadas.length > 0) return;
      // Zero linhas: outro escritor acrescentou no meio. Relê e tenta de novo.
    }
    console.warn(
      '[automations] anotação da interrupção: desisti — o registro não parou de mudar'
    );
  } catch (err) {
    console.error('[automations] anotação da interrupção estourou:', err);
  }
}

/**
 * Os motivos de interrupção — o vocabulário de `automation_logs.interrompida_por`
 * (CHECK da 1005). Chave nova = migration no CHECK, senão o UPDATE é recusado
 * e a execução continua sem marca, em silêncio.
 */
export type MotivoDeInterrupcao =
  | 'resposta'
  | 'etapa'
  | 'parar'
  | 'passo'
  | 'desativacao';

/**
 * MARCA as execuções como interrompidas — a fonte da verdade (1005).
 *
 * ⚠️⚠️ Por que uma COLUNA no registro, e não as linhas da fila (a 1ª versão,
 * 5ª rodada do Codex no PR #223): há um instante em que a execução está
 * RODANDO e ainda não tem linha nenhuma na fila — antes da primeira espera —
 * e um cancelamento nesse instante não tinha onde se gravar; a espera vinha
 * depois, e se o card voltasse à etapa a execução antiga acordava ao lado da
 * nova. A marca vive no registro (`log_id`), que existe desde o primeiro
 * passo, e é consultada em DOIS lugares: pela retomada
 * (`execucaoJaInterrompida`) e pelo estacionamento, DENTRO da função
 * `cb_estacionar_espera`, que trava a linha do registro antes de inserir —
 * fechando o vão entre "perguntar" e "inserir".
 *
 * Só a PRIMEIRA marca fica (`interrompida_em is null` no WHERE): quem
 * interrompeu primeiro é o motivo que vale.
 *
 * NUNCA lança. Devolve quantos registros marcou agora.
 */
export async function marcarExecucoesInterrompidas(
  db: SupabaseClient,
  logIds: (string | null | undefined)[],
  motivo: MotivoDeInterrupcao
): Promise<number> {
  const ids = [
    ...new Set(logIds.filter((id): id is string => typeof id === 'string')),
  ];
  if (ids.length === 0) return 0;
  try {
    const { data, error } = await db
      .from('automation_logs')
      .update({ interrompida_em: new Date().toISOString(), interrompida_por: motivo })
      .in('id', ids)
      .is('interrompida_em', null)
      .select('id');
    if (error) {
      console.error('[automations] marcar interrompida falhou:', error.message);
      return 0;
    }
    return (data ?? []).length;
  } catch (err) {
    console.error('[automations] marcar interrompida estourou:', err);
    return 0;
  }
}

/**
 * Esta execução já foi interrompida — por QUALQUER cancelamento?
 *
 * Lê `automation_logs.interrompida_em` (1005): a marca que a resposta do
 * cliente, a saída da etapa, o botão Parar, o passo "Parar automação" e a
 * desativação gravam. A continuação que ainda NÃO estava estacionada quando o
 * cancelamento aconteceu (o escopo de fora rodando, a retentativa, a espera
 * fora do corte por data do dreno) acorda, pergunta aqui, e não retoma. Vem
 * ANTES da conferência de etapa na retomada: o card pode ter voltado, e ainda
 * assim a execução antiga acabou.
 *
 * ⚠️ Falha ABERTA (erro de leitura = "não foi interrompida"): é a segunda
 * linha de defesa de uma corrida de segundos, e travar a retomada de TODA
 * automação por um soluço de banco custaria mais do que ela protege.
 */
/**
 * Cancela toda espera PENDENTE de uma execução (por `log_id`) — a segunda
 * varredura de todo cancelamento, DEPOIS da marca. A marca impede a irmã de
 * retomar; sem a varredura ela ficaria `pending` na aba até acordar. Nunca
 * lança; devolve quantas caíram.
 */
export async function cancelarEsperasDaExecucao(
  db: SupabaseClient,
  logId: string | null | undefined
): Promise<number> {
  if (!logId) return 0;
  try {
    const { data, error } = await db
      .from('automation_pending_executions')
      .update({ status: 'cancelled' })
      .eq('log_id', logId)
      .eq('status', 'pending')
      .select('id');
    if (error) {
      console.error(
        '[automations] cancelamento das esperas da execução falhou:',
        error.message
      );
      return 0;
    }
    return (data ?? []).length;
  } catch (err) {
    console.error('[automations] cancelamento das esperas da execução estourou:', err);
    return 0;
  }
}

export async function execucaoJaInterrompida(
  db: SupabaseClient,
  logId: string | null
): Promise<boolean> {
  if (!logId) return false;
  try {
    const { data, error } = await db
      .from('automation_logs')
      .select('interrompida_em')
      .eq('id', logId)
      .maybeSingle();
    if (error) return false;
    return Boolean((data as { interrompida_em?: string | null } | null)?.interrompida_em);
  } catch {
    return false;
  }
}
