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
//                           encerramento decidido com informação mais nova;
//   seguir o canal          o canal da conversa é o da mensagem mais RECENTE;
//   atraso de entrega       mediria "3 horas" numa conexão sadia (1002);
//   parar-se-responder      há default-deny de chamadores; a segunda linha de
//                           defesa da retomada lê `gravada_em` e cobre.
//
// O que ela faz ALÉM do insert é o que a conversa precisa para não mentir —
// `cb_assentar_mensagem_historica` (1009): refaz `aguardando_desde` (o gatilho
// da 972 conta por ordem de INSERÇÃO), soma a não lida quando cabe, e toca
// `updated_at`, que é o que faz o realtime corrigir a lista de quem está com
// a caixa de entrada aberta.
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

export async function gravarHistorica(
  db: SupabaseClient,
  m: NormalizedInbound,
  conversationId: string
): Promise<ResultadoDaHistorica> {
  const carimboIso = new Date(m.timestamp * 1000).toISOString();
  const replyToId = await idDaCitada(db, conversationId, m.quotedProviderId);
  const daEquipe = m.fromMe === true;

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
    if ((error as { code?: string } | null)?.code === '23505') return { status: 'duplicada' };
    console.error('[evolution/sem-telefone] gravar a histórica falhou:', error);
    return { status: 'falhou' };
  }

  // Não lida só para fala de CLIENTE que ninguém da equipe respondeu depois.
  const contaNaoLida = !daEquipe && !(await genteRespondeuDepois(db, conversationId, carimboIso));
  const { error: erroAoAssentar } = await db.rpc('cb_assentar_mensagem_historica', {
    p_conversation_id: conversationId,
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
