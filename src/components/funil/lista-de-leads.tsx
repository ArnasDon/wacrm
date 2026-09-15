"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  Loader2,
  MessageSquare,
  Pencil,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCan } from "@/hooks/use-can";
import { useChannels } from "@/hooks/use-channels";
import { useTrajetorias } from "@/hooks/use-trajetorias";
import { useAoVoltarParaOApp } from "@/hooks/use-ao-voltar-para-o-app";
import { avisarDrenagemDeFunil } from "@/lib/automations/avisar-drenagem";
import { formatCurrency } from "@/lib/currency";
import { baixarArquivo, nomeDeArquivoSeguro, paraCsv } from "@/lib/csv";
import { localDayKey } from "@/lib/dashboard/date-utils";
import { classificarEtapas } from "@/lib/funil/degraus";
import {
  CHAVE_COLUNAS,
  COLUNAS_FIXAS,
  COLUNAS_PADRAO,
  FILTROS_VAZIOS,
  ORDENACAO_PADRAO,
  alternarOrdenacao,
  chaveDoCampo,
  ehColunaDeCampo,
  ehOrdenavel,
  filtrarLinhas,
  linhasDoCsv,
  linhasDoFunil,
  noPeriodo,
  nomeDaLinha,
  normalizarColunas,
  ordenarLinhas,
  valorParaCsv,
  type ColunaFixa,
  type ColunaId,
  type ContextoDoCsv,
  type FiltroDeSituacao,
  type FiltrosDaLista,
  type Ordenacao,
} from "@/lib/funil/lista";
import { intervaloDoPreset, type Personalizado, type Preset } from "@/lib/funil/periodo";
import {
  aplicarMudancaDeEtapa,
  fatosDoNegocio,
  type FatosDoNegocio,
  type Situacao,
} from "@/lib/funil/trajetoria";
import { urlDoInbox } from "@/lib/inbox/url";
import { statusAoEntrarNaEtapa } from "@/lib/pipelines/resultado";
import { createClient } from "@/lib/supabase/client";
import type { CustomField, GrupoDeCampos, Pipeline, PipelineStage } from "@/types";

import { ColunasPopover } from "./colunas-popover";
import { SeletorDePeriodo } from "./seletor-de-periodo";

/**
 * A LISTA de leads de um funil (Fase 1 do plano). Lê a RPC das trajetórias
 * pelo `useTrajetorias`, deriva os fatos por negócio (`fatosDoNegocio`) e
 * deixa o recorte/ordenação/CSV com `src/lib/funil/lista.ts` — aqui só
 * tela.
 *
 * - Mostra quem está NESTE funil hoje; período pela CRIAÇÃO do negócio (D3).
 * - A etapa na linha escreve pelo MESMO padrão do quadro: `update` +
 *   ROWCOUNT (RLS que barra volta 0 linhas sem erro) + carimbo otimista de
 *   status + `avisarDrenagemDeFunil()`. Falha → toast, desfaz e recarrega.
 * - Estado vazio só com `carregando=false`: lista vazia DURANTE a carga não
 *   pode virar "nenhum lead" (armadilha do efeito passivo, CLAUDE.md).
 * - Sem virtualização, por decisão: renderiza 100 por vez, "mostrar mais".
 */

const PAGINA = 100;
const SITUACOES: Situacao[] = ["sem_avanco", "andamento", "fechado", "perdido", "fora_do_funil"];

const CHIP_DA_SITUACAO: Record<Situacao, string> = {
  sem_avanco: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  andamento: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  fechado: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  perdido: "bg-red-500/10 text-red-700 dark:text-red-300",
  fora_do_funil: "bg-muted text-muted-foreground",
};

const FUNDO_DA_LINHA: Partial<Record<Situacao, string>> = {
  perdido: "bg-red-500/5",
  fechado: "bg-emerald-500/5",
};

interface Catalogo {
  campos: CustomField[];
  grupos: GrupoDeCampos[];
  perfis: { id: string; full_name: string | null }[];
}

/** Preferência por dispositivo. Só roda no cliente: a vista nasce fechada. */
function lerColunasGravadas(): ColunaId[] {
  if (typeof window === "undefined") return [...COLUNAS_PADRAO];
  try {
    const cru = window.localStorage.getItem(CHAVE_COLUNAS);
    return cru ? normalizarColunas(JSON.parse(cru)) : [...COLUNAS_PADRAO];
  } catch {
    return [...COLUNAS_PADRAO];
  }
}

const formatarData = (d: Date) =>
  d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
const formatarDataHora = (d: Date) =>
  `${formatarData(d)} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;

export function ListaDeLeads({
  pipeline,
  stages,
  etapasCarregadas,
  onEditDeal,
  onDealChanged,
}: {
  pipeline: Pipeline;
  stages: PipelineStage[];
  /**
   * Se `stages` já é DESTE funil — igual em `Desempenho` e `Saude`. A página
   * não limpa as etapas ao trocar de funil, então elas são as do ANTERIOR
   * até a consulta voltar; sem esperar, nenhuma etapa casa, toda linha vira
   * "fora do funil" e o seletor de etapa da linha nasce em branco (Codex,
   * PR #123).
   */
  etapasCarregadas: boolean;
  /** abre o formulário do negócio (a página busca o negócio pelo id). */
  onEditDeal: (dealId: string) => void;
  /** depois de uma escrita: o quadro recarrega os dados dele. */
  onDealChanged: () => void;
}) {
  const t = useTranslations("Pipelines.funil.lista");
  const tSituacao = useTranslations("Pipelines.funil.situacao");
  const router = useRouter();
  const supabase = createClient();
  const podeMover = useCan("send-messages");
  const {
    channels,
    loading: canaisCarregando,
    recarregarEmSilencio: recarregarCanais,
  } = useChannels();

  const [preset, setPreset] = useState<Preset>("este_mes");
  const [personalizado, setPersonalizado] = useState<Personalizado>({ desde: "", ate: "" });
  const [filtros, setFiltros] = useState<FiltrosDaLista>(FILTROS_VAZIOS);
  const [ordenacao, setOrdenacao] = useState<Ordenacao>(ORDENACAO_PADRAO);
  const [colunas, setColunas] = useState<ColunaId[]>(lerColunasGravadas);
  const [limite, setLimite] = useState(PAGINA);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  // Sobe na volta ao app: refaz o catálogo sem tirar o de agora da tela.
  const [versaoDoCatalogo, setVersaoDoCatalogo] = useState(0);

  const intervalo = intervaloDoPreset(preset, new Date(), personalizado);
  const trajetorias = useTrajetorias(pipeline.id, intervalo);
  const { linhas, falhou, recarregar, atualizarLinha } = trajetorias;
  // O app instalado no celular não tem botão de recarregar: voltar para ele
  // depois de um tempo fora refaz a lista. ⚠️ Com o `recarregar` comum, que
  // pisca — e é o que se quer aqui: sem linhas durante a carga, ninguém muda
  // a etapa de um negócio com a recarga no ar, a corrida que o quadro
  // precisou cercar com versão (Codex, PR #216). ⚠️ E os catálogos JUNTO
  // (campos, blocos, perfis e conexões): só as linhas deixava campo, perfil
  // ou conexão renomeados lá fora com o nome antigo, e o responsável novo em
  // branco, até trocar de tela (Codex, merge do PR #216). Esses vão EM
  // SILÊNCIO — são rótulos, e a falha mantém os que estão na tela.
  useAoVoltarParaOApp(() => {
    recarregar();
    setVersaoDoCatalogo((v) => v + 1);
    void recarregarCanais();
  });
  // Sem as etapas DESTE funil, `classificarEtapas` não casa nada: toda linha
  // sairia "fora do funil" e o seletor da linha nasceria em branco.
  const carregando = trajetorias.carregando || !etapasCarregadas;

  // Catálogo de campos (colunas + rótulos), blocos e nomes dos responsáveis —
  // uma busca na montagem e outra a cada volta ao app (`versaoDoCatalogo`);
  // setState só no `.then` (regra do React Compiler).
  useEffect(() => {
    let ativo = true;
    void Promise.all([
      supabase
        .from("custom_fields")
        .select("*")
        .order("posicao", { nullsFirst: false })
        .order("field_name"),
      supabase.from("cb_grupos_de_campos").select("*").order("posicao").order("nome"),
      supabase.from("profiles").select("id, full_name"),
    ]).then(([campos, grupos, perfis]) => {
      if (!ativo) return;
      // ⚠️ Recarga que FALHA não grava por cima do catálogo que já está na
      // tela: vazio apagaria os rótulos e tiraria as colunas de campo da
      // tabela (`colunasVisiveis`) até a volta seguinte — e o celular volta
      // ao app antes da rede. Na primeira carga fica como sempre foi.
      const falhouAgora = Boolean(campos.error || grupos.error || perfis.error);
      setCatalogo((atual) =>
        falhouAgora && atual !== null
          ? atual
          : {
              campos: campos.data ?? [],
              grupos: grupos.data ?? [],
              perfis: perfis.data ?? [],
            },
      );
    });
    return () => {
      ativo = false;
    };
  }, [supabase, versaoDoCatalogo]);

  const classificacao = classificarEtapas(stages);
  const etapasOrdenadas = [...stages].sort((a, b) => a.position - b.position);
  const posicaoDaEtapa = new Map(stages.map((s) => [s.id, s.position]));
  const etapaPorId = new Map(stages.map((s) => [s.id, s]));
  const campoPorChave = new Map((catalogo?.campos ?? []).map((c) => [c.field_key, c]));
  const canalPorId = new Map(channels.map((c) => [c.id, c.label]));
  const perfilPorId = new Map((catalogo?.perfis ?? []).map((p) => [p.id, p.full_name ?? ""]));

  const fatos = (linhas ?? []).map((l) => fatosDoNegocio(l, pipeline.id, classificacao));
  const doPeriodo = noPeriodo(linhasDoFunil(fatos), intervalo);
  const filtradas = filtrarLinhas(doPeriodo, filtros);
  const ordenadas = ordenarLinhas(filtradas, ordenacao, posicaoDaEtapa);
  const visiveis = ordenadas.slice(0, limite);

  // Campo apagado do catálogo some da lista sozinho (a preferência gravada
  // ainda o cita); antes de o catálogo chegar, fica — o rótulo é a chave.
  const colunasVisiveis = colunas.filter(
    (c) => !ehColunaDeCampo(c) || catalogo === null || campoPorChave.has(chaveDoCampo(c)),
  );

  const rotuloDaColuna = (c: ColunaId): string =>
    ehColunaDeCampo(c)
      ? (campoPorChave.get(chaveDoCampo(c))?.field_name ?? chaveDoCampo(c))
      : // chave montada: `lista.colunas.<id>` — cobrada em lista.test.ts
        t(`colunas.${c}` as Parameters<typeof t>[0]);
  const rotuloDaSituacao = (s: Situacao) =>
    // chave montada: `situacao.<id>` — cobrada em lista.test.ts
    tSituacao(s as Parameters<typeof tSituacao>[0]);

  const mudarFiltros = (proximo: Partial<FiltrosDaLista>) => {
    setFiltros((f) => ({ ...f, ...proximo }));
    setLimite(PAGINA);
  };
  const mudarPeriodo = (p: Preset, pers: Personalizado) => {
    setPreset(p);
    setPersonalizado(pers);
    setLimite(PAGINA);
  };
  const salvarColunas = (proximas: ColunaId[]) => {
    setColunas(proximas);
    try {
      window.localStorage.setItem(CHAVE_COLUNAS, JSON.stringify(proximas));
    } catch {
      // preferência por dispositivo: sem storage, vale só nesta sessão
    }
  };
  const ordenarPor = (coluna: ColunaId) => {
    if (ehOrdenavel(coluna)) setOrdenacao((o) => alternarOrdenacao(o, coluna));
  };

  const conversaDe = (f: FatosDoNegocio) => f.linha.conversa_do_contato ?? f.linha.conversation_id;
  const abrirConversa = (f: FatosDoNegocio) => {
    const id = conversaDe(f);
    if (id) router.push(urlDoInbox({ c: id, de: "funil" }));
  };

  const moverEtapa = useCallback(
    async (f: FatosDoNegocio, stageId: string) => {
      if (stageId === f.linha.stage_id) return;
      const dealId = f.linha.deal_id;
      const antes = f.linha;
      const status = statusAoEntrarNaEtapa(stages, stageId);
      atualizarLinha(dealId, (l) => ({
        ...aplicarMudancaDeEtapa(l, stageId, new Date()),
        ...(status ? { status } : {}),
      }));
      const { data, error } = await supabase
        .from("deals")
        .update({ stage_id: stageId })
        .eq("id", dealId)
        .select("id");
      if (error || !data || data.length === 0) {
        toast.error(t("toastEtapaFalhou"));
        atualizarLinha(dealId, () => antes);
        recarregar();
        return;
      }
      avisarDrenagemDeFunil();
      onDealChanged();
    },
    [stages, supabase, atualizarLinha, recarregar, onDealChanged, t],
  );

  const exportar = () => {
    const rotulos = {} as Record<ColunaFixa, string>;
    for (const c of COLUNAS_FIXAS) rotulos[c] = rotuloDaColuna(c);
    const ctx: ContextoDoCsv = {
      rotulos,
      rotuloDoCampo: (k) => campoPorChave.get(k)?.field_name ?? k,
      nomeDaEtapa: (id) => (id ? (etapaPorId.get(id)?.name ?? "") : ""),
      nomeDoCanal: (id) => (id ? (canalPorId.get(id) ?? "") : ""),
      nomeDoResponsavel: (id) => (id ? (perfilPorId.get(id) ?? "") : ""),
      rotuloDaSituacao,
      formatarData: formatarDataHora,
      formatarValor: valorParaCsv,
    };
    baixarArquivo(
      `funil-${nomeDeArquivoSeguro(pipeline.name)}-${localDayKey(new Date())}.csv`,
      paraCsv(linhasDoCsv(ordenadas, colunasVisiveis, ctx)),
    );
  };

  const celulaDaTabela = (f: FatosDoNegocio, coluna: ColunaId, indice: number): ReactNode => {
    const l = f.linha;
    const traco = <span className="text-muted-foreground">—</span>;
    if (ehColunaDeCampo(coluna)) {
      const valor = l.campos[chaveDoCampo(coluna)];
      return valor ? <span className="block max-w-[16rem] truncate" title={valor}>{valor}</span> : traco;
    }
    switch (coluna) {
      case "numero":
        return <span className="tabular-nums text-muted-foreground">{indice + 1}</span>;
      case "data":
        return (
          <span className="tabular-nums">{l.created_at ? formatarData(new Date(l.created_at)) : traco}</span>
        );
      case "nome":
        return conversaDe(f) ? (
          <button
            type="button"
            onClick={() => abrirConversa(f)}
            title={t("abrirConversa")}
            className="max-w-[18rem] truncate text-left font-medium text-foreground hover:underline"
          >
            {nomeDaLinha(f)}
          </button>
        ) : (
          <span className="block max-w-[18rem] truncate font-medium">{nomeDaLinha(f)}</span>
        );
      case "naEtapaDesde":
        return (
          <span className="tabular-nums text-muted-foreground">{f.naEtapaDesde ? formatarDataHora(f.naEtapaDesde) : traco}</span>
        );
      case "etapa": {
        const etapa = f.etapaAtual ? etapaPorId.get(f.etapaAtual) : undefined;
        return (
          <select
            value={l.stage_id}
            disabled={!podeMover}
            onChange={(e) => void moverEtapa(f, e.target.value)}
            aria-label={t("colunas.etapa")}
            className="h-7 max-w-[13rem] truncate rounded-full border bg-card px-2 text-xs font-medium disabled:opacity-70"
            style={{
              color: etapa?.color,
              borderColor: etapa?.color,
              backgroundColor: etapa ? `${etapa.color}1a` : undefined,
            }}
          >
            {etapasOrdenadas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        );
      }
      case "valor":
        return l.value > 0 ? (
          <span className="font-medium tabular-nums">{formatCurrency(l.value)}</span>
        ) : (
          traco
        );
      case "telefone":
        return l.contato_telefone ? <span className="tabular-nums">{l.contato_telefone}</span> : traco;
      case "email":
        return l.contato_email ? (
          <span className="block max-w-[14rem] truncate" title={l.contato_email}>{l.contato_email}</span>
        ) : (
          traco
        );
      case "entrada":
        return f.entradaEm ? <span className="tabular-nums">{formatarData(f.entradaEm)}</span> : traco;
      case "situacao":
        return (
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CHIP_DA_SITUACAO[f.situacao]}`}>
            {rotuloDaSituacao(f.situacao)}
          </span>
        );
      case "conexao":
        return (l.channel_id && canalPorId.get(l.channel_id)) || traco;
      case "responsavel":
        return (l.assigned_to && perfilPorId.get(l.assigned_to)) || traco;
      case "empresa":
        return l.contato_empresa || traco;
    }
  };

  const colSpan = colunasVisiveis.length + 1;
  const vazio = (texto: string) => (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-12 text-center text-sm text-muted-foreground">
        {texto}
      </TableCell>
    </TableRow>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SeletorDePeriodo preset={preset} personalizado={personalizado} onChange={mudarPeriodo} />
        <div className="flex items-center gap-2">
          <ColunasPopover
            colunas={colunas}
            onChange={salvarColunas}
            campos={catalogo?.campos ?? []}
            grupos={catalogo?.grupos ?? []}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={exportar}
            // ⚠️ Canais e perfis chegam em buscas PRÓPRIAS, depois das
            // linhas. Exportar antes delas grava Conexão e Responsável
            // VAZIOS num arquivo que sai da tela e vira planilha — o
            // erro que ninguém percebe (Codex, PR #123).
            disabled={ordenadas.length === 0 || canaisCarregando || catalogo === null}
            className="h-9 border-border bg-card text-foreground hover:bg-muted"
          >
            <Download className="mr-1 h-4 w-4" />
            {t("exportar")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filtros.busca}
          onChange={(e) => mudarFiltros({ busca: e.target.value })}
          placeholder={t("buscar")}
          className="h-9 max-w-md flex-1 bg-card"
        />
        <select
          value={filtros.etapaId ?? ""}
          onChange={(e) => mudarFiltros({ etapaId: e.target.value || null })}
          aria-label={t("colunas.etapa")}
          className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
        >
          <option value="">{t("todasEtapas")}</option>
          {etapasOrdenadas.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={filtros.situacao}
          onChange={(e) => mudarFiltros({ situacao: e.target.value as FiltroDeSituacao })}
          aria-label={t("colunas.situacao")}
          className="h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
        >
          <option value="todas">{t("todasSituacoes")}</option>
          {SITUACOES.map((s) => (
            <option key={s} value={s}>
              {rotuloDaSituacao(s)}
            </option>
          ))}
        </select>
        {!carregando && !falhou && (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {t("contagem", { n: filtradas.length, m: doPeriodo.length })}
          </span>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {colunasVisiveis.map((c) => (
                <TableHead key={c} className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {ehOrdenavel(c) ? (
                    <button
                      type="button"
                      onClick={() => ordenarPor(c)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      title={t("ordenarPor", { coluna: rotuloDaColuna(c) })}
                    >
                      {rotuloDaColuna(c)}
                      {ordenacao.coluna === c ? (
                        ordenacao.direcao === "asc" ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    rotuloDaColuna(c)
                  )}
                </TableHead>
              ))}
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {carregando ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-12 text-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  {t("carregando")}
                </TableCell>
              </TableRow>
            ) : falhou ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-12 text-center text-sm text-muted-foreground">
                  {t("falhou")}{" "}
                  <button type="button" onClick={recarregar} className="underline hover:text-foreground">
                    {t("tentarDeNovo")}
                  </button>
                </TableCell>
              </TableRow>
            ) : visiveis.length === 0 ? (
              vazio(doPeriodo.length === 0 ? t("semLeadsNoPeriodo") : t("semLeadsComFiltro"))
            ) : (
              visiveis.map((f, i) => (
                <TableRow key={f.linha.deal_id} className={FUNDO_DA_LINHA[f.situacao] ?? ""}>
                  {colunasVisiveis.map((c) => (
                    <TableCell key={c} className="text-sm">
                      {celulaDaTabela(f, c, i)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-0.5">
                      {conversaDe(f) && (
                        <button
                          type="button"
                          onClick={() => abrirConversa(f)}
                          title={t("abrirConversa")}
                          aria-label={t("abrirConversa")}
                          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onEditDeal(f.linha.deal_id)}
                        title={t("editar")}
                        aria-label={t("editar")}
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {ordenadas.length > visiveis.length && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLimite((l) => l + PAGINA)}
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            {t("mostrarMais", { n: Math.min(PAGINA, ordenadas.length - visiveis.length) })}
          </Button>
        </div>
      )}
    </div>
  );
}
