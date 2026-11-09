"use client";

import { useEffect, useState } from "react";

// Conexões opcionais: Windsor.ai (métricas do Instagram e outras fontes) e
// Google Analytics 4 (visitas do site e de cada carro). A chave do Windsor
// vai direto para o servidor, que guarda criptografada.
const campo = { background: "var(--tr-surface-2)", border: "1px solid var(--tr-border)", borderRadius: 8, padding: "8px 10px", color: "var(--tr-text)" } as const;
const rotulo = { display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "var(--tr-text-dim)" } as const;
const caixa = { background: "var(--tr-surface)", border: "1px solid var(--tr-border)", borderRadius: 10, padding: 16, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", alignItems: "end" } as const;

export function ConexoesOpcionais() {
  const [temWindsor, setTemWindsor] = useState(false);
  const [chave, setChave] = useState("");
  const [ga4, setGa4] = useState("");
  const [msg, setMsg] = useState<Record<string, { tom: "ok" | "erro"; texto: string }>>({});
  const [salvando, setSalvando] = useState<string | null>(null);

  async function carregar() {
    const r = await fetch("/api/trafego/conexao", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      setTemWindsor(!!j.temWindsor);
      setGa4(j.ga4Propriedade ?? "");
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar();
  }, []);

  async function enviar(qual: string, corpo: Record<string, unknown>, ok: string) {
    setSalvando(qual);
    const r = await fetch("/api/trafego/conexao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    setSalvando(null);
    setMsg({ ...msg, [qual]: r.ok ? { tom: "ok", texto: ok } : { tom: "erro", texto: j.error || "Não foi possível salvar." } });
    if (r.ok) { setChave(""); carregar(); }
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="kpi-group-lbl" style={{ margin: 0 }}>Windsor.ai (opcional · Instagram e outras fontes)</div>
      <form onSubmit={(e) => { e.preventDefault(); enviar("windsor", { windsorChave: chave }, "Chave salva. As métricas do Instagram entram na próxima sincronização."); }} className="grid gap-3" style={caixa}>
        <label style={rotulo}>
          {temWindsor ? "Trocar a chave da API do Windsor (vazio mantém)" : "Chave da API do Windsor"}
          <input type="password" autoComplete="off" value={chave} onChange={(e) => setChave(e.target.value)} placeholder={temWindsor ? "•••••••• salva" : "cole aqui a chave"} style={campo} />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-accent" type="submit" disabled={salvando === "windsor" || !chave.trim()}>{salvando === "windsor" ? "Salvando…" : "Salvar chave"}</button>
          {temWindsor && <button className="btn" type="button" onClick={() => enviar("windsor", { removerWindsor: true }, "Chave do Windsor removida.")}>Remover</button>}
        </div>
        <p style={{ gridColumn: "1 / -1", fontSize: 12, margin: 0, color: msg.windsor?.tom === "erro" ? "var(--tr-bad)" : "var(--tr-text-dim)" }}>
          {msg.windsor?.texto ?? (temWindsor ? "Chave salva e criptografada. Para puxar o Instagram, adicione a conta do Instagram nas contas abaixo." : "Sem chave própria: o sistema usa a chave geral, se houver.")}
        </p>
      </form>

      <div className="kpi-group-lbl" style={{ margin: "8px 0 0" }}>Google Analytics 4 (opcional · visitas do site e de cada carro)</div>
      <form onSubmit={(e) => { e.preventDefault(); enviar("ga4", { ga4Propriedade: ga4 }, ga4 ? "Propriedade salva. As visitas aparecem no Pátio e na ficha de cada carro." : "GA4 desligado."); }} className="grid gap-3" style={caixa}>
        <label style={rotulo}>
          ID da propriedade do GA4 (só números)
          <input value={ga4} onChange={(e) => setGa4(e.target.value)} placeholder="ex.: 412345678" inputMode="numeric" style={campo} />
        </label>
        <button className="btn btn-accent" type="submit" disabled={salvando === "ga4"}>{salvando === "ga4" ? "Salvando…" : "Salvar"}</button>
        <p style={{ gridColumn: "1 / -1", fontSize: 12, margin: 0, color: msg.ga4?.tom === "erro" ? "var(--tr-bad)" : "var(--tr-text-dim)" }}>
          {msg.ga4?.texto ?? "Usa a mesma chave de serviço do Firebase do site. Ela precisa ter acesso de Leitor na propriedade (GA4 → Administrador → Gerenciamento de acesso)."}
        </p>
      </form>
    </section>
  );
}
