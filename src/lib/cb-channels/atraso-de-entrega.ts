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
 * Até quando uma medição ainda fala sobre o AGORA.
 *
 * ⚠️⚠️ Sem isto o alarme vira permanente, e essa é a armadilha que a
 * migration 1002 declara e que a primeira versão do código não cumpria: uma
 * amostra atrasada seguida de silêncio mantinha `warn/lagging` para sempre,
 * porque a régua olhava só o atraso histórico e nunca a IDADE dele. O
 * cabeçalho e o Meu dia afirmariam "esta conexão está entregando tarde"
 * horas ou dias depois da última mensagem (Codex, 3ª rodada do PR #220).
 *
 * Uma hora é a folga medida na conta: a conexão do episódio recebia ~1,26
 * mensagem por minuto (medição sempre fresca), e a mais parada do
 * escritório passa até uma hora sem mensagem em silêncio NORMAL. Curto
 * demais apagaria o alarme durante o próprio episódio, num intervalo
 * esparso; longo demais é o alarme permanente de volta.
 *
 * ⚠️ O que este eixo NÃO detecta, de propósito: a conexão que trava de vez e
 * PARA de receber. Ali a medição envelhece e o alarme apaga — dizer "está
 * atrasada" a partir de uma amostra de ontem seria inventar. "Não chega
 * mensagem há tempo demais" é outro alarme, e precisaria conhecer o padrão
 * de tráfego esperado de cada conexão para não gritar toda madrugada.
 */
export const VALIDADE_DA_MEDICAO_MS = 60 * 60_000;

/**
 * O instante antes do qual um carimbo guardado significa ALARME ACESO.
 *
 * ⚠️ Serve para pôr no WHERE a condição "a fronteira guardada está
 * atrasada", que em SQL seria `recebida - carimbo > limiar` — comparação
 * entre DUAS COLUNAS, que o filtro do PostgREST não faz. A saída é que o
 * bypass só interessa quando o alarme está ACESO, e alarme aceso já exige
 * medição FRESCA (`recebida` ≈ agora): então `agora - carimbo > limiar` diz
 * a mesma coisa contra uma CONSTANTE.
 */
export function corteDoAlarme(agoraMs: number): string {
  return new Date(agoraMs - LIMIAR_ATRASO_SEG * 1000).toISOString();
}

/** A medição ainda vale para afirmar algo sobre agora? */
export function medicaoAindaVale(medidoEmIso: string | null, agoraMs: number): boolean {
  if (!medidoEmIso) return false;
  const quando = Date.parse(medidoEmIso);
  if (!Number.isFinite(quando)) return false;
  return agoraMs - quando <= VALIDADE_DA_MEDICAO_MS;
}

export interface Alarme {
  atrasoSeg: number | null;
  /** `cb_channels.entrega_recebida_em` — quando a amostra foi colhida. */
  medidoEmIso: string | null;
  agoraMs: number;
}

/**
 * A conexão está entregando tarde AGORA? É esta que a régua de cor e a tela
 * usam — `entregaAtrasada` sozinha responde sobre a AMOSTRA, não sobre o
 * presente, e confundir as duas é o que faz o alarme nunca apagar.
 */
export function alarmeDeAtraso(a: Alarme): boolean {
  if (!entregaAtrasada(a.atrasoSeg)) return false;
  return medicaoAindaVale(a.medidoEmIso, a.agoraMs);
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
 *
 * ⚠️ Ele vale só para ACENDER — ver `podeIgnorarOEspacamento`. Apagar o
 * alarme não espera, senão a amostra saudável que fecha um backlog cai na
 * janela e a fronteira congela atrasada.
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
 * O espaçamento já pode ser ignorado?
 *
 * ⚠️⚠️ APAGAR O ALARME NUNCA ESPERA — e a assimetria é o conserto de um
 * defeito real (Codex, PR #220). Um backlog drena várias mensagens em
 * segundos e TERMINA numa mensagem atual: a primeira (atrasada) grava, a
 * última (saudável) cai dentro do minuto de espaçamento e é descartada. Se o
 * tráfego então silencia — fim de expediente, ou uma conexão de volume baixo
 * como a que passa uma hora sem mensagem —, não há escrita seguinte, e a
 * fronteira fica congelada na amostra ATRASADA: o alarme segue aceso sobre
 * uma conexão que já se recuperou. Foi exatamente a forma da recuperação
 * medida em 16/09/2026, quando o restart drenou 15 min de fila em segundos.
 *
 * Acender pode esperar o minuto (o episódio dura dezenas deles); apagar, não
 * — alarme que fica aceso sozinho é o que ensina o operador a ignorá-lo.
 */
export function podeIgnorarOEspacamento(
  atrasoNovoSeg: number,
  guardado: ParDaFronteira,
): boolean {
  if (entregaAtrasada(atrasoNovoSeg)) return false;
  return entregaAtrasada(atrasoDaFronteira(guardado));
}

/** O espaçamento entre gravações já passou? `null` (nunca gravou) libera. */
export function espacamentoLiberou(recebidaIso: string | null, agoraMs: number): boolean {
  if (!recebidaIso) return true;
  const quando = Date.parse(recebidaIso);
  if (!Number.isFinite(quando)) return true;
  return agoraMs - quando >= ESPACAMENTO_DE_GRAVACAO_SEG * 1000;
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
 * existe para impedir. O SELECT abaixo NÃO substitui essa cerca: ele decide
 * se VALE A PENA escrever (o espaçamento é heurística); quem garante a
 * invariante é o banco, no WHERE. Perder a corrida aqui custa um UPDATE a
 * mais, nunca uma fronteira errada.
 */
export async function registrarEntrega(
  db: SupabaseClient,
  channelId: string | null | undefined,
  carimboSegundos: number,
): Promise<void> {
  if (!channelId) return;

  const agoraMs = Date.now();
  const carimboMs = carimboSegundos * 1000;

  try {
    const { data, error: erroDaLeitura } = await db
      .from('cb_channels')
      .select('entrega_carimbo_em, entrega_recebida_em')
      .eq('id', channelId)
      .maybeSingle();
    // Sem saber o que está guardado não dá para decidir o espaçamento, e
    // escrever no escuro poderia ressuscitar uma fronteira velha.
    if (erroDaLeitura || !data) {
      if (erroDaLeitura) {
        console.warn('[atraso-de-entrega] não leu a fronteira:', erroDaLeitura.message);
      }
      return;
    }

    const guardado: ParDaFronteira = {
      carimboIso: (data.entrega_carimbo_em as string | null) ?? null,
      recebidaIso: (data.entrega_recebida_em as string | null) ?? null,
    };

    if (!moveAFronteira({ carimboMs, carimboGuardadoIso: guardado.carimboIso, agoraMs })) return;

    const atrasoNovoSeg = Math.max(0, Math.round((agoraMs - carimboMs) / 1000));
    const apagaOAlarme = podeIgnorarOEspacamento(atrasoNovoSeg, guardado);
    if (!espacamentoLiberou(guardado.recebidaIso, agoraMs) && !apagaOAlarme) return;

    const carimboIso = new Date(carimboMs).toISOString();
    let escrita = db.from('cb_channels').update({
      entrega_carimbo_em: carimboIso,
      entrega_recebida_em: new Date(agoraMs).toISOString(),
    }).eq('id', channelId);

    // ⚠️⚠️ TODA condição vive no WHERE, nunca só em memória. As checagens
    // acima decidem se VALE tentar; elas não contêm nada sozinhas, porque
    // várias invocações concorrentes do webhook para o mesmo canal leem a
    // MESMA linha antes de qualquer uma escrever. Quem serializa é o banco.
    if (apagaOAlarme) {
      // A transição que APAGA o alarme dispensa o espaçamento, mas leva a
      // condição que a torna atômica: "a fronteira guardada ainda é um
      // alarme aceso". Ela não depende do valor lido — é a coluna contra
      // uma constante.
      //
      // ⚠️ Duas versões anteriores erraram aqui, em direções opostas, e as
      // duas valem como aviso:
      //
      //  1. SEM cerca nenhuma, com o argumento de que o ramo era
      //     "auto-limitante" (`podeIgnorarOEspacamento` exige a fronteira
      //     guardada atrasada). Só valia SEQUENCIALMENTE: concorrentes leem
      //     todas a mesma linha atrasada e todas escrevem.
      //  2. Com COMPARE-AND-SWAP do valor exato lido. Atômico, mas PERDE a
      //     amostra saudável que corre com uma atrasada mais nova: as duas
      //     leem a fronteira velha, a atrasada grava primeiro, e a saudável
      //     não casa mais o valor original. Se era ela que encerrava o
      //     backlog e o tráfego silencia, o alarme fica aceso até a medição
      //     expirar — de volta ao defeito da 1ª rodada (Codex, 5ª rodada).
      //
      // Com o corte do alarme, os dois casos saem certos: a saudável que
      // perde a corrida AINDA casa (a fronteira nova continua atrasada, e
      // ela a apaga), e a segunda saudável NÃO casa (a fronteira já ficou
      // recente). Auto-limitação de verdade, imposta pelo banco.
      escrita = escrita
        .lt('entrega_carimbo_em', corteDoAlarme(agoraMs))
        // Avanço, pelo mesmo motivo do outro ramo. Redundante enquanto a
        // amostra for saudável (o corte já é mais restritivo), e mantido
        // explícito para a invariante não depender dessa coincidência.
        .lt('entrega_carimbo_em', carimboIso);
    } else {
      const limiteIso = new Date(agoraMs - ESPACAMENTO_DE_GRAVACAO_SEG * 1000).toISOString();
      escrita = escrita
        // Só avança. `or` cobre a primeira entrega, quando a coluna é nula —
        // `.lt()` sozinho nunca casa NULL e a fronteira nunca sairia do zero.
        .or(`entrega_carimbo_em.is.null,entrega_carimbo_em.lt.${carimboIso}`)
        // E o espaçamento, que é o que contém a rajada do backlog drenando.
        .or(`entrega_recebida_em.is.null,entrega_recebida_em.lt.${limiteIso}`);
    }

    const { error } = await escrita;
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
