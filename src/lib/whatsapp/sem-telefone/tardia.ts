// ============================================================
// Mensagem recuperada TARDIA: ainda é a última da conversa, mas chegou tarde
// demais para os motores (`modo.ts`). Ela entra como história — e a CONVERSA
// passa a refleti-la, porque nada mais novo do que ela existe:
//
//   reabre    se estava encerrada, SEM responsável — a regra da caixa em duas
//             abas ("qualquer mensagem de gente a devolve"), pelo MESMO helper
//             dos quatro caminhos normais. Quem encerrou o fez sem ver esta
//             mensagem;
//   prévia    pelo recálculo canônico que a edição e a exclusão já usam (lê a
//             mensagem mais recente pelo carimbo — se outra chegou no meio, é
//             ela que fica, e nada se perde);
//   posição   `last_message_at` = agora, como o caminho normal faz com
//             qualquer mensagem que acaba de chegar.
//
// O que continua de fora é o que faz da histórica uma história: robô,
// automação, IA, funil, canal da conversa e a medição de atraso de entrega
// (`historica.chamadores.test.ts` cobra os dois arquivos).
//
// Roda ENTRE o insert e `cb_assentar_mensagem_historica`, de propósito: a
// função trata conversa encerrada como "ninguém espera", e a espera do
// cliente só é calculada se a conversa já estiver reaberta.
//
// NUNCA lança: a mensagem já está no fio, e o que se perde aqui é o reflexo
// dela na lista — nunca a mensagem.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { reopenClosedConversation } from '@/lib/conversations/reopen';
import { atualizarPreviaDaConversa } from '@/lib/inbox/conversation-preview';

export async function refletirComoUltima(
  db: SupabaseClient,
  conversationId: string
): Promise<void> {
  try {
    const { data: conversa, error } = await db
      .from('conversations')
      .select('id, status')
      .eq('id', conversationId)
      .maybeSingle();
    if (error || !conversa) {
      console.error(
        '[evolution/sem-telefone] ler a conversa da tardia falhou:',
        error?.message ?? 'conversa não encontrada'
      );
      return;
    }

    // Cliente e celular pareado reabrem SEM responsável (ver `reopen.ts`).
    await reopenClosedConversation(db, {
      id: conversa.id as string,
      status: conversa.status as string | null,
    });

    await atualizarPreviaDaConversa(db, conversationId);
    const { error: erroDaPosicao } = await db
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId);
    if (erroDaPosicao) {
      console.error(
        '[evolution/sem-telefone] subir a conversa da tardia falhou:',
        erroDaPosicao.message
      );
    }
  } catch (err) {
    console.error(
      '[evolution/sem-telefone] refletir a tardia na conversa falhou:',
      err instanceof Error ? err.message : err
    );
  }
}
