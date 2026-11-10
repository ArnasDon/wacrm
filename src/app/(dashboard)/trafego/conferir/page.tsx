"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

// Conferência com o Facebook: o painel tem que ser um espelho do
// Gerenciador de Anúncios no período "Máximo". Mostra o total dos dois lados,
// os dias e as campanhas que não batem, e corrige mês a mês com um clique.

type Num = { gasto: number; impressions: number; clicks: number; msgs: number };
type Resultado = {
  totalMeta: number; totalBanco: number; primeiroDia: string | null; ultimoDia: string | null;
  campanhasMeta: number; campanhasBanco: number; bate: boolean; meses: string[]; conferidoEm: string;
  dias: { data: string; meta: number; banco: number }[];
  campanhas: { id: string; nome: string; status: string; meta: Num; banco: Num; motivo: string }[];
};

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const nomeMes = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
const STATUS: Record<string, string> = { ACTIVE: "Ativa", PAUSED: "Pausada", ARCHIVED: "Arquivada", "EXCLUÍDA": "Excluída", DELETED: "Excluída" };

export default function ConferirPage() {
  const [r, setR] = useState<Resultado | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [corrigindo, setCorrigindo] = useState<string[]>([]);
  const [log, setLog] = useState<string[]>([]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    const res = await fetch("/api/trafego/conferir", { cache: "no-store" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setErro(d.erro || "Não consegui falar com o Facebook.");
    else setR(d);
    setCarregando(false);
  }, []);

  useEffect(() => {
    let vivo = true;
    fetch("/api/trafego/conferir", { cache: "no-store" })
      .then(async (res) => ({ ok: res.ok, d: await res.json().catch(() => ({})) }))
      .then(({ ok, d }) => {
        if (!vivo) return;
        if (!ok) setErro(d.erro || "Não consegui falar com o Facebook.");
        else setR(d);
        setCarregando(false);
      });
    return () => { vivo = false; };
  }, []);

  async function corrigir(meses: string[]) {
    setCorrigindo(meses);
    setLog([]);
    for (const mes of meses) {
      setLog((l) => [...l, `${nomeMes(mes)}: buscando no Facebook…`]);
      const res = await fetch("/api/trafego/conferir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mes }) });
      const d = await res.json().catch(() => ({}));
      setLog((l) => [...l.slice(0, -1), res.ok ? `${nomeMes(mes)}: atualizado (${d.apagadas} linha(s) que o Facebook não tem foram retiradas)` : `${nomeMes(mes)}: ${d.erro || "erro"}`]);
      if (!res.ok && /token|conta/i.test(d.erro || "")) break;
    }
    setCorrigindo([]);
    await carregar();
  }

  const diferenca = r ? Math.round((r.totalMeta - r.totalBanco) * 100) / 100 : 0;
  const soNoPainel = r?.campanhas.filter((c) => c.motivo === "só no painel") ?? [];

  return (
    <div style={{ padding: "24px clamp(16px, 3vw, 32px)", display: "flex", flexDirection: "column", gap: 20, maxWidth: 1100 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, fontSize: 13 }}><Link href="/trafego">Visão geral</Link> / Conferência</p>
          <h1 style={{ margin: "4px 0 0", fontSize: 24 }}>Conferir com o Facebook</h1>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--tr-text-dim)" }}>Compara o painel com o Gerenciador de Anúncios no período <b>Máximo</b>, sem imposto (o Facebook mostra o valor sem imposto).</p>
        </div>
        <button type="button" className="btn" onClick={carregar} disabled={carregando || corrigindo.length > 0}>{carregando ? "Conferindo…" : "Conferir de novo"}</button>
      </header>

      {erro && <p role="alert" style={{ color: "var(--tr-bad)", margin: 0 }}>{erro}</p>}
      {carregando && !r && <p style={{ margin: 0 }}>Buscando os números no Facebook…</p>}

      {r && (
        <>
          <section className="card" style={{ padding: "18px 20px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
            <div><div style={{ fontSize: 13, color: "var(--tr-text-dim)" }}>Facebook (Máximo)</div><div style={{ fontSize: 26, fontWeight: 700 }}>{brl(r.totalMeta)}</div><div style={{ fontSize: 12, color: "var(--tr-text-dim)" }}>{dataBr(r.primeiroDia)} a {dataBr(r.ultimoDia)} · {r.campanhasMeta} campanhas</div></div>
            <div><div style={{ fontSize: 13, color: "var(--tr-text-dim)" }}>Painel (tudo gravado)</div><div style={{ fontSize: 26, fontWeight: 700 }}>{brl(r.totalBanco)}</div><div style={{ fontSize: 12, color: "var(--tr-text-dim)" }}>{r.campanhasBanco} campanhas com gasto</div></div>
            <div><div style={{ fontSize: 13, color: "var(--tr-text-dim)" }}>Situação</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: r.bate ? "var(--tr-good)" : "var(--tr-bad)" }}>{r.bate ? "Espelho do Facebook ✓" : `Diferença de ${brl(Math.abs(diferenca))}`}</div>
              <div style={{ fontSize: 12, color: "var(--tr-text-dim)" }}>{r.bate ? "Gasto, campanhas e conversas batem." : diferenca > 0 ? "Falta gasto no painel." : diferenca < 0 ? "O painel tem gasto a mais." : "O total bate, mas há campanhas diferentes."}</div>
            </div>
          </section>

          {!r.bate && r.meses.length > 0 && (
            <section className="card" style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
              <strong>Corrigir</strong>
              <p style={{ margin: 0, fontSize: 14 }}>O sistema busca de novo no Facebook os meses com diferença ({r.meses.map(nomeMes).join(", ")}), grava igual ao Facebook (inclusive campanhas excluídas) e retira do painel o dia/campanha que o Facebook não tem. A ligação das campanhas com carros e vendedores não muda.</p>
              <div><button type="button" className="btn btn-accent" disabled={corrigindo.length > 0} onClick={() => corrigir(r.meses)}>{corrigindo.length ? "Corrigindo…" : `Corrigir ${r.meses.length} mês(es)`}</button></div>
              {log.length > 0 && <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
            </section>
          )}
          {!r.bate && r.meses.length === 0 && r.campanhas.some((c) => c.motivo !== "só no painel") && (
            <section className="card" style={{ padding: "16px 20px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 14 }}>O gasto por dia bate, mas há campanhas com números diferentes. Buscar tudo de novo no Facebook:</span>
              <button type="button" className="btn btn-accent" disabled={corrigindo.length > 0} onClick={() => corrigir(mesesEntre(r.primeiroDia, r.ultimoDia))}>{corrigindo.length ? "Corrigindo…" : "Buscar tudo de novo"}</button>
              {log.length > 0 && <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, width: "100%" }}>{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
            </section>
          )}

          {r.campanhas.length > 0 && (
            <section className="card" style={{ padding: "16px 20px", overflowX: "auto" }}>
              <strong>Campanhas que não batem ({r.campanhas.length})</strong>
              <table className="vendtable" style={{ width: "100%", marginTop: 10, fontSize: 13 }}>
                <thead><tr><th style={{ textAlign: "left" }}>Campanha</th><th style={{ textAlign: "left" }}>No Facebook</th><th>Gasto Facebook</th><th>Gasto painel</th><th>Conversas FB / painel</th><th style={{ textAlign: "left" }}>O que é</th></tr></thead>
                <tbody>
                  {r.campanhas.map((c) => (
                    <tr key={c.id}>
                      <td>{c.nome}</td>
                      <td>{STATUS[c.status] || c.status || "—"}</td>
                      <td style={{ textAlign: "right" }}>{brl(c.meta.gasto)}</td>
                      <td style={{ textAlign: "right" }}>{brl(c.banco.gasto)}</td>
                      <td style={{ textAlign: "right" }}>{c.meta.msgs} / {c.banco.msgs}</td>
                      <td>{c.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {soNoPainel.length > 0 && <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--tr-text-dim)" }}>“Só no painel” é campanha sem o número do Facebook (veio do painel antigo). A correção automática não mexe nela; me avise se é para retirar.</p>}
            </section>
          )}

          {r.dias.length > 0 && (
            <section className="card" style={{ padding: "16px 20px", overflowX: "auto" }}>
              <strong>Dias que não batem ({r.dias.length})</strong>
              <table className="vendtable" style={{ width: "100%", marginTop: 10, fontSize: 13 }}>
                <thead><tr><th style={{ textAlign: "left" }}>Dia</th><th>Facebook</th><th>Painel</th><th>Diferença</th></tr></thead>
                <tbody>
                  {r.dias.map((d) => (
                    <tr key={d.data}><td>{dataBr(d.data)}</td><td style={{ textAlign: "right" }}>{brl(d.meta)}</td><td style={{ textAlign: "right" }}>{brl(d.banco)}</td><td style={{ textAlign: "right", color: "var(--tr-bad)" }}>{brl(d.meta - d.banco)}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <p style={{ margin: 0, fontSize: 12, color: "var(--tr-text-dim)" }}>Conferido em {new Date(r.conferidoEm).toLocaleString("pt-BR")}. O gasto de hoje pode ter alguns minutos de atraso nos dois lados.</p>
        </>
      )}
    </div>
  );
}

function mesesEntre(de: string | null, ate: string | null): string[] {
  if (!de || !ate) return [];
  const saida: string[] = [];
  let [a, m] = de.slice(0, 7).split("-").map(Number);
  const fim = ate.slice(0, 7);
  for (let i = 0; i < 60; i++) {
    const mes = `${a}-${String(m).padStart(2, "0")}`;
    saida.push(mes);
    if (mes >= fim) break;
    m++;
    if (m > 12) { m = 1; a++; }
  }
  return saida;
}
