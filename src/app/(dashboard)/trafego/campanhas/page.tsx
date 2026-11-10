"use client";

// Reescrita completa (Fase 3.3, retrabalhada na Fase 6 pra usar as classes
// exatas do artefato original) — gestão de TODAS as campanhas da conta
// (inclusive as sem carro/categoria vinculados), com KPIs clicáveis, toolbar
// de busca/filtro/ordenação, chips de status/vínculo, seleção em lote e
// tabela paginada com vínculo/projeto editáveis inline. Classes portadas de
// app/globals.css: .camp-mgmt-kpis/.kpi, .camp-mgmt-bulk, .camp-mgmt-toolbar,
// .camp-mgmt-chips/.chip-toggle, .camp-mgmt-select, .camp-table-wrap +
// .vendtable, .badge.status-ativa/.status-pausada/.vinc-nenhum.
//
// Vínculo é sempre um dos três: carro, categoria de negócio, OU um destino
// cadastrado (Site/WhatsApp/Instagram/etc, tabela link_destinos) — nunca
// mais de um ao mesmo tempo. Trocar pra um limpa os outros dois.

import { FINALIDADES, sugerirFinalidade } from "@/lib/trafego/finalidades";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { orgIdAtual } from "@/lib/trafego/org";
import { formatBRL } from "@/lib/trafego/format";
import { useVerMais } from "@/lib/trafego/pagination";
import { useWindsorSyncBar, SyncStatusLine, AtualizarAgoraButton } from "@/lib/trafego/syncBar";
import { fetchAll } from "@/lib/trafego/fetchAll";
import { sugerirCarroParaCampanha } from "@/lib/trafego/estoqueSite";


type Campaign = {
  id: string;
  nome: string;
  objetivo: string | null;
  status: string | null;
  car_id: string | null;
  categoria_objetivo: string | null;
  destino_id: string | null;
  projeto: string | null;
  vendedor_override: string | null;
  tipo: string | null;
  criado_em: string;
};

type Car = {
  id: string;
  modelo: string;
  placa: string;
  ano?: number | null;
  status?: string | null;
  // Ligação com o estoque do site (migration 0011) — ausentes enquanto ela não for aplicada.
  site_vehicle_id?: string | null;
  nome_site?: string | null;
  modelo_site?: string | null;
  site_status?: string | null;
  preco_site?: number | null;
};

// Rótulo do carro no seletor de vínculo: nome do site quando existe.
function rotuloCarro(c: Car): string {
  const nome = c.nome_site || c.modelo || c.placa || "(sem modelo)";
  const preco = c.site_status === "available" && c.preco_site ? ` · ${formatBRL(Number(c.preco_site))}` : "";
  return `${nome}${c.ano ? " " + c.ano : ""} · ${c.placa}${preco}`;
}

// "Categoria do vínculo" pedida pelo usuário: destinos cadastrados livremente
// (tipo também livre — Site/WhatsApp/Instagram/qualquer outro que ele criar).
type Destino = { id: string; tipo: string; nome: string; valor: string | null; ativo: boolean };

type MetricAgg = {
  gasto: number;
  impressions: number;
  clicks: number;
  msgs: number;
  leads: number;
  purchases: number;
};

const PROJETOS: Record<string, string> = { ibox: "iBox Prime", ix: "IX Consultas" };

// Categorias fixas de objetivo de negócio, pra vincular campanhas que não
// são sobre um carro específico — lista idêntica à do Artifact original.
const CATEGORIAS_OBJETIVO = FINALIDADES;

// Taxonomia completa de objetivos do Meta Ads (ODAX atual + nomes legados
// pré-2022) — todos convergem pro mesmo rótulo em português.
const OBJETIVO_LABELS: Record<string, string> = {
  OUTCOME_LEADS: "Leads",
  OUTCOME_SALES: "Vendas",
  OUTCOME_TRAFFIC: "Tráfego",
  OUTCOME_ENGAGEMENT: "Engajamento",
  OUTCOME_AWARENESS: "Reconhecimento",
  OUTCOME_APP_PROMOTION: "Promoção de app",
  LEAD_GENERATION: "Leads",
  LEADS: "Leads",
  CONVERSIONS: "Vendas",
  PRODUCT_CATALOG_SALES: "Vendas",
  CATALOG_SALES: "Vendas",
  SALES: "Vendas",
  TRAFFIC: "Tráfego",
  LINK_CLICKS: "Tráfego",
  STORE_VISITS: "Tráfego",
  POST_ENGAGEMENT: "Engajamento",
  VIDEO_VIEWS: "Engajamento",
  PAGE_LIKES: "Engajamento",
  EVENT_RESPONSES: "Engajamento",
  MESSAGES: "Engajamento",
  ENGAGEMENT: "Engajamento",
  BRAND_AWARENESS: "Reconhecimento",
  REACH: "Reconhecimento",
  AWARENESS: "Reconhecimento",
  APP_INSTALLS: "Promoção de app",
  APP_PROMOTION: "Promoção de app",
};
function objetivoLabel(o: string | null): string {
  return (o && OBJETIVO_LABELS[o]) || o || "Outro";
}

function campProjeto(c: Campaign): string {
  return c.projeto || "ibox";
}
// Tipo de vínculo derivado — nunca guardado separado.
function vinculoTipo(c: Campaign): "carro" | "categoria" | "destino" | null {
  if (c.car_id) return "carro";
  if (c.categoria_objetivo) return "categoria";
  if (c.destino_id) return "destino";
  return null;
}
const EMPTY_AGG: MetricAgg = { gasto: 0, impressions: 0, clicks: 0, msgs: 0, leads: 0, purchases: 0 };

type DailyRow = {
  campaign_id: string;
  data: string;
  gasto: number;
  impressions: number;
  clicks: number;
  msgs: number;
  leads: number;
  purchases: number;
};
function resultadosOf(agg: MetricAgg): number {
  return agg.msgs > 0 ? agg.msgs : agg.leads > 0 ? agg.leads : 0;
}

type HourlyRow = {
  campaign_id: string;
  data: string;
  hora: number;
  gasto: number;
  msgs: number;
  leads: number;
};

export default function CampanhasPage() {
  const supabase = createClient();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [aggByCampaign, setAggByCampaign] = useState<Record<string, MetricAgg>>({});
  const [metricsRows, setMetricsRows] = useState<DailyRow[]>([]);
  const [hourlyRows, setHourlyRows] = useState<HourlyRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterStatus, setFilterStatus] = useState<"todas" | "ACTIVE" | "PAUSED">("todas");
  const [filterProjeto, setFilterProjeto] = useState<"todos" | "ibox" | "ix">("todos");
  const [filterVinculo, setFilterVinculo] = useState<"todos" | "sem" | "carro" | "categoria" | "destino">("todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<"gasto_desc" | "gasto_asc" | "nome_asc" | "status">("gasto_desc");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [periodo, setPeriodo] = useState<"7d" | "30d" | "90d" | "tudo" | "custom">("tudo");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [objetivoFiltro, setObjetivoFiltro] = useState<Set<string>>(new Set());
  const [custoResultMax, setCustoResultMax] = useState<number | null>(null);
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  // Painel "Gerenciar destinos" (categoria do vínculo além de carro/categoria)
  const [destinos, setDestinos] = useState<Destino[]>([]);
  const [showDestinos, setShowDestinos] = useState(false);
  const [novoDestinoTipo, setNovoDestinoTipo] = useState("");
  const [novoDestinoNome, setNovoDestinoNome] = useState("");
  const [novoDestinoValor, setNovoDestinoValor] = useState("");

  // Seletor de vínculo em duas etapas: primeiro a categoria (Carro/Categoria/
  // tipo de destino), só depois a lista específica daquela categoria — em
  // vez de um único <select> com todos os carros já listados de cara.
  // "Pendente" = o usuário já trocou a categoria mas ainda não escolheu o
  // valor específico; enquanto isso o vínculo salvo (car_id/etc) não muda.
  const [pendingVinculoCategoria, setPendingVinculoCategoria] = useState<Record<string, string>>({});

  async function carregarTudo() {
    setLoading(true);
    const accId = await orgIdAtual(supabase);
    if (!accId) {
      setLoading(false);
      return;
    }
    setAccountId(accId);

    const [{ data: campaignsData }, { data: carsData }, { data: metricsData }, { data: destinosData }, { data: hourlyData }] = await Promise.all([
      supabase
        .from("tr_campaigns")
        .select("id, nome, objetivo, status, car_id, categoria_objetivo, destino_id, projeto, vendedor_override, tipo, criado_em")
        .eq("org_id", accId)
        .order("criado_em", { ascending: false }),
      supabase.from("veiculos").select("id, modelo, placa, ano, status").eq("org_id", accId).order("modelo", { ascending: true }),
      fetchAll((de, ate) =>
        supabase
          .from("tr_campaign_metrics_daily")
          .select("campaign_id, data, gasto, impressions, clicks, msgs, leads, purchases")
          .eq("org_id", accId)
          .order("id")
          .range(de, ate)
      ),
      supabase.from("tr_link_destinos").select("id, tipo, nome, valor, ativo").eq("org_id", accId).order("criado_em", { ascending: true }),
      fetchAll((de, ate) =>
        supabase
          .from("tr_campaign_metrics_hourly")
          .select("campaign_id, data, hora, gasto, msgs, leads")
          .eq("org_id", accId)
          .order("id")
          .range(de, ate)
      ),
    ]);

    setCampaigns((campaignsData ?? []) as Campaign[]);
    let listaCarros = (carsData ?? []) as Car[];
    // Campos do site em consulta separada: sem a migration 0011 a tela segue como antes.
    const { data: siteData, error: siteErr } = await supabase
      .from("veiculos")
      .select("id, site_vehicle_id, nome_site, modelo_site, site_status, preco_site")
      .eq("org_id", accId);
    if (!siteErr) {
      const porId = new Map(((siteData ?? []) as Car[]).map((r) => [r.id, r]));
      listaCarros = listaCarros.map((c) => ({ ...c, ...(porId.get(c.id) || {}) }));
    }
    setCars(listaCarros);
    setDestinos((destinosData ?? []) as Destino[]);

    const agg: Record<string, MetricAgg> = {};
    const rows: DailyRow[] = [];
    for (const row of (metricsData ?? []) as Array<Record<string, number | string>>) {
      const campId = String(row.campaign_id);
      const cur = agg[campId] || { gasto: 0, impressions: 0, clicks: 0, msgs: 0, leads: 0, purchases: 0 };
      cur.gasto += Number(row.gasto) || 0;
      cur.impressions += Number(row.impressions) || 0;
      cur.clicks += Number(row.clicks) || 0;
      cur.msgs += Number(row.msgs) || 0;
      cur.leads += Number(row.leads) || 0;
      cur.purchases += Number(row.purchases) || 0;
      agg[campId] = cur;
      rows.push({
        campaign_id: campId,
        data: String(row.data ?? ""),
        gasto: Number(row.gasto) || 0,
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        msgs: Number(row.msgs) || 0,
        leads: Number(row.leads) || 0,
        purchases: Number(row.purchases) || 0,
      });
    }
    setAggByCampaign(agg);
    setMetricsRows(rows);
    setHourlyRows(
      ((hourlyData ?? []) as Array<Record<string, number | string>>).map((row) => ({
        campaign_id: String(row.campaign_id),
        data: String(row.data ?? ""),
        hora: Number(row.hora) || 0,
        gasto: Number(row.gasto) || 0,
        msgs: Number(row.msgs) || 0,
        leads: Number(row.leads) || 0,
      }))
    );
    setLoading(false);
  }

  useEffect(() => {
    carregarTudo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { lastSyncAt, syncing, syncError, sincronizarAgora } = useWindsorSyncBar(accountId, carregarTudo);

  // Fecha o dropdown de filtros ao clicar fora dele.
  useEffect(() => {
    if (!showFilterPanel) return;
    // IMPORTANTE: stopPropagation() no painel não impede este listener de
    // disparar, porque ambos (o handler do React e este) ficam no MESMO nó
    // (document) — stopPropagation só bloqueia a propagação pra pais, não
    // outros listeners no mesmo nó. Por isso checamos o alvo do clique
    // explicitamente: só fecha se o clique caiu fora do botão e do painel
    // (bug real: antes disso, qualquer clique dentro do painel — período,
    // objetivo, custo — fechava o painel na hora).
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Element | null;
      if (target && (target.closest(".filter-dropdown") || target.closest(".filter-btn"))) return;
      setShowFilterPanel(false);
    }
    document.addEventListener("click", onClickOutside);
    return () => document.removeEventListener("click", onClickOutside);
  }, [showFilterPanel]);

  function gastoOf(c: Campaign): number {
    return (aggByCampaign[c.id] || EMPTY_AGG).gasto;
  }

  // ---- recorte por período (v6 do mockup, aplicado agora em Campanhas) ----
  // quando periodo === "tudo", rowsInPeriod é o mesmo array de metricsRows,
  // então periodAgg bate exatamente com aggByCampaign — sem regressão.
  const rowsInPeriod = useMemo(() => {
    if (periodo === "tudo") return metricsRows;
    if (periodo === "custom") {
      if (!customFrom && !customTo) return metricsRows;
      return metricsRows.filter((r) => (!customFrom || r.data >= customFrom) && (!customTo || r.data <= customTo));
    }
    const days = periodo === "7d" ? 7 : periodo === "30d" ? 30 : 90;
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    return metricsRows.filter((r) => {
      const d = new Date(r.data + "T00:00:00");
      return d >= from && d <= to;
    });
  }, [metricsRows, periodo, customFrom, customTo]);

  const hourlyRowsInPeriod = useMemo(() => {
    if (periodo === "tudo") return hourlyRows;
    if (periodo === "custom") {
      if (!customFrom && !customTo) return hourlyRows;
      return hourlyRows.filter((r) => (!customFrom || r.data >= customFrom) && (!customTo || r.data <= customTo));
    }
    const days = periodo === "7d" ? 7 : periodo === "30d" ? 30 : 90;
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    return hourlyRows.filter((r) => {
      const d = new Date(r.data + "T00:00:00");
      return d >= from && d <= to;
    });
  }, [hourlyRows, periodo, customFrom, customTo]);

  const periodAgg = useMemo(() => {
    const m: Record<string, MetricAgg> = {};
    for (const r of rowsInPeriod) {
      const cur = m[r.campaign_id] || { gasto: 0, impressions: 0, clicks: 0, msgs: 0, leads: 0, purchases: 0 };
      cur.gasto += r.gasto;
      cur.impressions += r.impressions;
      cur.clicks += r.clicks;
      cur.msgs += r.msgs;
      cur.leads += r.leads;
      cur.purchases += r.purchases;
      m[r.campaign_id] = cur;
    }
    return m;
  }, [rowsInPeriod]);

  function aggOfP(c: Campaign): MetricAgg {
    return periodAgg[c.id] || EMPTY_AGG;
  }
  function gastoOfP(c: Campaign): number {
    return aggOfP(c).gasto;
  }
  function custoResultadoOfP(c: Campaign): number | null {
    const a = aggOfP(c);
    const r = resultadosOf(a);
    return r > 0 ? a.gasto / r : null;
  }

  const objetivosDisponiveis = useMemo(() => {
    const s = new Set<string>();
    for (const c of campaigns) s.add(objetivoLabel(c.objetivo));
    return Array.from(s).sort();
  }, [campaigns]);

  function toggleObjetivo(o: string) {
    setObjetivoFiltro((prev) => {
      const next = new Set(prev);
      if (next.has(o)) next.delete(o);
      else next.add(o);
      return next;
    });
  }

  async function setProjeto(campId: string, value: string) {
    setCampaigns((prev) => prev.map((c) => (c.id === campId ? { ...c, projeto: value } : c)));
    await supabase.from("tr_campaigns").update({ projeto: value }).eq("id", campId);
  }

  // value: '' (sem vínculo) | 'carro:<carId>' | 'categoria:<key>' | 'destino:<id>'
  async function setVinculo(campId: string, value: string) {
    let car_id: string | null = null;
    let categoria_objetivo: string | null = null;
    let destino_id: string | null = null;
    if (value.startsWith("carro:")) car_id = value.slice(6);
    else if (value.startsWith("categoria:")) categoria_objetivo = value.slice(10);
    else if (value.startsWith("destino:")) destino_id = value.slice(8);
    setCampaigns((prev) => prev.map((c) => (c.id === campId ? { ...c, car_id, categoria_objetivo, destino_id } : c)));
    await supabase.from("tr_campaigns").update({ car_id, categoria_objetivo, destino_id }).eq("id", campId);
  }

  // Primeira etapa do seletor: só troca a categoria mostrada (não salva
  // nada ainda) — "" (sem vínculo) já salva direto, porque não tem segunda etapa.
  function selecionarCategoriaVinculo(campId: string, categoria: string) {
    if (!categoria) {
      setVinculo(campId, "");
      setPendingVinculoCategoria((prev) => {
        const next = { ...prev };
        delete next[campId];
        return next;
      });
      return;
    }
    setPendingVinculoCategoria((prev) => ({ ...prev, [campId]: categoria }));
  }

  // Segunda etapa: valor específico escolhido (carro, categoria de negócio
  // ou destino) — agora sim salva, e limpa o estado pendente da 1ª etapa.
  function selecionarValorVinculo(campId: string, value: string) {
    setVinculo(campId, value);
    setPendingVinculoCategoria((prev) => {
      const next = { ...prev };
      delete next[campId];
      return next;
    });
  }

  // Cadastro de destinos — tipo é texto livre (o usuário decide os tipos).
  async function criarDestino() {
    const tipo = novoDestinoTipo.trim();
    const nome = novoDestinoNome.trim();
    const valor = novoDestinoValor.trim() || null;
    if (!tipo || !nome || !accountId) return;
    const { data, error } = await supabase
      .from("tr_link_destinos")
      .insert({ org_id: accountId, tipo, nome, valor })
      .select("id, tipo, nome, valor, ativo")
      .single();
    if (!error && data) {
      setDestinos((prev) => [...prev, data as Destino]);
      setNovoDestinoTipo("");
      setNovoDestinoNome("");
      setNovoDestinoValor("");
    }
  }

  // Desativar/reativar é não-destrutivo — mesma convenção usada em
  // Vendedores: nunca apaga o destino, só some da lista de opções ativas
  // (campanhas já vinculadas a ele continuam mostrando o nome corretamente).
  async function toggleDestinoAtivo(id: string, ativo: boolean) {
    setDestinos((prev) => prev.map((d) => (d.id === id ? { ...d, ativo } : d)));
    await supabase.from("tr_link_destinos").update({ ativo }).eq("id", id);
  }

  function toggleSelected(campId: string, checked: boolean) {
    setSelected((prev) => {
      const next = { ...prev };
      if (checked) next[campId] = true;
      else delete next[campId];
      return next;
    });
  }
  function clearSelection() {
    setSelected({});
  }
  async function bulkSetProjeto(value: string) {
    const ids = Object.keys(selected);
    if (ids.length === 0) return;
    setCampaigns((prev) => prev.map((c) => (ids.includes(c.id) ? { ...c, projeto: value } : c)));
    setSelected({});
    await supabase.from("tr_campaigns").update({ projeto: value }).in("id", ids);
  }

  function clearFilters() {
    setFilterStatus("todas");
    setFilterProjeto("todos");
    setFilterVinculo("todos");
    setSearchTerm("");
    setPeriodo("tudo");
    setCustomFrom("");
    setCustomTo("");
    setObjetivoFiltro(new Set());
    setCustoResultMax(null);
  }

  const PERIODO_LABEL: Record<string, string> = { "7d": "7 dias", "30d": "30 dias", "90d": "90 dias", tudo: "Tudo", custom: "intervalo customizado" };
  const VINCULO_LABEL: Record<string, string> = { sem: "Sem vínculo", carro: "Com carro", categoria: "Com categoria", destino: "Com destino" };
  const STATUS_LABEL: Record<string, string> = { ACTIVE: "Ativas", PAUSED: "Pausadas" };

  // --- resumo geral: sempre sobre a conta inteira, ignora os filtros ---
  const { totalCamp, ativas, pausadas, semVinc, gastoIbox, gastoIx } = useMemo(() => {
    let ativas = 0,
      pausadas = 0,
      semVinc = 0,
      gastoIbox = 0,
      gastoIx = 0;
    for (const c of campaigns) {
      if (c.status === "ACTIVE") ativas++;
      else if (c.status === "PAUSED") pausadas++;
      if (vinculoTipo(c) === null) semVinc++;
      if (campProjeto(c) === "ix") gastoIx += gastoOf(c);
      else gastoIbox += gastoOf(c);
    }
    return { totalCamp: campaigns.length, ativas, pausadas, semVinc, gastoIbox, gastoIx };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, aggByCampaign]);

  const filteredSorted = useMemo(() => {
    const list = campaigns.filter((c) => {
      if (searchTerm && !c.nome.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (filterStatus !== "todas" && c.status !== filterStatus) return false;
      if (filterProjeto !== "todos" && campProjeto(c) !== filterProjeto) return false;
      const vt = vinculoTipo(c);
      if (filterVinculo === "sem" && vt !== null) return false;
      if (filterVinculo === "carro" && vt !== "carro") return false;
      if (filterVinculo === "categoria" && vt !== "categoria") return false;
      if (filterVinculo === "destino" && vt !== "destino") return false;
      if (objetivoFiltro.size > 0 && !objetivoFiltro.has(objetivoLabel(c.objetivo))) return false;
      if (custoResultMax !== null) {
        const cr = custoResultadoOfP(c);
        if (cr === null || cr > custoResultMax) return false;
      }
      return true;
    });
    return list.slice().sort((a, b) => {
      if (sortBy === "gasto_asc") return gastoOfP(a) - gastoOfP(b);
      if (sortBy === "nome_asc") return a.nome.localeCompare(b.nome);
      if (sortBy === "status") {
        const rank: Record<string, number> = { ACTIVE: 0, PAUSED: 1 };
        const ra = rank[a.status || ""] ?? 2;
        const rb = rank[b.status || ""] ?? 2;
        if (ra !== rb) return ra - rb;
        return gastoOfP(b) - gastoOfP(a);
      }
      return gastoOfP(b) - gastoOfP(a);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, aggByCampaign, periodAgg, searchTerm, filterStatus, filterProjeto, filterVinculo, sortBy, objetivoFiltro, custoResultMax]);

  const filteredCampaignIds = useMemo(() => new Set(filteredSorted.map((c) => c.id)), [filteredSorted]);

  // ---- métricas médias do recorte atual (v6) ----
  const metricsAgg = useMemo(() => {
    let gasto = 0, resultados = 0, impressions = 0, clicks = 0;
    for (const c of filteredSorted) {
      const a = aggOfP(c);
      gasto += a.gasto;
      resultados += resultadosOf(a);
      impressions += a.impressions;
      clicks += a.clicks;
    }
    return {
      gasto,
      resultados,
      custoMedio: resultados > 0 ? gasto / resultados : null,
      cpmMedio: impressions > 0 ? (gasto / impressions) * 1000 : null,
      ctrMedio: impressions > 0 ? (clicks / impressions) * 100 : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSorted, periodAgg]);

  // ---- melhores dias da semana (por custo/resultado) — v6 ----
  const weekdayStats = useMemo(() => {
    const buckets = Array.from({ length: 7 }, () => ({ gasto: 0, resultados: 0 }));
    for (const r of rowsInPeriod) {
      if (!filteredCampaignIds.has(r.campaign_id)) continue;
      const dow = new Date(r.data + "T00:00:00").getDay();
      buckets[dow].gasto += r.gasto;
      buckets[dow].resultados += r.msgs > 0 ? r.msgs : r.leads;
    }
    const dias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const rows = buckets.map((b, i) => ({ label: dias[i], custo: b.resultados > 0 ? b.gasto / b.resultados : null, n: b.resultados }));
    const MIN_AMOSTRA = 3;
    const elegiveis = rows.filter((r) => r.custo !== null && r.n >= MIN_AMOSTRA).slice().sort((a, b) => (a.custo as number) - (b.custo as number));
    const ordenado = rows.slice().sort((a, b) => {
      if (a.custo === null) return 1;
      if (b.custo === null) return -1;
      return a.custo - b.custo;
    });
    const comCusto = rows.filter((r) => r.custo !== null);
    const maxCusto = comCusto.length ? Math.max(...comCusto.map((r) => r.custo as number)) : 0;
    return { ordenado, melhor: elegiveis[0] ?? null, maxCusto, n: comCusto.length };
  }, [rowsInPeriod, filteredCampaignIds]);

  // ---- horário de pico de resultados (por custo/resultado, dado real da
  // sync horária do Meta Ads) ----
  const hourlyStats = useMemo(() => {
    const buckets = Array.from({ length: 24 }, () => ({ gasto: 0, resultados: 0 }));
    for (const r of hourlyRowsInPeriod) {
      if (!filteredCampaignIds.has(r.campaign_id)) continue;
      if (r.hora < 0 || r.hora > 23) continue;
      buckets[r.hora].gasto += r.gasto;
      buckets[r.hora].resultados += r.msgs > 0 ? r.msgs : r.leads;
    }
    const rows = buckets.map((b, hora) => ({
      hora,
      label: String(hora).padStart(2, "0") + "h",
      resultados: b.resultados,
      custo: b.resultados > 0 ? b.gasto / b.resultados : null,
    }));
    const MIN_AMOSTRA = 3;
    const elegiveis = rows.filter((r) => r.resultados >= MIN_AMOSTRA);
    // "Pico" aqui é o horário com mais resultados (o que a pergunta do
    // usuário pede — "horário de pico de resultados"), não o de menor custo.
    const pico = elegiveis.slice().sort((a, b) => b.resultados - a.resultados)[0] ?? null;
    const maxResultados = Math.max(1, ...rows.map((r) => r.resultados));
    const temDado = rows.some((r) => r.resultados > 0);
    return { rows, pico, maxResultados, temDado };
  }, [hourlyRowsInPeriod, filteredCampaignIds]);

  // ---- melhores dias do mês (por custo/resultado) — v6 ----
  const monthStats = useMemo(() => {
    const map: Record<string, { gasto: number; resultados: number }> = {};
    for (const r of rowsInPeriod) {
      if (!filteredCampaignIds.has(r.campaign_id)) continue;
      const day = r.data.slice(8, 10);
      if (!day) continue;
      const cur = map[day] || { gasto: 0, resultados: 0 };
      cur.gasto += r.gasto;
      cur.resultados += r.msgs > 0 ? r.msgs : r.leads;
      map[day] = cur;
    }
    const rows = Object.entries(map)
      .map(([day, v]) => ({ day, custo: v.resultados > 0 ? v.gasto / v.resultados : null, n: v.resultados }))
      .sort((a, b) => a.day.localeCompare(b.day));
    const comCusto = rows.filter((r) => r.custo !== null);
    const MIN_AMOSTRA = 3;
    const elegiveis = comCusto.filter((r) => r.n >= MIN_AMOSTRA);
    const melhor = elegiveis.slice().sort((a, b) => (a.custo as number) - (b.custo as number))[0] ?? null;
    const minCusto = comCusto.length ? Math.min(...comCusto.map((r) => r.custo as number)) : 0;
    const maxCusto = comCusto.length ? Math.max(...comCusto.map((r) => r.custo as number)) : 0;
    return { rows, melhor, minCusto, maxCusto };
  }, [rowsInPeriod, filteredCampaignIds]);

  const { visible, hasMore, buttonLabel, toggle } = useVerMais(filteredSorted);

  // Sugestão de carro para campanhas sem vínculo, pelo nome (modelo, ano, final da placa).
  // Sugestão para campanhas sem vínculo: primeiro o carro pelo nome (modelo,
  // ano, final da placa); se não for de carro, a finalidade pelo objetivo do
  // Meta e pelo nome (Instagram, site, marca, alcance).
  const sugestoes = useMemo(() => {
    const opcoes = cars.map((c) => ({ ...c, nomeSite: c.nome_site ?? null, modeloSite: c.modelo_site ?? null }));
    const m: Record<string, Car> = {};
    for (const c of campaigns) {
      if (c.car_id || c.categoria_objetivo || c.destino_id) continue;
      const s = sugerirCarroParaCampanha(c.nome || "", opcoes);
      if (s) m[c.id] = s;
    }
    return m;
  }, [campaigns, cars]);
  const sugestoesFinalidade = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of campaigns) {
      if (c.car_id || c.categoria_objetivo || c.destino_id || sugestoes[c.id]) continue;
      const f = sugerirFinalidade(c.objetivo, c.nome || "");
      if (f) m[c.id] = f;
    }
    return m;
  }, [campaigns, sugestoes]);
  const qtdSugestoes = Object.keys(sugestoes).length + Object.keys(sugestoesFinalidade).length;
  async function aplicarTodasSugestoes() {
    for (const [campId, car] of Object.entries(sugestoes)) await setVinculo(campId, `carro:${car.id}`);
    for (const [campId, f] of Object.entries(sugestoesFinalidade)) await setVinculo(campId, `categoria:${f}`);
  }

  const filtersActive =
    filterStatus !== "todas" || filterProjeto !== "todos" || filterVinculo !== "todos" || !!searchTerm || periodo !== "tudo" || objetivoFiltro.size > 0 || custoResultMax !== null;
  const selectedCount = Object.keys(selected).length;

  // Chips removíveis individualmente — cada filtro ativo vira um chip com um "×" próprio.
  type Chip = { key: string; label: string; remove: () => void };
  const activeChips: Chip[] = [];
  if (periodo !== "tudo") {
    activeChips.push({
      key: "periodo",
      label: `Período: ${PERIODO_LABEL[periodo]}`,
      remove: () => {
        setPeriodo("tudo");
        setCustomFrom("");
        setCustomTo("");
      },
    });
  }
  if (filterStatus !== "todas") {
    activeChips.push({ key: "status", label: `Status: ${STATUS_LABEL[filterStatus] ?? filterStatus}`, remove: () => setFilterStatus("todas") });
  }
  if (filterVinculo !== "todos") {
    activeChips.push({ key: "vinculo", label: `Vínculo: ${VINCULO_LABEL[filterVinculo] ?? filterVinculo}`, remove: () => setFilterVinculo("todos") });
  }
  if (filterProjeto !== "todos") {
    activeChips.push({ key: "projeto", label: `Projeto: ${PROJETOS[filterProjeto]}`, remove: () => setFilterProjeto("todos") });
  }
  if (custoResultMax !== null) {
    activeChips.push({ key: "custo", label: `Custo/resultado até ${formatBRL(custoResultMax)}`, remove: () => setCustoResultMax(null) });
  }
  if (objetivoFiltro.size > 0) {
    activeChips.push({
      key: "objetivo",
      label: `Objetivo: ${Array.from(objetivoFiltro).join(", ")}`,
      remove: () => setObjetivoFiltro(new Set()),
    });
  }
  if (searchTerm) {
    activeChips.push({ key: "busca", label: `Busca: "${searchTerm}"`, remove: () => setSearchTerm("") });
  }

  const recorteLabel = `${PERIODO_LABEL[periodo]}${objetivoFiltro.size > 0 ? " · " + Array.from(objetivoFiltro).join("/") : " · todos os objetivos"}`;

  // Agrupa os destinos ATIVOS por tipo, pra montar um <optgroup> por tipo no
  // seletor de vínculo — cresce conforme o usuário cadastra tipos novos.
  const destinosAtivosPorTipo = useMemo(() => {
    const map = new Map<string, Destino[]>();
    for (const d of destinos) {
      if (!d.ativo) continue;
      const arr = map.get(d.tipo) || [];
      arr.push(d);
      map.set(d.tipo, arr);
    }
    return map;
  }, [destinos]);
  const tiposDestinoConhecidos = useMemo(() => Array.from(new Set(destinos.map((d) => d.tipo))), [destinos]);

  return (
    <main className="px-6 py-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="section-ttl" style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
            Campanhas
          </div>
          <SyncStatusLine lastSyncAt={lastSyncAt} syncing={syncing} syncError={syncError} />
        </div>
        <AtualizarAgoraButton syncing={syncing} onClick={sincronizarAgora} />
      </div>
      <p className="text-sm mb-3 mt-2" style={{ color: "var(--tr-text-dim)" }}>
        Todas as campanhas da conta (ativas e pausadas). Cada uma é de um carro do pátio, OU tem uma finalidade sem
        carro (Instagram, site, marca, alcance…), OU vai para um destino cadastrado. O sistema sugere sozinho pelo nome e
        pelo objetivo do Meta: é só aceitar.
      </p>

      {/* Painel "Gerenciar destinos" — categoria do vínculo pra tráfego que não
          vai pra um carro específico (site, WhatsApp, Instagram, ou qualquer
          outro tipo que o usuário quiser cadastrar). */}
      <div className="mb-5">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowDestinos((v) => !v)}>
          {showDestinos ? "Ocultar destinos" : "🎯 Gerenciar destinos"}
        </button>
        {showDestinos && (
          <div className="panel" style={{ marginTop: 10, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                  color: "var(--tr-text-dim)",
                  marginBottom: 8,
                }}
              >
                Novo destino
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  className="camp-mgmt-select"
                  style={{ flex: "1 1 160px" }}
                  placeholder="Tipo (ex: Site, WhatsApp, Instagram)"
                  list="tipos-destino-conhecidos"
                  value={novoDestinoTipo}
                  onChange={(e) => setNovoDestinoTipo(e.target.value)}
                />
                <datalist id="tipos-destino-conhecidos">
                  {tiposDestinoConhecidos.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                <input
                  className="camp-mgmt-select"
                  style={{ flex: "2 1 220px" }}
                  placeholder="Nome (ex: WhatsApp Vendas)"
                  value={novoDestinoNome}
                  onChange={(e) => setNovoDestinoNome(e.target.value)}
                />
                <input
                  className="camp-mgmt-select"
                  style={{ flex: "1 1 180px" }}
                  placeholder="Valor (opcional: URL, número...)"
                  value={novoDestinoValor}
                  onChange={(e) => setNovoDestinoValor(e.target.value)}
                />
                <button className="btn btn-accent btn-sm" onClick={criarDestino} disabled={!novoDestinoTipo.trim() || !novoDestinoNome.trim()}>
                  + Adicionar
                </button>
              </div>
            </div>

            {destinos.length === 0 ? (
              <p className="text-[11px]" style={{ color: "var(--tr-text-dim)" }}>
                Nenhum destino cadastrado ainda.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {destinos.map((d) => (
                  <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, opacity: d.ativo ? 1 : 0.55 }}>
                    <span className="badge" style={{ minWidth: 76, textAlign: "center" }}>
                      {d.tipo}
                    </span>
                    <span style={{ flex: 1 }}>
                      {d.nome}
                      {d.valor ? ` — ${d.valor}` : ""}
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={() => toggleDestinoAtivo(d.id, !d.ativo)}>
                      {d.ativo ? "Desativar" : "Reativar"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="empty-state">Carregando…</div>
      ) : (
        <>
          {/* Barra de seleção em lote — porte exato de .camp-mgmt-bulk */}
          {selectedCount > 0 && (
            <div className="camp-mgmt-bulk">
              <span className="text-sm">
                <b>{selectedCount}</b> selecionada(s)
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => bulkSetProjeto("ix")}>
                Marcar como {PROJETOS.ix}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => bulkSetProjeto("ibox")}>
                Marcar como {PROJETOS.ibox}
              </button>
              <button className="clear-link" style={{ marginLeft: "auto" }} onClick={clearSelection}>
                Limpar seleção
              </button>
            </div>
          )}

          {/* Barra de filtros unificada — um botão só, tudo dentro do painel (v4 aprovado) */}
          <div className="unified-filterbar">
            <input className="search" placeholder="Buscar campanha por nome…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            <button
              type="button"
              className={`filter-btn${showFilterPanel ? " open" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setShowFilterPanel((v) => !v);
              }}
            >
              ⚙ Filtros
              {activeChips.length > 0 && <span className="count">{activeChips.length}</span>}
            </button>
            <select className="camp-mgmt-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
              <option value="gasto_desc">Ordenar: maior gasto</option>
              <option value="gasto_asc">Menor gasto</option>
              <option value="nome_asc">Nome (A-Z)</option>
              <option value="status">Status (ativas primeiro)</option>
            </select>

            {showFilterPanel && (
              <div className="filter-dropdown" onClick={(e) => e.stopPropagation()}>
                <div className="fd-grid">
                  <div className="fd-field" style={{ gridColumn: "span 2" }}>
                    <label>Período</label>
                    <div className="fd-presets">
                      {(["7d", "30d", "90d", "tudo"] as const).map((p) => (
                        <span
                          key={p}
                          className={`fd-preset${periodo === p ? " on" : ""}`}
                          onClick={() => {
                            setPeriodo(p);
                            setCustomFrom("");
                            setCustomTo("");
                          }}
                        >
                          {p === "tudo" ? "Tudo" : p}
                        </span>
                      ))}
                    </div>
                    <div className="fd-range">
                      <input
                        type="date"
                        value={customFrom}
                        onChange={(e) => {
                          setCustomFrom(e.target.value);
                          setPeriodo("custom");
                        }}
                      />
                      <span style={{ color: "var(--tr-text-dim)", fontSize: 11 }}>até</span>
                      <input
                        type="date"
                        value={customTo}
                        onChange={(e) => {
                          setCustomTo(e.target.value);
                          setPeriodo("custom");
                        }}
                      />
                    </div>
                  </div>

                  <div className="fd-field">
                    <label>Status</label>
                    <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}>
                      <option value="todas">Todas</option>
                      <option value="ACTIVE">Ativas</option>
                      <option value="PAUSED">Pausadas</option>
                    </select>
                  </div>

                  <div className="fd-field">
                    <label>Vínculo</label>
                    <select value={filterVinculo} onChange={(e) => setFilterVinculo(e.target.value as typeof filterVinculo)}>
                      <option value="todos">Todos</option>
                      <option value="sem">Sem vínculo</option>
                      <option value="carro">Com carro</option>
                      <option value="categoria">Com categoria</option>
                      <option value="destino">Com destino</option>
                    </select>
                  </div>

                  <div className="fd-field">
                    <label>Projeto</label>
                    <select value={filterProjeto} onChange={(e) => setFilterProjeto(e.target.value as typeof filterProjeto)}>
                      <option value="todos">Todos</option>
                      <option value="ibox">{PROJETOS.ibox}</option>
                      <option value="ix">{PROJETOS.ix}</option>
                    </select>
                  </div>

                  <div className="fd-field">
                    <label>Custo/resultado até</label>
                    <input
                      type="number"
                      placeholder="Sem limite"
                      value={custoResultMax ?? ""}
                      onChange={(e) => setCustoResultMax(e.target.value === "" ? null : Number(e.target.value))}
                    />
                  </div>

                  <div className="fd-field" style={{ gridColumn: "span 3" }}>
                    <label>Objetivo (múltiplo)</label>
                    <div className="fd-pills">
                      {objetivosDisponiveis.map((o) => (
                        <span key={o} className={`fd-pill${objetivoFiltro.has(o) ? " on" : ""}`} onClick={() => toggleObjetivo(o)}>
                          {o}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="fd-foot">
                  <button className="clear-link-sm" onClick={clearFilters}>
                    Limpar tudo
                  </button>
                  <button className="btn btn-accent btn-sm" onClick={() => setShowFilterPanel(false)}>
                    Aplicar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Chips dos filtros ativos — cada um removível individualmente */}
          {activeChips.length > 0 && (
            <div className="achips">
              {activeChips.map((c) => (
                <span className="achip" key={c.key}>
                  {c.label}
                  <button onClick={c.remove} aria-label={`Remover filtro ${c.label}`}>
                    ×
                  </button>
                </span>
              ))}
              <button className="clear-link-sm" onClick={clearFilters}>
                Limpar tudo
              </button>
            </div>
          )}

          {/* Painel único "Desempenho das campanhas" — resumo geral + métricas do recorte + horário de pico + melhores dias, tudo junto (v3/v4 aprovado) */}
          <div className="perf-panel">
            <div className="perf-panel-head">
              <span className="perf-panel-title">Desempenho das campanhas</span>
              <span className="perf-panel-tag">recorte: {recorteLabel}</span>
            </div>

            <div className="metric-group-lbl">Resumo geral (conta inteira, sem filtro)</div>
            <div className="camp-mgmt-kpis">
              <div className="kpi">
                <div className="label">Campanhas</div>
                <div className="value">{totalCamp}</div>
              </div>
              <div className="kpi">
                <div className="label">Ativas</div>
                <div className="value good">{ativas}</div>
              </div>
              <div className="kpi">
                <div className="label">Pausadas</div>
                <div className="value">{pausadas}</div>
              </div>
              <div className="kpi click" onClick={() => setFilterVinculo("sem")} title="Ver só as sem vínculo">
                <div className="label">Sem vínculo</div>
                <div className={`value${semVinc > 0 ? " bad" : ""}`}>{semVinc}</div>
              </div>
              <div className="kpi">
                <div className="label">Gasto {PROJETOS.ibox}</div>
                <div className="value">{formatBRL(gastoIbox)}</div>
              </div>
              <div className="kpi">
                <div className="label">Gasto {PROJETOS.ix}</div>
                <div className="value">{formatBRL(gastoIx)}</div>
              </div>
            </div>

          {/* Métricas médias do recorte atual — retrátil (v6) */}
          <details className="collapsible" open>
            <summary>
              <span className="chev">▸</span>
              <span className="htitle">Métricas médias</span>
              <span className="hmeta">{filteredSorted.length} campanha(s)</span>
              <span className="hspacer"></span>
            </summary>
            <div className="body">
              <div className="metrics-strip-v2">
                <div className="metric-cell-v2">
                  <div className="lbl">Gasto no recorte</div>
                  <div className="row">
                    <span className="val">{formatBRL(metricsAgg.gasto)}</span>
                  </div>
                </div>
                <div className="metric-cell-v2">
                  <div className="lbl">Resultados no recorte</div>
                  <div className="row">
                    <span className="val">{metricsAgg.resultados}</span>
                  </div>
                </div>
                <div className="metric-cell-v2">
                  <div className="lbl">Custo/resultado médio</div>
                  <div className="row">
                    <span className="val good">{metricsAgg.custoMedio !== null ? formatBRL(metricsAgg.custoMedio) : "—"}</span>
                  </div>
                </div>
                <div className="metric-cell-v2">
                  <div className="lbl">CPM médio</div>
                  <div className="row">
                    <span className="val">{metricsAgg.cpmMedio !== null ? formatBRL(metricsAgg.cpmMedio) : "—"}</span>
                  </div>
                </div>
                <div className="metric-cell-v2">
                  <div className="lbl">CTR médio</div>
                  <div className="row">
                    <span className="val">{metricsAgg.ctrMedio !== null ? metricsAgg.ctrMedio.toFixed(2) + "%" : "—"}</span>
                  </div>
                </div>
              </div>
            </div>
          </details>

          {/* Horário de pico de resultados — dado real da sync horária do Meta Ads */}
          <details className="collapsible" open>
            <summary>
              <span className="chev">▸</span>
              <span className="htitle">Horário de pico de resultados</span>
              <span className="flag ready">por volume de resultados</span>
              <span className="hspacer"></span>
            </summary>
            <div className="body">
              {!hourlyStats.temDado ? (
                <p className="text-sm" style={{ color: "var(--tr-text-dim)" }}>
                  Ainda não há dado horário sincronizado pra este recorte — a próxima sincronização do Meta Ads já traz
                  o gasto e os resultados por hora do dia.
                </p>
              ) : (
                <>
                  <div className="hourchart-v2">
                    {hourlyStats.rows.map((h) => {
                      const pct = Math.max(4, (h.resultados / hourlyStats.maxResultados) * 100);
                      const isPico = hourlyStats.pico && h.hora === hourlyStats.pico.hora;
                      return (
                        <div key={h.hora} className="hbar-col-v2" title={`${h.label}: ${h.resultados} resultado(s)${h.custo !== null ? ` · ${formatBRL(h.custo)}/resultado` : ""}`}>
                          <div
                            className="hbar-v2"
                            style={{ height: `${pct}%`, background: isPico ? "var(--tr-gold-2)" : undefined }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="hourchart-axis-v2">
                    {hourlyStats.rows.map((h) => (
                      <span key={h.hora}>{h.hora % 3 === 0 ? h.label : ""}</span>
                    ))}
                  </div>
                  {hourlyStats.pico && (
                    <span className="peak-tag">
                      ⚡ Pico: {hourlyStats.pico.label} — {hourlyStats.pico.resultados} resultado(s)
                      {hourlyStats.pico.custo !== null ? ` · ${formatBRL(hourlyStats.pico.custo)}/resultado` : ""}
                    </span>
                  )}
                </>
              )}
            </div>
          </details>

          {/* Melhores dias da semana + dias do mês — lado a lado (v6) */}
          <div className="two-col-fit">
            <details className="collapsible" open>
              <summary>
                <span className="chev">▸</span>
                <span className="htitle">Melhores dias da semana</span>
                <span className="flag ready">por custo/resultado</span>
                <span className="hspacer"></span>
              </summary>
              <div className="body">
                {weekdayStats.n === 0 ? (
                  <p className="text-sm" style={{ color: "var(--tr-text-dim)" }}>
                    Sem resultados suficientes no período/objetivo selecionado.
                  </p>
                ) : (
                  <>
                    <div className="weekday-list">
                      {weekdayStats.ordenado.map((d) => {
                        const tier =
                          d.custo === null
                            ? null
                            : weekdayStats.maxCusto <= 0
                            ? "good"
                            : d.custo <= weekdayStats.maxCusto * 0.45
                            ? "good"
                            : d.custo <= weekdayStats.maxCusto * 0.75
                            ? "warn"
                            : "bad";
                        const pct = d.custo === null || weekdayStats.maxCusto <= 0 ? 0 : Math.max(6, (d.custo / weekdayStats.maxCusto) * 100);
                        return (
                          <div className="wd-row" key={d.label}>
                            <span className="d">{d.label}</span>
                            <div className="bar-track">
                              <div className={`bar-fill${tier ? " " + tier : ""}`} style={{ width: `${pct}%` }}></div>
                            </div>
                            <span className={`c${tier ? " " + tier : ""}`}>{d.custo !== null ? formatBRL(d.custo) : "—"}</span>
                            <span className="n">{d.n} result.</span>
                          </div>
                        );
                      })}
                    </div>
                    {weekdayStats.melhor && (
                      <span className="best-tag">
                        ✓ Melhor dia: {weekdayStats.melhor.label} — {formatBRL(weekdayStats.melhor.custo as number)}/resultado
                      </span>
                    )}
                  </>
                )}
              </div>
            </details>

            <details className="collapsible" open>
              <summary>
                <span className="chev">▸</span>
                <span className="htitle">Melhores dias do mês</span>
                <span className="flag ready">por custo/resultado</span>
                <span className="hspacer"></span>
              </summary>
              <div className="body">
                {monthStats.rows.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--tr-text-dim)" }}>
                    Sem resultados suficientes no período selecionado.
                  </p>
                ) : (
                  <>
                    <p className="text-sm" style={{ color: "var(--tr-text-dim)", marginBottom: 4 }}>
                      Cada quadrado é o número do dia (1 a 31), somando todos os meses do período.
                    </p>
                    <div className="month-grid">
                      {monthStats.rows.map((d) => {
                        const range = monthStats.maxCusto - monthStats.minCusto;
                        const t = d.custo === null || range <= 0 ? 0.5 : (d.custo - monthStats.minCusto) / range;
                        const color =
                          d.custo === null
                            ? "var(--tr-surface-3)"
                            : t < 0.4
                            ? `rgba(63,207,142,${0.5 - t * 0.4})`
                            : t < 0.7
                            ? `rgba(242,169,60,${0.25 + t * 0.3})`
                            : `rgba(241,106,95,${0.25 + t * 0.4})`;
                        const isBest = monthStats.melhor && d.day === monthStats.melhor.day;
                        return (
                          <div
                            key={d.day}
                            className={`m-cell${isBest ? " best" : ""}`}
                            style={{ background: color }}
                            data-tip={d.custo !== null ? `dia ${d.day} · ${formatBRL(d.custo)}/resultado` : `dia ${d.day} · sem resultados`}
                          >
                            {d.day}
                          </div>
                        );
                      })}
                    </div>
                    <div className="m-legend">
                      <span>Mais caro</span>
                      <div className="m-scale"></div>
                      <span>Mais barato</span>
                    </div>
                    {monthStats.melhor && (
                      <span className="best-tag" style={{ marginTop: 10 }}>
                        ✓ Melhor dia: {monthStats.melhor.day} — {formatBRL(monthStats.melhor.custo as number)}/resultado
                      </span>
                    )}
                  </>
                )}
              </div>
            </details>
          </div>
          </div>

          <div className="result-count">
            <a href="/trafego/ligar" className="btn btn-accent" style={{ marginRight: 10 }}>Ligar campanhas a carros e finalidades (mais rápido) →</a>
            {filteredSorted.length} campanha(s)
            {qtdSugestoes > 0 && (
              <>
                {" · "}
                <button type="button" className="btn btn-accent" style={{ marginLeft: 6 }} onClick={aplicarTodasSugestoes}>
                  Aceitar {qtdSugestoes} sugest{qtdSugestoes === 1 ? "ão" : "ões"} (carro ou finalidade)
                </button>
              </>
            )}
          </div>

          {filteredSorted.length === 0 ? (
            <div className="empty-state">Nenhuma campanha encontrada com esses filtros.</div>
          ) : (
            <div className="vendtable-wrap camp-table-wrap">
              <table className="vendtable">
                <thead>
                  <tr>
                    <th style={{ width: 32 }} />
                    <th>Campanha</th>
                    <th>Status</th>
                    <th>Objetivo</th>
                    <th className="num">Gasto</th>
                    <th className="num">Resultados</th>
                    <th className="num">Custo/resultado</th>
                    <th>Projeto</th>
                    <th>Vínculo</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((camp) => {
                    const vt = vinculoTipo(camp);
                    // Se o destino vinculado foi desativado, ele não aparece mais nos
                    // grupos ativos abaixo — inclui ele avulso pra não quebrar o select.
                    const destinoDesativadoAtual = vt === "destino" ? destinos.find((d) => d.id === camp.destino_id && !d.ativo) : undefined;
                    const destinoTipoAtual = vt === "destino" ? destinos.find((d) => d.id === camp.destino_id)?.tipo ?? null : null;
                    // Categoria efetivamente salva agora (deriva de car_id/categoria_objetivo/destino_id)
                    const categoriaAtual = vt === "carro" ? "carro" : vt === "categoria" ? "categoria" : vt === "destino" ? destinoTipoAtual ?? "" : "";
                    const pendingCategoria = pendingVinculoCategoria[camp.id];
                    // Categoria mostrada no 1º select: a pendente (se o usuário já trocou
                    // mas ainda não escolheu o valor específico) ou a atualmente salva.
                    const categoriaSelecionada = pendingCategoria !== undefined ? pendingCategoria : categoriaAtual;
                    // true quando o usuário trocou a categoria mas ainda não escolheu o
                    // valor específico — nesse caso o 2º select começa em branco.
                    const categoriaPendente = pendingCategoria !== undefined && pendingCategoria !== categoriaAtual;
                    return (
                      <tr key={camp.id} className={vt === null ? "sem-vinculo" : undefined}>
                        <td>
                          <input type="checkbox" checked={!!selected[camp.id]} onChange={(e) => toggleSelected(camp.id, e.target.checked)} />
                        </td>
                        <td className="nomecell" style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={camp.nome}>
                          {camp.nome}
                        </td>
                        <td>
                          <span className={`badge ${camp.status === "ACTIVE" ? "status-ativa" : camp.status === "PAUSED" ? "status-pausada" : "none"}`}>
                            {camp.status === "ACTIVE" ? "Ativa" : camp.status === "PAUSED" ? "Pausada" : camp.status || "—"}
                          </span>
                        </td>
                        <td>{objetivoLabel(camp.objetivo)}</td>
                        <td className="num">{formatBRL(gastoOfP(camp))}</td>
                        <td className="num">{resultadosOf(aggOfP(camp))}</td>
                        <td className="num">
                          {custoResultadoOfP(camp) !== null ? formatBRL(custoResultadoOfP(camp) as number) : "—"}
                        </td>
                        <td>
                          <select className="camp-mgmt-select" value={campProjeto(camp)} onChange={(e) => setProjeto(camp.id, e.target.value)}>
                            <option value="ibox">{PROJETOS.ibox}</option>
                            <option value="ix">{PROJETOS.ix}</option>
                          </select>
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            {/* 1ª etapa: só a categoria — carro/categoria/tipos de destino,
                                nunca a lista inteira de carros de cara. */}
                            <select
                              className="camp-mgmt-select"
                              value={categoriaSelecionada}
                              onChange={(e) => selecionarCategoriaVinculo(camp.id, e.target.value)}
                            >
                              <option value="">— sem vínculo —</option>
                              <option value="carro">Carro</option>
                              <option value="categoria">Finalidade (sem carro)</option>
                              {tiposDestinoConhecidos.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                              {destinoTipoAtual && !tiposDestinoConhecidos.includes(destinoTipoAtual) && (
                                <option value={destinoTipoAtual}>{destinoTipoAtual}</option>
                              )}
                            </select>

                            {/* 2ª etapa: só aparece depois da categoria escolhida. */}
                            {categoriaSelecionada === "carro" && (
                              <select
                                className="camp-mgmt-select"
                                value={categoriaPendente ? "" : camp.car_id ?? ""}
                                onChange={(e) => selecionarValorVinculo(camp.id, e.target.value ? `carro:${e.target.value}` : "")}
                              >
                                <option value="">— selecione o carro —</option>
                                {cars.some((c) => c.site_vehicle_id) ? (
                                  <>
                                    <optgroup label="Estoque do site — à venda">
                                      {cars
                                        .filter((c) => c.site_vehicle_id && c.site_status !== "sold" && c.status !== "vendido")
                                        .map((c) => (
                                          <option key={c.id} value={c.id}>
                                            {rotuloCarro(c)}
                                          </option>
                                        ))}
                                    </optgroup>
                                    <optgroup label="Estoque do site — vendidos">
                                      {cars
                                        .filter((c) => c.site_vehicle_id && (c.site_status === "sold" || c.status === "vendido"))
                                        .map((c) => (
                                          <option key={c.id} value={c.id}>
                                            {rotuloCarro(c)}
                                          </option>
                                        ))}
                                    </optgroup>
                                    <optgroup label="Fora do site (cadastrados no painel)">
                                      {cars
                                        .filter((c) => !c.site_vehicle_id)
                                        .map((c) => (
                                          <option key={c.id} value={c.id}>
                                            {rotuloCarro(c)}
                                          </option>
                                        ))}
                                    </optgroup>
                                  </>
                                ) : (
                                  cars.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.modelo || c.placa || "(sem modelo)"}
                                    </option>
                                  ))
                                )}
                              </select>
                            )}

                            {categoriaSelecionada === "categoria" && (
                              <select
                                className="camp-mgmt-select"
                                value={categoriaPendente ? "" : camp.categoria_objetivo ?? ""}
                                onChange={(e) => selecionarValorVinculo(camp.id, e.target.value ? `categoria:${e.target.value}` : "")}
                              >
                                <option value="">— selecione a finalidade —</option>
                                {CATEGORIAS_OBJETIVO.map((cat) => (
                                  <option key={cat.key} value={cat.key}>
                                    {cat.label}
                                  </option>
                                ))}
                              </select>
                            )}

                            {categoriaSelecionada && categoriaSelecionada !== "carro" && categoriaSelecionada !== "categoria" && (
                              <select
                                className="camp-mgmt-select"
                                value={categoriaPendente ? "" : vt === "destino" ? camp.destino_id ?? "" : ""}
                                onChange={(e) => selecionarValorVinculo(camp.id, e.target.value ? `destino:${e.target.value}` : "")}
                              >
                                <option value="">— selecione —</option>
                                {(destinosAtivosPorTipo.get(categoriaSelecionada) || []).map((d) => (
                                  <option key={d.id} value={d.id}>
                                    {d.nome}
                                  </option>
                                ))}
                                {destinoDesativadoAtual && destinoDesativadoAtual.tipo === categoriaSelecionada && (
                                  <option value={destinoDesativadoAtual.id}>{destinoDesativadoAtual.nome} (desativado)</option>
                                )}
                              </select>
                            )}
                            {vt === null && <span className="badge vinc-nenhum">sem vínculo</span>}
                            {vt === null && sugestoes[camp.id] && (
                              <button
                                type="button"
                                className="btn"
                                style={{ fontSize: 12, padding: "4px 8px" }}
                                title="Sugestão pelo nome da campanha"
                                onClick={() => setVinculo(camp.id, `carro:${sugestoes[camp.id].id}`)}
                              >
                                Sugerido: {sugestoes[camp.id].nome_site || sugestoes[camp.id].modelo} — vincular
                              </button>
                            )}
                            {vt === null && !sugestoes[camp.id] && sugestoesFinalidade[camp.id] && (
                              <button
                                type="button"
                                className="btn"
                                style={{ fontSize: 12, padding: "4px 8px" }}
                                title="Sugestão pelo objetivo do Meta e pelo nome da campanha"
                                onClick={() => setVinculo(camp.id, `categoria:${sugestoesFinalidade[camp.id]}`)}
                              >
                                Sugerido: {FINALIDADES.find((f) => f.key === sugestoesFinalidade[camp.id])?.label} — aplicar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {hasMore && (
            <div className="flex justify-center mt-4">
              <button className="btn btn-ghost btn-sm" onClick={toggle}>
                {buttonLabel}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
