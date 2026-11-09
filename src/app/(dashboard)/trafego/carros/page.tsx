"use client";

import Link from "next/link";

// Reescrita (Fase 6 — paridade visual com o standalone/Artifact original):
// página única com lista mestre na lateral (busca não muda de URL) + detalhe
// inline no conteúdo principal, exatamente como o Placa a Placa original.
// Substitui o padrão anterior (tabela grande + rota separada
// carros/[id]/page.tsx) a pedido explícito do usuário ("replicar exatamente").
//
// A rota carros/[id]/page.tsx continua existindo só como fallback de link
// direto (ex.: favoritos antigos) — toda a navegação normal agora acontece
// aqui dentro, trocando um estado local (selectedCarId), sem router.push.

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { orgIdAtual } from "@/lib/trafego/org";
import { formatBRL, META_TAX } from "@/lib/trafego/format";
import { vendedorOf, vendedorLabel } from "@/lib/trafego/vendedorOf";
import { useWindsorSyncBar, SyncStatusLine, AtualizarAgoraButton } from "@/lib/trafego/syncBar";
import { fetchAll } from "@/lib/trafego/fetchAll";
import { candidatoNoPainel, lerEstoqueSite, type VeiculoSite } from "@/lib/trafego/estoqueSite";


type Car = {
  id: string;
  placa: string;
  modelo: string;
  ano: number | null;
  status: "estoque" | "vendido";
  valor_venda: number | null;
  tipo_negocio: "venda" | "troca" | null;
  veiculo_troca: string | null;
  valor_troca: number | null;
  valor_volta: number | null;
  margem_lucro: number | null;
  criado_em: string;
  // Ligação com o estoque do site (migration 0011). Ausentes enquanto ela não for aplicada.
  site_vehicle_id?: string | null;
  origem?: string | null;
  nome_site?: string | null;
  preco_site?: number | null;
  site_status?: string | null;
  foto_url?: string | null;
};

const CAMPOS_SITE = "id, site_vehicle_id, origem, nome_site, preco_site, site_status, foto_url";

type Campaign = {
  id: string;
  nome: string;
  objetivo: string | null;
  car_id: string | null;
  categoria_objetivo: string | null;
  vendedor_override: string | null;
};

type Agg = { gasto: number; msgs: number; leads: number; purchases: number };
const EMPTY_AGG: Agg = { gasto: 0, msgs: 0, leads: 0, purchases: 0 };

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
function resultadosOf(agg: Agg): number {
  return agg.msgs > 0 ? agg.msgs : agg.leads > 0 ? agg.leads : 0;
}
function tipoOf(agg: Agg): "WhatsApp" | "Lead site" | "Sem resultado" {
  if (agg.msgs > 0) return "WhatsApp";
  if (agg.leads > 0) return "Lead site";
  return "Sem resultado";
}

type SortKey = "nome_asc" | "gasto_desc" | "gasto_asc" | "resultados_desc" | "custo_desc" | "valor_desc" | "margem_desc" | "roas_desc";
type DetalheSortKey = "relevancia" | "gasto_desc" | "gasto_asc" | "resultados_desc" | "nome_asc";

export default function CarrosPage() {
  const supabase = createClient();
  const [accId, setAccId] = useState<string | null>(null);
  const [cars, setCars] = useState<Car[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [aggByCampaign, setAggByCampaign] = useState<Record<string, Agg>>({});
  const [loading, setLoading] = useState(true);

  const [selectedCarId, setSelectedCarId] = useState<string | null>(null);

  const [novoModelo, setNovoModelo] = useState("");
  const [novaPlaca, setNovaPlaca] = useState("");
  const [criando, setCriando] = useState(false);

  const [sidebarSearch, setSidebarSearch] = useState("");

  // Estoque do site: null = ainda não sei se o banco tem a migration 0011.
  const [siteAtivo, setSiteAtivo] = useState<boolean | null>(null);
  const [estoqueSite, setEstoqueSite] = useState<VeiculoSite[]>([]);
  const [syncEstoque, setSyncEstoque] = useState<{ quando: Date | null; rodando: boolean; erro: string | null }>({ quando: null, rodando: false, erro: null });
  const [vendoConferir, setVendoConferir] = useState(false);
  const [mostrarCadastroManual, setMostrarCadastroManual] = useState(false);

  async function carregar() {
    setLoading(true);
    const acc = await orgIdAtual(supabase);
    if (!acc) {
      setLoading(false);
      return;
    }
    setAccId(acc);
    const [{ data: carsData }, { data: campaignsData }, { data: metricsData }] = await Promise.all([
      supabase
        .from("veiculos")
        .select("id, placa, modelo, ano, status, valor_venda, tipo_negocio, veiculo_troca, valor_troca, valor_volta, margem_lucro, criado_em")
        .eq("org_id", acc)
        .order("criado_em", { ascending: false }),
      supabase.from("tr_campaigns").select("id, nome, objetivo, car_id, categoria_objetivo, vendedor_override").eq("org_id", acc),
      fetchAll((de, ate) => supabase.from("tr_campaign_metrics_daily").select("campaign_id, gasto, msgs, leads, purchases").eq("org_id", acc).order("id").range(de, ate)),
    ]);
    let lista = (carsData ?? []) as Car[];
    // Campos do site numa consulta separada: se o banco ainda não tem a migration 0011,
    // a tela continua igual a antes, sem quebrar.
    const { data: siteData, error: siteErr } = await supabase.from("veiculos").select(CAMPOS_SITE).eq("org_id", acc);
    if (siteErr) {
      setSiteAtivo(false);
    } else {
      setSiteAtivo(true);
      const porId = new Map(((siteData ?? []) as Partial<Car>[]).map((r) => [r.id as string, r]));
      lista = lista.map((c) => ({ ...c, ...(porId.get(c.id) || {}) }));
    }
    setCars(lista);
    setCampaigns((campaignsData ?? []) as Campaign[]);

    const agg: Record<string, Agg> = {};
    for (const row of (metricsData ?? []) as Array<Record<string, number | string>>) {
      const id = String(row.campaign_id);
      const cur = agg[id] || { gasto: 0, msgs: 0, leads: 0, purchases: 0 };
      cur.gasto += Number(row.gasto) || 0;
      cur.msgs += Number(row.msgs) || 0;
      cur.leads += Number(row.leads) || 0;
      cur.purchases += Number(row.purchases) || 0;
      agg[id] = cur;
    }
    setAggByCampaign(agg);
    setLoading(false);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ao abrir (e no botão), puxa o estoque do site para o painel e recarrega.
  async function atualizarEstoque() {
    setSyncEstoque((s) => ({ ...s, rodando: true, erro: null }));
    try {
      const r = await fetch("/api/trafego/estoque", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      const erro = !r.ok ? j?.error || `erro ${r.status}` : (j?.results || []).find((x: { erro?: string }) => x.erro)?.erro || null;
      setSyncEstoque({ quando: new Date(), rodando: false, erro });
      setEstoqueSite(await lerEstoqueSite());
      await carregar();
    } catch (e) {
      setSyncEstoque({ quando: null, rodando: false, erro: e instanceof Error ? e.message : String(e) });
    }
  }
  useEffect(() => {
    if (siteAtivo) atualizarEstoque();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteAtivo]);

  // Carros do site ainda sem ligação no painel (os parecidos esperam conferência).
  const paraConferir = useMemo(() => {
    if (!siteAtivo) return [];
    const ligados = new Set(cars.map((c) => c.site_vehicle_id).filter(Boolean));
    return estoqueSite
      .filter((v) => !ligados.has(v.id))
      .map((v) => ({ v, cand: candidatoNoPainel(v, cars) }));
  }, [siteAtivo, estoqueSite, cars]);

  const { lastSyncAt, syncing, syncError, sincronizarAgora } = useWindsorSyncBar(accId, carregar);

  // ---- computa totais por carro (usado na visão geral e nos cards da lateral) ----
  const computed = useMemo(() => {
    return cars.map((car) => {
      const camps = campaigns.filter((c) => c.car_id === car.id);
      let gasto = 0;
      let resultados = 0;
      const porVendedor: Record<string, { gasto: number; resultados: number }> = {};
      const porObjetivo: Record<string, number> = {};
      for (const camp of camps) {
        const a = aggByCampaign[camp.id] || EMPTY_AGG;
        gasto += a.gasto;
        resultados += resultadosOf(a);
        const v = vendedorLabel(vendedorOf(camp));
        if (!porVendedor[v]) porVendedor[v] = { gasto: 0, resultados: 0 };
        porVendedor[v].gasto += a.gasto;
        porVendedor[v].resultados += resultadosOf(a);
        const lbl = objetivoLabel(camp.objetivo);
        porObjetivo[lbl] = (porObjetivo[lbl] || 0) + a.gasto;
      }
      const vendNames = Object.keys(porVendedor).sort((x, y) => porVendedor[y].gasto - porVendedor[x].gasto);
      const vendPrincipal = vendNames[0] ? { nome: vendNames[0], ...porVendedor[vendNames[0]] } : null;
      const objKeys = Object.keys(porObjetivo).sort((x, y) => porObjetivo[y] - porObjetivo[x]);
      const objPrincipal = objKeys[0] ?? null;

      const impostoMeta = gasto * META_TAX;
      const custoComImposto = gasto + impostoMeta;
      const tipoNegocio = car.tipo_negocio || "venda";
      const precoVenda = Number(car.valor_venda) || 0;
      const valorTroca = Number(car.valor_troca) || 0;
      const valorVolta = Number(car.valor_volta) || 0;
      const margemLucro = Number(car.margem_lucro) || 0;
      const valorNegocio = tipoNegocio === "troca" ? valorTroca + valorVolta : precoVenda;
      const margemAposAnuncio = margemLucro - custoComImposto;
      const roas = gasto > 0 ? valorNegocio / gasto : null;

      return {
        car,
        campCount: camps.length,
        tot: { gasto, resultados },
        fin: { impostoMeta, custoComImposto, tipoNegocio, valorNegocio, margemLucro, margemAposAnuncio, roas },
        vendPrincipal,
        objPrincipal,
      };
    });
  }, [cars, campaigns, aggByCampaign]);

  const computedById = useMemo(() => {
    const m: Record<string, (typeof computed)[number]> = {};
    for (const item of computed) m[item.car.id] = item;
    return m;
  }, [computed]);

  const semCarroCount = useMemo(() => campaigns.filter((c) => !c.car_id).length, [campaigns]);

  const sidebarList = useMemo(() => {
    const term = sidebarSearch.toLowerCase();
    return computed
      .filter((item) => {
        if (!term) return true;
        return (item.car.modelo || "").toLowerCase().includes(term) || (item.car.placa || "").toLowerCase().includes(term);
      })
      .slice()
      .sort((a, b) => (a.car.modelo || a.car.placa || "").localeCompare(b.car.modelo || b.car.placa || "", "pt-BR", { sensitivity: "base" }));
  }, [computed, sidebarSearch]);

  async function adicionarCarro() {
    if (!accId || !novoModelo.trim()) return;
    setCriando(true);
    const { data, error } = await supabase
      .from("veiculos")
      .insert({ org_id: accId, modelo: novoModelo.trim(), placa: novaPlaca.trim().toUpperCase(), status: "estoque" })
      .select("id, placa, modelo, ano, status, valor_venda, tipo_negocio, veiculo_troca, valor_troca, valor_volta, margem_lucro, criado_em")
      .single();
    setCriando(false);
    if (!error && data) {
      setCars((prev) => [data as Car, ...prev]);
      setNovoModelo("");
      setNovaPlaca("");
      setSelectedCarId((data as Car).id);
    }
  }

  function updateCarLocal(carId: string, patch: Partial<Car>) {
    setCars((prev) => prev.map((c) => (c.id === carId ? { ...c, ...patch } : c)));
  }
  function removeCarLocal(carId: string) {
    setCars((prev) => prev.filter((c) => c.id !== carId));
    setSelectedCarId(null);
  }
  function updateCampaignLocal(campId: string, patch: Partial<Campaign>) {
    setCampaigns((prev) => prev.map((c) => (c.id === campId ? { ...c, ...patch } : c)));
  }

  const selected = selectedCarId ? cars.find((c) => c.id === selectedCarId) ?? null : null;

  if (loading) {
    return (
      <div className="body-grid">
        <main className="main">
          <p className="text-sm" style={{ color: "var(--tr-text-dim)" }}>
            Carregando…
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="body-grid">
      {/* ---------------- Lateral: lista mestre (porte exato do renderSidebar do artefato) ---------------- */}
      {/* .sidebar no artefato assume uma .topbar de 110px acima (top:110px,
          height:calc(100vh - 110px)) — este layout ainda não tem essa
          topbar/nav-rail global (fica pra Fase 6 seguinte), então
          sobrescrevemos aqui pra não deixar um vão vazio no topo. */}
      <aside className="sidebar" style={{ top: 0, height: "100vh" }}>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <SyncStatusLine lastSyncAt={lastSyncAt} syncing={syncing} syncError={syncError} />
          <AtualizarAgoraButton syncing={syncing} onClick={sincronizarAgora} idleLabel="↻ Atualizar" />
        </div>
        {siteAtivo && (
          <div className="panel add-car">
            <div className="ttl">Estoque do site</div>
            <div style={{ fontSize: 13, color: "var(--tr-text-dim)", lineHeight: 1.4 }}>
              Os carros vêm sozinhos do site.{" "}
              {syncEstoque.rodando
                ? "Atualizando…"
                : syncEstoque.erro
                  ? `Não atualizou: ${syncEstoque.erro}`
                  : syncEstoque.quando
                    ? `Atualizado às ${syncEstoque.quando.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`
                    : ""}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button className="btn" onClick={atualizarEstoque} disabled={syncEstoque.rodando}>
                ↻ Atualizar estoque
              </button>
              <Link className="btn" href="/patio/auditoria">Auditoria: pátio × anúncios</Link>
              {paraConferir.length > 0 && (
                <button
                  className="btn btn-accent"
                  onClick={() => {
                    setSelectedCarId(null);
                    setVendoConferir(true);
                  }}
                >
                  Conferir {paraConferir.length}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setMostrarCadastroManual((v) => !v)}
              style={{ all: "unset", cursor: "pointer", fontSize: 12, color: "var(--tr-text-dim)", textDecoration: "underline" }}
            >
              {mostrarCadastroManual ? "Fechar cadastro manual" : "Cadastrar carro fora do site"}
            </button>
          </div>
        )}
        {(!siteAtivo || mostrarCadastroManual) && (
        <div className="panel add-car">
          <div className="ttl">{siteAtivo ? "Carro fora do site" : "Novo carro"}</div>
          <input
            placeholder="Modelo (ex: Rampage Laramie)"
            value={novoModelo}
            onChange={(e) => setNovoModelo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && adicionarCarro()}
          />
          <input
            className="plate"
            placeholder="Placa (ex: ABC1D23)"
            value={novaPlaca}
            onChange={(e) => setNovaPlaca(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && adicionarCarro()}
          />
          <button className="btn btn-accent" onClick={adicionarCarro} disabled={criando || !novoModelo.trim()}>
            + Adicionar carro
          </button>
        </div>
        )}

        {semCarroCount > 0 && (
          <div className="unassigned-callout">
            <span>
              {semCarroCount} campanha{semCarroCount === 1 ? "" : "s"} ainda sem carro
            </span>
          </div>
        )}

        <input
          placeholder="Buscar carro…"
          value={sidebarSearch}
          onChange={(e) => setSidebarSearch(e.target.value)}
          style={{ background: "var(--tr-surface-2)", border: "1px solid var(--tr-border)", borderRadius: 7, padding: "8px 10px", color: "var(--tr-text)", fontSize: 13.5 }}
        />

        <div className="car-list">
          <div
            className={`car-card overview-card${selectedCarId === null && !vendoConferir ? " active" : ""}`}
            onClick={() => {
              setSelectedCarId(null);
              setVendoConferir(false);
            }}
          >
            <div className="modelo">📊 Visão geral</div>
            <div className="placa" style={{ border: "none", padding: 0, fontFamily: "inherit", letterSpacing: "normal", textTransform: "none" }}>
              Todos os carros lado a lado
            </div>
          </div>

          {sidebarList.length === 0 ? (
            <div className="empty-state">Nenhum carro encontrado.</div>
          ) : (
            sidebarList.map((item) => {
              const active = item.car.id === selectedCarId;
              return (
                <div
                  key={item.car.id}
                  className={`car-card${active ? " active" : ""}`}
                  onClick={() => {
                    setSelectedCarId(item.car.id);
                    setVendoConferir(false);
                  }}
                >
                  <div className="modelo">
                    {item.car.modelo || "(sem modelo)"}
                    {item.car.status === "vendido" && (
                      <span className="badge status-vendido" style={{ marginLeft: 6 }}>
                        Vendido
                      </span>
                    )}
                  </div>
                  <div className="placa">{item.car.placa || "—"}</div>
                  {siteAtivo && (
                    <div style={{ fontSize: 11.5, color: "var(--tr-text-dim)", marginTop: 2 }}>
                      {item.car.site_vehicle_id
                        ? item.car.site_status === "sold"
                          ? "Site · vendido"
                          : item.car.site_status === "unavailable"
                            ? "Site · indisponível"
                            : `Site · ${item.car.preco_site ? formatBRL(Number(item.car.preco_site)) : "à venda"}`
                        : "Fora do site"}
                    </div>
                  )}
                  <div className="foot">
                    <span className="gasto num">{formatBRL(item.tot.gasto)}</span>
                    <span className="count" style={{ color: item.campCount === 0 ? "var(--tr-bad)" : undefined }}>
                      {item.campCount} campanha(s)
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* ---------------- Conteúdo principal ---------------- */}
      <main className="main">
        {selected ? (
          <CarroDetalhe
            key={selected.id}
            car={selected}
            campaigns={campaigns}
            aggByCampaign={aggByCampaign}
            onUpdateCar={updateCarLocal}
            onDeleteCar={removeCarLocal}
            onUpdateCampaign={updateCampaignLocal}
            onVoltar={() => setSelectedCarId(null)}
            supabase={supabase}
          />
        ) : vendoConferir && accId ? (
          <ConferirLigacoes
            itens={paraConferir}
            cars={cars}
            accId={accId}
            supabase={supabase}
            onFeito={async () => {
              await carregar();
            }}
            onVoltar={() => setVendoConferir(false)}
          />
        ) : (
          <VisaoGeral computed={computed} computedById={computedById} onSelect={setSelectedCarId} />
        )}
      </main>
    </div>
  );
}

// ============================================================================
// Visão geral — a tabela comparativa completa (era o conteúdo integral da
// página antes desta reescrita), agora renderizada inline em vez de ser a
// página inteira.
// ============================================================================

function VisaoGeral({
  computed,
  onSelect,
}: {
  computed: Array<{
    car: Car;
    campCount: number;
    tot: { gasto: number; resultados: number };
    fin: {
      impostoMeta: number;
      custoComImposto: number;
      tipoNegocio: string;
      valorNegocio: number;
      margemLucro: number;
      margemAposAnuncio: number;
      roas: number | null;
    };
    vendPrincipal: { nome: string; gasto: number; resultados: number } | null;
    objPrincipal: string | null;
  }>;
  computedById: Record<string, unknown>;
  onSelect: (id: string) => void;
}) {
  const [status, setStatus] = useState<"todos" | "estoque" | "vendido">("todos");
  const [search, setSearch] = useState("");
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("nome_asc");

  const total = computed.length;
  const estoqueCount = computed.filter((i) => i.car.status !== "vendido").length;
  const vendidoCount = computed.filter((i) => i.car.status === "vendido").length;
  const semCampCount = computed.filter((i) => i.campCount === 0).length;

  const emEstoque = computed.filter((i) => i.car.status !== "vendido");
  const maiorGasto = emEstoque.slice().sort((a, b) => b.tot.gasto - a.tot.gasto)[0] || null;
  const comResultado = emEstoque.filter((i) => i.tot.resultados > 0);
  const maiorCusto = comResultado.slice().sort((a, b) => b.tot.gasto / b.tot.resultados - a.tot.gasto / a.tot.resultados)[0] || null;
  const comRoas = emEstoque.filter((i) => i.fin.roas !== null);
  const maiorRoas = comRoas.slice().sort((a, b) => (b.fin.roas ?? 0) - (a.fin.roas ?? 0))[0] || null;

  const list = useMemo(() => {
    const term = search.toLowerCase();
    const filtered = computed.filter((item) => {
      if (status === "estoque" && item.car.status === "vendido") return false;
      if (status === "vendido" && item.car.status !== "vendido") return false;
      if (onlyEmpty && item.campCount > 0) return false;
      if (term) {
        const inModelo = (item.car.modelo || "").toLowerCase().includes(term);
        const inPlaca = (item.car.placa || "").toLowerCase().includes(term);
        if (!inModelo && !inPlaca) return false;
      }
      return true;
    });
    return filtered.slice().sort((a, b) => {
      if (sortBy === "gasto_desc") return b.tot.gasto - a.tot.gasto;
      if (sortBy === "gasto_asc") return a.tot.gasto - b.tot.gasto;
      if (sortBy === "resultados_desc") return b.tot.resultados - a.tot.resultados;
      if (sortBy === "custo_desc") {
        const ca = a.tot.resultados > 0 ? a.tot.gasto / a.tot.resultados : -1;
        const cb = b.tot.resultados > 0 ? b.tot.gasto / b.tot.resultados : -1;
        return cb - ca;
      }
      if (sortBy === "valor_desc") return b.fin.valorNegocio - a.fin.valorNegocio;
      if (sortBy === "margem_desc") return b.fin.margemAposAnuncio - a.fin.margemAposAnuncio;
      if (sortBy === "roas_desc") {
        const ra = a.fin.roas === null ? -Infinity : a.fin.roas;
        const rb = b.fin.roas === null ? -Infinity : b.fin.roas;
        return rb - ra;
      }
      return (a.car.modelo || a.car.placa || "").localeCompare(b.car.modelo || b.car.placa || "", "pt-BR", { sensitivity: "base" });
    });
  }, [computed, status, search, onlyEmpty, sortBy]);

  const anyFilterActive = search !== "" || sortBy !== "nome_asc" || onlyEmpty || status !== "todos";
  function clearFilters() {
    setSearch("");
    setSortBy("nome_asc");
    setOnlyEmpty(false);
    setStatus("todos");
  }

  if (computed.length === 0) {
    return (
      <div className="rounded-xl p-8 text-center" style={{ background: "var(--tr-surface)", border: "1px solid var(--tr-border)" }}>
        <p className="font-semibold mb-1">Nenhum carro cadastrado</p>
        <p className="text-sm" style={{ color: "var(--tr-text-dim)" }}>
          Cadastre um carro na lateral pra começar a acompanhar gasto, ROAS e margem por veículo.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="section-ttl" style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
        Carros cadastrados — visão completa
      </div>

      {/* Tabs de status — porte exato de .cars-status-tabs/.cars-status-tab */}
      <div className="cars-status-tabs">
        {(["todos", "estoque", "vendido"] as const).map((s) => (
          <button key={s} className={`cars-status-tab${status === s ? " on" : ""}`} onClick={() => setStatus(s)}>
            {s === "todos" ? "Todos" : s === "estoque" ? "Em estoque" : "Vendidos"}
            <span className="n">{s === "todos" ? total : s === "estoque" ? estoqueCount : vendidoCount}</span>
          </button>
        ))}
      </div>

      {/* KPIs — porte exato de .camp-mgmt-kpis / kpiBlock */}
      <div className="camp-mgmt-kpis">
        <div className="kpi click" onClick={() => setSortBy("gasto_desc")} title="Ordenar por maior gasto">
          <div className="label">Maior gasto</div>
          <div className="value num">{maiorGasto ? formatBRL(maiorGasto.tot.gasto) : "—"}</div>
          {maiorGasto && <div className="kpi-sub">{maiorGasto.car.modelo || maiorGasto.car.placa || "(sem modelo)"}</div>}
        </div>
        <div className="kpi click" onClick={() => setSortBy("custo_desc")} title="Ordenar por maior custo/mensagem">
          <div className="label">Maior custo/mensagem</div>
          <div className="value num bad">{maiorCusto ? formatBRL(maiorCusto.tot.gasto / maiorCusto.tot.resultados) : "—"}</div>
          {maiorCusto && <div className="kpi-sub">{maiorCusto.car.modelo || maiorCusto.car.placa || "(sem modelo)"}</div>}
        </div>
        <div className="kpi click" onClick={() => setOnlyEmpty((v) => !v)} title="Ver só as sem campanha vinculada">
          <div className="label">Sem campanha vinculada</div>
          <div className={`value${semCampCount > 0 ? " bad" : ""}`}>{semCampCount}</div>
        </div>
        <div className="kpi click" onClick={() => setSortBy("roas_desc")} title="Ordenar por maior ROAS">
          <div className="label">Maior ROAS</div>
          <div className="value num good">{maiorRoas && maiorRoas.fin.roas !== null ? maiorRoas.fin.roas.toFixed(1) + "x" : "—"}</div>
          {maiorRoas && <div className="kpi-sub">{maiorRoas.car.modelo || maiorRoas.car.placa || "(sem modelo)"}</div>}
        </div>
      </div>

      {/* Toolbar + filtros — porte exato de .toolbar/.chip-toggle/.filter-row */}
      <div className="toolbar">
        <input className="search" placeholder="Buscar carro por modelo ou placa…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="filters">
          <button className={`chip-toggle${onlyEmpty ? " on" : ""}`} onClick={() => setOnlyEmpty((v) => !v)}>
            Só sem campanhas vinculadas
          </button>
        </div>
      </div>
      <div className="filter-row">
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
          <option value="nome_asc">Nome (A-Z)</option>
          <option value="gasto_desc">Maior gasto</option>
          <option value="gasto_asc">Menor gasto</option>
          <option value="resultados_desc">Mais mensagens</option>
          <option value="custo_desc">Maior custo/mensagem</option>
          <option value="valor_desc">Maior valor de negócio</option>
          <option value="margem_desc">Maior margem após tráfego</option>
          <option value="roas_desc">Maior ROAS</option>
        </select>
        {anyFilterActive && (
          <button className="clear-link" onClick={clearFilters}>
            Limpar filtros
          </button>
        )}
      </div>

      <div className="result-count">
        {list.length} de {total} carro(s)
      </div>

      {list.length === 0 ? (
        <div className="empty-state">Nenhum carro encontrado com esses filtros.</div>
      ) : (
        <div className="vendtable-wrap cars-table-wrap">
          <table className="vendtable cars-full-table">
            <thead>
              <tr>
                <th>Carro</th>
                <th>Status</th>
                <th>Negócio</th>
                <th className="num">Valor negócio</th>
                <th className="num">Gasto tráfego</th>
                <th className="num">Imposto (12%)</th>
                <th className="num">Custo c/ imposto</th>
                <th className="num">Margem lucro</th>
                <th className="num">Margem após tráfego</th>
                <th className="num">ROAS</th>
                <th className="num">Mensagens</th>
                <th className="num">Custo/mensagem</th>
                <th>Vendedor principal</th>
                <th>Objetivo principal</th>
                <th className="num">Campanhas</th>
              </tr>
            </thead>
            <tbody>
              {list.map((item) => {
                const { car, tot, fin } = item;
                const custo = tot.resultados > 0 ? formatBRL(tot.gasto / tot.resultados) : "—";
                return (
                  <tr key={car.id} className={`clickable-row${car.status === "vendido" ? " cars-row-vendido" : ""}`} onClick={() => onSelect(car.id)}>
                    <td className="nomecell">
                      {car.modelo || "(sem modelo)"}{" "}
                      <span style={{ color: "var(--tr-text-dim)", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{car.placa || "—"}</span>
                    </td>
                    <td>{car.status === "vendido" ? <span className="badge status-vendido">Vendido</span> : <span className="badge status-estoque">Em estoque</span>}</td>
                    <td>{fin.tipoNegocio === "troca" ? "Troca" : "Venda"}</td>
                    <td className="num">{formatBRL(fin.valorNegocio)}</td>
                    <td className="num">{formatBRL(tot.gasto)}</td>
                    <td className="num">{formatBRL(fin.impostoMeta)}</td>
                    <td className="num">{formatBRL(fin.custoComImposto)}</td>
                    <td className="num">{formatBRL(fin.margemLucro)}</td>
                    <td className={`num ${fin.margemAposAnuncio >= 0 ? "good" : "bad"}`}>{formatBRL(fin.margemAposAnuncio)}</td>
                    <td className="num">{fin.roas !== null ? fin.roas.toFixed(1) + "x" : "—"}</td>
                    <td className="num">{tot.resultados}</td>
                    <td className="num">{custo}</td>
                    <td>
                      {item.vendPrincipal ? (
                        <>
                          {item.vendPrincipal.nome} <span style={{ color: "var(--tr-text-dim)" }}>({item.vendPrincipal.resultados} msg.)</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{item.objPrincipal ?? "—"}</td>
                    <td className="num">
                      {item.campCount}
                      {item.campCount === 0 && <span className="warn"> · sem camp.</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ============================================================================
// Detalhe do carro — inline (ex-carros/[id]/page.tsx), mesma lógica, mas
// operando sobre o estado já carregado pela página pai (sem fetch próprio,
// sem trocar de URL). Header, KPIs, Dados do negócio, Mensagens por
// vendedor, Campanhas.
// ============================================================================

function CarroDetalhe({
  car,
  campaigns,
  aggByCampaign,
  onUpdateCar,
  onDeleteCar,
  onUpdateCampaign,
  onVoltar,
  supabase,
}: {
  car: Car;
  campaigns: Campaign[];
  aggByCampaign: Record<string, Agg>;
  onUpdateCar: (carId: string, patch: Partial<Car>) => void;
  onDeleteCar: (carId: string) => void;
  onUpdateCampaign: (campId: string, patch: Partial<Campaign>) => void;
  onVoltar: () => void;
  supabase: ReturnType<typeof createClient>;
}) {
  const carId = car.id;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [modeloDraft, setModeloDraft] = useState(car.modelo || "");
  const [placaDraft, setPlacaDraft] = useState(car.placa || "");

  const [searchTerm, setSearchTerm] = useState("");
  const [filterTipo, setFilterTipo] = useState("todos");
  const [filterVendedor, setFilterVendedor] = useState("");
  const [sortBy, setSortBy] = useState<DetalheSortKey>("relevancia");
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);

  useEffect(() => {
    // Mesmo comportamento do painel antigo: ao trocar de carro, reinicia os rascunhos.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModeloDraft(car.modelo || "");
    setPlacaDraft(car.placa || "");
    setConfirmDelete(false);
  }, [car.id, car.modelo, car.placa]);

  async function saveField(field: keyof Car, value: string | number | null) {
    onUpdateCar(carId, { [field]: value } as Partial<Car>);
    await supabase.from("veiculos").update({ [field]: value }).eq("id", carId);
  }

  async function toggleVendido() {
    const novo = car.status === "vendido" ? "estoque" : "vendido";
    onUpdateCar(carId, { status: novo });
    await supabase.from("veiculos").update({ status: novo }).eq("id", carId);
  }

  async function excluirCarro() {
    await supabase.from("veiculos").delete().eq("id", carId);
    onDeleteCar(carId);
  }

  async function toggleCampanha(campId: string, checked: boolean) {
    onUpdateCampaign(campId, { car_id: checked ? carId : null, categoria_objetivo: checked ? null : undefined });
    if (checked) {
      await supabase.from("tr_campaigns").update({ car_id: carId, categoria_objetivo: null }).eq("id", campId);
    } else {
      await supabase.from("tr_campaigns").update({ car_id: null }).eq("id", campId);
    }
  }

  async function setVendedorOverride(campId: string, value: string) {
    const v = value.trim();
    onUpdateCampaign(campId, { vendedor_override: v });
    await supabase.from("tr_campaigns").update({ vendedor_override: v }).eq("id", campId);
  }

  const carCampaigns = useMemo(() => campaigns.filter((c) => c.car_id === carId), [campaigns, carId]);

  const tot = useMemo(() => {
    let gasto = 0;
    let resultados = 0;
    for (const c of carCampaigns) {
      const a = aggByCampaign[c.id] || EMPTY_AGG;
      gasto += a.gasto;
      resultados += resultadosOf(a);
    }
    return { gasto, resultados };
  }, [carCampaigns, aggByCampaign]);

  const custoMedio = tot.resultados > 0 ? tot.gasto / tot.resultados : null;
  const impostoMeta = tot.gasto * META_TAX;
  const custoComImposto = tot.gasto + impostoMeta;
  const tipoNegocio = car.tipo_negocio || "venda";
  const precoVenda = Number(car.valor_venda) || 0;
  const valorTroca = Number(car.valor_troca) || 0;
  const valorVolta = Number(car.valor_volta) || 0;
  const margemLucro = Number(car.margem_lucro) || 0;
  const valorNegocio = tipoNegocio === "troca" ? valorTroca + valorVolta : precoVenda;
  const margemAposAnuncio = margemLucro - custoComImposto;

  const vendStats = useMemo(() => {
    const out: Record<string, { gasto: number; resultados: number }> = {};
    for (const c of carCampaigns) {
      const a = aggByCampaign[c.id] || EMPTY_AGG;
      const v = vendedorLabel(vendedorOf(c));
      if (!out[v]) out[v] = { gasto: 0, resultados: 0 };
      out[v].gasto += a.gasto;
      out[v].resultados += resultadosOf(a);
    }
    return out;
  }, [carCampaigns, aggByCampaign]);
  const vendNames = Object.keys(vendStats).sort((a, b) => vendStats[b].gasto - vendStats[a].gasto);

  const allTipos = useMemo(() => {
    const s = new Set<string>();
    for (const c of campaigns) s.add(tipoOf(aggByCampaign[c.id] || EMPTY_AGG));
    return Array.from(s).sort();
  }, [campaigns, aggByCampaign]);
  const allVendedores = useMemo(() => {
    const s = new Set<string>();
    for (const c of campaigns) {
      const v = vendedorOf(c);
      if (v) s.add(v);
    }
    return Array.from(s).sort();
  }, [campaigns]);

  const anyFilterActive = filterTipo !== "todos" || filterVendedor !== "" || sortBy !== "relevancia" || onlyUnassigned || searchTerm !== "";
  function clearFilters() {
    setFilterTipo("todos");
    setFilterVendedor("");
    setSortBy("relevancia");
    setOnlyUnassigned(false);
    setSearchTerm("");
  }

  const list = useMemo(() => {
    const term = searchTerm.toLowerCase();
    const filtered = campaigns.filter((c) => {
      if (term) {
        const inNome = c.nome.toLowerCase().includes(term);
        const inVend = (vendedorOf(c) || "").toLowerCase().includes(term);
        if (!inNome && !inVend) return false;
      }
      if (onlyUnassigned && c.car_id && c.car_id !== carId) return false;
      if (filterTipo !== "todos" && tipoOf(aggByCampaign[c.id] || EMPTY_AGG) !== filterTipo) return false;
      if (filterVendedor && vendedorOf(c) !== filterVendedor) return false;
      return true;
    });
    return filtered.slice().sort((a, b) => {
      const aggA = aggByCampaign[a.id] || EMPTY_AGG;
      const aggB = aggByCampaign[b.id] || EMPTY_AGG;
      if (sortBy === "gasto_desc") return aggB.gasto - aggA.gasto;
      if (sortBy === "gasto_asc") return aggA.gasto - aggB.gasto;
      if (sortBy === "resultados_desc") return resultadosOf(aggB) - resultadosOf(aggA);
      if (sortBy === "nome_asc") return a.nome.localeCompare(b.nome);
      const aChecked = a.car_id === carId;
      const bChecked = b.car_id === carId;
      if (aChecked !== bChecked) return aChecked ? -1 : 1;
      return aggB.gasto - aggA.gasto;
    });
  }, [campaigns, searchTerm, onlyUnassigned, filterTipo, filterVendedor, sortBy, aggByCampaign, carId]);

  return (
    <div>
      <button className="btn btn-ghost btn-sm" style={{ marginBottom: 14 }} onClick={onVoltar}>
        ← Visão geral
      </button>

      {/* Header editável — porte exato de .car-header */}
      <div className="car-header">
        <div className="fields">
          <input
            className="modelo-field"
            value={modeloDraft}
            onChange={(e) => setModeloDraft(e.target.value)}
            onBlur={() => saveField("modelo", modeloDraft)}
            placeholder="Modelo"
          />
          <input
            className="plate-field"
            value={placaDraft}
            onChange={(e) => setPlacaDraft(e.target.value.toUpperCase())}
            onBlur={() => saveField("placa", placaDraft)}
            placeholder="PLACA"
          />
          {car.status === "vendido" && <span className="badge status-vendido">Vendido</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={car.status === "vendido" ? "btn btn-ghost btn-sm" : "btn btn-accent btn-sm"} onClick={toggleVendido}>
            {car.status === "vendido" ? "↺ Marcar como em estoque" : "✔ Marcar como vendido"}
          </button>
          {!confirmDelete ? (
            <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>
              Remover carro
            </button>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
              <span style={{ color: "var(--tr-text-dim)" }}>Confirma remover?</span>
              <button className="btn btn-danger btn-sm" onClick={excluirCarro}>
                Sim, remover
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* KPIs — porte exato de .detail-kpis */}
      <div className="detail-kpis">
        <div className="kpi">
          <div className="label">Gasto total (tráfego)</div>
          <div className="value accent">{formatBRL(tot.gasto)}</div>
        </div>
        <div className="kpi tax">
          <div className="label">Imposto META (12%)</div>
          <div className="value">{formatBRL(impostoMeta)}</div>
        </div>
        <div className="kpi">
          <div className="label">Custo total c/ imposto</div>
          <div className="value">{formatBRL(custoComImposto)}</div>
        </div>
        <div className="kpi">
          <div className="label">Mensagens (conversas/leads)</div>
          <div className="value">{tot.resultados}</div>
        </div>
        <div className="kpi">
          <div className="label">Custo por mensagem</div>
          <div className="value">{custoMedio !== null ? formatBRL(custoMedio) : "—"}</div>
        </div>
      </div>

      {/* Dados do negócio — porte exato de .panel.deal-panel */}
      <div className="panel deal-panel">
        <div className="ttl">Dados do negócio</div>
        <div className="deal-tabs">
          {(["venda", "troca"] as const).map((t) => (
            <button
              key={t}
              className={`chip-toggle${tipoNegocio === t ? " on" : ""}`}
              onClick={() => saveField("tipo_negocio", t)}
            >
              {t === "venda" ? "Venda" : "Troca"}
            </button>
          ))}
        </div>
        <div className="deal-grid">
          {tipoNegocio === "troca" ? (
            <>
              <Field label="Veículo recebido na troca">
                <input
                  defaultValue={car.veiculo_troca ?? ""}
                  placeholder="ex: Fiat Uno 2015"
                  onBlur={(e) => saveField("veiculo_troca", e.target.value)}
                />
              </Field>
              <Field label="Valor da troca (R$)">
                <input
                  type="number"
                  step="0.01"
                  defaultValue={valorTroca}
                  onBlur={(e) => saveField("valor_troca", Number(e.target.value) || 0)}
                />
              </Field>
              <Field label="Valor da volta (R$)">
                <input
                  type="number"
                  step="0.01"
                  defaultValue={valorVolta}
                  onBlur={(e) => saveField("valor_volta", Number(e.target.value) || 0)}
                />
              </Field>
            </>
          ) : (
            <Field label="Preço de venda (R$)">
              <input
                type="number"
                step="0.01"
                defaultValue={precoVenda}
                onBlur={(e) => saveField("valor_venda", Number(e.target.value) || 0)}
              />
            </Field>
          )}
          <Field label="Margem de lucro (R$)">
            <input
              type="number"
              step="0.01"
              defaultValue={margemLucro}
              onBlur={(e) => saveField("margem_lucro", Number(e.target.value) || 0)}
            />
          </Field>
        </div>
        <div className="deal-summary">
          <span>
            Valor do negócio: <b>{formatBRL(valorNegocio)}</b>
          </span>
          <span>
            Custo tráfego c/ imposto: <b className="bad">{formatBRL(custoComImposto)}</b>
          </span>
          <span>
            Margem após tráfego (estimada): <b className={margemAposAnuncio >= 0 ? "good" : "bad"}>{formatBRL(margemAposAnuncio)}</b>
          </span>
        </div>
      </div>

      {/* Mensagens por vendedor — porte exato de .section-ttl + .vendtable-wrap */}
      <div className="section-ttl">Mensagens por vendedor</div>
      {vendNames.length === 0 ? (
        <div className="empty-state">Nenhuma campanha atribuída a esse carro ainda.</div>
      ) : (
        <div className="vendtable-wrap">
          <table className="vendtable">
            <thead>
              <tr>
                <th>Vendedor</th>
                <th className="num">Mensagens</th>
                <th className="num">Gasto</th>
                <th className="num">Custo/mensagem</th>
              </tr>
            </thead>
            <tbody>
              {vendNames.map((v) => {
                const d = vendStats[v];
                const custo = d.resultados > 0 ? d.gasto / d.resultados : null;
                return (
                  <tr key={v}>
                    <td className="nomecell">{v}</td>
                    <td className="num">{d.resultados}</td>
                    <td className="num">{formatBRL(d.gasto)}</td>
                    <td className="num">{custo !== null ? formatBRL(custo) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Campanhas — porte exato de .section-ttl + .toolbar/.filter-row + .camp-list/.camp-row */}
      <div className="section-ttl">Campanhas</div>
      <div className="toolbar">
        <input className="search" placeholder="Buscar campanha por nome ou vendedor…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        <div className="filters">
          <button className={`chip-toggle${onlyUnassigned ? " on" : ""}`} onClick={() => setOnlyUnassigned((v) => !v)}>
            Só não atribuídas
          </button>
        </div>
      </div>
      <div className="filter-row">
        <select value={filterTipo} onChange={(e) => setFilterTipo(e.target.value)}>
          <option value="todos">Todos os tipos</option>
          {allTipos.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={filterVendedor} onChange={(e) => setFilterVendedor(e.target.value)}>
          <option value="">Todos os vendedores</option>
          {allVendedores.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as DetalheSortKey)}>
          <option value="relevancia">Ordenar: relevância</option>
          <option value="gasto_desc">Maior gasto</option>
          <option value="gasto_asc">Menor gasto</option>
          <option value="resultados_desc">Mais mensagens</option>
          <option value="nome_asc">Nome (A-Z)</option>
        </select>
        {anyFilterActive && (
          <button className="clear-link" onClick={clearFilters}>
            Limpar filtros
          </button>
        )}
      </div>
      <div className="result-count">{list.length} campanha(s)</div>

      {list.length === 0 ? (
        <div className="empty-state">Nenhuma campanha encontrada com esses filtros.</div>
      ) : (
        <div className="camp-list">
          {list.map((camp) => {
            const checked = camp.car_id === carId;
            const other = camp.car_id && camp.car_id !== carId ? camp.car_id : null;
            const a = aggByCampaign[camp.id] || EMPTY_AGG;
            const tipo = tipoOf(a);
            const v = vendedorOf(camp);
            const badgeCls = tipo === "WhatsApp" ? "wa" : tipo === "Lead site" ? "lead" : "none";
            return (
              <label key={camp.id} className={`camp-row${checked ? " checked" : ""}`}>
                <input type="checkbox" checked={checked} onChange={(e) => toggleCampanha(camp.id, e.target.checked)} />
                <div style={{ minWidth: 0 }}>
                  <div className="nomecell" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={camp.nome}>
                    {camp.nome}
                  </div>
                  {other && (
                    <div style={{ fontSize: 11, color: "var(--tr-text-dim)" }}>também vinculada a outro carro</div>
                  )}
                </div>
                <span className={`badge ${badgeCls}`}>{tipo}</span>
                <input
                  defaultValue={v || ""}
                  placeholder="—"
                  title="Editar vendedor"
                  className="vendedor-edit"
                  onClick={(e) => e.preventDefault()}
                  onBlur={(e) => setVendedorOverride(camp.id, e.target.value)}
                />
                <span className="gasto">{formatBRL(a.gasto)}</span>
                <span className="res">{resultadosOf(a)} res.</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="deal-field">
      {label}
      {children}
    </label>
  );
}

// ============================================================================
// Conferir ligações — carros do site que parecem já existir no painel com outro
// nome ou placa digitada diferente. Nada é ligado sozinho nesses casos.
// ============================================================================

function ConferirLigacoes({
  itens,
  cars,
  accId,
  supabase,
  onFeito,
  onVoltar,
}: {
  itens: Array<{ v: VeiculoSite; cand: ReturnType<typeof candidatoNoPainel> }>;
  cars: Car[];
  accId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  onFeito: () => Promise<void>;
  onVoltar: () => void;
}) {
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const livres = cars.filter((c) => !c.site_vehicle_id).sort((a, b) => (a.modelo || "").localeCompare(b.modelo || "", "pt-BR"));

  function camposSite(v: VeiculoSite) {
    return {
      nome_site: v.nome,
      modelo_site: v.modelo,
      preco_site: v.preco,
      site_status: v.status,
      foto_url: v.foto,
      sincronizado_em: new Date().toISOString(),
    };
  }

  async function ligar(v: VeiculoSite, carId: string) {
    setSalvando(v.id);
    setErro(null);
    const patch: Record<string, unknown> = { site_vehicle_id: v.id, ...camposSite(v) };
    const atual = cars.find((c) => c.id === carId);
    if (v.status === "sold" && atual?.status !== "vendido") patch.status = "vendido";
    const { error } = await supabase.from("veiculos").update(patch).eq("id", carId);
    setSalvando(null);
    if (error) return setErro(error.message);
    await onFeito();
  }

  async function criar(v: VeiculoSite) {
    setSalvando(v.id);
    setErro(null);
    const base = (v.placa || "").toUpperCase().replace(/[^A-Z0-9]/g, "") || `SITE-${v.id.slice(0, 8).toUpperCase()}`;
    const usada = cars.some((c) => (c.placa || "").toUpperCase() === base);
    const { error } = await supabase.from("veiculos").insert({
      org_id: accId,
      placa: usada ? `${base}-${v.id.slice(0, 4).toUpperCase()}` : base,
      modelo: v.nome || v.modelo || "Carro do site",
      ano: v.ano,
      status: v.status === "sold" ? "vendido" : "estoque",
      origem: "site",
      site_vehicle_id: v.id,
      ...camposSite(v),
    });
    setSalvando(null);
    if (error) return setErro(error.message);
    await onFeito();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22 }}>Conferir carros do site</h2>
          <p style={{ margin: "6px 0 0", color: "var(--tr-text-dim)", fontSize: 14, maxWidth: 720 }}>
            Estes carros do site parecem já existir no painel com outro nome ou placa. Se for o mesmo, ligue: as campanhas e custos que já
            estão nele passam a contar para o carro do site. Se não for, crie um carro novo.
          </p>
        </div>
        <button className="btn" onClick={onVoltar}>
          ← Voltar
        </button>
      </div>
      {erro && <div style={{ color: "var(--tr-bad)", fontSize: 14 }}>Não salvou: {erro}</div>}
      {itens.length === 0 && <div className="empty-state">Nada para conferir. Todos os carros do site estão ligados.</div>}
      {itens.map(({ v, cand }) => {
        const sel = escolha[v.id] ?? cand?.car.id ?? "";
        return (
          <div key={v.id} className="panel" style={{ padding: 14, display: "grid", gridTemplateColumns: "72px 1fr", gap: 14, alignItems: "start" }}>
            {v.foto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.foto} alt="" style={{ width: 72, height: 54, objectFit: "cover", borderRadius: 6 }} />
            ) : (
              <div style={{ width: 72, height: 54, borderRadius: 6, background: "var(--tr-surface-2)" }} />
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div>
                <b>{v.nome}</b> {v.anoTexto}
                <span style={{ color: "var(--tr-text-dim)" }}>
                  {" "}
                  · placa no site {v.placa || "—"} · {v.status === "sold" ? "vendido" : v.status === "unavailable" ? "indisponível" : v.preco ? formatBRL(v.preco) : "à venda"}
                </span>
              </div>
              {cand && <div style={{ fontSize: 13, color: "var(--tr-text-dim)" }}>Parecido no painel: {cand.motivo}.</div>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  value={sel}
                  onChange={(e) => setEscolha((x) => ({ ...x, [v.id]: e.target.value }))}
                  style={{ background: "var(--tr-surface-2)", border: "1px solid var(--tr-border)", borderRadius: 7, padding: "7px 9px", color: "var(--tr-text)", maxWidth: 360 }}
                  aria-label={`Carro do painel para ${v.nome}`}
                >
                  <option value="">Escolher carro do painel…</option>
                  {livres.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.modelo} · {c.placa}
                      {c.status === "vendido" ? " · vendido" : ""}
                    </option>
                  ))}
                </select>
                <button className="btn btn-accent" disabled={!sel || salvando === v.id} onClick={() => ligar(v, sel)}>
                  É o mesmo — ligar
                </button>
                <button className="btn" disabled={salvando === v.id} onClick={() => criar(v)}>
                  É outro carro — criar
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
