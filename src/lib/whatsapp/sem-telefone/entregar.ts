// ============================================================
// A mensagem recuperada já tem telefone. Como ela entra?
//
//   nova       pelo caminho NORMAL de ingestão, sem mudar uma linha dele;
//   tardia     como história, e a conversa passa a refleti-la (`tardia.ts`);
//   historica  só no fio (`historica.ts`).
//
// A regra é pura e mora em `modo.ts`; aqui só se pergunta ao banco qual é a
// mensagem mais recente da conversa e se despacha. Usado pelos dois chamadores
// — a chegada (`receber.ts`) e a religação (`religar.ts`).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  persistDeviceMessage,
  persistInboundMessage,
  type NormalizedInbound,
} from '@/lib/whatsapp/inbound-store';

import { gravarHistorica } from './historica';
import { modoDaRecuperada, type ModoDaRecuperada } from './modo';
import { refletirComoUltima } from './tardia';

export type Entrega =
  | { status: 'gravada'; modo: ModoDaRecuperada; messageId: string }
  | { status: 'duplicada' }
  | { status: 'falhou' };

/**
 * O `created_at` da mensagem mais recente da conversa, em ms. `null` =
 * conversa sem mensagem; `'erro'` = não consegui ler.
 */
async function ultimaDaConversa(
  db: SupabaseClient,
  conversationId: string
): Promise<number | null | 'erro'> {
  const { data, error } = await db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return 'erro';
  const iso = data?.created_at as string | undefined;
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 'erro' : ms;
}

export async function entregarRecuperada(args: {
  db: SupabaseClient;
  m: NormalizedInbound;
  /** A conversa onde o par LID↔telefone foi visto. */
  conversationId: string;
  agoraMs: number;
}): Promise<Entrega> {
  const { db, m, conversationId, agoraMs } = args;

  const ultima = await ultimaDaConversa(db, conversationId);
  // ⚠️ Sem saber qual é a última, NÃO se arrisca o caminho dos motores: a
  // dúvida cai na histórica, que só acrescenta a bolha.
  const modo: ModoDaRecuperada =
    ultima === 'erro'
      ? 'historica'
      : modoDaRecuperada({
          carimboMs: m.timestamp * 1000,
          agoraMs,
          ultimaDaConversaMs: ultima,
        });

  if (modo !== 'nova') {
    const r = await gravarHistorica(db, m, conversationId, {
      // A `tardia` ainda é a última da conversa: reabre, prévia e posição —
      // ENTRE o insert e o acerto da espera (ver `tardia.ts`).
      antesDeAssentar: modo === 'tardia' ? () => refletirComoUltima(db, conversationId) : undefined,
    });
    return r.status === 'gravada' ? { status: 'gravada', modo, messageId: r.messageId } : r;
  }

  // `nova`: exatamente o que a rota faria com uma mensagem comum. Devolve
  // `null` quando desiste no meio — inclusive quando a OUTRA cópia da mesma
  // mensagem ganhou o `UNIQUE` (o insert vem antes dos motores, então quem
  // perdeu não dispara nada).
  const gravada = m.fromMe
    ? await persistDeviceMessage(db, m)
    : await persistInboundMessage(db, m);
  if (gravada) return { status: 'gravada', modo, messageId: gravada.messageId };

  // ⚠️ `null` tem dois significados, e só um é falha. Se a cópia normal
  // ganhou a corrida do `UNIQUE`, a mensagem ESTÁ no fio: responder `falhou`
  // mandava quem chama RETER uma mensagem já entregue — e o Meu dia avisava
  // "mensagem retida, veja no celular" por até 7 dias sobre conversa completa
  // (revisão por duas lentes, 19/09/2026).
  return (await jaEstaNaConversa(db, conversationId, m.providerMessageId))
    ? { status: 'duplicada' }
    : { status: 'falhou' };
}

/** Erro de leitura responde `false`: na dúvida, retém (a religação deduplica). */
async function jaEstaNaConversa(
  db: SupabaseClient,
  conversationId: string,
  providerMessageId: string
): Promise<boolean> {
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('message_id', providerMessageId)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}
