import { localDayKey } from "@/lib/dashboard/date-utils";

import { type Classificacao, type Degrau, DEGRAUS, indiceDoDegrau } from "./degraus";
import { dentroDoIntervalo, diasDoIntervalo, type Intervalo } from "./periodo";
import type { FatosDoNegocio } from "./trajetoria";

/**
 * A COORTE de um período e tudo o que o painel de Desempenho mostra sobre
 * ela. Regra 2 do plano: a coorte são os negócios cuja ENTRADA no funil
 * caiu no período; tudo o mais se conta sobre ela ATÉ HOJE — "dos 35 que
 * entraram em setembro, 21 chegaram a MQL", inclusive se chegaram em outubro.
 *
 * ⚠️ As linhas da RPC são um SUPERCONJUNTO (negócio criado no intervalo OU
 * com qualquer evento no intervalo). O recorte de verdade é `coorteDoPeriodo`
 * — nunca some as linhas cruas como se fossem a coorte.
 *
 * ⚠️ Negócio transferido para outro funil está aqui como qualquer outro
 * (regra 6, decisão do operador em 2026-09-03): `fatosDoNegocio` já
 * resolveu a última etapa dele neste funil.
 */

export interface ContagemDoDegrau {
  degrau: Degrau;
  /** negócios da coorte que alcançaram este degrau ou um posterior (regra 3). */
  alcancaram: number;
  /** o funil tem ao menos uma etapa neste degrau. Sem etapa = card tracejado. */
  comEtapa: boolean;
  /** alcançaram ÷ o degrau mapeado anterior (o primeiro: ÷ entradas); nulo sem etapa ou sem denominador. */
  taxaDoAnterior: number | null;
}

export interface Transicao {
  de: Degrau;
  para: Degrau;
  numerador: number;
  denominador: number;
  /** fração 0..1; nulo quando o denominador é zero. */
  taxa: number | null;
}

export interface PerdaPorEtapa {
  etapaId: string;
  nome: string;
  n: number;
}

export interface EntradasNoDia {
  /** AAAA-MM-DD local */
  dia: string;
  n: number;
}

export interface ResumoDoPeriodo {
  entradas: number;
  porDegrau: ContagemDoDegrau[];
  /** entre degraus MAPEADOS consecutivos — degrau sem etapa é pulado. */
  transicoes: Transicao[];
  /** lead → contrato; nulo se um dos dois não tem etapa. */
  global: Transicao | null;
  /** uma linha por etapa de perda, na ordem do funil, inclusive com zero. */
  perdasPorEtapa: PerdaPorEtapa[];
  perdidos: number;
  /**
   * Entrantes do período que estão perdidos HOJE. Na coorte é o próprio
   * `perdidos`; por período os dois divergem — `perdidos` é fluxo (perda de
   * lead de qualquer mês) e este é a foto dos entrantes, como sem avanço e
   * em andamento. É o que o "custo dos perdidos" multiplica: custo por lead
   * do período × perdas de leads de OUTROS meses passava do investimento
   * (revisão do PR #224).
   */
  perdidosDosEntrantes: number;
  semAvanco: number;
  emAndamento: number;
  /** em andamento por degrau ATUAL (o "pipeline ativo" da referência = proposta). */
  emAndamentoPorDegrau: Partial<Record<Degrau, number>>;
  /**
   * Entrou no funil e hoje está numa etapa SEM degrau (estacionado). É balde
   * da coorte como os outros — sem ele, os totais não fechavam com as
   * entradas (achado do Codex no PR #119). ⚠️ A partição é por `situacao`:
   * fechado + perdido + sem avanço + em andamento + fora do funil =
   * entradas — e o "fechado" dela é `fechadosAgora`, NUNCA `fechados`
   * (aquele é "alcançou contrato" e inclui quem voltou).
   */
  foraDoFunil: number;
  /**
   * ⚠️ ALCANÇARAM contrato (regra 3), mesmo que tenham voltado ou se
   * perdido depois. É o número do DEGRAU do funil de eficiência e das
   * taxas — não é "contrato em pé", e somá-lo aos baldes conta o mesmo
   * negócio duas vezes. Para dinheiro, use `fechadosAgora`.
   */
  fechados: number;
  /**
   * Contratos que ESTÃO fechados hoje (`situacao === 'fechado'`). É daqui
   * que saem valor fechado, ticket médio e o CAC: um distrato (chegou a
   * contrato e foi para uma etapa de perda) reaparecia como receita e
   * dividia o investimento por um número inflado — medido numa coorte de
   * teste, 4 "contratos" e R$ 68.000 onde havia 1 e R$ 24.000 (revisão do
   * PR #123).
   */
  fechadosAgora: number;
  valorFechado: number;
  ticketMedio: number | null;
  /** densa quando o intervalo tem `desde`; esparsa (só dias com lead) no Total. */
  entradasPorDia: EntradasNoDia[];
}

export function coorteDoPeriodo(
  fatos: readonly FatosDoNegocio[],
  intervalo: Intervalo,
): FatosDoNegocio[] {
  return fatos.filter((f) => f.entradaEm !== null && dentroDoIntervalo(f.entradaEm, intervalo));
}

function transicao(de: Degrau, para: Degrau, alcancaram: number[]): Transicao {
  const numerador = alcancaram[indiceDoDegrau(para)];
  const denominador = alcancaram[indiceDoDegrau(de)];
  return { de, para, numerador, denominador, taxa: denominador > 0 ? numerador / denominador : null };
}

/**
 * Das contagens por degrau ao funil de eficiência: a taxa de cada degrau
 * sobre o mapeado anterior (o primeiro, sobre as entradas), as transições
 * encadeadas e a global. É a MESMA montagem nos dois modos de contagem — o
 * que muda entre eles é de onde saem `alcancaram` e `entradas` (a coorte,
 * aqui; o que aconteceu no período, em `por-periodo.ts`). Duas cópias
 * divergiriam na primeira mudança, e a tela leria taxas calculadas de jeitos
 * diferentes conforme o seletor.
 */
export function funilDeContagens(
  alcancaram: readonly number[],
  entradas: number,
  classificacao: Classificacao,
): Pick<ResumoDoPeriodo, "porDegrau" | "transicoes" | "global"> {
  const contagens = [...alcancaram];
  const comEtapa = DEGRAUS.map((d) => classificacao.porClasse[d].length > 0);

  let denominadorAnterior = entradas;
  const porDegrau: ContagemDoDegrau[] = DEGRAUS.map((degrau, k) => {
    if (!comEtapa[k]) {
      return { degrau, alcancaram: contagens[k], comEtapa: false, taxaDoAnterior: null };
    }
    const taxaDoAnterior = denominadorAnterior > 0 ? contagens[k] / denominadorAnterior : null;
    denominadorAnterior = contagens[k];
    return { degrau, alcancaram: contagens[k], comEtapa: true, taxaDoAnterior };
  });

  const mapeados = DEGRAUS.filter((_, k) => comEtapa[k]);
  const transicoes = mapeados.slice(1).map((para, i) => transicao(mapeados[i], para, contagens));
  const global =
    comEtapa[indiceDoDegrau("lead")] && comEtapa[indiceDoDegrau("contrato")]
      ? transicao("lead", "contrato", contagens)
      : null;
  return { porDegrau, transicoes, global };
}

export function resumoDoPeriodo(
  fatos: readonly FatosDoNegocio[],
  classificacao: Classificacao,
  intervalo: Intervalo,
  agora: Date,
): ResumoDoPeriodo {
  const coorte = coorteDoPeriodo(fatos, intervalo);
  const entradas = coorte.length;

  const alcancaram = DEGRAUS.map(
    (_, k) => coorte.filter((f) => f.degrauMaximo !== null && f.degrauMaximo >= k).length,
  );
  const { porDegrau, transicoes, global } = funilDeContagens(alcancaram, entradas, classificacao);

  const perdasPorEtapa: PerdaPorEtapa[] = classificacao.porClasse.perda.map((etapa) => ({
    etapaId: etapa.id,
    nome: etapa.name,
    n: coorte.filter((f) => f.situacao === "perdido" && f.etapaAtual === etapa.id).length,
  }));

  const perdidos = coorte.filter((f) => f.situacao === "perdido").length;
  // Duas contas diferentes de propósito: o DEGRAU conta quem alcançou
  // contrato (é o funil de eficiência); o DINHEIRO conta o que está fechado.
  const fechados = coorte.filter((f) => f.alcancouContrato).length;
  const emPe = coorte.filter((f) => f.situacao === "fechado");
  const valorFechado = emPe.reduce((soma, f) => soma + f.linha.value, 0);

  return {
    entradas,
    porDegrau,
    transicoes,
    global,
    perdasPorEtapa,
    perdidos,
    perdidosDosEntrantes: perdidos,
    ...emAbertoDe(coorte),
    fechados,
    fechadosAgora: emPe.length,
    valorFechado,
    ticketMedio: emPe.length > 0 ? valorFechado / emPe.length : null,
    entradasPorDia: entradasPorDia(coorte, intervalo, agora),
  };
}

/**
 * Onde estão HOJE os leads que entraram no período e ainda não têm desfecho
 * — sem avanço, em andamento (por degrau atual) e fora do funil. Vale igual
 * nos dois modos de contagem: é a FOTO dos entrantes, não um fluxo datado.
 */
export function emAbertoDe(
  entrantes: readonly FatosDoNegocio[],
): Pick<ResumoDoPeriodo, "semAvanco" | "emAndamento" | "emAndamentoPorDegrau" | "foraDoFunil"> {
  const emAndamentoPorDegrau: Partial<Record<Degrau, number>> = {};
  for (const f of entrantes) {
    if (f.situacao !== "andamento" || !f.classeAtual || f.classeAtual === "perda") continue;
    emAndamentoPorDegrau[f.classeAtual] = (emAndamentoPorDegrau[f.classeAtual] ?? 0) + 1;
  }
  return {
    semAvanco: entrantes.filter((f) => f.situacao === "sem_avanco").length,
    emAndamento: entrantes.filter((f) => f.situacao === "andamento").length,
    emAndamentoPorDegrau,
    foraDoFunil: entrantes.filter((f) => f.situacao === "fora_do_funil").length,
  };
}

export function entradasPorDia(
  coorte: readonly FatosDoNegocio[],
  intervalo: Intervalo,
  agora: Date,
): EntradasNoDia[] {
  const contagem = new Map<string, number>();
  for (const f of coorte) {
    if (!f.entradaEm) continue;
    const dia = localDayKey(f.entradaEm);
    contagem.set(dia, (contagem.get(dia) ?? 0) + 1);
  }
  const densos = intervalo.desde ? diasDoIntervalo(intervalo, agora) : [];
  // ⚠️ A grade densa é limitada (fim do intervalo, teto de dias); a coorte
  // NÃO é. Um relógio de navegador alguns minutos à frente da meia-noite do
  // banco, ou um período personalizado de 26 anos, deixava lead FORA do
  // gráfico enquanto o card "Leads" continuava contando — soma menor que o
  // total, sem nada avisando (revisão do PR #123). Os dias da coorte que a
  // grade não cobre entram, e a ordenação é do próprio dia.
  const dias = [...new Set([...densos, ...contagem.keys()])].sort();
  return dias.map((dia) => ({ dia, n: contagem.get(dia) ?? 0 }));
}

export interface DeltaDeContagem {
  atual: number;
  anterior: number | null;
  /** fração: 0.2 = +20%; nulo sem período anterior ou com anterior zero. */
  variacao: number | null;
}

export interface DeltaDeTaxa {
  atual: number | null;
  anterior: number | null;
  /** diferença em PONTOS PERCENTUAIS; nulo quando falta um dos lados. */
  pp: number | null;
}

export interface Comparacao {
  entradas: DeltaDeContagem;
  fechados: DeltaDeContagem;
  perdidos: DeltaDeContagem;
  global: DeltaDeTaxa | null;
  transicoes: (Pick<Transicao, "de" | "para"> & DeltaDeTaxa)[];
}

function contagem(atual: number, anterior: number | null): DeltaDeContagem {
  return {
    atual,
    anterior,
    variacao: anterior !== null && anterior > 0 ? (atual - anterior) / anterior : null,
  };
}

function taxa(atual: number | null, anterior: number | null): DeltaDeTaxa {
  return {
    atual,
    anterior,
    pp: atual !== null && anterior !== null ? (atual - anterior) * 100 : null,
  };
}

/** Atual × anterior. `anterior` nulo (Total) devolve deltas nulos. */
export function comparar(atual: ResumoDoPeriodo, anterior: ResumoDoPeriodo | null): Comparacao {
  return {
    entradas: contagem(atual.entradas, anterior?.entradas ?? null),
    fechados: contagem(atual.fechados, anterior?.fechados ?? null),
    perdidos: contagem(atual.perdidos, anterior?.perdidos ?? null),
    global: atual.global
      ? taxa(atual.global.taxa, anterior?.global?.taxa ?? null)
      : null,
    transicoes: atual.transicoes.map((t) => {
      const par = anterior?.transicoes.find((a) => a.de === t.de && a.para === t.para);
      return { de: t.de, para: t.para, ...taxa(t.taxa, par?.taxa ?? null) };
    }),
  };
}
