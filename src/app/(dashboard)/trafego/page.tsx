"use client";

// Reescrita completa (Fase 3.6) — a maior tela do painel: paridade total com
// a "Visão geral da conta" do Artifact original. Filtros (período, projeto,
// carro/objetivo/vendedor, gasto, performance), hero financeiro + métricas
// gerais + site, funil geral, funil do quiz, faturamento do tráfego,
// destaques, desempenho por objetivo, linha do tempo, campanhas sem carro
// vinculado, grid "por carro" e a tabela completa "visão geral por
// campanha". Cada seção é isolada visualmente — um dado estranho numa seção
// não deve impedir o resto de aparecer (mesmo espírito do render() original,
// que isola cada renderX() em try/catch).

import { FINALIDADES } from "@/lib/trafego/finalidades";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { orgIdAtual } from "@/lib/trafego/org";
import { formatBRL, formatInt, formatPercent, formatRoas, formatDuracaoSessao, META_TAX } from "@/lib/trafego/format";
import { vendedorOf, vendedorLabel } from "@/lib/trafego/vendedorOf";
import { useVerMais } from "@/lib/trafego/pagination";
import { useMasked, MASKED_PLACEHOLDER } from "@/lib/trafego/masking";
import { FunnelGeral, type FunnelStage } from "@/lib/trafego/funnelSvg";
import { fetchAll } from "@/lib/trafego/fetchAll";


// ---------------------------------------------------------------------
// Tipos e taxonomias (objetivo/categoria) — mesma taxonomia usada em
// Campanhas e Carros; duplicada aqui por simplicidade de cada página ser
// autocontida (mesmo padrão já adotado nas outras reescritas da Fase 3).
// ---------------------------------------------------------------------
type Car = {
  id: string;
  modelo: string;
  placa: string;
  status: "estoque" | "vendido";
  tipo_negocio: "venda" | "troca" | null;
  valor_venda: number | null;
  valor_troca: number | null;
  valor_volta: number | null;
  margem_lucro: number | null;
};
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
};
type MetricRow = {
  campaign_id: string;
  data: string;
  gasto: number;
  impressions: number;
  clicks: number;
  msgs: number;
  leads: number;
  purchases: number;
};
type AccMetricRow = { fonte: string; data: string; campos: Record<string, number> };

const PROJETOS: Record<string, string> = { ibox: "iBox Prime", ix: "IX Consultas" };
const CATEGORIAS_OBJETIVO = FINALIDADES;
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
const OBJETIVO_PRIORIDADE = ["Leads", "Vendas", "Tráfego", "Engajamento", "Reconhecimento", "Promoção de app", "Outro"];
function objetivoRank(lbl: string): number {
  const i = OBJETIVO_PRIORIDADE.indexOf(lbl);
  return i === -1 ? OBJETIVO_PRIORIDADE.length : i;
}
function resultForTipo(o: { msgs: number; leads: number; purchases: number; impressions?: number; clicks?: number }, tipo: string): number {
  if (tipo === "mensagens") return o.msgs;
  if (tipo === "leads") return o.leads;
  if (tipo === "compras") return o.purchases;
  if (tipo === "cliques") return o.clicks || 0;
  if (tipo === "impressoes") return o.impressions || 0;
  return o.msgs + o.leads + o.purchases;
}
function resultTipoLabel(tipo: string): string {
  if (tipo === "mensagens") return "mensagens";
  if (tipo === "leads") return "leads";
  if (tipo === "compras") return "compras";
  if (tipo === "cliques") return "cliques";
  if (tipo === "impressoes") return "impressões";
  return "contatos";
}

const WINDSOR_GA4_SITES = [
  { key: "ibox", label: "iboxprime.com.br" },
  { key: "quiz", label: "Quiz (consultoria.iboxprime.com.br)" },
];

type EmptyAgg = { gasto: number; impressions: number; clicks: number; msgs: number; leads: number; purchases: number };
const EMPTY_AGG: EmptyAgg = { gasto: 0, impressions: 0, clicks: 0, msgs: 0, leads: 0, purchases: 0 };

// Formata em "YYYY-MM-DD" usando a data LOCAL do navegador — nunca
// toISOString(), que converte pra UTC e desloca o dia em ~3h (Brasília é
// UTC-3): entre ~21h e meia-noite, "Hoje"/"Ontem"/"7/30/90 dias"/"Este mês"
// calculavam o dia seguinte em vez do dia real. Bug real reportado pelo
// usuário como "a filtragem de dias não está correta".
function fmtLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function datePreset(preset: string): { from: string; to: string } {
  const today = new Date();
  const fmt = fmtLocalDate;
  if (preset === "hoje") return { from: fmt(today), to: fmt(today) };
  if (preset === "ontem") {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    return { from: fmt(y), to: fmt(y) };
  }
  if (preset === "7" || preset === "30" || preset === "90") {
    const d = new Date(today);
    d.setDate(d.getDate() - (Number(preset) - 1));
    return { from: fmt(d), to: fmt(today) };
  }
  if (preset === "mes") {
    const d = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: fmt(d), to: fmt(today) };
  }
  return { from: "", to: "" };
}

export default function DashboardPage() {
  const supabase = createClient();
  const router = useRouter();

  const [cars, setCars] = useState<Car[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  // Nomes dos destinos cadastrados (Site/WhatsApp/Instagram/etc, ver Campanhas)
  // — só pra exibir o rótulo aqui; cadastro/edição fica na página de Campanhas.
  const [destinosById, setDestinosById] = useState<Record<string, string>>({});
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [accMetrics, setAccMetrics] = useState<AccMetricRow[]>([]);
  const [loading, setLoading] = useState(true);

  // --- filtros ---
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [projetoFilter, setProjetoFilter] = useState<"todos" | "ibox" | "ix">("todos");
  const [carFilter, setCarFilter] = useState<string[]>([]);
  const [objetivoFilter, setObjetivoFilter] = useState<string[]>([]);
  const [vendedorFilter, setVendedorFilter] = useState<string[]>([]);
  const [gastoMin, setGastoMin] = useState("");
  const [gastoMax, setGastoMax] = useState("");
  const [cplMin, setCplMin] = useState("");
  const [onlySemResultado, setOnlySemResultado] = useState(false);
  const [resultTipo, setResultTipo] = useState("todos");
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [tableSearch, setTableSearch] = useState("");
  const [siteAtivo, setSiteAtivo] = useState<"ibox" | "quiz">("ibox");
  const masked = useMasked();
  // Preferência de exibir/ocultar o "Funil do quiz" — persiste entre
  // recarregamentos (localStorage), diferente do olhinho de mascaramento
  // (useMasked) que é só de sessão. Default: visível.
  const [quizFunilVisivel, setQuizFunilVisivel] = useState(true);
  useEffect(() => {
    try {
      const salvo = window.localStorage.getItem("ibox:quizFunilVisivel");
      if (salvo !== null) setQuizFunilVisivel(salvo === "1");
    } catch {
      /* localStorage indisponível — mantém o default (visível) */
    }
  }, []);
  function toggleQuizFunilVisivel() {
    setQuizFunilVisivel((v) => {
      const novo = !v;
      try {
        window.localStorage.setItem("ibox:quizFunilVisivel", novo ? "1" : "0");
      } catch {
        /* localStorage indisponível — o toggle ainda funciona nesta sessão */
      }
      return novo;
    });
  }
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function carregar() {
    setLoading(true);
    const accId = await orgIdAtual(supabase);
    if (!accId) {
      setLoading(false);
      return;
    }
    const [{ data: carsData }, { data: campaignsData }, { data: metricsData }, { data: accData }, { data: syncData }, { data: destinosData }] = await Promise.all([
      supabase
        .from("veiculos")
        .select("id, modelo, placa, status, tipo_negocio, valor_venda, valor_troca, valor_volta, margem_lucro")
        .eq("org_id", accId),
      supabase.from("tr_campaigns").select("id, nome, objetivo, status, car_id, categoria_objetivo, destino_id, projeto, vendedor_override").eq("org_id", accId),
      fetchAll((de, ate) => supabase.from("tr_campaign_metrics_daily").select("campaign_id, data, gasto, impressions, clicks, msgs, leads, purchases").eq("org_id", accId).order("id").range(de, ate)),
      fetchAll((de, ate) => supabase.from("tr_metrics_daily").select("fonte, data, campos").eq("org_id", accId).order("id").range(de, ate)),
      supabase.from("tr_sync_runs").select("concluido_em").eq("org_id", accId).eq("status", "ok").order("concluido_em", { ascending: false }).limit(1),
      supabase.from("tr_link_destinos").select("id, nome").eq("org_id", accId),
    ]);
    setCars((carsData ?? []) as Car[]);
    setCampaigns((campaignsData ?? []) as Campaign[]);
    setMetrics((metricsData ?? []) as MetricRow[]);
    setAccMetrics((accData ?? []) as AccMetricRow[]);
    setLastSyncAt(((syncData ?? [])[0] as { concluido_em?: string } | undefined)?.concluido_em ?? null);
    const destinosMap: Record<string, string> = {};
    for (const d of (destinosData ?? []) as Array<{ id: string; nome: string }>) destinosMap[d.id] = d.nome;
    setDestinosById(destinosMap);
    setLoading(false);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sincronizarAgora() {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/trafego/sync/manual", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setSyncError((json && json.error) || "Falha ao sincronizar");
      } else {
        await carregar();
      }
    } catch {
      setSyncError("Falha ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  const dateActive = !!(dateFrom || dateTo);
  function dateInRange(d: string): boolean {
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  }
  function dateRangeLabel(): string {
    if (!dateActive) return "Tudo";
    return `${dateFrom || "início"} → ${dateTo || "hoje"}`;
  }

  const rowsByCampaign = useMemo(() => {
    const map: Record<string, MetricRow[]> = {};
    for (const row of metrics) {
      (map[row.campaign_id] ||= []).push(row);
    }
    return map;
  }, [metrics]);

  function sumCampaign(campId: string): EmptyAgg {
    const rows = rowsByCampaign[campId];
    if (!rows) return EMPTY_AGG;
    const out = { ...EMPTY_AGG };
    for (const r of rows) {
      if (dateActive && !dateInRange(r.data)) continue;
      out.gasto += Number(r.gasto) || 0;
      out.impressions += Number(r.impressions) || 0;
      out.clicks += Number(r.clicks) || 0;
      out.msgs += Number(r.msgs) || 0;
      out.leads += Number(r.leads) || 0;
      out.purchases += Number(r.purchases) || 0;
    }
    return out;
  }

  function campProjeto(c: Campaign): string {
    return c.projeto || "ibox";
  }
  function campMatchesObjetivoFilter(c: Campaign): boolean {
    if (!objetivoFilter.length) return true;
    return objetivoFilter.includes(objetivoLabel(c.objetivo));
  }
  function campaignInScope(c: Campaign): boolean {
    if (projetoFilter !== "todos" && campProjeto(c) !== projetoFilter) return false;
    if (!campMatchesObjetivoFilter(c)) return false;
    if (onlyUnassigned) {
      if (c.car_id) return false;
    } else if (carFilter.length) {
      if (!c.car_id || !carFilter.includes(c.car_id)) return false;
    }
    if (vendedorFilter.length) {
      const v = vendedorLabel(vendedorOf(c));
      if (!vendedorFilter.includes(v)) return false;
    }
    return true;
  }

  const objetivosDisponiveis = useMemo(() => {
    const list = OBJETIVO_PRIORIDADE.slice(0, -1).slice();
    for (const c of campaigns) {
      const l = objetivoLabel(c.objetivo);
      if (!list.includes(l)) list.push(l);
    }
    return list;
  }, [campaigns]);
  const vendedoresDisponiveis = useMemo(() => {
    const list: string[] = [];
    for (const c of campaigns) {
      const l = vendedorLabel(vendedorOf(c));
      if (!list.includes(l)) list.push(l);
    }
    list.sort((a, b) => {
      if (a === "Sem vendedor") return 1;
      if (b === "Sem vendedor") return -1;
      return a.localeCompare(b, "pt-BR");
    });
    return list;
  }, [campaigns]);

  // --- métricas de conta (respeitam escopo + período) ---
  const acc = useMemo(() => {
    const out = { ...EMPTY_AGG };
    for (const c of campaigns) {
      if (!campaignInScope(c)) continue;
      const s = sumCampaign(c.id);
      out.gasto += s.gasto;
      out.impressions += s.impressions;
      out.clicks += s.clicks;
      out.msgs += s.msgs;
      out.leads += s.leads;
      out.purchases += s.purchases;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, rowsByCampaign, dateFrom, dateTo, projetoFilter, objetivoFilter, onlyUnassigned, carFilter, vendedorFilter]);
  const accResultado = resultForTipo(acc, resultTipo);
  const custoResultadoConta = accResultado > 0 ? acc.gasto / accResultado : null;
  const ctr = acc.impressions > 0 ? (acc.clicks / acc.impressions) * 100 : null;
  const cpm = acc.impressions > 0 ? (acc.gasto / acc.impressions) * 1000 : null;
  const contatos = acc.msgs + acc.leads + acc.purchases;
  const custoContato = contatos > 0 ? acc.gasto / contatos : null;

  // --- carros no negócio (faturamento) ---
  function carDashboardMetrics(car: Car): { gasto: number; resultados: number } {
    let gasto = 0;
    let resultados = 0;
    for (const c of campaigns) {
      if (c.car_id !== car.id) continue;
      if (!campMatchesObjetivoFilter(c)) continue;
      if (vendedorFilter.length) {
        const v = vendedorLabel(vendedorOf(c));
        if (!vendedorFilter.includes(v)) continue;
      }
      const s = sumCampaign(c.id);
      gasto += s.gasto;
      resultados += s.msgs > 0 ? s.msgs : s.leads;
    }
    return { gasto, resultados };
  }

  const fat = useMemo(() => {
    const carsScope = projetoFilter === "ix" ? [] : carFilter.length ? cars.filter((c) => carFilter.includes(c.id)) : cars;
    let totalFaturamento = 0,
      totalGasto = 0,
      totalMargemLucro = 0,
      totalMargemAposAnuncio = 0;
    const rows: { car: Car; valorNegocio: number; gasto: number; roas: number | null; margemLucro: number; margemAposAnuncio: number }[] = [];
    for (const car of carsScope) {
      const tipoNegocio = car.tipo_negocio || "venda";
      const valorNegocio = tipoNegocio === "troca" ? (Number(car.valor_troca) || 0) + (Number(car.valor_volta) || 0) : Number(car.valor_venda) || 0;
      const m = carDashboardMetrics(car);
      const custoComImposto = m.gasto + m.gasto * META_TAX;
      const margemLucro = Number(car.margem_lucro) || 0;
      const margemAposAnuncio = margemLucro - custoComImposto;
      totalFaturamento += valorNegocio;
      totalGasto += m.gasto;
      totalMargemLucro += margemLucro;
      totalMargemAposAnuncio += margemAposAnuncio;
      if (valorNegocio > 0 || m.gasto > 0 || margemLucro > 0) {
        rows.push({ car, valorNegocio, gasto: m.gasto, roas: m.gasto > 0 ? valorNegocio / m.gasto : null, margemLucro, margemAposAnuncio });
      }
    }
    rows.sort((a, b) => b.valorNegocio - a.valorNegocio);
    return {
      totalFaturamento,
      totalGasto,
      roas: totalGasto > 0 ? totalFaturamento / totalGasto : null,
      totalMargemLucro,
      totalMargemAposAnuncio,
      rows,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cars, campaigns, rowsByCampaign, dateFrom, dateTo, projetoFilter, carFilter, objetivoFilter, vendedorFilter]);

  // --- instagram / site (metrics_daily) ---
  const instagramDaily = useMemo(() => accMetrics.filter((m) => m.fonte === "instagram"), [accMetrics]);
  const ig = useMemo(() => {
    let ganhos = 0;
    let dias = 0;
    // "Total hoje" — total ATUAL de seguidores, não soma por dia. A Windsor.ai
    // devolve esse valor igual em toda linha do período; usamos o do dia mais
    // recente disponível (mesmo critério do Artifact original).
    let total: number | null = null;
    let totalData = "";
    for (const row of instagramDaily) {
      const t = row.campos?.followers_count_total;
      if (t !== undefined && t !== null && row.data >= totalData) {
        total = Number(t);
        totalData = row.data;
      }
      if (dateActive && !dateInRange(row.data)) continue;
      ganhos += Number(row.campos?.follower_count) || 0;
      dias++;
    }
    return { ganhos, dias, total, hasData: instagramDaily.length > 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instagramDaily, dateFrom, dateTo]);

  function siteMetricsFor(fonte: "ga4" | "ga4_quiz") {
    const rows = accMetrics.filter((m) => m.fonte === fonte);
    let sessions = 0,
      engaged = 0,
      users = 0,
      newUsers = 0,
      pageviews = 0,
      contactsWa = 0,
      durSum = 0,
      diasComDuracao = 0;
    for (const row of rows) {
      if (dateActive && !dateInRange(row.data)) continue;
      sessions += Number(row.campos?.sessions) || 0;
      engaged += Number(row.campos?.engaged_sessions) || 0;
      users += Number(row.campos?.active_users) || 0;
      newUsers += Number(row.campos?.new_users) || 0;
      pageviews += Number(row.campos?.screen_page_views) || 0;
      contactsWa += Number(row.campos?.click_whatsapp) || 0;
      if (row.campos?.average_session_duration !== undefined) {
        durSum += Number(row.campos.average_session_duration) || 0;
        diasComDuracao++;
      }
    }
    return {
      sessions,
      users,
      newUsers,
      pageviews,
      contacts: contactsWa,
      engagementRate: sessions > 0 ? engaged / sessions : null,
      avgSessionDuration: diasComDuracao > 0 ? durSum / diasComDuracao : null,
      hasData: rows.length > 0,
    };
  }
  const site = useMemo(() => siteMetricsFor(siteAtivo === "quiz" ? "ga4_quiz" : "ga4"), [accMetrics, siteAtivo, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps
  const quizFunnel = useMemo(() => {
    const rows = accMetrics.filter((m) => m.fonte === "ga4_quiz");
    let quiz_start = 0,
      quiz_complete = 0,
      generate_lead = 0,
      hasData = false;
    for (const row of rows) {
      if (dateActive && !dateInRange(row.data)) continue;
      hasData = true;
      quiz_start += Number(row.campos?.quiz_start) || 0;
      quiz_complete += Number(row.campos?.quiz_complete) || 0;
      generate_lead += Number(row.campos?.generate_lead) || 0;
    }
    return { quiz_start, quiz_complete, generate_lead, hasData };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accMetrics, dateFrom, dateTo]);
  const quizSite = useMemo(() => siteMetricsFor("ga4_quiz"), [accMetrics, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- estrutura da conta ---
  const alloc = useMemo(() => {
    let totalGasto = 0;
    let alocado = 0;
    let naoAlocadas = 0;
    for (const c of campaigns) {
      if (!campaignInScope(c)) continue;
      const s = sumCampaign(c.id);
      totalGasto += s.gasto;
      if (c.car_id) alocado += s.gasto;
      else naoAlocadas++;
    }
    return { totalGasto, impostoTotal: totalGasto * META_TAX, carros: cars.length, alocado, naoAlocadoValor: totalGasto - alocado, naoAlocadas };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, rowsByCampaign, dateFrom, dateTo, cars, projetoFilter, objetivoFilter, onlyUnassigned, carFilter, vendedorFilter]);

  // --- funil geral ---
  const custoImp = acc.impressions > 0 ? acc.gasto / acc.impressions : null;
  const custoClk = acc.clicks > 0 ? acc.gasto / acc.clicks : null;
  const custoRes = accResultado > 0 ? acc.gasto / accResultado : null;
  const convClkPct = acc.impressions > 0 ? (acc.clicks / acc.impressions) * 100 : null;
  const convResPct = acc.clicks > 0 ? (accResultado / acc.clicks) * 100 : null;
  const convTotalPct = acc.impressions > 0 ? (accResultado / acc.impressions) * 100 : null;
  const funilGeralStages: FunnelStage[] = [
    { name: "Impressões", sub: "ponto de partida", value: acc.impressions, pctTotal: 100, conv: null, cost: custoImp !== null ? formatBRL(custoImp) : null, costLbl: "impressão", color: "#F9F295", barPct: 100 },
    {
      name: "Cliques no link",
      sub: `custo/clique ${custoClk !== null ? formatBRL(custoClk) : "—"}`,
      value: acc.clicks,
      pctTotal: convClkPct,
      conv: convClkPct,
      cost: custoClk !== null ? formatBRL(custoClk) : null,
      costLbl: "clique",
      color: "var(--ouro-forte)",
      barPct: acc.impressions > 0 ? Math.max((acc.clicks / acc.impressions) * 100, 2) : 0,
    },
    {
      name: `Resultados (${resultTipoLabel(resultTipo)})`,
      sub: `${acc.msgs + acc.leads} contatos${acc.purchases ? ` · ${acc.purchases} compras` : ""}`,
      value: accResultado,
      pctTotal: convTotalPct,
      conv: convResPct,
      cost: custoRes !== null ? formatBRL(custoRes) : null,
      costLbl: "resultado",
      color: "color-mix(in oklch, var(--ouro-forte) 45%, var(--card))",
      barPct: acc.impressions > 0 ? Math.max((accResultado / acc.impressions) * 100, 1.5) : 0,
    },
  ];

  // --- funil do quiz ---
  const qSessions = quizSite.hasData ? quizSite.sessions : null;
  const quizCampanhas = useMemo(() => campaigns.filter((c) => /quiz|consultoria/i.test(c.nome)), [campaigns]);
  const quizGastoAtribuido = quizCampanhas.reduce((s, c) => s + sumCampaign(c.id).gasto, 0);
  const temCustoQuiz = quizCampanhas.length > 0 && quizGastoAtribuido > 0;
  const convSessStartPct = qSessions !== null && qSessions > 0 ? (quizFunnel.quiz_start / qSessions) * 100 : null;
  const quizConvConcPct = quizFunnel.quiz_start > 0 ? (quizFunnel.quiz_complete / quizFunnel.quiz_start) * 100 : null;
  const quizConvLeadPct = quizFunnel.quiz_complete > 0 ? (quizFunnel.generate_lead / quizFunnel.quiz_complete) * 100 : null;
  const quizConvTotalPct = qSessions !== null && qSessions > 0 ? (quizFunnel.generate_lead / qSessions) * 100 : quizFunnel.quiz_start > 0 ? (quizFunnel.generate_lead / quizFunnel.quiz_start) * 100 : null;
  const custoPorSessao = temCustoQuiz && qSessions ? quizGastoAtribuido / qSessions : null;
  const custoPorInicio = temCustoQuiz && quizFunnel.quiz_start > 0 ? quizGastoAtribuido / quizFunnel.quiz_start : null;
  const custoPorConclusao = temCustoQuiz && quizFunnel.quiz_complete > 0 ? quizGastoAtribuido / quizFunnel.quiz_complete : null;
  const custoPorLead = temCustoQuiz && quizFunnel.generate_lead > 0 ? quizGastoAtribuido / quizFunnel.generate_lead : null;
  const quizStages: FunnelStage[] = [
    { name: "Sessões no site", sub: `visitaram consultoria.iboxprime.com.br${temCustoQuiz ? ` · ${formatBRL(custoPorSessao || 0)}/sessão` : ""}`, value: qSessions, pctTotal: 100, conv: null, color: "#F9F295", barPct: 100 },
    {
      name: "Quiz iniciado",
      sub: `clicou em "Começar"${temCustoQuiz ? ` · ${custoPorInicio !== null ? formatBRL(custoPorInicio) : "—"}/início` : ""}`,
      value: quizFunnel.quiz_start,
      pctTotal: convSessStartPct,
      conv: convSessStartPct,
      color: "var(--ouro-forte)",
      barPct: qSessions && qSessions > 0 ? Math.max((quizFunnel.quiz_start / qSessions) * 100, 2) : quizFunnel.hasData ? 100 : 0,
    },
    {
      name: "Quiz concluído",
      sub: `respondeu as 3 perguntas${temCustoQuiz ? ` · ${custoPorConclusao !== null ? formatBRL(custoPorConclusao) : "—"}/conclusão` : ""}`,
      value: quizFunnel.quiz_complete,
      pctTotal: qSessions && qSessions > 0 ? (quizFunnel.quiz_complete / qSessions) * 100 : quizConvConcPct,
      conv: quizConvConcPct,
      color: "color-mix(in oklch, var(--ouro-forte) 70%, var(--card))",
      barPct: qSessions && qSessions > 0 ? Math.max((quizFunnel.quiz_complete / qSessions) * 100, 2) : quizFunnel.quiz_start > 0 ? Math.max((quizFunnel.quiz_complete / quizFunnel.quiz_start) * 100, 2) : 0,
    },
    {
      name: "Lead gerado (WhatsApp)",
      sub: `clicou no link final${temCustoQuiz ? ` · ${custoPorLead !== null ? formatBRL(custoPorLead) : "—"}/lead` : ""}`,
      value: quizFunnel.generate_lead,
      pctTotal: quizConvTotalPct,
      conv: quizConvLeadPct,
      color: "color-mix(in oklch, var(--ouro-forte) 45%, var(--card))",
      barPct: qSessions && qSessions > 0 ? Math.max((quizFunnel.generate_lead / qSessions) * 100, 1.5) : quizFunnel.quiz_start > 0 ? Math.max((quizFunnel.generate_lead / quizFunnel.quiz_start) * 100, 1.5) : 0,
    },
  ];

  // --- destaques (leaderboards) ---
  const highlights = useMemo(() => {
    const rows = campaigns
      .filter(campaignInScope)
      .map((c) => {
        const s = sumCampaign(c.id);
        const res = resultForTipo(s, resultTipo);
        return { camp: c, gasto: s.gasto, resultados: res, custo: res > 0 ? s.gasto / res : null };
      })
      .filter((r) => r.resultados > 0);
    const porCusto = rows
      .slice()
      .sort((a, b) => (a.custo ?? Infinity) - (b.custo ?? Infinity))
      .slice(0, 5);
    const porVolume = rows
      .slice()
      .sort((a, b) => b.resultados - a.resultados)
      .slice(0, 5);
    return { porCusto, porVolume };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, rowsByCampaign, dateFrom, dateTo, projetoFilter, objetivoFilter, onlyUnassigned, carFilter, vendedorFilter, resultTipo]);

  // --- desempenho por objetivo ---
  const objBreakdown = useMemo(() => {
    const byObj: Record<string, EmptyAgg> = {};
    for (const c of campaigns) {
      if (projetoFilter !== "todos" && campProjeto(c) !== projetoFilter) continue;
      if (onlyUnassigned) {
        if (c.car_id) continue;
      } else if (carFilter.length) {
        if (!c.car_id || !carFilter.includes(c.car_id)) continue;
      }
      if (vendedorFilter.length) {
        const v = vendedorLabel(vendedorOf(c));
        if (!vendedorFilter.includes(v)) continue;
      }
      const lbl = objetivoLabel(c.objetivo);
      const s = sumCampaign(c.id);
      const cur = byObj[lbl] || { ...EMPTY_AGG };
      cur.gasto += s.gasto;
      cur.impressions += s.impressions;
      cur.clicks += s.clicks;
      cur.msgs += s.msgs;
      cur.leads += s.leads;
      cur.purchases += s.purchases;
      byObj[lbl] = cur;
    }
    return Object.keys(byObj)
      .map((lbl) => {
        const o = byObj[lbl];
        const res = lbl === "Tráfego" ? o.clicks : resultForTipo(o, resultTipo);
        return { lbl, gasto: o.gasto, impressions: o.impressions, clicks: o.clicks, ctr: o.impressions > 0 ? (o.clicks / o.impressions) * 100 : null, resultados: res, custo: res > 0 ? o.gasto / res : null };
      })
      .sort((a, b) => objetivoRank(a.lbl) - objetivoRank(b.lbl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, rowsByCampaign, dateFrom, dateTo, carFilter, onlyUnassigned, resultTipo, projetoFilter, vendedorFilter]);

  // --- linha do tempo (conta inteira, respeita escopo) ---
  const timeline = useMemo(() => {
    const byDate: Record<string, { gasto: number; resultados: number }> = {};
    for (const c of campaigns) {
      if (!campaignInScope(c)) continue;
      const rows = rowsByCampaign[c.id] || [];
      for (const r of rows) {
        if (dateActive && !dateInRange(r.data)) continue;
        const cur = byDate[r.data] || { gasto: 0, resultados: 0 };
        cur.gasto += Number(r.gasto) || 0;
        cur.resultados += Number(r.msgs) > 0 ? Number(r.msgs) : Number(r.leads) || 0;
        byDate[r.data] = cur;
      }
    }
    return Object.keys(byDate)
      .sort()
      .map((date) => ({ date, ...byDate[date] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, rowsByCampaign, dateFrom, dateTo, projetoFilter, objetivoFilter, onlyUnassigned, carFilter, vendedorFilter]);

  // --- campanhas sem carro vinculado ---
  const unassigned = useMemo(
    () => campaigns.filter((c) => campMatchesObjetivoFilter(c) && !c.car_id && !c.categoria_objetivo && !c.destino_id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [campaigns, objetivoFilter]
  );

  async function quickAssignCampaign(campId: string, carId: string) {
    if (!carId) return;
    setCampaigns((prev) => prev.map((c) => (c.id === campId ? { ...c, car_id: carId, categoria_objetivo: null } : c)));
    await supabase.from("tr_campaigns").update({ car_id: carId, categoria_objetivo: null }).eq("id", campId);
  }
  async function quickSetCategoria(campId: string, categoria: string) {
    setCampaigns((prev) => prev.map((c) => (c.id === campId ? { ...c, categoria_objetivo: categoria || null } : c)));
    await supabase.from("tr_campaigns").update({ categoria_objetivo: categoria || null }).eq("id", campId);
  }
  async function quickSetProjeto(campId: string, value: string) {
    setCampaigns((prev) => prev.map((c) => (c.id === campId ? { ...c, projeto: value } : c)));
    await supabase.from("tr_campaigns").update({ projeto: value }).eq("id", campId);
  }

  // --- por carro (grid) ---
  const carsInScope = carFilter.length ? cars.filter((c) => carFilter.includes(c.id)) : cars;
  const carsGrid = useMemo(
    () =>
      carsInScope
        .slice()
        .map((car) => ({ car, m: carDashboardMetrics(car) }))
        .sort((a, b) => b.m.gasto - a.m.gasto),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [carsInScope, campaigns, rowsByCampaign, dateFrom, dateTo, objetivoFilter, vendedorFilter]
  );
  const carsGridPage = useVerMais(carsGrid);

  // --- visão geral por campanha (tabela completa) ---
  const campaignTableRows = useMemo(() => {
    const search = tableSearch.toLowerCase();
    const rows = campaigns
      .filter(campaignInScope)
      .map((c) => {
        const s = sumCampaign(c.id);
        const res = resultForTipo(s, resultTipo);
        return {
          camp: c,
          gasto: s.gasto,
          impressions: s.impressions,
          clicks: s.clicks,
          resultados: res,
          ctr: s.impressions > 0 ? (s.clicks / s.impressions) * 100 : 0,
          custo: res > 0 ? s.gasto / res : null,
          vendedor: vendedorLabel(vendedorOf(c)),
        };
      })
      .filter((r) => {
        if (!(r.gasto > 0 || r.impressions > 0)) return false;
        if (search && !r.camp.nome.toLowerCase().includes(search)) return false;
        if (gastoMin !== "" && r.gasto < parseFloat(gastoMin)) return false;
        if (gastoMax !== "" && r.gasto > parseFloat(gastoMax)) return false;
        if (onlySemResultado) {
          if (r.custo !== null) return false;
        } else if (cplMin !== "") {
          if (r.custo === null || r.custo < parseFloat(cplMin)) return false;
        }
        return true;
      });
    return rows.sort((a, b) => b.gasto - a.gasto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns, rowsByCampaign, dateFrom, dateTo, projetoFilter, objetivoFilter, onlyUnassigned, carFilter, vendedorFilter, tableSearch, gastoMin, gastoMax, onlySemResultado, cplMin, resultTipo]);
  const campaignTablePage = useVerMais(campaignTableRows);
  const fatPage = useVerMais(fat.rows);

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setProjetoFilter("todos");
    setCarFilter([]);
    setObjetivoFilter([]);
    setVendedorFilter([]);
    setGastoMin("");
    setGastoMax("");
    setCplMin("");
    setOnlySemResultado(false);
    setOnlyUnassigned(false);
    setTableSearch("");
  }

  const selectStyle: React.CSSProperties = { background: "var(--tr-surface-2)", border: "1px solid var(--tr-border)", color: "var(--tr-text)" };

  if (loading) {
    return (
      <main className="px-6 py-8 max-w-7xl mx-auto">
        <p className="text-sm" style={{ color: "var(--tr-text-dim)" }}>
          Carregando…
        </p>
      </main>
    );
  }

  return (
    <main className="px-6 py-8 max-w-7xl mx-auto">
      <header className="mb-5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold gold-text" style={{ fontFamily: "inherit" }}>
            Visão geral da conta
          </h1>
          <p className="text-[11px] mt-1" style={{ color: "var(--tr-text-dim)" }}>
            {lastSyncAt ? `Última sincronização: ${new Date(lastSyncAt).toLocaleString("pt-BR")}` : "Ainda sem sincronização registrada"}
            {syncError && <span style={{ color: "var(--tr-bad)" }}> · {syncError}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
        <a href="/trafego/conferir" className="text-xs font-semibold px-4 py-2 rounded-md" style={{ border: "1px solid var(--tr-border)" }}>
          Conferir com o Facebook
        </a>
        <button
          onClick={sincronizarAgora}
          disabled={syncing}
          className="text-xs font-semibold px-4 py-2 rounded-md disabled:opacity-50"
          style={{ background: "var(--tr-gold-2)", color: "var(--primary-foreground)" }}
        >
          {syncing ? "Sincronizando…" : "↻ Atualizar agora"}
        </button>
        </div>
      </header>

      {/* Barra de filtros */}
      <div className="flex flex-wrap gap-2 items-center mb-2 rounded-xl p-3" style={{ background: "var(--tr-surface)", border: "1px solid var(--tr-border)" }}>
        <details className="relative">
          <summary className="text-xs cursor-pointer px-3 py-2 rounded-md select-none" style={selectStyle}>
            Período: {dateRangeLabel()}
          </summary>
          <div className="absolute z-20 mt-1 p-3 rounded-lg flex flex-col gap-1 text-xs" style={{ background: "var(--tr-surface-2)", border: "1px solid var(--tr-border)", minWidth: 200 }}>
            {[
              ["hoje", "Hoje"],
              ["ontem", "Ontem"],
              ["7", "Últimos 7 dias"],
              ["30", "Últimos 30 dias"],
              ["90", "Últimos 90 dias"],
              ["mes", "Este mês"],
              ["tudo", "Tudo"],
            ].map(([key, label]) => (
              <button
                key={key}
                className="text-left px-2 py-1 rounded hover:brightness-125"
                onClick={() => {
                  const r = datePreset(key);
                  setDateFrom(r.from);
                  setDateTo(r.to);
                }}
              >
                {label}
              </button>
            ))}
            <div className="my-1" style={{ borderTop: "1px solid var(--tr-border)" }} />
            <label className="flex items-center justify-between gap-2">
              De <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-1 py-0.5 rounded" style={selectStyle} />
            </label>
            <label className="flex items-center justify-between gap-2">
              Até <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-1 py-0.5 rounded" style={selectStyle} />
            </label>
          </div>
        </details>

        <label className="text-xs flex items-center gap-1">
          Projeto
          <select className="px-2 py-2 rounded-md text-xs" style={selectStyle} value={projetoFilter} onChange={(e) => setProjetoFilter(e.target.value as typeof projetoFilter)}>
            <option value="todos">Todos (bate com a BM)</option>
            <option value="ibox">{PROJETOS.ibox}</option>
            <option value="ix">{PROJETOS.ix}</option>
          </select>
        </label>

        <CheckDropdown label="Carros" options={cars.map((c) => ({ value: c.id, label: c.modelo || c.placa || "(sem modelo)" }))} selected={carFilter} onChange={setCarFilter} />
        <CheckDropdown label="Objetivo" options={objetivosDisponiveis.map((o) => ({ value: o, label: o }))} selected={objetivoFilter} onChange={setObjetivoFilter} />
        <CheckDropdown label="Vendedor" options={vendedoresDisponiveis.map((v) => ({ value: v, label: v }))} selected={vendedorFilter} onChange={setVendedorFilter} />

        <details className="relative">
          <summary className="text-xs cursor-pointer px-3 py-2 rounded-md select-none" style={selectStyle}>
            Gasto: {gastoMin || gastoMax ? `${gastoMin || "0"} – ${gastoMax || "∞"}` : "Qualquer valor"}
          </summary>
          <div className="absolute z-20 mt-1 p-3 rounded-lg flex flex-col gap-2 text-xs" style={{ background: "var(--tr-surface-2)", border: "1px solid var(--tr-border)", minWidth: 200 }}>
            <label className="flex items-center justify-between gap-2">
              De (R$) <input type="number" min={0} value={gastoMin} onChange={(e) => setGastoMin(e.target.value)} className="px-1 py-0.5 rounded w-24" style={selectStyle} />
            </label>
            <label className="flex items-center justify-between gap-2">
              Até (R$) <input type="number" min={0} value={gastoMax} onChange={(e) => setGastoMax(e.target.value)} className="px-1 py-0.5 rounded w-24" style={selectStyle} />
            </label>
          </div>
        </details>

        <details className="relative">
          <summary className="text-xs cursor-pointer px-3 py-2 rounded-md select-none" style={selectStyle}>
            Performance{cplMin || onlySemResultado ? " · ativo" : ""}
          </summary>
          <div className="absolute z-20 mt-1 p-3 rounded-lg flex flex-col gap-2 text-xs" style={{ background: "var(--tr-surface-2)", border: "1px solid var(--tr-border)", minWidth: 240 }}>
            <label className="flex items-center justify-between gap-2">
              Custo/resultado a partir de (R$)
              <input type="number" min={0} disabled={onlySemResultado} value={cplMin} onChange={(e) => setCplMin(e.target.value)} className="px-1 py-0.5 rounded w-20" style={selectStyle} />
            </label>
            <div style={{ borderTop: "1px solid var(--tr-border)" }} />
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={onlySemResultado} onChange={(e) => setOnlySemResultado(e.target.checked)} /> Só campanhas sem resultado ainda
            </label>
          </div>
        </details>

        <label className="text-xs flex items-center gap-1">
          Tipo de resultado
          <select className="px-2 py-2 rounded-md text-xs" style={selectStyle} value={resultTipo} onChange={(e) => setResultTipo(e.target.value)}>
            <option value="todos">Todos</option>
            <option value="mensagens">Mensagens (Leads/Engajamento)</option>
            <option value="leads">Leads</option>
            <option value="compras">Compras (Vendas)</option>
            <option value="cliques">Cliques (Tráfego)</option>
            <option value="impressoes">Impressões (Reconhecimento)</option>
          </select>
        </label>

        <label className="text-xs flex items-center gap-1">
          <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} /> Só sem carro vinculado
        </label>

        <button className="text-xs underline ml-auto" style={{ color: "var(--tr-text-dim)" }} onClick={clearFilters}>
          Limpar filtros
        </button>
      </div>
      {dateActive && (
        <p className="text-xs mb-5" style={{ color: "var(--tr-text-dim)" }}>
          Período: <b>{dateFrom || "início"}</b> até <b>{dateTo || "hoje"}</b>.
        </p>
      )}

      {/* Visão geral da conta — hero financeiro + crescimento + site.
          Porte exato do .vg-hero/.vg-money/.vg-growth do artefato original
          (index_1.html linhas 3023-3075) — substitui os 3 cards genéricos
          que existiam antes por essa estrutura mais elaborada. */}
      <div className="vg-hero">
        <div className="vg-money">
          <div className="vg-growth-sublbl">Financeiro</div>
          <div className="vg-money-row">
            <span className="lbl">Investimento no período</span>
            <span className="val">{formatBRL(acc.gasto)}</span>
          </div>
          <div className="vg-money-div" />
          <div className="vg-money-row">
            <span className="lbl">Faturamento</span>
            <span className="val good">{formatBRL(fat.totalFaturamento)}</span>
          </div>
          <div className="vg-money-div" />
          <div className="vg-money-row">
            <span className="lbl">ROAS</span>
            <span className="val roas">{fat.roas !== null ? formatRoas(fat.roas) : "—"}</span>
          </div>
          <div className="vg-money-div" style={{ margin: "4px 0 0" }} />
          <div className="vg-growth-sublbl">Margem</div>
          <div className="vg-money-row">
            <span className="lbl-wrap">
              <span className="lbl">Margem de lucro</span>
              <button className="olhinho-btn" onClick={() => masked.toggle("lucro")} title={masked.isMasked("lucro") ? "Mostrar valor" : "Ocultar valor"}>
                {masked.isMasked("lucro") ? "🙈" : "👁"}
              </button>
            </span>
            <span className={`val${masked.isMasked("lucro") ? " masked" : ""}`} style={{ fontSize: 22 }}>
              {masked.isMasked("lucro") ? MASKED_PLACEHOLDER : formatBRL(fat.totalMargemLucro)}
            </span>
          </div>
          <div className="vg-money-div" />
          <div className="vg-money-row">
            <span className="lbl-wrap">
              <span className="lbl">Margem após tráfego (c/ imposto)</span>
              <button className="olhinho-btn" onClick={() => masked.toggle("aposTrafego")} title={masked.isMasked("aposTrafego") ? "Mostrar valor" : "Ocultar valor"}>
                {masked.isMasked("aposTrafego") ? "🙈" : "👁"}
              </button>
            </span>
            <span
              className={`val${masked.isMasked("aposTrafego") ? " masked" : fat.totalMargemAposAnuncio >= 0 ? " good" : " bad"}`}
              style={{ fontSize: 22 }}
            >
              {masked.isMasked("aposTrafego") ? MASKED_PLACEHOLDER : formatBRL(fat.totalMargemAposAnuncio)}
            </span>
          </div>
        </div>

        <div className="vg-growth">
          <div className="vg-growth-sublbl">Métricas gerais</div>
          <div className="vg-money-row">
            <span className="lbl">Seguidores ganhos ({dateActive ? "no período" : "últimos 30 dias"})</span>
            <span className="val good" style={{ fontSize: 30 }}>
              {ig.hasData ? `${ig.ganhos > 0 ? "+" : ""}${formatInt(ig.ganhos)}` : "—"}
            </span>
          </div>
          <div className="sub">
            <span>Total hoje</span>
            <b>{ig.total !== null ? ig.total.toLocaleString("pt-BR") : "—"}</b>
          </div>
          <div className="sub">
            <span>Média/dia</span>
            <b>{ig.hasData && ig.dias > 0 ? (ig.ganhos / ig.dias).toFixed(1).replace(".", ",") : "—"}</b>
          </div>
          <div className="vg-money-div" style={{ margin: "4px 0 0" }} />
          <div className="vg-growth-sublbl">Campanha</div>
          <div className="sub">
            <span>Impressões</span>
            <b>{formatInt(acc.impressions)}</b>
          </div>
          <div className="sub">
            <span>Cliques no link</span>
            <b>{formatInt(acc.clicks)}</b>
          </div>
          <div className="sub">
            <span>CPM</span>
            <b>{cpm !== null ? formatBRL(cpm) : "—"}</b>
          </div>
          <div className="sub">
            <span>CTR</span>
            <b>{ctr !== null ? formatPercent(ctr, 2) : "—"}</b>
          </div>
          <div className="sub">
            <span>Contatos</span>
            <b className="accent">{formatInt(contatos)}</b>
          </div>
          <div className="sub">
            <span>Custo por contato</span>
            <b>{custoContato !== null ? formatBRL(custoContato) : "—"}</b>
          </div>
        </div>

        <div className="vg-growth">
          <div className="vg-growth-sublbl-row">
            <div className="vg-growth-sublbl">Site</div>
            <select className="site-select" value={siteAtivo} onChange={(e) => setSiteAtivo(e.target.value as "ibox" | "quiz")}>
              {WINDSOR_GA4_SITES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="vg-money-row">
            <span className="lbl">Sessões ({dateActive ? "no período" : "últimos 30 dias"})</span>
            <span className="val accent" style={{ fontSize: 30 }}>
              {site.hasData ? formatInt(site.sessions) : "—"}
            </span>
          </div>
          <div className="sub">
            <span>Usuários ativos</span>
            <b>{site.hasData ? formatInt(site.users) : "—"}</b>
          </div>
          <div className="sub">
            <span>Novos usuários</span>
            <b>{site.hasData ? formatInt(site.newUsers) : "—"}</b>
          </div>
          <div className="vg-money-div" style={{ margin: "4px 0 0" }} />
          <div className="vg-growth-sublbl">Engajamento</div>
          <div className="sub">
            <span>Visualizações de página</span>
            <b>{site.hasData ? formatInt(site.pageviews) : "—"}</b>
          </div>
          <div className="sub">
            <span>Taxa de engajamento</span>
            <b>{site.engagementRate !== null ? formatPercent(site.engagementRate * 100, 1) : "—"}</b>
          </div>
          <div className="sub">
            <span>Duração média da sessão</span>
            <b>{site.avgSessionDuration !== null ? formatDuracaoSessao(site.avgSessionDuration) : "—"}</b>
          </div>
          <div className="vg-money-div" style={{ margin: "4px 0 0" }} />
          <div className="vg-growth-sublbl">Contato</div>
          <div className="sub">
            <span>Contatos iniciados (WhatsApp)</span>
            <b className="accent">{site.hasData ? formatInt(site.contacts) : "—"}</b>
          </div>
          {!site.hasData && <p className="funnel-foot-note" style={{ marginTop: 6 }}>Aguardando sincronização com o Google Analytics 4.</p>}
        </div>
      </div>

      {/* Estrutura da conta */}
      <div className="vg-spec-cols" style={{ gridTemplateColumns: "1fr", marginBottom: 24 }}>
        <div className="vg-spec">
          <div className="vg-spec-ttl">Estrutura da conta</div>
          <div className="vg-spec-row">
            <span>Total em campanhas</span>
            <b>{formatBRL(alloc.totalGasto)}</b>
          </div>
          <div className="vg-spec-row">
            <span>Imposto META (12%)</span>
            <b className="warn">{formatBRL(alloc.impostoTotal)}</b>
          </div>
          <div className="vg-spec-row">
            <span>Carros cadastrados</span>
            <b className="accent">{alloc.carros}</b>
          </div>
          <div className="vg-spec-row">
            <span>Já alocado / não alocado</span>
            <b>
              {formatBRL(alloc.alocado)} · {formatBRL(alloc.naoAlocadoValor)}
              {alloc.naoAlocadas > 0 ? ` (${alloc.naoAlocadas} camp.)` : ""}
            </b>
          </div>
        </div>
      </div>

      {/* Funil geral — porte exato do .fg-wrap, sem card envolvendo (o
          artefato original renderiza a silhueta+lista direto no fundo da
          página, sem painel de superfície por trás). */}
      <div className="section-ttl">Funil geral</div>
      <FunnelGeral stages={funilGeralStages} />
      <p className="text-[11px] mb-6" style={{ color: "var(--tr-text-dim)" }}>
        custo por impressão: {custoImp !== null ? formatBRL(custoImp) : "—"} · custo por clique: {custoClk !== null ? formatBRL(custoClk) : "—"} · custo por resultado: {custoRes !== null ? formatBRL(custoRes) : "—"} · conversão
        impressão → resultado: {convTotalPct !== null ? formatPercent(convTotalPct, 2) : "—"}
      </p>

      {/* Funil do quiz — com opção de remover/mostrar a exibição, que persiste
          entre recarregamentos (localStorage). */}
      <div className="flex items-center justify-between gap-2" style={{ marginTop: 28, paddingTop: 14, borderTop: "1px solid var(--tr-border)" }}>
        <div className="section-ttl" style={{ margin: 0, padding: 0, border: "none" }}>Funil do quiz</div>
        <button
          type="button"
          onClick={toggleQuizFunilVisivel}
          className="btn"
          style={{ fontSize: 11, padding: "3px 8px", height: "auto" }}
        >
          {quizFunilVisivel ? "Ocultar" : "Mostrar"}
        </button>
      </div>
      {quizFunilVisivel && (
        <>
          <FunnelGeral stages={quizStages} />
          {!quizFunnel.hasData && !quizSite.hasData ? (
            <p className="text-[11px] mb-6" style={{ color: "var(--tr-text-dim)" }}>
              Aguardando dados do Google Analytics do quiz (consultoria.iboxprime.com.br).
            </p>
          ) : (
            <>
              <p className="text-[11px]" style={{ color: "var(--tr-text-dim)" }}>
                conversão sessão → quiz iniciado: {convSessStartPct !== null ? formatPercent(convSessStartPct, 2) : "—"} · quiz iniciado → concluído: {quizConvConcPct !== null ? formatPercent(quizConvConcPct, 2) : "—"} · concluído → lead:{" "}
                {quizConvLeadPct !== null ? formatPercent(quizConvLeadPct, 2) : "—"} · conversão total: {quizConvTotalPct !== null ? formatPercent(quizConvTotalPct, 2) : "—"}
              </p>
              <p className="text-[11px] mb-6" style={{ color: "var(--tr-text-dim)" }}>
                {temCustoQuiz
                  ? `Custo calculado a partir de ${quizCampanhas.length} campanha(s) de tráfego identificada(s) pelo nome ("quiz"/"consultoria"), gasto total no período: ${formatBRL(quizGastoAtribuido)}.`
                  : 'Custo por etapa ainda não aparece aqui: nenhuma campanha de tráfego direcionada pro quiz no período (procure "quiz"/"consultoria" no nome da campanha).'}
              </p>
            </>
          )}
        </>
      )}

      {/* Faturamento */}
      <SectionTitle>Faturamento do tráfego{carFilter.length ? " (carros filtrados)" : " (geral)"}</SectionTitle>
      {fat.rows.length === 0 ? (
        <p className="text-sm mb-2" style={{ color: "var(--tr-text-dim)" }}>
          Nenhum carro com dado de negócio ainda.
        </p>
      ) : (
        <div className="rounded-xl overflow-hidden mb-2" style={{ border: "1px solid var(--tr-border)" }}>
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--tr-surface-2)", color: "var(--tr-text-dim)" }}>
                <th className="text-left px-3 py-2">Carro</th>
                <th className="text-right px-3 py-2">Faturamento</th>
                <th className="text-right px-3 py-2">Investido</th>
                <th className="text-right px-3 py-2">ROAS</th>
                <th className="text-right px-3 py-2">Margem lucro</th>
                <th className="text-right px-3 py-2">Margem após tráfego</th>
              </tr>
            </thead>
            <tbody>
              {fatPage.visible.map((r) => (
                <tr key={r.car.id} style={{ borderTop: "1px solid var(--tr-border)" }}>
                  <td className="px-3 py-2">{r.car.modelo || r.car.placa || "(sem modelo)"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatBRL(r.valorNegocio)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatBRL(r.gasto)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.roas !== null ? formatRoas(r.roas) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatBRL(r.margemLucro)}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: r.margemAposAnuncio >= 0 ? "var(--tr-good)" : "var(--tr-bad)" }}>
                    {formatBRL(r.margemAposAnuncio)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {fatPage.hasMore && (
        <div className="flex justify-center mb-2">
          <VerMaisButton label={fatPage.buttonLabel} onClick={fatPage.toggle} />
        </div>
      )}
      <p className="text-[11px] mb-6" style={{ color: "var(--tr-text-dim)" }}>
        * Faturamento e margem vêm dos dados de negócio preenchidos em cada carro — não são filtráveis por data, apenas por carro. Margem após tráfego já desconta o imposto META (12%).
      </p>

      {/* Destaques */}
      <SectionTitle>Destaques</SectionTitle>
      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <LeaderboardCard title="Melhor custo por resultado" rows={highlights.porCusto.map((r, i) => ({ rank: i + 1, name: r.camp.nome, metric: `${formatBRL(r.custo ?? 0)}/res.` }))} />
        <LeaderboardCard title="Maior volume de resultados" rows={highlights.porVolume.map((r, i) => ({ rank: i + 1, name: r.camp.nome, metric: `${r.resultados} res.` }))} />
      </div>

      {/* Desempenho por objetivo */}
      {objBreakdown.length > 0 && (
        <>
          <SectionTitle>Desempenho por objetivo de campanha</SectionTitle>
          <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {objBreakdown.map((o) => {
              const rank = objetivoRank(o.lbl);
              const tierColor = rank <= 1 ? "var(--tr-good)" : rank <= 3 ? "var(--tr-gold-2)" : "var(--tr-text-dim)";
              const tierTag = rank <= 1 ? "Prioridade alta" : rank <= 3 ? "Prioridade média" : "Prioridade baixa";
              return (
                <div key={o.lbl} className="rounded-xl p-4" style={{ background: "var(--tr-surface)", border: "1px solid var(--tr-border)", borderLeft: `3px solid ${tierColor}` }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm">{o.lbl}</span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ color: tierColor, background: "var(--tr-surface-2)" }}>
                      {tierTag}
                    </span>
                  </div>
                  <SubRow label="Gasto" value={formatBRL(o.gasto)} />
                  <SubRow label="Impressões" value={formatInt(o.impressions)} />
                  <SubRow label="Cliques" value={formatInt(o.clicks)} />
                  <SubRow label="CTR" value={o.ctr !== null ? formatPercent(o.ctr, 2) : "—"} />
                  <SubRow label={o.lbl === "Tráfego" ? "Resultados (cliques)" : "Resultados"} value={formatInt(o.resultados)} />
                  <SubRow label="Custo/resultado" value={o.custo !== null ? formatBRL(o.custo) : "—"} />
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Linha do tempo */}
      <SectionTitle>Linha do tempo</SectionTitle>
      <div className="rounded-xl p-4 mb-6" style={{ background: "var(--tr-surface)", border: "1px solid var(--tr-border)" }}>
        {timeline.length >= 2 ? <Sparkline series={timeline} /> : <p className="text-sm" style={{ color: "var(--tr-text-dim)" }}>Sem histórico diário suficiente para o gráfico ainda.</p>}
      </div>

      {/* Campanhas sem carro vinculado */}
      {unassigned.length > 0 && (
        <>
          <SectionTitle>Campanhas sem carro vinculado ({unassigned.length})</SectionTitle>
          <div className="flex flex-col gap-2 mb-6">
            {unassigned.map((camp) => (
              <div key={camp.id} className="rounded-lg p-3 flex flex-col gap-2" style={{ background: "var(--tr-surface)", border: "1px solid var(--tr-border)" }}>
                <div>
                  <p className="text-sm font-medium">{camp.nome}</p>
                  <p className="text-xs" style={{ color: "var(--tr-text-dim)" }}>
                    {objetivoLabel(camp.objetivo)} · {formatBRL(sumCampaign(camp.id).gasto)}
                  </p>
                </div>
                <div className="flex gap-3 flex-wrap text-xs">
                  <label className="flex items-center gap-1" style={{ color: "var(--tr-text-dim)" }}>
                    Vincular a carro
                    <select className="px-2 py-1 rounded" style={selectStyle} defaultValue="" onChange={(e) => quickAssignCampaign(camp.id, e.target.value)}>
                      <option value="">Selecionar carro</option>
                      {cars.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.modelo || c.placa || "(sem modelo)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1" style={{ color: "var(--tr-text-dim)" }}>
                    Ou é
                    <select className="px-2 py-1 rounded" style={selectStyle} defaultValue="" onChange={(e) => quickSetCategoria(camp.id, e.target.value)}>
                      <option value="">Selecionar objetivo</option>
                      {CATEGORIAS_OBJETIVO.map((cat) => (
                        <option key={cat.key} value={cat.key}>
                          {cat.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1" style={{ color: "var(--tr-text-dim)" }}>
                    Projeto
                    <select className="px-2 py-1 rounded" style={selectStyle} value={campProjeto(camp)} onChange={(e) => quickSetProjeto(camp.id, e.target.value)}>
                      <option value="ibox">{PROJETOS.ibox}</option>
                      <option value="ix">{PROJETOS.ix}</option>
                    </select>
                  </label>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Por carro */}
      <SectionTitle>Por carro</SectionTitle>
      {carsGrid.length === 0 ? (
        <p className="text-sm mb-6" style={{ color: "var(--tr-text-dim)" }}>
          Nenhum carro cadastrado ainda (ou nenhum corresponde ao filtro).
        </p>
      ) : (
        <>
          <div className="grid gap-3 mb-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {carsGridPage.visible.map(({ car, m }) => {
              const custo = m.resultados > 0 ? formatBRL(m.gasto / m.resultados) : "—";
              return (
                <div key={car.id} onClick={() => router.push(`/trafego/carros/${car.id}`)} className="rounded-xl p-4 cursor-pointer hover:brightness-110" style={{ background: "var(--tr-surface)", border: "1px solid var(--tr-border)" }}>
                  <p className="font-semibold text-sm truncate">{car.modelo || "(sem modelo)"}</p>
                  <p className="text-[11px] mb-2" style={{ color: "var(--tr-text-dim)", fontFamily: "ui-monospace, monospace" }}>
                    {car.placa || "—"}
                  </p>
                  <SubRow label="Gasto" value={formatBRL(m.gasto)} />
                  <SubRow label="Resultados" value={String(m.resultados)} />
                  <SubRow label="Custo/resultado" value={custo} />
                </div>
              );
            })}
          </div>
          {carsGridPage.hasMore && (
            <div className="flex justify-center mb-6">
              <VerMaisButton label={carsGridPage.buttonLabel} onClick={carsGridPage.toggle} />
            </div>
          )}
        </>
      )}

      {/* Visão geral por campanha */}
      <SectionTitle>Visão geral por campanha</SectionTitle>
      <input
        className="px-3 py-2 rounded-md text-sm w-full mb-3"
        style={selectStyle}
        placeholder="Buscar campanha…"
        value={tableSearch}
        onChange={(e) => setTableSearch(e.target.value)}
      />
      {campaignTableRows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--tr-text-dim)" }}>
          Nenhuma campanha com dados no período/filtro selecionado.
        </p>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--tr-border)" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--tr-surface-2)", color: "var(--tr-text-dim)" }}>
                  <th className="text-left px-3 py-2">Campanha</th>
                  <th className="text-left px-3 py-2">Objetivo</th>
                  <th className="text-left px-3 py-2">Projeto</th>
                  <th className="text-left px-3 py-2">Vínculo</th>
                  <th className="text-left px-3 py-2">Vendedor</th>
                  <th className="text-right px-3 py-2">Impressões</th>
                  <th className="text-right px-3 py-2">Cliques</th>
                  <th className="text-right px-3 py-2">CTR</th>
                  <th className="text-right px-3 py-2">Gasto</th>
                  <th className="text-right px-3 py-2">Resultados</th>
                  <th className="text-right px-3 py-2">Custo/resultado</th>
                </tr>
              </thead>
              <tbody>
                {campaignTablePage.visible.map((r) => {
                  const car = cars.find((c) => c.id === r.camp.car_id) || null;
                  const vinculoTxt = car
                    ? car.modelo || car.placa || "(sem modelo)"
                    : r.camp.categoria_objetivo
                      ? CATEGORIAS_OBJETIVO.find((c) => c.key === r.camp.categoria_objetivo)?.label ?? "—"
                      : r.camp.destino_id
                        ? destinosById[r.camp.destino_id] ?? "—"
                        : null;
                  return (
                    <tr key={r.camp.id} style={{ borderTop: "1px solid var(--tr-border)" }}>
                      <td className="px-3 py-2 max-w-[220px] truncate" title={r.camp.nome}>
                        {r.camp.nome}
                      </td>
                      <td className="px-3 py-2">{objetivoLabel(r.camp.objetivo)}</td>
                      <td className="px-3 py-2">
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--tr-surface-2)", color: "var(--tr-text-dim)" }}>
                          {PROJETOS[campProjeto(r.camp)]}
                        </span>
                      </td>
                      <td className="px-3 py-2">{vinculoTxt ?? <span style={{ color: "var(--tr-bad)" }}>sem vínculo</span>}</td>
                      <td className="px-3 py-2">{r.vendedor === "Sem vendedor" ? <span style={{ color: "var(--tr-bad)" }}>{r.vendedor}</span> : r.vendedor}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatInt(r.impressions)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatInt(r.clicks)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatPercent(r.ctr, 2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatBRL(r.gasto)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.resultados}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.custo !== null ? formatBRL(r.custo) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {campaignTablePage.hasMore && (
        <div className="flex justify-center mt-4">
          <VerMaisButton label={campaignTablePage.buttonLabel} onClick={campaignTablePage.toggle} />
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="section-ttl">{children}</h2>;
}

function VerMaisButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="text-xs font-semibold px-4 py-2 rounded-lg"
      style={{ background: "var(--tr-surface-2)", border: "1px solid var(--tr-border)", color: "var(--tr-text)" }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function SubRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs py-0.5">
      <span style={{ color: "var(--tr-text-dim)" }}>{label}</span>
      <b style={{ color: accent ? "var(--tr-gold-2)" : "var(--tr-text)" }}>{value}</b>
    </div>
  );
}

function LeaderboardCard({ title, rows }: { title: string; rows: { rank: number; name: string; metric: string }[] }) {
  return (
    <div className="rounded-xl p-4" style={{ background: "var(--tr-surface)", border: "1px solid var(--tr-border)" }}>
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--tr-text-dim)" }}>
          Sem resultados no período.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <div key={r.rank + r.name} className="flex items-center gap-2 text-xs">
              <span className="w-4 text-center font-bold" style={{ color: "var(--tr-gold-2)" }}>
                {r.rank}
              </span>
              <span className="flex-1 truncate" title={r.name}>
                {r.name}
              </span>
              <span className="tabular-nums" style={{ color: "var(--tr-text-dim)" }}>
                {r.metric}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CheckDropdown({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  function toggle(v: string) {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  }
  return (
    <details className="relative">
      <summary className="text-xs cursor-pointer px-3 py-2 rounded-md select-none" style={{ background: "var(--tr-surface-2)", border: "1px solid var(--tr-border)", color: "var(--tr-text)" }}>
        {label}: {selected.length ? `${selected.length} selecionado(s)` : "Todos"}
      </summary>
      <div className="absolute z-20 mt-1 p-2 rounded-lg flex flex-col gap-1 text-xs max-h-64 overflow-y-auto" style={{ background: "var(--tr-surface-2)", border: "1px solid var(--tr-border)", minWidth: 220 }}>
        {options.length === 0 ? (
          <span style={{ color: "var(--tr-text-dim)" }} className="px-2 py-1">
            Nenhuma opção ainda.
          </span>
        ) : (
          options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 px-2 py-1 rounded hover:brightness-125 cursor-pointer">
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              <span className="truncate">{o.label}</span>
            </label>
          ))
        )}
      </div>
    </details>
  );
}

// Gráfico de área simples (gasto + resultados normalizados) — mesmo padrão
// usado na tela de Vendedores, aqui aplicado à conta inteira.
function Sparkline({ series }: { series: { date: string; gasto: number; resultados: number }[] }) {
  const w = 900;
  const h = 160;
  const pad = 8;
  const maxGasto = Math.max(...series.map((d) => d.gasto), 1);
  const maxRes = Math.max(...series.map((d) => d.resultados), 1);
  function pts(key: "gasto" | "resultados", max: number): string {
    return series
      .map((d, i) => {
        const x = pad + (i / (series.length - 1)) * (w - 2 * pad);
        const y = h - pad - (d[key] / max) * (h - 2 * pad);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }
  const resPts = pts("resultados", maxRes);
  const areaPts = `${resPts} ${(w - pad).toFixed(1)},${h - pad} ${pad.toFixed(1)},${h - pad}`;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: 160 }}>
        <defs>
          <linearGradient id="dashSparkArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--tr-gold-2)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="var(--tr-gold-2)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <polygon points={areaPts} fill="url(#dashSparkArea)" />
        <polyline points={pts("gasto", maxGasto)} fill="none" stroke="var(--az)" strokeWidth={2} />
        <polyline points={resPts} fill="none" stroke="var(--tr-gold-2)" strokeWidth={2} />
      </svg>
      <div className="flex gap-4 flex-wrap text-[11px] mt-2" style={{ color: "var(--tr-text-dim)" }}>
        <span>
          <i className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "var(--az)" }} />
          Gasto (máx {formatBRL(maxGasto)})
        </span>
        <span>
          <i className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: "var(--tr-gold-2)" }} />
          Resultados (máx {maxRes})
        </span>
        <span className="ml-auto">
          {series[0].date} → {series[series.length - 1].date}
        </span>
      </div>
    </div>
  );
}
