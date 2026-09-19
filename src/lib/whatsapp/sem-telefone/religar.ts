// ============================================================
// Religar: o telefone de um LID acabou de aparecer — as mensagens RETIDAS
// daquele LID entram na conversa.
//
// Quem chama é a rota do webhook, depois de gravar QUALQUER mensagem 1:1 que
// traga os dois endereços (cliente ou celular pareado). É o eco da resposta
// do escritório, ou a mensagem seguinte do cliente, que destrava a fala que
// tinha ficado guardada.
//
// ⚠️⚠️ Roda no caminho de uma mensagem NORMAL, já gravada: NUNCA lança, e uma
// retida que falha não segura as outras nem a mensagem que a destravou. Falha
// = a retida continua retida, e a próxima mensagem daquele LID tenta de novo.
//
// ⚠️ A conexão é a DA RETIDA, não a do webhook que destravou: o LID é da conta
// do WhatsApp da pessoa, então a fala que chegou pelo número A pode ser
// destravada por uma mensagem no número B — e o anexo só existe na instância
// do A.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { mediaBytesOf } from '@/lib/whatsapp/transport/anexo-declarado';
import {
  isLidJid,
  normalizeUpsert,
  type EvolutionUpsert,
} from '@/lib/whatsapp/transport/evolution-inbound';

import { entregarRecuperada } from './entregar';
import { marcarDuplicada, marcarEntregue, retidasDoLid } from './retidas';

/** A pergunta "esta mensagem já está no banco?" — a da rota, para não haver duas. */
export type JaGravada = (providerMessageId: string, esperarCorrida?: boolean) => Promise<boolean>;

/** O que a rota precisa para buscar o anexo de uma recuperada, na fase 2 dela. */
export interface AnexoDaRecuperada {
  item: EvolutionUpsert;
  contentType: string;
  messageId: string;
  bytes: number | null;
  /** A conexão por onde a mensagem CHEGOU — é dela a instância que tem a mídia. */
  channelId: string | null;
}

const TEM_ANEXO = new Set(['image', 'video', 'audio', 'document']);

export function anexoDe(
  item: EvolutionUpsert,
  contentType: string,
  messageId: string,
  channelId: string | null
): AnexoDaRecuperada | null {
  if (!TEM_ANEXO.has(contentType)) return null;
  return { item, contentType, messageId, bytes: mediaBytesOf(item), channelId };
}

export async function religarRetidas(args: {
  db: SupabaseClient;
  accountId: string;
  ownerUserId: string;
  /** O LID da mensagem que acabou de ser gravada (`remoteJidLid`). */
  lidJid: string | null | undefined;
  /** O telefone dela (`remoteJid`). */
  telefoneJid: string | null | undefined;
  /** A conversa onde ela foi gravada — é a do contato (036: uma por contato). */
  conversationId: string;
  jaGravada: JaGravada;
  agoraMs?: number;
}): Promise<AnexoDaRecuperada[]> {
  const { db, accountId, ownerUserId, lidJid, telefoneJid, conversationId, jaGravada } = args;
  // Conversa não migrada para LID (o campo nem vem) não tem o que religar —
  // e sai antes de qualquer consulta.
  if (!lidJid || !isLidJid(lidJid)) return [];
  if (!telefoneJid || !telefoneJid.endsWith('@s.whatsapp.net')) return [];

  const anexos: AnexoDaRecuperada[] = [];
  try {
    const retidas = await retidasDoLid(db, accountId, lidJid);
    for (const retida of retidas) {
      try {
        const item = retida.payload as EvolutionUpsert;
        const m = normalizeUpsert(item, accountId, ownerUserId, retida.channelId, {
          telefoneResolvido: telefoneJid,
        });
        if (!m) {
          console.error(
            '[evolution/sem-telefone] retida que não normaliza — segue retida.',
            JSON.stringify({ id: retida.id, messageId: retida.providerMessageId })
          );
          continue;
        }

        // A cópia NORMAL da mesma mensagem pode ter entrado depois da retenção.
        if (await jaGravada(m.providerMessageId, false)) {
          await marcarDuplicada(db, retida.id);
          continue;
        }

        const entrega = await entregarRecuperada({
          db,
          m,
          conversationId,
          agoraMs: args.agoraMs ?? Date.now(),
        });
        if (entrega.status === 'duplicada') {
          await marcarDuplicada(db, retida.id);
          continue;
        }
        if (entrega.status === 'falhou') continue; // segue retida; a próxima tenta

        await marcarEntregue(
          db,
          {
            accountId,
            channelId: retida.channelId,
            lidJid,
            providerMessageId: m.providerMessageId,
            fromMe: m.fromMe === true,
            tipo: m.contentType,
            carimboSeg: m.timestamp,
          },
          'religacao',
          entrega.messageId
        );
        console.info(
          '[evolution/sem-telefone] mensagem retida RELIGADA à conversa.',
          JSON.stringify({ messageId: m.providerMessageId, modo: entrega.modo })
        );
        const anexo = anexoDe(item, m.contentType, entrega.messageId, retida.channelId);
        if (anexo) anexos.push(anexo);
      } catch (err) {
        console.error(
          '[evolution/sem-telefone] religar uma retida falhou:',
          err instanceof Error ? err.message : err
        );
      }
    }
  } catch (err) {
    console.error(
      '[evolution/sem-telefone] religar falhou:',
      err instanceof Error ? err.message : err
    );
  }
  return anexos;
}
