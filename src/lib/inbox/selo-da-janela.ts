// ============================================================
// O selo da janela de 24h na linha da caixa de entrada (pedido do operador,
// 10/09/2026, ao conectar o número oficial).
//
// "Uma forma discreta de marcar quando o lead tiver selecionado para a API
// da Meta": só uma ampulheta, que expande no hover para mostrar quanto resta,
// em três cores — a padrão de 24h a 12h, âmbar de 12h a 3h, vermelha abaixo
// de 3h. Fora das Encerradas; só WhatsApp oficial (não Instagram).
//
// A régua da janela é a do FIO (`janela-24h.ts`, PR #192): 24h contadas da
// última mensagem do CLIENTE que chegou pelo número oficial por onde se vai
// responder. O fio tem as mensagens; a lista não — ela lê o fato do banco:
// `conversations.janela_meta` (993), um mapa NÚMERO → instante da última
// mensagem do cliente por aquele número oficial, mais a chave `sem_carimbo`
// (a mensagem da Meta sem carimbo: histórico, carimbo que falhou, conexão
// apagada — conta para qualquer número oficial, como no fio). Mantido por
// gatilho que ESPELHA `contaParaOCanal`. Para o número de saída, a lista
// fica com a mais recente entre a chave dele e a `sem_carimbo` — que é
// exatamente a "última mensagem do cliente que conta para este número" do
// fio. Há teste comparando os dois sobre as mesmas mensagens, inclusive com
// DOIS números oficiais (a 991 guardava um par só e divergia; a 993 corrigiu).
//
// UMA exceção, escrita: a conta SEM canal nenhum. O fio conta o fio inteiro
// (o legado de número único); a lista não tem como saber por qual número
// responde e cala.
//
// ⚠️ Aqui fica só a régua — pura, para o teste, e para a linha da lista não
// carregar aritmética de tempo. Cor e classes ficam no componente.
// ============================================================

import type { Conversation } from "@/types";
import { ehMeta } from "@/lib/cb-channels/transporte";

import { MINUTOS_DA_JANELA, type CanalDeSaida } from "./janela-24h";

/** A chave do mapa para a mensagem da Meta SEM carimbo — o literal da 993. */
export const CHAVE_SEM_CARIMBO = "sem_carimbo";

/** Doze horas: daqui para baixo a ampulheta fica âmbar. */
export const LIMIAR_AMBAR_MIN = 12 * 60;
/** Três horas: daqui para baixo a ampulheta fica vermelha. */
export const LIMIAR_VERMELHO_MIN = 3 * 60;

/** As três cores que o operador escolheu (10/09/2026). */
export type CorDaJanela = "padrao" | "ambar" | "vermelha";

export interface SeloDaJanela {
  /** Minutos que restam da janela (1..1440) — a mesma conta do fio. */
  restante: number;
  cor: CorDaJanela;
}

/**
 * A cor pelo que resta: 12h ou mais é a padrão; de 3h até antes de 12h,
 * âmbar; abaixo de 3h, vermelha. Às 11h59 já é âmbar; às 2h59, já vermelha.
 */
export function corDaJanela(restante: number): CorDaJanela {
  if (restante >= LIMIAR_AMBAR_MIN) return "padrao";
  if (restante >= LIMIAR_VERMELHO_MIN) return "ambar";
  return "vermelha";
}

/**
 * O instante (ms) da última mensagem do cliente que conta para o número de
 * saída: a chave DELE ou a `sem_carimbo`, a mais recente. `null` quando não
 * há nenhuma — ou quando o valor gravado não é data (nunca deveria; a lista
 * cala em vez de inventar).
 */
function ultimaNoNumero(
  mapa: NonNullable<Conversation["janela_meta"]>,
  canalId: string,
): number | null {
  let ultima: number | null = null;
  for (const chave of [canalId, CHAVE_SEM_CARIMBO]) {
    const valor = mapa[chave];
    if (typeof valor !== "string") continue;
    const ms = Date.parse(valor);
    if (Number.isNaN(ms)) continue;
    if (ultima === null || ms > ultima) ultima = ms;
  }
  return ultima;
}

/**
 * `null` = sem selo. Com selo, quanto resta e em que cor.
 *
 * Sem selo quando: o cliente nunca escreveu pelo número oficial (mapa vazio
 * ou ausente — inclusive antes da 993 ser aplicada: a lista degrada para o
 * que era, sem erro); a conversa está ENCERRADA (decisão do operador: a aba
 * Encerradas não mostra o selo; o mapa fica, e a reaberta volta a mostrar);
 * é GRUPO; o número de saída é desconhecido (`canalDeSaida` nulo — canais
 * ainda carregando ou a consulta falhou: a lista vazia não pode virar a
 * afirmação "é Meta", a armadilha do "Expirada" que piscava no cabeçalho);
 * o número de saída não é da Meta (QR Code, Instagram); o cliente só
 * escreveu por OUTRO número oficial (a janela é por número); ou as 24h já
 * passaram.
 *
 * O restante é truncado como no fio (`differenceInMinutes`): o minuto em
 * curso ainda conta. Relógio do aparelho atrasado em relação ao carimbo não
 * produz "25h": o teto é 24h.
 */
export function seloDaJanela(
  c: Pick<Conversation, "status" | "group_id" | "janela_meta">,
  canalDeSaida: CanalDeSaida | null,
  agoraMs: number,
): SeloDaJanela | null {
  if (!c.janela_meta || c.status === "closed" || c.group_id) return null;
  if (!canalDeSaida || !ehMeta(canalDeSaida)) return null;
  const desde = ultimaNoNumero(c.janela_meta, canalDeSaida.id);
  if (desde === null) return null;
  const passados = Math.trunc((agoraMs - desde) / 60_000);
  const restante = Math.min(
    MINUTOS_DA_JANELA,
    Math.max(0, MINUTOS_DA_JANELA - passados),
  );
  if (restante === 0) return null;
  return { restante, cor: corDaJanela(restante) };
}
