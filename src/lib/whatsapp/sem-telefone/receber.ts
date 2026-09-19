// ============================================================
// A CHEGADA de uma mensagem 1:1 em `@lid` SEM telefone.
//
// O que é (provado em 19/09/2026 — docs/PLANO-lid-sem-telefone.md): quando a
// Evolution não consegue decifrar uma mensagem de primeira — típico da
// PRIMEIRA mensagem de um contato novo —, a Baileys 7 pede uma cópia ao
// celular pareado, e essa cópia chega com a chave crua do aparelho: só o LID.
// Até aqui o CRM a jogava fora (sem telefone não há como achar o cliente, e
// gravar o LID como telefone cria contato fantasma — 4 deles em 26/07, um
// fundido com cliente real). Medido: 5 em 3.875 mensagens em 10 dias; 4 eram
// duplicata, 1 era a fala inicial de um lead novo.
//
// A ordem, e o motivo de cada degrau:
//
//   1. Já gravada?        A cópia normal da MESMA mensagem costuma chegar
//                         antes (4 dos 5 casos). Sai calada — hoje ela gera
//                         um "DESCARTADA" que é alarme falso.
//   2. Resolver o LID     no acervo do próprio CRM (`resolver-lid.ts`).
//   3. Achou → entregar   como `nova` ou `historica` (`modo.ts`).
//   4. Não achou → RETER  e olhar o acervo DE NOVO: o eco que traz o par pode
//                         ter sido gravado enquanto a retenção acontecia — ou
//                         ele enxerga a retida, ou a retida o enxerga.
//
// ⚠️⚠️ A invariante que sustenta o resto: SE QUALQUER PEÇA AQUI FALHAR, O
// COMPORTAMENTO É O DE ANTES — a mensagem não entra e o log diz "DESCARTADA".
// Nunca lança: roda dentro do laço de ingestão da rota.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  detectContentType,
  ehLidSemTelefone,
  isReaction,
  isSecretEncrypted,
  normalizeUpsert,
  type EvolutionUpsert,
} from '@/lib/whatsapp/transport/evolution-inbound';

import { entregarRecuperada } from './entregar';
import { anexoDe, religarRetidas, type AnexoDaRecuperada, type JaGravada } from './religar';
import { resolverTelefoneDoLid } from './resolver-lid';
import { marcarEntregue, reter, type Ocorrencia } from './retidas';

export interface RotaDeEntrada {
  accountId: string;
  ownerUserId: string;
  channelId: string | null;
}

/** O carimbo do item, em segundos — a mesma leitura de `normalizeUpsert`. */
function carimboDoItem(item: EvolutionUpsert, agoraMs: number): number {
  const bruto = item.messageTimestamp;
  if (typeof bruto === 'number') return bruto;
  if (typeof bruto === 'string') return parseInt(bruto, 10) || Math.floor(agoraMs / 1000);
  return Math.floor(agoraMs / 1000);
}

/**
 * O aviso de SEMPRE, com o texto de sempre — é o que o medidor do
 * docs/PLANO-baileys-7.md (8.3) procura no log. Depois desta correção ele só
 * aparece quando a retenção FALHOU: mensagem que o CRM de fato não guardou.
 *
 * (Nasceu na rota, em 27/07/2026, como `registrarDescartePorLid`: naquele dia
 * 119 de 143 ecos do aparelho — 83% — eram descartados assim sem log nenhum,
 * e a perda só apareceu porque o operador comparou o celular com a tela. A
 * Evolution 2.4 passou a mandar o telefone em `remoteJidAlt` e o número caiu
 * para 5 em 3.875; esta correção trata o que sobrou.)
 */
function avisarDescarte(o: Ocorrencia): void {
  console.warn(
    '[evolution/webhook] mensagem DESCARTADA: endereçada por @lid sem telefone.',
    JSON.stringify({
      canal: o.channelId,
      remoteJid: o.lidJid,
      messageId: o.providerMessageId,
      fromMe: o.fromMe,
      tipo: o.tipo,
    })
  );
}

/**
 * Devolve os anexos a buscar — os das mensagens que ENTRARAM e têm mídia
 * (mais de um só quando a retenção destrava outras retidas do mesmo LID).
 * Lista vazia também para o que não é assunto daqui: item com telefone,
 * grupo, reação, edição cifrada, chave sem id — o descarte silencioso de
 * sempre.
 */
export async function receberSemTelefone(args: {
  db: SupabaseClient;
  item: EvolutionUpsert;
  rota: RotaDeEntrada;
  jaGravada: JaGravada;
  agoraMs?: number;
}): Promise<AnexoDaRecuperada[]> {
  const { db, item, rota, jaGravada } = args;
  const id = item.key?.id;
  if (!id || !ehLidSemTelefone(item.key)) return [];
  if (isReaction(item.message) || isSecretEncrypted(item.message)) return [];

  const agoraMs = args.agoraMs ?? Date.now();
  const lidJid = item.key!.remoteJid!;
  const fromMe = item.key?.fromMe === true;
  const ocorrencia: Ocorrencia = {
    accountId: rota.accountId,
    channelId: rota.channelId,
    lidJid,
    providerMessageId: id,
    fromMe,
    tipo: detectContentType(item.message),
    carimboSeg: carimboDoItem(item, agoraMs),
  };

  let lidConhecido = false;
  try {
    // 1. A duplicata. `fromMe` espera a corrida do envio do próprio CRM, como
    //    a rota faz com qualquer eco.
    if (await jaGravada(id, fromMe)) return [];

    // 2–3. O acervo conhece o LID?
    const achado = await resolverTelefoneDoLid(db, rota.accountId, lidJid);
    lidConhecido = achado !== null;
    const m = achado
      ? normalizeUpsert(item, rota.accountId, rota.ownerUserId, rota.channelId, {
          telefoneResolvido: achado.telefoneJid,
        })
      : null;
    if (achado && m) {
      const entrega = await entregarRecuperada({
        db,
        m,
        conversationId: achado.conversationId,
        agoraMs,
      });
      if (entrega.status === 'duplicada') return [];
      if (entrega.status === 'gravada') {
        await marcarEntregue(db, ocorrencia, 'acervo', entrega.messageId);
        console.info(
          '[evolution/sem-telefone] mensagem sem telefone RESOLVIDA pelo acervo.',
          JSON.stringify({ messageId: id, modo: entrega.modo })
        );
        const anexo = anexoDe(item, m.contentType, entrega.messageId, rota.channelId);
        return anexo ? [anexo] : [];
      }
    }
    // Tinha telefone e mesmo assim não entrou (banco, normalização): cai na
    // retenção — a próxima mensagem daquele LID tenta de novo.
  } catch (err) {
    // ⚠️ NÃO é "descartada": o estouro pode ter vindo DEPOIS do insert (um
    // motor, no modo `nova`). Reter é o lado seguro nos dois casos — se a
    // mensagem já entrou, a religação a encontra gravada e marca `duplicada`.
    console.error(
      '[evolution/sem-telefone] entregar na chegada falhou — vai para a retenção:',
      err instanceof Error ? err.message : err
    );
  }

  // 4. Reter. Daqui para baixo nada lança (`reter`, `resolverTelefoneDoLid` e
  //    `religarRetidas` engolem o próprio erro).
  if (!(await reter(db, ocorrencia, item))) {
    avisarDescarte(ocorrencia);
    return [];
  }
  console.warn(
    '[evolution/sem-telefone] mensagem RETIDA: endereçada por @lid sem telefone.',
    JSON.stringify({ canal: rota.channelId, messageId: id, fromMe, tipo: ocorrencia.tipo })
  );

  // A corrida retenção × eco. Só quando o LID era DESCONHECIDO: se ele já era
  // conhecido e a entrega falhou, tentar de novo agora daria na mesma.
  if (lidConhecido) return [];
  const depois = await resolverTelefoneDoLid(db, rota.accountId, lidJid);
  if (!depois) return [];
  return religarRetidas({
    db,
    accountId: rota.accountId,
    ownerUserId: rota.ownerUserId,
    lidJid,
    telefoneJid: depois.telefoneJid,
    conversationId: depois.conversationId,
    jaGravada,
    agoraMs,
  });
}
