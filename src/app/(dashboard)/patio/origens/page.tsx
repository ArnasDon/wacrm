"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ORIGENS_VENDA, detalheDaOrigem } from "@/lib/patio/origem-venda";

// Origem das vendas antigas: cada carro vendido sem origem aparece com uma
// sugestão (clientes do carro no CRM ou gasto em anúncios). O sócio confere,
// troca se precisar e salva — um por um ou todos de uma vez.

type Item = {
  id: string; nome: string; placa: string | null; foto: string | null; dataVenda: string | null; valor: number;
  comprador: string | null; gastoAnuncios: number;
  sugestao: { origem: string; detalhe: string; motivo: string } | null;
};
type Escolha = { origem: string; detalhe: string; nova: boolean };

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dataBr = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");

export default function OrigensPage() {
  const [itens, setItens] = useState<Item[] | null>(null);
  const [resumo, setResumo] = useState<{ vendidos: number; comOrigem: number } | null>(null);
  const [erro, setErro] = useState("");
  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>({});
  const [opcoes, setOpcoes] = useState<{ origens: string[]; vendedores: string[] }>({ origens: [...ORIGENS_VENDA], vendedores: [] });
  const [salvando, setSalvando] = useState<string[]>([]);
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    let vivo = true;
    fetch("/api/patio/origens-venda/pendentes", { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => {
        if (!vivo) return;
        if (!ok) { setErro(d.erro || "Não consegui carregar."); return; }
        setItens(d.itens);
        setResumo({ vendidos: d.vendidos, comOrigem: d.comOrigem });
        const e: Record<string, Escolha> = {};
        for (const it of d.itens as Item[]) e[it.id] = { origem: it.sugestao?.origem ?? "", detalhe: it.sugestao?.detalhe ?? "", nova: false };
        setEscolhas(e);
      });
    fetch("/api/patio/origens-venda", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d?.origens) setOpcoes({ origens: d.origens, vendedores: d.vendedores ?? [] }); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  const prontos = useMemo(() => (itens ?? []).filter((i) => escolhas[i.id]?.origem.trim()), [itens, escolhas]);

  async function salvar(ids: string[]) {
    const lista = ids.map((id) => ({ id, origem: escolhas[id].origem, detalhe: escolhas[id].detalhe })).filter((x) => x.origem.trim());
    if (!lista.length) return;
    setSalvando(lista.map((x) => x.id));
    setAviso("");
    const r = await fetch("/api/patio/origens-venda/pendentes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itens: lista }) });
    const d = await r.json().catch(() => ({}));
    setSalvando([]);
    if (!r.ok && !d.salvos) { setAviso(d.erro || "Não consegui salvar."); return; }
    const ok = new Set<string>(d.salvos ?? []);
    setItens((xs) => (xs ?? []).filter((x) => !ok.has(x.id)));
    setResumo((s) => (s ? { ...s, comOrigem: s.comOrigem + ok.size } : s));
    setAviso(d.falhas?.length ? `${ok.size} salva(s). Não salvou: ${d.falhas.map((f: { erro: string }) => f.erro).join("; ")}` : `${ok.size} venda(s) salva(s).`);
  }

  const muda = (id: string, m: Partial<Escolha>) => setEscolhas((e) => ({ ...e, [id]: { ...e[id], ...m } }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <p className="rot" style={{ margin: 0 }}><Link href="/patio">Pátio</Link> / Origem das vendas</p>
          <h1 className="disp" style={{ margin: "4px 0 0", fontSize: 32 }}>Origem das vendas</h1>
          <p style={{ margin: "6px 0 0", fontSize: 14, maxWidth: 680 }}>Vendas que ainda estão sem origem. O sistema já deixou uma sugestão quando encontrou pista (clientes do carro no CRM ou anúncios do carro). Confira, troque o que estiver errado e salve.</p>
        </div>
        {itens && prontos.length > 0 && (
          <button type="button" className="btnp" disabled={salvando.length > 0} onClick={() => salvar(prontos.map((p) => p.id))}>
            {salvando.length > 1 ? "Salvando…" : `Salvar ${prontos.length} preenchida(s)`}
          </button>
        )}
      </header>

      {erro && <p role="alert" style={{ color: "var(--ru)", margin: 0 }}>{erro}</p>}
      {aviso && <p role="status" style={{ margin: 0, fontSize: 14 }}>{aviso}</p>}
      {!itens && !erro && <p style={{ margin: 0 }}>Carregando as vendas…</p>}
      {resumo && <p className="rot" style={{ margin: 0 }}>{resumo.comOrigem} de {resumo.vendidos} vendas já têm origem · faltam {itens?.length ?? 0}</p>}
      {itens && itens.length === 0 && <section className="card" style={{ padding: 20 }}>Todas as vendas já têm origem. ✓</section>}

      {itens && itens.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {itens.map((it) => {
            const e = escolhas[it.id] ?? { origem: "", detalhe: "", nova: false };
            const det = detalheDaOrigem(e.origem);
            const lista = [...opcoes.origens, ...(e.origem && !opcoes.origens.includes(e.origem) && !e.nova ? [e.origem] : [])];
            return (
              <li key={it.id} className="card" style={{ padding: 14, display: "grid", gridTemplateColumns: "minmax(220px, 1.2fr) minmax(260px, 2fr) auto", gap: 14, alignItems: "center" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                  {it.foto ? <img src={it.foto} alt="" width={64} height={48} style={{ objectFit: "cover", borderRadius: 6, flex: "none" }} /> : <div style={{ width: 64, height: 48, borderRadius: 6, background: "var(--p-linha-2)", flex: "none" }} />}
                  <div style={{ minWidth: 0 }}>
                    <Link href={`/patio/${it.id}`} style={{ fontWeight: 600 }}>{it.nome}</Link>
                    <div className="rot" style={{ fontSize: 12 }}>{[it.placa, `vendido ${dataBr(it.dataVenda)}`, it.valor ? brl(it.valor) : null, it.comprador].filter(Boolean).join(" · ")}</div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {e.nova ? (
                      <input autoFocus value={e.origem} placeholder="Nome da origem" onChange={(ev) => muda(it.id, { origem: ev.target.value })} style={{ flex: 1, minWidth: 160 }} aria-label="Origem da venda" />
                    ) : (
                      <select value={e.origem} onChange={(ev) => (ev.target.value === "__nova" ? muda(it.id, { nova: true, origem: "", detalhe: "" }) : muda(it.id, { origem: ev.target.value, detalhe: ev.target.value === it.sugestao?.origem ? it.sugestao.detalhe : "" }))} aria-label="Origem da venda" style={{ flex: 1, minWidth: 160 }}>
                        <option value="">Escolha a origem…</option>
                        {lista.map((o) => <option key={o}>{o}</option>)}
                        <option value="__nova">+ Outra origem…</option>
                      </select>
                    )}
                    {det && (
                      <>
                        <input value={e.detalhe} placeholder={det} onChange={(ev) => muda(it.id, { detalhe: ev.target.value })} list={e.origem === "Conexão de vendedor" ? `vend-${it.id}` : undefined} style={{ flex: 1, minWidth: 160 }} aria-label={det} />
                        {e.origem === "Conexão de vendedor" && <datalist id={`vend-${it.id}`}>{opcoes.vendedores.map((v) => <option key={v} value={v} />)}</datalist>}
                      </>
                    )}
                  </div>
                  <span className="rot" style={{ fontSize: 12 }}>
                    {it.sugestao ? <>Sugestão: <b>{it.sugestao.origem}</b> — {it.sugestao.motivo}</> : "Sem pista no sistema — escolha a origem."}
                  </span>
                </div>
                <button type="button" className="btns" disabled={!e.origem.trim() || salvando.length > 0} onClick={() => salvar([it.id])}>
                  {salvando.length === 1 && salvando[0] === it.id ? "Salvando…" : "Salvar"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
