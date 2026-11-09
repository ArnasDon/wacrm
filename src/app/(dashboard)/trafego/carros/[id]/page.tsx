"use client";

import Link from "next/link";

// Ficha individual do carro (Fase 3.4) — paridade total com a tela de
// detalhe do Artifact original: header editável, KPIs, painel "Dados do
// negócio" (abas Venda/Troca), tabela "mensagens por vendedor" e a lista de
// campanhas com busca/filtro/sort e checkbox de vínculo (marcar/desmarcar
// vincula/desvincula a campanha deste carro — vínculo é sempre um único
// carro por campanha, marcar aqui limpa qualquer categoria de objetivo que
// a campanha tivesse, mesma regra da tela de Campanhas).

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { orgIdAtual } from "@/lib/trafego/org";
import { formatBRL, META_TAX } from "@/lib/trafego/format";
import { vendedorOf, vendedorLabel } from "@/lib/trafego/vendedorOf";
import { fetchAll } from "@/lib/trafego/fetchAll";

type Car = {
  id: string;
  placa: string;
  modelo: string;
  status: "estoque" | "vendido";
  valor_venda: number | null;
  tipo_negocio: "venda" | "troca" | null;
  veiculo_troca: string | null;
  valor_troca: number | null;
  valor_volta: number | null;
  margem_lucro: number | null;
  site_vehicle_id: string | null;
};

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
function resultadosOf(agg: Agg): number {
  return agg.msgs > 0 ? agg.msgs : agg.leads > 0 ? agg.leads : 0;
}
function tipoOf(agg: Agg): "WhatsApp" | "Lead site" | "Sem resultado" {
  if (agg.msgs > 0) return "WhatsApp";
  if (agg.leads > 0) return "Lead site";
  return "Sem resultado";
}

type SortKey = "relevancia" | "gasto_desc" | "gasto_asc" | "resultados_desc" | "nome_asc";

const selectStyle: React.CSSProperties = { background: "var(--tr-surface-2)", border: "1px solid var(--tr-border)", color: "var(--tr-text)" };

export default function CarroDetalhePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const carId = params.id;

  const [car, setCar] = useState<Car | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [aggByCampaign, setAggByCampaign] = useState<Record<string, Agg>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [modeloDraft, setModeloDraft] = useState("");
  const [placaDraft, setPlacaDraft] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [filterTipo, setFilterTipo] = useState("todos");
  const [filterVendedor, setFilterVendedor] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("relevancia");
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);

  async function carregar() {
    setLoading(true);
    const accId = await orgIdAtual(supabase);
    if (!accId) {
      setLoading(false);
      return;
    }
    const [{ data: carData }, { data: campaignsData }, { data: metricsData }] = await Promise.all([
      supabase
        .from("veiculos")
        .select("id, placa, modelo, status, valor_venda, tipo_negocio, veiculo_troca, valor_troca, valor_volta, margem_lucro, site_vehicle_id")
        .eq("org_id", accId)
        .eq("id", carId)
        .maybeSingle(),
      supabase.from("tr_campaigns").select("id, nome, objetivo, car_id, categoria_objetivo, vendedor_override").eq("org_id", accId),
      fetchAll((de, ate) => supabase.from("tr_campaign_metrics_daily").select("campaign_id, gasto, msgs, leads, purchases").eq("org_id", accId).order("id").range(de, ate)),
    ]);

    if (!carData) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setCar(carData as Car);
    setModeloDraft((carData as Car).modelo || "");
    setPlacaDraft((carData as Car).placa || "");
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
  }, [carId]);

  async function saveField(field: keyof Car, value: string | number | null) {
    if (!car) return;
    setCar({ ...car, [field]: value } as Car);
    await supabase.from("veiculos").update({ [field]: value }).eq("id", car.id);
  }

  async function toggleVendido() {
    if (!car) return;
    const novo = car.status === "vendido" ? "estoque" : "vendido";
    setCar({ ...car, status: novo });
    await supabase.from("veiculos").update({ status: novo }).eq("id", car.id);
  }

  async function excluirCarro() {
    if (!car) return;
    await supabase.from("veiculos").delete().eq("id", car.id);
    router.push("/trafego/carros");
  }

  async function toggleCampanha(campId: string, checked: boolean) {
    if (!car) return;
    setCampaigns((prev) =>
      prev.map((c) => (c.id === campId ? { ...c, car_id: checked ? car.id : null, categoria_objetivo: checked ? null : c.categoria_objetivo } : c))
    );
    if (checked) {
      await supabase.from("tr_campaigns").update({ car_id: car.id, categoria_objetivo: null }).eq("id", campId);
    } else {
      await supabase.from("tr_campaigns").update({ car_id: null }).eq("id", campId);
    }
  }

  async function setVendedorOverride(campId: string, value: string) {
    const v = value.trim();
    setCampaigns((prev) => prev.map((c) => (c.id === campId ? { ...c, vendedor_override: v } : c)));
    await supabase.from("tr_campaigns").update({ vendedor_override: v }).eq("id", campId);
  }

  const carCampaigns = useMemo(() => (car ? campaigns.filter((c) => c.car_id === car.id) : []), [campaigns, car]);

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
  const tipoNegocio = car?.tipo_negocio || "venda";
  const precoVenda = Number(car?.valor_venda) || 0;
  const valorTroca = Number(car?.valor_troca) || 0;
  const valorVolta = Number(car?.valor_volta) || 0;
  const margemLucro = Number(car?.margem_lucro) || 0;
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
      // "só não atribuídas": esconde campanhas já vinculadas a OUTRO carro
      // (as vinculadas a este carro continuam aparecendo, marcadas).
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

  if (loading) {
    return (
      <main className="px-6 py-8 max-w-5xl mx-auto">
        <p className="text-sm" style={{ color: "var(--tr-text-dim)" }}>
          Carregando…
        </p>
      </main>
    );
  }
  if (notFound || !car) {
    return (
      <main className="px-6 py-8 max-w-5xl mx-auto">
        <p className="text-sm mb-4" style={{ color: "var(--tr-text-dim)" }}>
          Carro não encontrado.
        </p>
        <button className="text-sm underline" style={{ color: "var(--tr-gold-2)" }} onClick={() => router.push("/trafego/carros")}>
          ← Voltar pra lista de carros
        </button>
      </main>
    );
  }

  return (
    <main className="px-6 py-8 max-w-5xl mx-auto">
      <button className="text-xs mb-4 underline" style={{ color: "var(--tr-text-dim)" }} onClick={() => router.push("/trafego/carros")}>
        ← Todos os carros
      </button>

      {/* Header editável */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <input
            value={modeloDraft}
            onChange={(e) => setModeloDraft(e.target.value)}
            onBlur={() => saveField("modelo", modeloDraft)}
            placeholder="Modelo"
            className="text-xl font-bold bg-transparent outline-none gold-text"
            style={{ fontFamily: "inherit", minWidth: 160 }}
          />
          <input
            value={placaDraft}
            onChange={(e) => setPlacaDraft(e.target.value.toUpperCase())}
            onBlur={() => saveField("placa", placaDraft)}
            placeholder="PLACA"
            className="text-sm font-mono tracking-widest px-2 py-1 rounded"
            style={selectStyle}
          />
          {car.site_vehicle_id && (
            <Link href={`/patio/${car.site_vehicle_id}`} className="text-xs font-semibold px-2 py-1 rounded" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
              Abrir ficha no Pátio
            </Link>
          )}
          {car.status === "vendido" && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--az-fundo)", color: "var(--az)" }}>
              Vendido
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={toggleVendido}
            className="text-xs font-semibold px-3 py-2 rounded-md"
            style={
              car.status === "vendido"
                ? { background: "var(--tr-surface-2)", border: "1px solid var(--tr-border)", color: "var(--tr-text)" }
                : { background: "var(--tr-gold-2)", color: "var(--primary-foreground)" }
            }
          >
            {car.status === "vendido" ? "↺ Marcar como em estoque" : "✔ Marcar como vendido"}
          </button>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs font-semibold px-3 py-2 rounded-md"
              style={{ background: "var(--tr-bad-bg)", color: "var(--tr-bad)", border: "1px solid var(--tr-bad)" }}
            >
              Remover carro
            </button>
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <span style={{ color: "var(--tr-text-dim)" }}>Confirma remover?</span>
              <button onClick={excluirCarro} className="font-semibold px-2 py-1 rounded" style={{ background: "var(--tr-bad)", color: "var(--card)" }}>
                Sim, remover
              </button>
              <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 rounded" style={{ border: "1px solid var(--tr-border)", color: "var(--tr-text-dim)" }}>
                Cancelar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* KPIs */}
      <section className="grid gap-3 mb-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <KpiCard label="Gasto total (tráfego)" value={formatBRL(tot.gasto)} accent="var(--tr-gold-2)" />
        <KpiCard label="Imposto META (12%)" value={formatBRL(impostoMeta)} accent="var(--tr-warn)" />
        <KpiCard label="Custo total c/ imposto" value={formatBRL(custoComImposto)} />
        <KpiCard label="Mensagens (conversas/leads)" value={String(tot.resultados)} />
        <KpiCard label="Custo por mensagem" value={custoMedio !== null ? formatBRL(custoMedio) : "—"} />
      </section>

      {/* Dados do negócio */}
      <section className="rounded-xl p-5 mb-6" style={{ background: "var(--tr-surface)", border: "1px solid var(--tr-border)" }}>
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--tr-text-dim)" }}>
          Dados do negócio
        </h2>
        <div className="flex gap-2 mb-4">
          {(["venda", "troca"] as const).map((t) => (
            <button
              key={t}
              onClick={() => saveField("tipo_negocio", t)}
              className="text-xs font-semibold px-3 py-1.5 rounded-full"
              style={{
                background: tipoNegocio === t ? "var(--tr-gold-2)" : "var(--tr-surface-2)",
                color: tipoNegocio === t ? "var(--primary-foreground)" : "var(--tr-text-dim)",
                border: "1px solid " + (tipoNegocio === t ? "var(--tr-gold-2)" : "var(--tr-border)"),
              }}
            >
              {t === "venda" ? "Venda" : "Troca"}
            </button>
          ))}
        </div>
        <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          {tipoNegocio === "troca" ? (
            <>
              <Field label="Veículo recebido na troca">
                <input
                  defaultValue={car.veiculo_troca ?? ""}
                  placeholder="ex: Fiat Uno 2015"
                  className="px-3 py-2 rounded-md text-sm w-full"
                  style={selectStyle}
                  onBlur={(e) => saveField("veiculo_troca", e.target.value)}
                />
              </Field>
              <Field label="Valor da troca (R$)">
                <input
                  type="number"
                  step="0.01"
                  defaultValue={valorTroca}
                  className="px-3 py-2 rounded-md text-sm w-full"
                  style={selectStyle}
                  onBlur={(e) => saveField("valor_troca", Number(e.target.value) || 0)}
                />
              </Field>
              <Field label="Valor da volta (R$)">
                <input
                  type="number"
                  step="0.01"
                  defaultValue={valorVolta}
                  className="px-3 py-2 rounded-md text-sm w-full"
                  style={selectStyle}
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
                className="px-3 py-2 rounded-md text-sm w-full"
                style={selectStyle}
                onBlur={(e) => saveField("valor_venda", Number(e.target.value) || 0)}
              />
            </Field>
          )}
          <Field label="Margem de lucro (R$)">
            <input
              type="number"
              step="0.01"
              defaultValue={margemLucro}
              className="px-3 py-2 rounded-md text-sm w-full"
              style={selectStyle}
              onBlur={(e) => saveField("margem_lucro", Number(e.target.value) || 0)}
            />
          </Field>
        </div>
        <div className="flex gap-6 flex-wrap text-sm pt-3" style={{ borderTop: "1px solid var(--tr-border)" }}>
          <span>
            Valor do negócio: <b>{formatBRL(valorNegocio)}</b>
          </span>
          <span>
            Custo tráfego c/ imposto: <b style={{ color: "var(--tr-bad)" }}>{formatBRL(custoComImposto)}</b>
          </span>
          <span>
            Margem após tráfego (estimada):{" "}
            <b style={{ color: margemAposAnuncio >= 0 ? "var(--tr-good)" : "var(--tr-bad)" }}>{formatBRL(margemAposAnuncio)}</b>
          </span>
        </div>
      </section>

      {/* Mensagens por vendedor */}
      <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--tr-text-dim)" }}>
        Mensagens por vendedor
      </h2>
      {vendNames.length === 0 ? (
        <p className="text-sm mb-6" style={{ color: "var(--tr-text-dim)" }}>
          Nenhuma campanha atribuída a esse carro ainda.
        </p>
      ) : (
        <div className="rounded-xl overflow-hidden mb-6" style={{ border: "1px solid var(--tr-border)" }}>
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--tr-surface-2)", color: "var(--tr-text-dim)" }}>
                <th className="text-left px-3 py-2">Vendedor</th>
                <th className="text-right px-3 py-2">Mensagens</th>
                <th className="text-right px-3 py-2">Gasto</th>
                <th className="text-right px-3 py-2">Custo/mensagem</th>
              </tr>
            </thead>
            <tbody>
              {vendNames.map((v) => {
                const d = vendStats[v];
                const custo = d.resultados > 0 ? d.gasto / d.resultados : null;
                return (
                  <tr key={v} style={{ borderTop: "1px solid var(--tr-border)" }}>
                    <td className="px-3 py-2">{v}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.resultados}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatBRL(d.gasto)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{custo !== null ? formatBRL(custo) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Campanhas */}
      <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--tr-text-dim)" }}>
        Campanhas
      </h2>
      <div className="flex gap-3 flex-wrap mb-3">
        <input
          className="px-3 py-2 rounded-md text-sm flex-1 min-w-[220px]"
          style={selectStyle}
          placeholder="Buscar campanha por nome ou vendedor…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <button
          className="text-xs font-semibold px-3 py-1.5 rounded-full"
          onClick={() => setOnlyUnassigned((v) => !v)}
          style={{
            background: onlyUnassigned ? "var(--tr-gold-2)" : "var(--tr-surface-2)",
            color: onlyUnassigned ? "var(--primary-foreground)" : "var(--tr-text-dim)",
            border: "1px solid " + (onlyUnassigned ? "var(--tr-gold-2)" : "var(--tr-border)"),
          }}
        >
          Só não atribuídas
        </button>
      </div>
      <div className="flex gap-3 flex-wrap items-center mb-3">
        <select className="px-3 py-2 rounded-md text-sm" style={selectStyle} value={filterTipo} onChange={(e) => setFilterTipo(e.target.value)}>
          <option value="todos">Todos os tipos</option>
          {allTipos.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select className="px-3 py-2 rounded-md text-sm" style={selectStyle} value={filterVendedor} onChange={(e) => setFilterVendedor(e.target.value)}>
          <option value="">Todos os vendedores</option>
          {allVendedores.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select className="px-3 py-2 rounded-md text-sm" style={selectStyle} value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
          <option value="relevancia">Ordenar: relevância</option>
          <option value="gasto_desc">Maior gasto</option>
          <option value="gasto_asc">Menor gasto</option>
          <option value="resultados_desc">Mais mensagens</option>
          <option value="nome_asc">Nome (A-Z)</option>
        </select>
        {anyFilterActive && (
          <button className="text-xs underline" style={{ color: "var(--tr-text-dim)" }} onClick={clearFilters}>
            Limpar filtros
          </button>
        )}
      </div>
      <p className="text-xs mb-2" style={{ color: "var(--tr-text-dim)" }}>
        {list.length} campanha(s)
      </p>

      {list.length === 0 ? (
        <div className="rounded-xl p-6 text-sm text-center" style={{ background: "var(--tr-surface)", border: "1px solid var(--tr-border)", color: "var(--tr-text-dim)" }}>
          Nenhuma campanha encontrada com esses filtros.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((camp) => {
            const checked = camp.car_id === carId;
            const other = camp.car_id && camp.car_id !== carId ? camp.car_id : null;
            const a = aggByCampaign[camp.id] || EMPTY_AGG;
            const tipo = tipoOf(a);
            const v = vendedorOf(camp);
            const badgeColor = tipo === "WhatsApp" ? "var(--tr-good)" : tipo === "Lead site" ? "var(--az)" : "var(--tr-text-dim)";
            return (
              <label
                key={camp.id}
                className="flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer flex-wrap"
                style={{
                  background: checked ? "var(--primary-soft)" : "var(--tr-surface)",
                  border: "1px solid " + (checked ? "var(--tr-gold-3)" : "var(--tr-border)"),
                }}
              >
                <input type="checkbox" checked={checked} onChange={(e) => toggleCampanha(camp.id, e.target.checked)} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate" title={camp.nome}>
                    {camp.nome}
                  </div>
                  {other && (
                    <div className="text-[11px]" style={{ color: "var(--tr-text-dim)" }}>
                      também vinculada a outro carro
                    </div>
                  )}
                </div>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--tr-surface-2)", color: badgeColor }}>
                  {tipo}
                </span>
                <input
                  defaultValue={v || ""}
                  placeholder="—"
                  title="Editar vendedor"
                  onClick={(e) => e.preventDefault()}
                  onBlur={(e) => setVendedorOverride(camp.id, e.target.value)}
                  className="text-xs px-2 py-1 rounded w-28"
                  style={selectStyle}
                />
                <span className="text-xs tabular-nums w-20 text-right">{formatBRL(a.gasto)}</span>
                <span className="text-xs tabular-nums w-16 text-right" style={{ color: "var(--tr-text-dim)" }}>
                  {resultadosOf(a)} res.
                </span>
              </label>
            );
          })}
        </div>
      )}
    </main>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: "var(--tr-surface)", border: "1px solid var(--tr-border)" }}>
      <p className="text-[11px] uppercase tracking-wide mb-2" style={{ color: "var(--tr-text-dim)" }}>
        {label}
      </p>
      <p className="text-xl font-bold" style={{ color: accent ?? "var(--tr-text)" }}>
        {value}
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--tr-text-dim)" }}>
      {label}
      {children}
    </label>
  );
}
