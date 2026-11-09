"use client";

import { useEffect, useState } from "react";
import { CabecalhoAjustes } from "../comum";

type Config = { phone: string; addr: string; email: string; wa: string; insta: string; yt: string; tiktok: string };
const CAMPOS: [keyof Config, string, string?][] = [
  ["phone", "Telefone"], ["wa", "WhatsApp (só números, com DDD)", "tel"], ["email", "E-mail de contato", "email"], ["addr", "Endereço"],
  ["insta", "Instagram (link completo)"], ["yt", "YouTube (link)"], ["tiktok", "TikTok (link)"],
];

export default function ConfigSitePage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [inicial, setInicial] = useState<Config | null>(null);
  const [hook, setHook] = useState<{ ligado: boolean; final?: string }>({ ligado: false });
  const [novoHook, setNovoHook] = useState("");
  const [papel, setPapel] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    fetch("/api/site/config", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || "Não foi possível abrir.");
        setCfg(d.config); setInicial(d.config); setHook(d.reconstrucao); setPapel(d.papel);
      })
      .catch((e: Error) => setAviso(e.message));
  }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!cfg || !inicial) return;
    const mudou = Object.fromEntries((Object.keys(cfg) as (keyof Config)[]).filter((k) => cfg[k] !== inicial[k]).map((k) => [k, cfg[k]]));
    if (!Object.keys(mudou).length && !novoHook.trim()) { setAviso("Nada mudou."); return; }
    setSalvando(true); setAviso(null);
    const r = await fetch("/api/site/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: mudou, ...(novoHook.trim() ? { deployHookUrl: novoHook.trim() } : {}) }) });
    const d = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) { setAviso(d.erro || "Não foi possível salvar."); return; }
    setInicial(cfg);
    if (novoHook.trim()) { setHook({ ligado: true, final: novoHook.trim().slice(-4) }); setNovoHook(""); }
    setAviso(d.siteAtualizando ? "Salvo. O site está sendo atualizado (leva uns minutos)." : "Salvo.");
  }

  return (
    <form onSubmit={salvar} style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 }}>
      <CabecalhoAjustes titulo="Configurações do site" sub="Contato e redes que aparecem no rodapé e nos botões do iboxprime.com.br." />
      {cfg && (
        <section className="card" style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          {CAMPOS.map(([k, rot, tipo]) => (
            <label key={k} className="campo">{rot}<input type={tipo === "email" ? "email" : "text"} inputMode={tipo === "tel" ? "tel" : undefined} value={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} /></label>
          ))}
        </section>
      )}
      {cfg && (
        <section className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }} aria-labelledby="hook-t">
          <h2 id="hook-t" className="h2">Publicação do site</h2>
          <p style={{ margin: 0, fontSize: 14 }}>{hook.ligado ? `Ligada (link terminando em ${hook.final}). Cada mudança salva aqui publica o site sozinha.` : "Sem link de reconstrução: o site só atualiza na reconstrução diária da madrugada."}</p>
          {papel === "socio" && (
            <label className="campo">{hook.ligado ? "Trocar o link (Deploy Hook da Vercel)" : "Colar o link (Deploy Hook da Vercel)"}<input value={novoHook} onChange={(e) => setNovoHook(e.target.value)} placeholder="https://api.vercel.com/v1/integrations/deploy/…" autoComplete="off" /></label>
          )}
        </section>
      )}
      {aviso && <p role="status" style={{ margin: 0, fontSize: 14 }}>{aviso}</p>}
      {cfg && <div style={{ display: "flex", justifyContent: "flex-end" }}><button type="submit" className="btnp" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button></div>}
    </form>
  );
}
