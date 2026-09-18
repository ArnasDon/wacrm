import { type Classificacao, type Degrau, DEGRAUS } from "./degraus";
import type { ResumoDoPeriodo } from "./coorte";
import { type MesDoHistorico, mesesAnteriores } from "./periodo";
import { type ModoDeContagem, resumoNoModo } from "./por-periodo";
import type { FatosDoNegocio } from "./trajetoria";

/**
 * A vista de Saúde: doze MESES e a escala de cor do mapa de calor. No modo
 * "por período" (o padrão desde 18/09/2026) cada mês mostra o que ACONTECEU
 * nele; no modo "por mês de entrada" cada mês é uma COORTE (quem entrou nele,
 * e o que fez até hoje). Ver `por-periodo.ts`.
 *
 * Regra 11 do plano: coorte recente ainda está em andamento (a tela marca),
 * e coorte PEQUENA fica apagada — taxa sobre 2 leads é ruído, e a referência
 * pinta 100% e 0% com a mesma confiança.
 *
 * Cor RELATIVA À LINHA (decisão D6): dentro de uma transição, o melhor mês
 * dos doze é verde e o pior é vermelho. Escala absoluta pintaria
 * "Lead → Contrato" de vermelho em todo mês (2–9%) e não informaria nada.
 */

export const COORTE_PEQUENA = 5;

export interface CoorteMensal extends MesDoHistorico {
  resumo: ResumoDoPeriodo;
  /** ainda sem desfecho: sem avanço + em andamento. */
  emAberto: number;
  pequena: boolean;
}

/**
 * `modo` é OBRIGATÓRIO de propósito (18/09/2026): o padrão das telas passou a
 * ser a contagem por período, e um parâmetro opcional deixaria um chamador
 * novo cair na coorte sem ninguém ter escolhido.
 *
 * ⚠️ `emAberto` só existe na COORTE: lá o mês ainda muda enquanto houver lead
 * sem desfecho (a taxa de agosto sobe quando um lead de agosto fecha em
 * outubro). Por período o mês já passado é final — o contrato de outubro
 * conta em outubro —, então a marca "N em aberto" afirmaria uma incerteza
 * que não existe. Fica zero, e quem não fechou ainda é o mês corrente, que a
 * tela diz na nota.
 */
export function coortesMensais(
  fatos: readonly FatosDoNegocio[],
  classificacao: Classificacao,
  meses: number,
  agora: Date,
  modo: ModoDeContagem,
): CoorteMensal[] {
  return mesesAnteriores(agora, meses).map((mes) => {
    const resumo = resumoNoModo(modo, fatos, classificacao, { desde: mes.desde, ate: mes.ate }, agora);
    return {
      ...mes,
      resumo,
      emAberto: modo === "entrada" ? resumo.semAvanco + resumo.emAndamento : 0,
      pequena: coortePequena(resumo.entradas),
    };
  });
}

export function coortePequena(entradas: number): boolean {
  return entradas < COORTE_PEQUENA;
}

export interface TransicaoDoHistorico {
  de: Degrau;
  para: Degrau;
  /** lead → contrato, a linha de baixo do mapa. */
  global: boolean;
}

/** As linhas do gráfico e do mapa: degraus MAPEADOS consecutivos + a global. */
export function transicoesDoHistorico(classificacao: Classificacao): TransicaoDoHistorico[] {
  const mapeados = DEGRAUS.filter((d) => classificacao.porClasse[d].length > 0);
  const linhas: TransicaoDoHistorico[] = mapeados
    .slice(1)
    .map((para, i) => ({ de: mapeados[i], para, global: false }));
  if (classificacao.porClasse.lead.length > 0 && classificacao.porClasse.contrato.length > 0) {
    linhas.push({ de: "lead", para: "contrato", global: true });
  }
  return linhas;
}

export interface LinhaDoMapa {
  transicao: TransicaoDoHistorico;
  /** uma taxa (fração) por mês, na ordem das coortes; nula sem denominador. */
  taxas: (number | null)[];
  /** 0..1 relativo à LINHA, calculado SEM as coortes pequenas (regra 11). */
  escala: (v: number | null) => number | null;
}

/**
 * Uma linha por transição, com a escala de cor própria. Coorte pequena
 * entra com a taxa (a célula mostra o número, apagado) mas fica FORA do
 * min/max — 100% sobre um lead dominaria a escala do ano inteiro.
 */
export function linhasDoMapa(coortes: readonly CoorteMensal[], classificacao: Classificacao): LinhaDoMapa[] {
  return transicoesDoHistorico(classificacao).map((transicao) => {
    const taxas = coortes.map((c) => {
      const t = transicao.global
        ? c.resumo.global
        : c.resumo.transicoes.find((x) => x.de === transicao.de && x.para === transicao.para);
      return t?.taxa ?? null;
    });
    const confiaveis = taxas.map((t, i) => (coortes[i].pequena ? null : t));
    return { transicao, taxas, escala: escalaRelativa(confiaveis) };
  });
}

/**
 * Normaliza os valores de UMA linha do mapa para 0..1 (pior → melhor).
 * Nulos ficam nulos; linha sem variação (tudo igual) devolve 0.5 — não há
 * "melhor" nem "pior" para pintar.
 */
export function escalaRelativa(
  valores: readonly (number | null)[],
): (v: number | null) => number | null {
  const validos = valores.filter((v): v is number => v !== null);
  if (validos.length === 0) return () => null;
  const min = Math.min(...validos);
  const max = Math.max(...validos);
  return (v) => {
    if (v === null) return null;
    if (max === min) return 0.5;
    return (v - min) / (max - min);
  };
}
