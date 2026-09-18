"use client";

import { BarChart } from "@/components/tremor/bar-chart";
import { eixoDasTaxas } from "@/lib/funil/apresentacao";

export interface LinhaDeTaxa {
  transicao: string;
  atual: number | null;
  anterior: number | null;
}

/**
 * Taxas de conversão entre degraus, atual × anterior — barras horizontais
 * (o `layout="vertical"` do recharts é o das barras deitadas). Os valores
 * já chegam em pontos percentuais (0..100). Tremor vendorizado, como o
 * gráfico de tempo de resposta do painel.
 */
export function GraficoDeTaxas({
  linhas,
  rotuloAtual,
  rotuloAnterior,
}: {
  linhas: LinhaDeTaxa[];
  rotuloAtual: string;
  rotuloAnterior: string;
}) {
  // As chaves das séries são os RÓTULOS traduzidos: o Tremor usa a chave
  // como texto da legenda e do tooltip. Taxa NULA (sem denominador, ou
  // sem período anterior no "Total") continua nula: barra ausente e "—" no
  // tooltip. Coalescer para 0 desenhava "0,0%" — uma conversão MEDIDA em
  // zero, que não houve (Codex, PR #121).
  const dados = linhas.map((l) => ({
    transicao: l.transicao,
    [rotuloAtual]: l.atual,
    [rotuloAnterior]: l.anterior,
  }));
  // 100 enquanto couber; na contagem por período a taxa pode passar disso, e
  // com o eixo cravado a barra era cortada na borda (ver `eixoDasTaxas`).
  const { teto } = eixoDasTaxas(linhas.flatMap((l) => [l.atual, l.anterior]));

  return (
    <BarChart
      data={dados}
      index="transicao"
      categories={[rotuloAtual, rotuloAnterior]}
      colors={["emerald", "amber"]}
      layout="vertical"
      valueFormatter={(v) => (v == null ? "—" : `${v.toFixed(1)}%`)}
      minValue={0}
      maxValue={teto}
      yAxisWidth={190}
      showLegend
      legendPosition="right"
      className="h-[280px]"
    />
  );
}
