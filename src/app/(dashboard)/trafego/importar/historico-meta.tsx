"use client";

import { useState } from "react";

// Busca o histórico de gasto e conversas direto do Meta, mês a mês
// (o Meta guarda até 37 meses). Repetir só atualiza, nunca duplica.
const iso = (d: Date) => d.toISOString().slice(0, 10);

function meses(desdeMes: string): { desde: string; ate: string; nome: string }[] {
  const [a, m] = desdeMes.split("-").map(Number);
  const hoje = new Date();
  const saida = [];
  for (let d = new Date(Date.UTC(a, m - 1, 1)); d <= hoje; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const fim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    saida.push({ desde: iso(d), ate: iso(fim > hoje ? hoje : fim), nome: d.toLocaleDateString("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" }) });
  }
  return saida;
}

export function HistoricoMeta() {
  const padrao = (() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 24); return iso(d).slice(0, 7); })();
  const limite = (() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 36); return iso(d).slice(0, 7); })();
  const [desde, setDesde] = useState(padrao);
  const [rodando, setRodando] = useState(false);
  const [linhas, setLinhas] = useState<{ nome: string; situacao: string; ok?: boolean }[]>([]);

  async function buscar() {
    const lista = meses(desde < limite ? limite : desde);
    setRodando(true);
    setLinhas(lista.map((m) => ({ nome: m.nome, situacao: "na fila" })));
    for (let i = 0; i < lista.length; i++) {
      setLinhas((l) => l.map((x, k) => (k === i ? { ...x, situacao: "buscando…" } : x)));
      const r = await fetch("/api/trafego/historico", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ desde: lista[i].desde, ate: lista[i].ate }) });
      const d = await r.json().catch(() => ({}));
      setLinhas((l) => l.map((x, k) => (k === i ? { ...x, ok: r.ok, situacao: r.ok ? `${d.linhas} dias de campanha gravados` : d.erro || "erro" } : x)));
      if (!r.ok && /token|conta/i.test(d.erro || "")) break;
    }
    setRodando(false);
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 28 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Histórico completo do Meta</h2>
      <p style={{ margin: 0, fontSize: 14 }}>A sincronização diária pega só os últimos 30 dias. Aqui o sistema busca no Meta o gasto e as conversas de cada campanha, mês a mês, desde o mês escolhido (o Meta guarda até 3 anos). Pode repetir: só atualiza.</p>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>Desde o mês
          <input type="month" value={desde} min={limite} max={iso(new Date()).slice(0, 7)} onChange={(e) => setDesde(e.target.value)} disabled={rodando} />
        </label>
        <button type="button" className="btn btn-accent" onClick={buscar} disabled={rodando}>{rodando ? "Buscando…" : "Buscar histórico"}</button>
      </div>
      {linhas.length > 0 && (
        <table className="vendtable" style={{ width: "100%" }}>
          <thead><tr><th style={{ textAlign: "left" }}>Mês</th><th style={{ textAlign: "left" }}>Situação</th></tr></thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.nome}><td>{l.nome}</td><td style={{ color: l.ok === false ? "var(--tr-bad)" : l.ok ? "var(--tr-good)" : "var(--tr-text-dim)" }}>{l.situacao}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
