import {
  coorteDoPeriodo,
  emAbertoDe,
  entradasPorDia,
  funilDeContagens,
  type PerdaPorEtapa,
  type ResumoDoPeriodo,
  resumoDoPeriodo,
} from "./coorte";
import { type Classificacao, DEGRAUS, indiceDoDegrau } from "./degraus";
import { dentroDoIntervalo, type Intervalo } from "./periodo";
import type { FatosDoNegocio } from "./trajetoria";

/**
 * A contagem POR PERÍODO — o padrão das abas Desempenho e Saúde desde
 * 18/09/2026, por decisão do operador: "se eu tive 10 reuniões marcadas no
 * mês passado e dessas 10 reuniões 5 contratos fechados esse mês, quando eu
 * olhar para as métricas desse mês eu preciso ver os 5 contratos fechados".
 *
 * O modo anterior (`coorte.ts`, "por mês de entrada") continua existindo, sob
 * demanda: lá o período escolhe QUEM entra na conta (a coorte) e tudo o que
 * esses leads fizeram depois conta até hoje. Aqui o período escolhe O QUE
 * ACONTECEU nele, venha o lead de quando vier.
 *
 * As regras (seção 3.5 do plano, docs/PLANO-funil-comercial.md):
 *
 *  - LEADS = negócios cuja ENTRADA no funil caiu no período. Igual nos dois
 *    modos.
 *  - DEGRAU k = negócios que alcançaram o degrau k PELA PRIMEIRA VEZ no
 *    período (`FatosDoNegocio.alcancouEm`, a regra 7 da trajetória). É daqui
 *    que saem as duas garantias pedidas pelo operador: bater duas vezes em
 *    "Reunião Agendada" conta UMA vez (na primeira, e nunca de novo em outro
 *    mês), e quem fecha contrato sem passar por Proposta conta em Proposta na
 *    data do contrato.
 *  - PERDA = está numa etapa de perda HOJE e entrou nela no período. Quem foi
 *    desqualificado e voltou ao funil não é perda em mês nenhum — a mesma
 *    régua da coorte ("perda é onde está hoje"), agora datada.
 *  - DINHEIRO (valor fechado, ticket, e o CAC que a tela deriva) = contrato
 *    alcançado no período que CONTINUA fechado hoje. O distrato conta no
 *    degrau e some do dinheiro, como na coorte.
 *  - SEM AVANÇO / EM ANDAMENTO / FORA DO FUNIL = a foto de hoje dos leads que
 *    ENTRARAM no período. Não são fluxo, e por isso não mudam entre os modos.
 *
 * ⚠️⚠️ AS TAXAS AQUI SÃO RAZÃO DE FLUXO, NÃO CONVERSÃO DE COORTE: contratos do
 * período ÷ reuniões do período. Numa conta pequena o numerador vem de leads
 * de outro mês, e a taxa PODE PASSAR DE 100% (5 contratos de reuniões de
 * agosto, 2 reuniões em setembro = 250%). Decisão do operador (18/09/2026):
 * mostrar como é, com a nota na tela. Quem precisa da conversão rigorosa usa
 * o modo por mês de entrada, onde nenhuma taxa passa de 100%. NÃO "consertar"
 * com `Math.min(1, …)`: o número cortado afirmaria uma conversão que não houve.
 *
 * ⚠️ A RPC devolve a trajetória INTEIRA de todo negócio com evento no
 * intervalo carregado, e isso é load-bearing aqui: "primeira vez" só é
 * primeira olhando a história toda. Truncar o trajeto ao período faria a
 * reentrada numa etapa contar de novo.
 *
 * ⚠️ As datas vêm de `cb_lead_events.occurred_at`, sem filtrar a origem —
 * evento `retroativo` (a carga da Kommo, docs/PLANO-migracao-kommo.md) conta
 * na data REAL que carregar. É o que faz o funil dos meses anteriores sair
 * verdadeiro depois da migração; carga que carimbe `now()` despeja tudo no
 * dia da importação.
 */

export const MODOS_DE_CONTAGEM = ["periodo", "entrada"] as const;
export type ModoDeContagem = (typeof MODOS_DE_CONTAGEM)[number];
export const MODO_PADRAO: ModoDeContagem = "periodo";

/** Preferência por dispositivo (`localStorage`), como as colunas da lista. */
export const CHAVE_DO_MODO = "wacrm:pipelines:funil:modo";

/** Parse, nunca `as`: valor estranho no storage cai no padrão. */
export function lerModo(cru: unknown): ModoDeContagem {
  return typeof cru === "string" && (MODOS_DE_CONTAGEM as readonly string[]).includes(cru)
    ? (cru as ModoDeContagem)
    : MODO_PADRAO;
}

function noPeriodo(d: Date | null, intervalo: Intervalo): boolean {
  return d !== null && dentroDoIntervalo(d, intervalo);
}

export function resumoPorPeriodo(
  fatos: readonly FatosDoNegocio[],
  classificacao: Classificacao,
  intervalo: Intervalo,
  agora: Date,
): ResumoDoPeriodo {
  const entrantes = coorteDoPeriodo(fatos, intervalo);
  const entradas = entrantes.length;

  const alcancaram = DEGRAUS.map(
    (_, k) => fatos.filter((f) => noPeriodo(f.alcancouEm[k] ?? null, intervalo)).length,
  );
  const { porDegrau, transicoes, global } = funilDeContagens(alcancaram, entradas, classificacao);

  // Perda datada: a ÚLTIMA entrada na etapa de perda em que o negócio está
  // (`naEtapaDesde`). Quem saiu da perda não entra — `situacao` é de hoje.
  const perdidosNoPeriodo = fatos.filter(
    (f) => f.situacao === "perdido" && noPeriodo(f.naEtapaDesde, intervalo),
  );
  const perdasPorEtapa: PerdaPorEtapa[] = classificacao.porClasse.perda.map((etapa) => ({
    etapaId: etapa.id,
    nome: etapa.name,
    n: perdidosNoPeriodo.filter((f) => f.etapaAtual === etapa.id).length,
  }));

  const contrato = indiceDoDegrau("contrato");
  const emPe = fatos.filter(
    (f) => f.situacao === "fechado" && noPeriodo(f.alcancouEm[contrato] ?? null, intervalo),
  );
  const valorFechado = emPe.reduce((soma, f) => soma + f.linha.value, 0);

  return {
    entradas,
    porDegrau,
    transicoes,
    global,
    perdasPorEtapa,
    perdidos: perdidosNoPeriodo.length,
    ...emAbertoDe(entrantes),
    fechados: alcancaram[contrato],
    fechadosAgora: emPe.length,
    valorFechado,
    ticketMedio: emPe.length > 0 ? valorFechado / emPe.length : null,
    entradasPorDia: entradasPorDia(entrantes, intervalo, agora),
  };
}

/** O resumo no modo escolhido — o único ponto em que as telas decidem. */
export function resumoNoModo(
  modo: ModoDeContagem,
  fatos: readonly FatosDoNegocio[],
  classificacao: Classificacao,
  intervalo: Intervalo,
  agora: Date,
): ResumoDoPeriodo {
  return modo === "entrada"
    ? resumoDoPeriodo(fatos, classificacao, intervalo, agora)
    : resumoPorPeriodo(fatos, classificacao, intervalo, agora);
}

/**
 * Houve ALGO no período? No modo por período "nenhum lead entrou" não quer
 * dizer tela vazia — contrato e perda de lead antigo contam. A nota de
 * período vazio só aparece quando nada aconteceu.
 */
export function periodoSemAtividade(resumo: ResumoDoPeriodo): boolean {
  return (
    resumo.entradas === 0 &&
    resumo.perdidos === 0 &&
    resumo.porDegrau.every((d) => d.alcancaram === 0)
  );
}
