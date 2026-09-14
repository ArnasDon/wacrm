"use client";

import { Loader2, Settings } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useTrajetorias } from "@/hooks/use-trajetorias";
import { useAoVoltarParaOApp } from "@/hooks/use-ao-voltar-para-o-app";
import { formatarPercentual, paraPontosPercentuais } from "@/lib/funil/apresentacao";
import { classificarEtapas, type Degrau } from "@/lib/funil/degraus";
import { inicioDoMesLocal } from "@/lib/funil/periodo";
import { COORTE_PEQUENA, coortesMensais, linhasDoMapa, type TransicaoDoHistorico } from "@/lib/funil/saude";
import { fatosDoNegocio } from "@/lib/funil/trajetoria";
import type { Pipeline, PipelineStage } from "@/types";

import { GraficoDeConversao, type SerieDeConversao } from "./grafico-de-conversao";
import { MapaDeCalor, type LinhaDoMapaDeCalor } from "./mapa-de-calor";

/**
 * A vista de SAÚDE (Fase 3 do plano): doze coortes mensais (pelo mês da
 * ENTRADA no funil), a conversão por transição ao longo do tempo e o mapa
 * de calor com cor relativa à linha. Conta em `src/lib/funil/saude.ts`.
 *
 * UMA carga da RPC para `[1º dia de 11 meses atrás, hoje)` — o que a coorte
 * de cada mês fez depois conta até hoje. Coorte com lead ainda SEM DESFECHO
 * é "em andamento" e traz a contagem sob o mês — não é o mês corrente: a
 * coorte de agosto com três leads abertos segue mudando em setembro, e o
 * mês corrente com tudo resolvido já é final (Codex, PR #122). Coorte
 * pequena (< 5) fica apagada e fora da escala de cor.
 */

const MESES = 12;

/**
 * ⚠️ As três classes de cada degrau são LITERAIS, nunca derivadas por
 * `replace("stroke-", "fill-")`: o Tailwind varre o FONTE atrás de strings e
 * não executa código, então uma classe montada em tempo de execução
 * simplesmente não é gerada — e o ponto da linha caía no preto padrão do
 * SVG, sem erro nenhum. Medido no CSS compilado: `.fill-sky-500` tinha ZERO
 * ocorrências enquanto `.stroke-sky-500` tinha uma. É a mesma armadilha da
 * `PALETA_DE_CANAIS` (CLAUDE.md), e há teste cobrando a forma.
 */
export interface CorDoDegrau {
  traco: string;
  ponto: string;
  bloco: string;
}

const COR_DA_TRANSICAO: Record<Degrau, CorDoDegrau> = {
  lead: { traco: "stroke-sky-500", ponto: "fill-sky-500", bloco: "bg-sky-500" },
  mql: { traco: "stroke-violet-500", ponto: "fill-violet-500", bloco: "bg-violet-500" },
  reuniao: { traco: "stroke-pink-500", ponto: "fill-pink-500", bloco: "bg-pink-500" },
  proposta: { traco: "stroke-amber-500", ponto: "fill-amber-500", bloco: "bg-amber-500" },
  contrato: { traco: "stroke-emerald-500", ponto: "fill-emerald-500", bloco: "bg-emerald-500" },
};

export function Saude({
  pipeline,
  stages,
  etapasCarregadas,
  onConfigurar,
}: {
  pipeline: Pipeline;
  stages: PipelineStage[];
  /** se `stages` já é DESTE funil — ver o mesmo campo em `Desempenho`. */
  etapasCarregadas: boolean;
  onConfigurar: () => void;
}) {
  const t = useTranslations("Pipelines.funil.saude");
  const tDesempenho = useTranslations("Pipelines.funil.desempenho");
  const tDegraus = useTranslations("Pipelines.funil.degraus");

  const agora = new Date();
  const desde = inicioDoMesLocal(agora.getFullYear(), agora.getMonth() - (MESES - 1));
  const { linhas, carregando, falhou, recarregar } = useTrajetorias(pipeline.id, { desde, ate: null });
  // O app instalado no celular não tem botão de recarregar: voltar para ele
  // depois de um tempo fora refaz as coortes. Com o `recarregar` comum, que
  // pisca o carregando — é relatório, afirma números (a escolha do Meu dia).
  useAoVoltarParaOApp(recarregar);

  const classificacao = classificarEtapas(stages);
  const rotuloDoDegrau = (d: Degrau) =>
    // chave montada: `degraus.<d>` — cobrada em degraus.test.ts
    tDegraus(d as Parameters<typeof tDegraus>[0]);
  const rotuloDaTransicao = (tr: TransicaoDoHistorico) =>
    tr.global ? tDesempenho("taxas.global") : `${rotuloDoDegrau(tr.de)} → ${rotuloDoDegrau(tr.para)}`;

  // Etapas ainda não chegaram ≠ funil sem etapa (ver `Desempenho`).
  if (!etapasCarregadas) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {tDesempenho("carregando")}
      </div>
    );
  }
  if (!classificacao.configurado) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
        <Settings className="h-8 w-8 text-muted-foreground" />
        <p className="max-w-md text-sm text-muted-foreground">{tDesempenho("configure")}</p>
        <Button variant="outline" onClick={onConfigurar} className="border-border bg-card text-foreground hover:bg-muted">
          {tDesempenho("configurar")}
        </Button>
      </div>
    );
  }

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {tDesempenho("carregando")}
      </div>
    );
  }
  if (falhou) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card py-16 text-sm text-muted-foreground">
        {tDesempenho("falhou")}
        <button type="button" onClick={recarregar} className="underline hover:text-foreground">
          {tDesempenho("tentarDeNovo")}
        </button>
      </div>
    );
  }

  const fatos = (linhas ?? []).map((l) => fatosDoNegocio(l, pipeline.id, classificacao));
  const coortes = coortesMensais(fatos, classificacao, MESES, agora);
  const mapa = linhasDoMapa(coortes, classificacao);
  // "jul/26", não "jul. de 26": são doze colunas lado a lado.
  const rotuloDoMes = (d: Date) =>
    `${d.toLocaleDateString(undefined, { month: "short" }).replace(".", "")}/${String(d.getFullYear()).slice(-2)}`;
  const meses = coortes.map((c) => ({
    chave: c.chave,
    rotulo: rotuloDoMes(c.desde),
    // "em andamento" é ter lead SEM DESFECHO, não ser o mês corrente (ver
    // o cabeçalho): a contagem vai para debaixo do rótulo do mês.
    emAberto: c.emAberto,
  }));
  const totalDeEntradas = coortes.reduce((s, c) => s + c.resumo.entradas, 0);

  const series: SerieDeConversao[] = mapa.map((linha) => ({
    chave: `${linha.transicao.de}-${linha.transicao.para}${linha.transicao.global ? "-global" : ""}`,
    rotulo: rotuloDaTransicao(linha.transicao),
    cor: COR_DA_TRANSICAO[linha.transicao.global ? "contrato" : linha.transicao.de],
    valores: linha.taxas.map(paraPontosPercentuais),
  }));

  const linhasDoCalor: LinhaDoMapaDeCalor[] = mapa.map((linha) => ({
    chave: `${linha.transicao.de}-${linha.transicao.para}${linha.transicao.global ? "-global" : ""}`,
    rotulo: rotuloDaTransicao(linha.transicao),
    celulas: linha.taxas.map((taxa, i) => ({
      taxa,
      posicao: coortes[i].pequena ? null : linha.escala(taxa),
      entradas: coortes[i].resumo.entradas,
      pequena: coortes[i].pequena,
    })),
  }));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {t("periodo", { meses: MESES })} · {t("entradas", { n: totalDeEntradas })}
      </p>
      {totalDeEntradas === 0 && (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          {t("semCoortes")}
        </p>
      )}

      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("conversao.titulo")} <span className="font-normal normal-case">· {t("conversao.subtitulo", { meses: MESES })}</span>
        </h3>
        {series.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{tDesempenho("funil.semEtapa")}</p>
        ) : (
          <GraficoDeConversao
            meses={meses.map((m) => m.rotulo)}
            series={series}
            formatarValor={(v) => (v === null ? "—" : formatarPercentual(v / 100))}
          />
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("mapa.titulo")} <span className="font-normal normal-case">· {t("mapa.subtitulo")}</span>
          </h3>
          <span className="text-[11px] text-muted-foreground">
            {t("mapa.legenda", { minimo: COORTE_PEQUENA })}
          </span>
        </div>
        {linhasDoCalor.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{tDesempenho("funil.semEtapa")}</p>
        ) : (
          <MapaDeCalor
            meses={meses}
            linhas={linhasDoCalor}
            formatarTaxa={formatarPercentual}
            tituloDaCelula={(mes, taxa, entradas) => t("mapa.celula", { mes, taxa, n: entradas })}
            rotuloEmAndamento={(n) => t("mapa.emAndamento", { n })}
            rotuloEmAberto={(n) => t("mapa.emAberto", { n })}
            rotuloPequena={t("mapa.pequena", { minimo: COORTE_PEQUENA })}
          />
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">{t("fonte", { funil: pipeline.name })}</p>
      </section>
    </div>
  );
}
