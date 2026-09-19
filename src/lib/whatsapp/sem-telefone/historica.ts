// ============================================================
// Grava uma mensagem recuperada como HISTÓRIA: ela entra no fio, no lugar do
// carimbo dela, e mais nada.
//
// Existe separada de `persistInboundMessage`/`persistDeviceMessage` pelo mesmo
// motivo que `persistDeviceMessage` existe separada: uma função que NÃO chama
// o fan-out não tem como fanar por engano. A garantia é ESTRUTURAL — este
// arquivo não importa os motores, e há teste lendo o fonte
// (`historica.chamadores.test.ts`). O que fica de fora, e por quê:
//
//   robô, automação, IA     leriam a mensagem antiga DEPOIS das mais novas;
//   funil                   a mensagem que trouxe o telefone já roteou;
//   reabrir a conversa      idem — e reabrir por fala antiga desfaria um
//                           encerramento decidido com informação mais nova.
//                           (A exceção é a TARDIA, que ainda é a última da
//                           conversa: quem reabre é `tardia.ts`, pelo gancho
//                           `antesDeAssentar` — este arquivo continua sem
//                           importar o helper);
//   seguir o canal          o canal da conversa é o da mensagem mais RECENTE;
//   atraso de entrega       mediria "3 horas" numa conexão sadia (1002);
//   parar-se-responder      há default-deny de chamadores; a segunda linha de
//                           defesa da retomada lê `gravada_em` e cobre.
//
// O que ela faz ALÉM do insert é o que a conversa precisa para não mentir —
// `cb_assentar_mensagem_historica` (1009): acerta `aguardando_desde` (o
// gatilho da 972 decide por ordem de INSERÇÃO, não de carimbo), soma a não
// lida quando cabe, e toca `updated_at`, que é o que faz o realtime corrigir
// a lista de quem está com a caixa de entrada aberta.
//
// ⚠️⚠️ A função NÃO recalcula a espera do zero, e é de propósito. A primeira
// versão copiava a fórmula do gatilho de mensagem apagada da 972 ("a fala de
// cliente mais antiga depois da última resposta de gente") — e a revisão
// MEDIU o defeito: a fórmula não sabe que ENCERRAR limpa a espera. Conversa
// que terminou com um "ok, obrigado" do cliente e foi encerrada (o caso comum)
// ressuscitava aquele "obrigado" como espera de 9 dias na primeira histórica
// que entrasse. A função mexe só no que ESTA mensagem muda — e, para isso,
// precisa saber o que o gatilho acabou de apagar: daí a leitura de
// `aguardando_desde` ANTES do insert (`p_espera_antes`).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { gravarComCanal } from '@/lib/cb-channels/stamp';
import type { NormalizedInbound } from '@/lib/whatsapp/inbound-store';

export type ResultadoDaHistorica =
  | { status: 'gravada'; messageId: string }
  /** O `UNIQUE (conversation_id, message_id)` recusou: outra cópia já entrou. */
  | { status: 'duplicada' }
  | { status: 'falhou' };

const TIPOS_ACEITOS = new Set(['text', 'image', 'document', 'audio', 'video', 'location']);

/** `messages.id` da citada, dentro da conversa. Erro vira "sem citação". */
async function idDaCitada(
  db: SupabaseClient,
  conversationId: string,
  quotedProviderId: string | null | undefined
): Promise<string | null> {
  if (!quotedProviderId) return null;
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('message_id', quotedProviderId)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data?.id as string | undefined) ?? null;
}

/**
 * Alguém da EQUIPE respondeu depois dela? É a régua da 972 e do Radar:
 * `sender_id` preenchido OU `from_device` (o celular pareado, por onde o
 * escritório mais fala). Robô, disparo e fluxo não contam.
 *
 * ⚠️ Erro de leitura responde `true` ("considere respondida"): o único efeito
 * é NÃO somar a não lida — o lado de menos efeito colateral.
 */
async function genteRespondeuDepois(
  db: SupabaseClient,
  conversationId: string,
  carimboIso: string
): Promise<boolean> {
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'agent')
    // A MESMA forma que o Radar e o Meu dia já usam em produção (`use-radar.ts`).
    .or('sender_id.not.is.null,from_device.is.true')
    .is('deleted_at', null)
    .gt('created_at', carimboIso)
    .limit(1);
  if (error) return true;
  return (data ?? []).length > 0;
}

/**
 * `aguardando_desde` ANTES do insert. O gatilho da 972 LIMPA a espera quando
 * entra resposta de gente, sem olhar a ordem dos carimbos — para devolver o
 * que um eco antigo apagou, a função precisa saber o que havia. `undefined` =
 * não consegui ler (a função então não devolve nada: é o comportamento de
 * hoje para qualquer eco atrasado).
 */
async function esperaAntes(
  db: SupabaseClient,
  conversationId: string
): Promise<string | null | undefined> {
  const { data, error } = await db
    .from('conversations')
    .select('aguardando_desde')
    .eq('id', conversationId)
    .maybeSingle();
  if (error || !data) return undefined;
  return (data.aguardando_desde as string | null | undefined) ?? null;
}

export interface OpcoesDaHistorica {
  /**
   * Roda DEPOIS do insert e ANTES de `cb_assentar_mensagem_historica`. É por
   * onde a `tardia` reabre a conversa (`tardia.ts`) — este arquivo não
   * importa o helper de reabertura, de propósito. Não pode lançar.
   */
  antesDeAssentar?: () => Promise<void>;
}

export async function gravarHistorica(
  db: SupabaseClient,
  m: NormalizedInbound,
  conversationId: string,
  opcoes: OpcoesDaHistorica = {}
): Promise<ResultadoDaHistorica> {
  const carimboIso = new Date(m.timestamp * 1000).toISOString();
  const replyToId = await idDaCitada(db, conversationId, m.quotedProviderId);
  const daEquipe = m.fromMe === true;
  const antes = await esperaAntes(db, conversationId);

  // A MESMA forma de linha dos dois caminhos normais — a bolha, a busca, o
  // Radar e o "apagar/editar" leem estas colunas sem saber de onde ela veio.
  const { resultado } = await gravarComCanal(m.channelId ?? null, (canal) =>
    db
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: daEquipe ? 'agent' : 'customer',
        content_type: TIPOS_ACEITOS.has(m.contentType) ? m.contentType : 'text',
        content_text: m.text,
        media_url: m.mediaUrl ?? null,
        message_id: m.providerMessageId,
        remote_jid: m.remoteJid ?? null,
        remote_jid_lid: m.remoteJidLid ?? null,
        channel_id: canal,
        reply_to_message_id: replyToId,
        from_me: daEquipe,
        ...(daEquipe ? { from_device: true } : {}),
        status: daEquipe ? 'sent' : 'delivered',
        created_at: carimboIso,
      })
      .select('id')
      .single()
  );

  const { data: inserida, error } = resultado;
  if (error || !inserida) {
    const erro = error as { code?: string; message?: string } | null;
    if (erro?.code === '23505') return { status: 'duplicada' };
    // ⚠️ Só o código e a mensagem: o `details` de uma violação de CHECK ou
    // NOT NULL traz a LINHA recusada — com o texto do cliente dentro.
    console.error(
      '[evolution/sem-telefone] gravar a histórica falhou:',
      erro?.code ?? '(sem código)',
      erro?.message ?? ''
    );
    return { status: 'falhou' };
  }

  if (opcoes.antesDeAssentar) await opcoes.antesDeAssentar();

  // Não lida só para fala de CLIENTE que ninguém da equipe respondeu depois.
  const contaNaoLida = !daEquipe && !(await genteRespondeuDepois(db, conversationId, carimboIso));
  const { error: erroAoAssentar } = await db.rpc('cb_assentar_mensagem_historica', {
    p_conversation_id: conversationId,
    p_carimbo: carimboIso,
    p_da_equipe: daEquipe,
    p_espera_antes: antes ?? null,
    p_conta_nao_lida: contaNaoLida,
  });
  if (erroAoAssentar) {
    // A mensagem JÁ está no fio — aqui só se perde o ajuste fino da conversa
    // (o "em atraso" pode ficar errado até a próxima resposta de gente).
    console.error(
      '[evolution/sem-telefone] assentar a conversa falhou:',
      erroAoAssentar.message
    );
  }

  return { status: 'gravada', messageId: inserida.id as string };
}
