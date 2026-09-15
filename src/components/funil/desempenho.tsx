"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowRight,
  DollarSign,
  Loader2,
  Megaphone,
  Percent,
  Receipt,
  Settings,
  Trophy,
  UserMinus,
  Users,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { MetricCard } from "@/components/dashboard/metric-card";
import { Button } from "@/components/ui/button";
import { useGastosDeAnuncios } from "@/hooks/use-gastos-de-anuncios";
import { useTrajetorias } from "@/hooks/use-trajetorias";
import { useAoVoltarParaOApp } from "@/hooks/use-ao-voltar-para-o-app";
import { formatCurrency } from "@/lib/currency";
import { custos, diasDoPeriodo, gastoDoPeriodo } from "@/lib/meta-ads/atribuicao";
import {
  formatarPercentual,
  formatarPp,
  formatarVariacao,
  paraPontosPercentuais,
  sinalArredondado,
} from "@/lib/funil/apresentacao";
import { comparar, resumoDoPeriodo } from "@/lib/funil/coorte";
import { DEGRAUS, classificarEtapas, type Degrau } from "@/lib/funil/degraus";
import {
  duracaoEmDias,
  intervaloDoPreset,
  periodoAnterior,
  type Personalizado,
  type Preset,
} from "@/lib/funil/periodo";
import { fatosDoNegocio } from "@/lib/funil/trajetoria";
import type { Pipeline, PipelineStage } from "@/types";

import { GraficoDeEntradas } from "./grafico-de-entradas";
import { GraficoDeTaxas, type LinhaDeTaxa } from "./grafico-de-taxas";
import { SeletorDePeriodo } from "./seletor-de-periodo";

/**
 * A vista de DESEMPENHO (Fase 2 do plano): o funil de eficiência do período,
 * com comparação contra o período anterior de mesma duração. Toda a conta
 * mora em `src/lib/funil/coorte.ts`; aqui só apresentação.
 *
 * - UMA carga da RPC para `[desde do período anterior, hoje)`: a coorte é
 *   quem ENTROU no período, e o que ela fez depois conta até hoje (regra 2).
 * - Funil sem etapa em `lead` → estado "configure", com o atalho para Funis.
 *   Período sem coorte → zeros com a nota, NUNCA o estado "configure".
 * - Os cinco baldes da situação aparecem, inclusive "fora do funil" —
 *   escondê-lo faria os totais não fecharem (Codex, PR #119).
 */

/**
 * Fundo e borda tingidos com a cor do degrau (a referência do operador,
 * 05/09 — "referência polida", mantendo a identidade do app: são as classes
 * do cartão de sempre, só a cor mudou de borda superior para tinta). Classes
 * LITERAIS, nunca interpoladas: o Tailwind varre o fonte e não executa
 * código (ver PALETA_DE_CANAIS). Os matizes são os das linhas da Saúde.
 */
const TINTA_DO_DEGRAU: Record<Degrau, string> = {
  lead: "border-sky-500/40 bg-sky-500/10",
  mql: "border-violet-500/40 bg-violet-500/10",
  reuniao: "border-pink-500/40 bg-pink-500/10",
  proposta: "border-amber-500/40 bg-amber-500/10",
  contrato: "border-emerald-500/40 bg-emerald-500/10",
};

export function Desempenho({
  pipeline,
  stages,
  etapasCarregadas,
  onConfigurar,
}: {
  pipeline: Pipeline;
  stages: PipelineStage[];
  /**
   * Se `stages` já é DESTE funil. A página carrega as etapas depois da
   * seleção e o estado fica `[]` até lá — o mesmo `[]` de um funil sem
   * etapa. Obrigatória para o compilador cobrar de quem montar a vista.
   */
  etapasCarregadas: boolean;
  /** abre "Gerenciar funil" — é lá que a correspondência das etapas se faz. */
  onConfigurar: () => void;
}) {
  const t = useTranslations("Pipelines.funil.desempenho");
  const tDegraus = useTranslations("Pipelines.funil.degraus");

  const [preset, setPreset] = useState<Preset>("este_mes");
  const [personalizado, setPersonalizado] = useState<Personalizado>({ desde: "", ate: "" });

  const agora = new Date();
  const intervalo = intervaloDoPreset(preset, agora, personalizado);
  const anterior = periodoAnterior(intervalo, agora);
  // superconjunto que cobre os dois períodos; o recorte fino é da coorte
  const { linhas, carregando, falhou, recarregar } = useTrajetorias(pipeline.id, {
    desde: anterior?.desde ?? intervalo.desde,
    ate: null,
  });
  // Fase 4: o gasto em anúncios do período (campanhas → funil), sob RLS.
  const anuncios = useGastosDeAnuncios(intervalo);
  // O app instalado no celular não tem botão de recarregar: voltar para ele
  // depois de um tempo fora refaz as trajetórias E o gasto, com o
  // `recarregar` comum, que pisca o carregando — é relatório, afirma
  // números, e afirmar sobre número velho é pior que piscar (a escolha do
  // Meu dia). ⚠️ Os DOIS juntos: só as trajetórias misturava os leads novos
  // com o gasto de antes da sincronização, e o custo por lead e o CAC saíam
  // errados até trocar de tela ou de período (Codex, merge do PR #216).
  useAoVoltarParaOApp(() => {
    recarregar();
    anuncios.recarregar();
  });

  const classificacao = classificarEtapas(stages);
  const rotuloDoDegrau = (d: Degrau) =>
    // chave montada: `degraus.<d>` — cobrada em degraus.test.ts
    tDegraus(d as Parameters<typeof tDegraus>[0]);

  // Etapas ainda não chegaram ≠ funil sem etapa: o primeiro espera, o
  // segundo cai no estado de configuração (sem Lead mapeado não há o que
  // medir). A versão que gateava por `stages.length > 0` mostrava zero
  // métricas, com cara de funil configurado, para o funil que ficou sem
  // etapa nenhuma (Codex, PR #121).
  if (!etapasCarregadas) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("carregando")}
      </div>
    );
  }
  if (!classificacao.configurado) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
        <Settings className="h-8 w-8 text-muted-foreground" />
        <p className="max-w-md text-sm text-muted-foreground">{t("configure")}</p>
        <Button variant="outline" onClick={onConfigurar} className="border-border bg-card text-foreground hover:bg-muted">
          {t("configurar")}
        </Button>
      </div>
    );
  }

  const fatos = (linhas ?? []).map((l) => fatosDoNegocio(l, pipeline.id, classificacao));
  const atual = resumoDoPeriodo(fatos, classificacao, intervalo, agora);
  const resumoAnterior = anterior ? resumoDoPeriodo(fatos, classificacao, anterior, agora) : null;
  const comparacao = comparar(atual, resumoAnterior);
  const dias = duracaoEmDias(intervalo, agora);

  // A seta sai do valor ARREDONDADO, o mesmo que o texto ao lado escreve:
  // com o sinal cru, -0,04 pp virava seta vermelha ao lado de "0,0 pp".
  const deltaDeContagem = (variacao: number | null) =>
    variacao === null
      ? undefined
      : {
          sign: sinalArredondado(variacao * 100, 0),
          label: t("cards.vsAnterior", { delta: formatarVariacao(variacao) ?? "" }),
        };
  const deltaDeTaxa = (pp: number | null) =>
    pp === null
      ? undefined
      : { sign: sinalArredondado(pp, 1), label: t("cards.vsAnterior", { delta: formatarPp(pp) ?? "" }) };

  const linhasDeTaxas: LinhaDeTaxa[] = [
    ...comparacao.transicoes.map((tr) => ({
      transicao: `${rotuloDoDegrau(tr.de)} → ${rotuloDoDegrau(tr.para)}`,
      atual: paraPontosPercentuais(tr.atual),
      anterior: paraPontosPercentuais(tr.anterior),
    })),
    ...(comparacao.global
      ? [
          {
            transicao: t("taxas.global"),
            atual: paraPontosPercentuais(comparacao.global.atual),
            anterior: paraPontosPercentuais(comparacao.global.anterior),
          },
        ]
      : []),
  ];

  const penultimo = [...DEGRAUS].reverse().find((d, i) => i > 0 && classificacao.porClasse[d].length > 0);
  const emPenultimo = penultimo ? (atual.emAndamentoPorDegrau[penultimo] ?? 0) : 0;
  const pctDosLeads = (n: number) => formatarPercentual(atual.entradas > 0 ? n / atual.entradas : null);

  const investimento = gastoDoPeriodo(anuncios.gastos, anuncios.campanhas, pipeline.id, diasDoPeriodo(intervalo, agora));
  // CAC divide por contrato EM PÉ: com "alcançou contrato", um distrato
  // dividia o investimento por um número inflado (revisão do PR #123).
  const custo = custos(investimento.total, atual.entradas, atual.fechadosAgora, atual.perdidos);
  const moeda = (v: number | null) => (v === null ? "—" : formatCurrency(v));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SeletorDePeriodo
          preset={preset}
          personalizado={personalizado}
          onChange={(p, pers) => {
            setPreset(p);
            setPersonalizado(pers);
          }}
        />
        <p className="text-xs text-muted-foreground">
          {t("periodoPorEntrada")} ·{" "}
          {anterior && dias !== null ? t("comparacaoCom", { dias }) : t("semComparacao")}
        </p>
      </div>

      {carregando ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("carregando")}
        </div>
      ) : falhou ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card py-16 text-sm text-muted-foreground">
          {t("falhou")}
          <button type="button" onClick={recarregar} className="underline hover:text-foreground">
            {t("tentarDeNovo")}
          </button>
        </div>
      ) : (
        <>
          {atual.entradas === 0 && (
            <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              {t("semCoorte")}
            </p>
          )}

          {/* Cards de eficiência */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <MetricCard
              title={t("cards.leads")}
              value={String(atual.entradas)}
              icon={Users}
              delta={deltaDeContagem(comparacao.entradas.variacao)}
              subtitle={comparacao.entradas.variacao === null ? t("cards.semAnterior") : undefined}
            />
            <MetricCard
              title={t("cards.contratos")}
              value={String(atual.fechados)}
              icon={Trophy}
              delta={deltaDeContagem(comparacao.fechados.variacao)}
              subtitle={
                comparacao.fechados.variacao === null
                  ? t("cards.deLeads", { n: atual.entradas })
                  : undefined
              }
            />
            <MetricCard
              title={t("cards.conversao")}
              value={formatarPercentual(atual.global?.taxa ?? null)}
              icon={Percent}
              delta={deltaDeTaxa(comparacao.global?.pp ?? null)}
              subtitle={comparacao.global?.pp == null ? t("cards.deLeads", { n: atual.entradas }) : undefined}
            />
            <MetricCard
              title={t("cards.valorFechado")}
              value={formatCurrency(atual.valorFechado)}
              icon={DollarSign}
              subtitle={t("cards.contratosFechados", { n: atual.fechadosAgora })}
            />
            <MetricCard
              title={t("cards.ticketMedio")}
              value={atual.ticketMedio === null ? "—" : formatCurrency(atual.ticketMedio)}
              icon={Receipt}
              subtitle={atual.ticketMedio === null ? t("cards.semFechados") : t("cards.porContrato")}
            />
          </div>

          {/* Investimento em anúncios (Fase 4) — só com o Meta Ads conectado;
              sem integração, uma linha apontando para Integrações, nunca
              R$ 0,00 com cara de número. */}
          {anuncios.conectado ? (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <MetricCard
                  title={t("investimento.investimento")}
                  value={formatCurrency(investimento.total)}
                  icon={Megaphone}
                  subtitle={t("investimento.campanhasDoFunil", { n: investimento.porCampanha.length })}
                />
                <MetricCard
                  title={t("investimento.custoPorLead")}
                  value={moeda(custo.custoPorLead)}
                  icon={Wallet}
                  subtitle={t("investimento.porLead")}
                />
                <MetricCard
                  title={t("investimento.cac")}
                  value={moeda(custo.cac)}
                  icon={Trophy}
                  subtitle={t("investimento.porContrato")}
                />
                <MetricCard
                  title={t("investimento.custoDosPerdidos")}
                  value={moeda(custo.custoDosPerdidos)}
                  icon={UserMinus}
                  subtitle={t("investimento.porPerdido")}
                />
              </div>
              {investimento.semFunil.total > 0 && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  {t("investimento.semFunil", {
                    valor: formatCurrency(investimento.semFunil.total),
                    n: investimento.semFunil.campanhas,
                  })}{" "}
                  <Link href="/settings?tab=integracoes" className="underline">
                    {t("investimento.abrirIntegracoes")}
                  </Link>
                </p>
              )}
            </>
          ) : anuncios.falhou ? (
            // Ler o gasto falhou (ou não coube). Dizer "conecte o Meta Ads"
            // aqui mandaria conectar o que já está conectado, e mostrar
            // zeros faria o custo por lead mentir para baixo.
            <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              {t("investimento.falhou")}
            </p>
          ) : (
            !anuncios.carregando && (
              <p className="text-xs text-muted-foreground">
                {t("investimento.naoConectado")}{" "}
                <Link href="/settings?tab=integracoes" className="underline hover:text-foreground">
                  {t("investimento.abrirIntegracoes")}
                </Link>
              </p>
            )
          )}

          {/* Funil de eficiência */}
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("funil.titulo")}
              </h3>
              <span className="text-xs text-muted-foreground">
                {t("funil.entradas", { n: atual.entradas })}
              </span>
            </div>
            {/* Cinco cartões tingidos com a cor do degrau e uma seta entre eles
                (a referência do operador). A seta é SÓ seta: a taxa fica dentro
                do cartão, e a queda em número ("−15") foi descartada por decisão
                dele. Abaixo de `lg` as setas somem e os cartões voltam à grade —
                seta quebrando de linha vira ruído. As nove colunas são
                cartão · seta · cartão · …, com a seta no tamanho do ícone. */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-2">
              {atual.porDegrau.map((d, k) => {
                const etapas = classificacao.porClasse[d.degrau].map((e) => e.name);
                const anteriorMapeado = atual.porDegrau.slice(0, k).reverse().find((x) => x.comEtapa);
                return (
                  <Fragment key={d.degrau}>
                    {k > 0 && (
                      <div className="hidden items-center justify-center text-muted-foreground lg:flex" aria-hidden="true">
                        <ArrowRight className="h-4 w-4" />
                      </div>
                    )}
                    <div
                      className={
                        d.comEtapa
                          ? `min-w-0 rounded-lg border p-3 ${TINTA_DO_DEGRAU[d.degrau]}`
                          : "min-w-0 rounded-lg border border-dashed border-border p-3 opacity-70"
                      }
                    >
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {rotuloDoDegrau(d.degrau)}
                      </div>
                      <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                        {d.comEtapa ? d.alcancaram : "—"}
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        {d.comEtapa && anteriorMapeado && <ArrowDownLeft className="h-3 w-3 shrink-0" aria-hidden="true" />}
                        <span className="min-w-0">
                          {!d.comEtapa
                            ? t("funil.semEtapa")
                            : anteriorMapeado
                              ? t("funil.doAnterior", {
                                  pct: formatarPercentual(d.taxaDoAnterior),
                                  degrau: rotuloDoDegrau(anteriorMapeado.degrau),
                                })
                              : t("funil.dasEntradas", { pct: formatarPercentual(d.taxaDoAnterior) })}
                        </span>
                      </div>
                      {etapas.length > 0 && (
                        <div className="mt-2 truncate text-[11px] text-muted-foreground" title={etapas.join(", ")}>
                          {t("funil.etapas", { nomes: etapas.join(", ") })}
                        </div>
                      )}
                      {!d.comEtapa && (
                        <button type="button" onClick={onConfigurar} className="mt-2 text-[11px] underline hover:text-foreground">
                          {t("configurar")}
                        </button>
                      )}
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </section>

          {/* Negativos e em aberto */}
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("negativos.titulo")}
              </h3>
              <span className="text-xs text-muted-foreground">
                {t("negativos.perdidos", { n: atual.perdidos })}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
              {atual.perdasPorEtapa.map((p) => (
                <Balde key={p.etapaId} titulo={p.nome} n={p.n} pct={pctDosLeads(p.n)} descricao={t("negativos.perdaDesc")} tom="perda" />
              ))}
              <Balde
                titulo={t("negativos.semAvanco")}
                n={atual.semAvanco}
                pct={pctDosLeads(atual.semAvanco)}
                descricao={t("negativos.semAvancoDesc")}
                tom="neutro"
              />
              <Balde
                titulo={t("negativos.emAndamento")}
                n={atual.emAndamento}
                pct={pctDosLeads(atual.emAndamento)}
                descricao={
                  penultimo
                    ? t("negativos.emAndamentoDesc", { n: emPenultimo, degrau: rotuloDoDegrau(penultimo) })
                    : ""
                }
                tom="ativo"
              />
              {atual.foraDoFunil > 0 && (
                <Balde
                  titulo={t("negativos.foraDoFunil")}
                  n={atual.foraDoFunil}
                  pct={pctDosLeads(atual.foraDoFunil)}
                  descricao={t("negativos.foraDoFunilDesc")}
                  tom="neutro"
                />
              )}
            </div>
          </section>

          {/* Gráficos */}
          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("taxas.titulo")} <span className="font-normal normal-case">· {t("taxas.subtitulo")}</span>
              </h3>
              {linhasDeTaxas.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{t("funil.semEtapa")}</p>
              ) : (
                <GraficoDeTaxas
                  linhas={linhasDeTaxas}
                  rotuloAtual={t("taxas.atual")}
                  rotuloAnterior={t("taxas.anterior")}
                />
              )}
            </section>
            <section className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("entradas.titulo")} <span className="font-normal normal-case">· {t("entradas.subtitulo")}</span>
              </h3>
              {atual.entradasPorDia.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{t("semCoorte")}</p>
              ) : (
                <GraficoDeEntradas
                  pontos={atual.entradasPorDia}
                  rotuloDaContagem={(n) => t("entradas.noDia", { n })}
                />
              )}
            </section>
          </div>

          {/* Investimento por campanha (Fase 4) */}
          {anuncios.conectado && (
            <section className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("investimento.porCampanha")}
              </h3>
              {investimento.porCampanha.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("investimento.semGasto")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="py-1 pr-2 font-medium">{t("investimento.colCampanha")}</th>
                        <th className="py-1 text-right font-medium">{t("investimento.colGasto")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {investimento.porCampanha.map((c) => (
                        <tr key={c.campaignId} className="border-t border-border">
                          <td className="max-w-[28rem] truncate py-1.5 pr-2" title={c.nome}>
                            {c.nome}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{formatCurrency(c.gasto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Balde({
  titulo,
  n,
  pct,
  descricao,
  tom,
}: {
  titulo: string;
  n: number;
  pct: string;
  descricao: string;
  tom: "perda" | "neutro" | "ativo";
}) {
  const t = useTranslations("Pipelines.funil.desempenho");
  const cor =
    tom === "perda"
      ? "text-red-600 dark:text-red-400"
      : tom === "ativo"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground" title={titulo}>
        {titulo}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${cor}`}>{n}</div>
      <div className="mt-1 text-xs text-muted-foreground">{t("negativos.dosLeads", { pct })}</div>
      {descricao && <div className="mt-1 text-[11px] text-muted-foreground">{descricao}</div>}
    </div>
  );
}
