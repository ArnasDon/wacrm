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

/**
 * Melhor esforço, e NUNCA lança: quando isto roda a espera JÁ foi cancelada,
 * e anotação que falha não pode desfazer o cancelamento nem derrubar quem
 * chamou (a ingestão de mensagem, o dreno do funil, a retomada do agendador).
 */
export async function anotarInterrupcao(
  db: SupabaseClient,
  logId: string | null,
  stepId: string | null,
  detalhe: string
): Promise<void> {
  if (!logId) return;
  try {
    const { data, error } = await db
      .from('automation_logs')
      .select('steps_executed')
      .eq('id', logId)
      .maybeSingle();
    if (error || !data) return;

    const passos = Array.isArray(data.steps_executed)
      ? data.steps_executed
      : [];
    const { error: erroDaNota } = await db
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
      .eq('id', logId);
    if (erroDaNota) {
      console.error(
        '[automations] anotação da interrupção falhou:',
        erroDaNota.message
      );
    }
  } catch (err) {
    console.error('[automations] anotação da interrupção estourou:', err);
  }
}
