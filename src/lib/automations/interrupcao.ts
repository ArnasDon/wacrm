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
