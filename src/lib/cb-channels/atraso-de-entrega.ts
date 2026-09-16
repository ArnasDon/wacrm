// ============================================================
// Atraso de ENTREGA — o terceiro eixo da saúde das conexões.
//
// `health.ts` mede dois eixos: o estado que o provedor reporta e o frescor
// dessa informação. Os dois respondem "a conexão está DE PÉ?". Nenhum
// responde "ela está entregando EM DIA?" — e são perguntas diferentes.
//
// MEDIDO em 16/09/2026, e é por isso que este módulo existe: a conexão
// Bancário - Comercial passou a manhã `open`, com o webhook apontado para
// cá e o frescor novo — verde em todos os eixos — enquanto o WhatsApp
// entregava as mensagens à Evolution com 29 MINUTOS de atraso. No mesmo
// segundo de gravação, a Evolution registrou um carimbo de 12:02 numa
// conexão e 11:36 na outra. Quem descobriu foi o operador, olhando a tela e
// estranhando o relógio da mensagem; o sistema não tinha como avisar.
//
// A MEDIDA É A FRONTEIRA DE ENTREGA, não o atraso de uma mensagem solta:
//
//     atraso = quando o CRM gravou  −  carimbo do WhatsApp
//
// sobre a mensagem de carimbo MAIS NOVO já entregue. Duas colunas em
// `cb_channels` guardam esse par, e nada mais — é o mesmo cálculo que
// diagnosticou o episódio, agora contínuo.
//
// ⚠️ GRUPO FICA DE FORA, e é escolha, não esquecimento. A ingestão de grupo
// tem caminho próprio (`cb-groups/persist.ts`), e lá o `channel_id` gravado
// é o do webhook que CHEGOU PRIMEIRO — com os dois números do escritório
// dentro do mesmo grupo, o WhatsApp entrega às duas instâncias e o UNIQUE
// descarta a segunda. Creditar a fronteira por ali daria sempre ao número
// mais RÁPIDO a medição, e o lento — justamente o que precisa ser
// detectado — deixaria de ser medido naquele grupo. O 1:1 de cada conexão
// mede o mesmo caminho sem essa corrida.
//
// ⚠️ POR QUE "SÓ AVANÇA" (a fronteira, e não a última mensagem a chegar):
// conexão atrasada drena o backlog FORA DE ORDEM. Medido no mesmo dia, a
// Evolution gravou, em sequência, carimbos 11:36, 11:30, 11:23, 11:30,
// 11:29, 11:04, 11:04, 11:03. Guardando "a última que chegou", a de 11:04
// apagaria o alarme que a de 11:36 acabou de acender, e a tela ficaria
// piscando entre "em dia" e "atrasada" a cada 30 s no meio do episódio.
// A fronteira só anda para a frente, então ela mede o quanto a conexão já
// alcançou — que é a pergunta do operador.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Acima disto a conexão entrega, mas tarde, e o operador precisa saber
 * antes de responder a um cliente com meia hora de conversa na frente.
 *
 * Cinco minutos é folgado de propósito. Medido nos 10 dias anteriores ao
 * episódio: em operação normal o atraso fica em 0,0–0,1 min (segundos), e
 * os episódios ruins foram de 9 a 50 min. Não há nada na faixa do meio —
 * então o limiar não precisa ser fino, precisa não dar falso positivo.
 */
export const LIMIAR_ATRASO_SEG = 300;

/**
 * Carimbo no FUTURO além disto é relógio errado do remetente, não entrega
 * adiantada. Aceitar move a fronteira para frente do relógio e trava a
 * medição até o tempo alcançá-la — mascarando atraso real justamente
 * depois de uma mensagem com relógio torto. O carimbo vem do aparelho de
 * quem enviou; dois minutos cobrem a folga normal de relógio.
 */
export const TOLERANCIA_DE_RELOGIO_SEG = 120;

export interface ParDaFronteira {
  /** Carimbo do WhatsApp da mensagem mais nova já entregue (ISO). */
  carimboIso: string | null;
  /** Quando o CRM gravou essa mensagem (ISO). */
  recebidaIso: string | null;
}

/**
 * O atraso da fronteira, em segundos. `null` quando nunca se mediu nada
 * nesta conexão — que NÃO é o mesmo que zero, e o chamador tem de tratar
 * como "não sei" (a lição de `falhou` no `use-channel-health`).
 *
 * Negativo vira 0: o relógio do remetente pode estar à frente do nosso
 * dentro da tolerância, e "entrega adiantada" não existe.
 */
export function atrasoDaFronteira(par: ParDaFronteira): number | null {
  if (!par.carimboIso || !par.recebidaIso) return null;
  const carimbo = Date.parse(par.carimboIso);
  const recebida = Date.parse(par.recebidaIso);
  if (!Number.isFinite(carimbo) || !Number.isFinite(recebida)) return null;
  return Math.max(0, Math.round((recebida - carimbo) / 1000));
}

/** A conexão está entregando tarde? `null` (não sei) nunca acusa. */
export function entregaAtrasada(atrasoSeg: number | null): boolean {
  return atrasoSeg !== null && atrasoSeg > LIMIAR_ATRASO_SEG;
}

/**
 * Espaçamento entre duas gravações da fronteira na MESMA conexão.
 *
 * ⚠️ Não é economia de banco — é o realtime. Todo UPDATE em `cb_channels`
 * dispara o `postgres_changes` que `use-channel-health` assina, e o hook
 * responde refazendo a sonda. Sem espaçar, a rajada de um backlog drenando
 * (dezenas de mensagens num minuto — exatamente o momento em que o alarme
 * importa) faria a tela sondar dezenas de vezes por minuto.
 *
 * Um minuto não estraga a medição: o limiar é de cinco, e o erro que o
 * espaçamento introduz é no máximo o próprio minuto.
 */
export const ESPACAMENTO_DE_GRAVACAO_SEG = 60;

export interface Chegada {
  /** Carimbo do WhatsApp da mensagem que acabou de chegar, em MILISSEGUNDOS. */
  carimboMs: number;
  /** A fronteira guardada hoje nesta conexão. */
  carimboGuardadoIso: string | null;
  agoraMs: number;
}

/**
 * Esta chegada move a fronteira?
 *
 * Só quando o carimbo é mais NOVO que o guardado (ver a nota do cabeçalho
 * sobre o backlog fora de ordem) e não está no futuro além da tolerância.
 * Carimbo ilegível não move nada: preferimos a fronteira velha, que é
 * verdade medida, a uma nova inventada.
 */
export function moveAFronteira(c: Chegada): boolean {
  if (!Number.isFinite(c.carimboMs) || c.carimboMs <= 0) return false;
  if (c.carimboMs > c.agoraMs + TOLERANCIA_DE_RELOGIO_SEG * 1000) return false;
  if (!c.carimboGuardadoIso) return true;
  const guardado = Date.parse(c.carimboGuardadoIso);
  if (!Number.isFinite(guardado)) return true;
  return c.carimboMs > guardado;
}

/**
 * Registra a chegada na conexão, movendo a fronteira quando for o caso.
 *
 * ⚠️ NUNCA LANÇA, e é isso que torna seguro o `await` dos chamadores: isto
 * roda no caminho da ingestão, junto de `followConversationChannel` e do
 * roteador de funil. Uma falha aqui é um alarme menos preciso; uma falha
 * que derrube a ingestão é a mensagem do cliente perdida — e o provedor já
 * recebeu 200, então ninguém a reenvia. Por isso todo erro é engolido com
 * aviso, o `catch` cobre o que o supabase-js LANÇA (rede) e o `error` cobre
 * o que ele DEVOLVE (o Supabase não lança em erro de banco).
 *
 * ⚠️ A cerca `entrega_carimbo_em` no UPDATE não é enfeite: duas mensagens
 * do mesmo canal podem ser processadas em paralelo (o webhook responde e
 * trabalha em `after()`), e sem ela a mais VELHA das duas pode escrever por
 * último e puxar a fronteira para trás — o defeito que a regra "só avança"
 * existe para impedir. Ler-então-escrever não serializa nada; quem
 * serializa é o banco.
 */
export async function registrarEntrega(
  db: SupabaseClient,
  channelId: string | null | undefined,
  carimboSegundos: number,
): Promise<void> {
  if (!channelId) return;

  const agoraMs = Date.now();
  const carimboMs = carimboSegundos * 1000;
  if (!Number.isFinite(carimboMs) || carimboMs <= 0) return;
  if (carimboMs > agoraMs + TOLERANCIA_DE_RELOGIO_SEG * 1000) return;

  const carimboIso = new Date(carimboMs).toISOString();
  const limiteIso = new Date(agoraMs - ESPACAMENTO_DE_GRAVACAO_SEG * 1000).toISOString();

  try {
    const { error } = await db
      .from('cb_channels')
      .update({
        entrega_carimbo_em: carimboIso,
        entrega_recebida_em: new Date(agoraMs).toISOString(),
      })
      .eq('id', channelId)
      // Só avança. `or` cobre a primeira entrega, quando a coluna é nula —
      // `.lt()` sozinho nunca casa NULL e a fronteira nunca sairia do zero.
      .or(`entrega_carimbo_em.is.null,entrega_carimbo_em.lt.${carimboIso}`)
      // Espaçamento (ver a constante). Condições encadeadas viram AND, então
      // a gravação só passa quando avança E quando já esperou o intervalo.
      .or(`entrega_recebida_em.is.null,entrega_recebida_em.lt.${limiteIso}`);
    if (error) {
      console.warn('[atraso-de-entrega] não registrou a fronteira:', error.message);
    }
  } catch (err) {
    console.warn(
      '[atraso-de-entrega] não registrou a fronteira:',
      err instanceof Error ? err.message : err,
    );
  }
}
