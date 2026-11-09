"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CabecalhoAjustes, quando } from "../comum";

type Conexao = { id: string; nome: string; para: string; estado: "ok" | "erro" | "desligado" | "info"; detalhe: string; ultima?: string | null; configurar: string; grupo: string };

const SELO: Record<Conexao["estado"], [string, string]> = {
  ok: ["selo s-ok", "Ligada"],
  erro: ["selo s-ru", "Com problema"],
  desligado: ["selo s-ne", "Desligada"],
  info: ["selo s-az", "Informativo"],
};
const GRUPOS = ["Clientes", "Marketing", "Site", "Em breve"];

export default function ConexoesPage() {
  const [lista, setLista] = useState<Conexao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/conexoes", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || "Não foi possível abrir.");
        setLista(d.conexoes);
      })
      .catch((e: Error) => setErro(e.message));
  }, []);

  const problemas = lista?.filter((c) => c.estado === "erro").length ?? 0;
  const ligadas = lista?.filter((c) => c.estado === "ok").length ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 1180 }}>
      <CabecalhoAjustes titulo="Conexões" sub="Tudo o que o sistema usa para funcionar, num lugar só. Nenhuma senha ou token aparece aqui." />
      {erro && <div className="card" style={{ padding: 16 }}>{erro}</div>}
      {lista && (
        <div className="card" style={{ padding: "14px 18px", display: "flex", gap: 24, flexWrap: "wrap", fontSize: 14 }}>
          <span><span className="dado" style={{ fontSize: 22 }}>{ligadas}</span> ligadas</span>
          <span><span className="dado" style={{ fontSize: 22, color: problemas ? "var(--ru)" : undefined }}>{problemas}</span> com problema</span>
        </div>
      )}
      {!lista && !erro && <div className="rot">Conferindo cada conexão…</div>}
      {GRUPOS.map((g) => {
        const itens = lista?.filter((c) => c.grupo === g) ?? [];
        if (!itens.length) return null;
        return (
          <section key={g} aria-labelledby={`g-${g}`} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 id={`g-${g}`} className="h2">{g}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
              {itens.map((c) => (
                <article key={c.id} className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, opacity: g === "Em breve" ? 0.7 : 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{c.nome}</div>
                    <span className={SELO[c.estado][0]}>{SELO[c.estado][1]}</span>
                  </div>
                  <div className="rot" style={{ fontSize: 13 }}>{c.para}</div>
                  <div style={{ fontSize: 14 }}>{c.detalhe}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", gap: 8 }}>
                    <span className="rot" style={{ fontSize: 12 }}>{c.ultima ? `Último dado ${quando(c.ultima)}` : ""}</span>
                    {c.configurar && (c.configurar.startsWith("http")
                      ? <a className="btns" href={c.configurar} target="_blank" rel="noreferrer">Abrir na Vercel</a>
                      : <Link className="btns" href={c.configurar}>{c.estado === "desligado" ? "Ligar" : "Configurar"}</Link>)}
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
