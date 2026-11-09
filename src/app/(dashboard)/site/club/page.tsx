"use client";

import { useMemo, useState } from "react";
import { enviarParaCloudinary } from "@/lib/patio/cloudinary";
import { paraCsv } from "@/lib/patio/site";
import { Foto } from "../../patio/comum";
import { Cabecalho, useDocSite } from "../comum";

type Grupo = { mostrar?: boolean; aberto?: boolean; vagasTotal?: number; vagasOcupadas?: number; abertoAte?: string | null; listaEspera?: number; nota?: string };
type Oferta = { nome?: string; detalhe?: string; foto?: string; precoInsta?: number; precoClub?: number; selo?: string; tags?: string[]; ativo?: boolean };
type Club = { lote?: number; entradaDe?: number; ofertas?: Oferta[]; vantagens?: string[]; [k: string]: unknown };
type Membro = { id: string; nome?: string; wa?: string; status?: string; numero?: number; posicao?: number; criadoEm?: string };
const VANTAGENS: [string, string][] = [["preco", "Preço abaixo do anunciado"], ["taxa", "Taxa negociada"], ["brinde", "Brinde de membro"], ["relampago", "Oferta relâmpago"], ["reserva", "Reserva antes de todos"], ["troca", "Seu usado vale mais"], ["entrada", "Entrada facilitada"], ["carta", "Carta de crédito"]];
const SELOS: [string, string][] = [["oferta", "Oferta Club"], ["vendido", "Vendido no Club"], ["reservado", "Reservado"], ["relampago", "Relâmpago"]];

export default function IboxClub() {
  const { dados, setDados, erro, aviso, salvando, salvar } = useDocSite<{ grupo: Grupo; club: Club; linkGrupo: string; membros: Membro[] }>("/api/site/club");
  const [filtro, setFiltro] = useState<"membro" | "espera">("membro");
  const membros = useMemo(() => (dados?.membros ?? []).filter((m) => m.status === filtro).sort((a, b) => (a.numero ?? a.posicao ?? 0) - (b.numero ?? b.posicao ?? 0)), [dados, filtro]);
  if (erro) return <div className="card" style={{ padding: 20 }}>{erro}</div>;
  if (!dados) return <div className="card" style={{ padding: 20 }} aria-busy="true">Abrindo o iBox Club…</div>;
  const g = dados.grupo, c = dados.club;
  const setG = (n: Partial<Grupo>) => setDados({ ...dados, grupo: { ...g, ...n } });
  const setC = (n: Partial<Club>) => setDados({ ...dados, club: { ...c, ...n } });
  const ofertas = c.ofertas ?? [];
  const vant = c.vantagens ?? [];
  const restam = Math.max(0, (Number(g.vagasTotal) || 0) - (Number(g.vagasOcupadas) || 0));

  function baixarCsv() {
    const csv = paraCsv(membros as unknown as Record<string, unknown>[], [["numero", "Nº"], ["posicao", "Posição"], ["nome", "Nome"], ["wa", "WhatsApp"], ["criadoEm", "Cadastro"]]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `ibox-club-${filtro}.csv`;
    a.click();
  }
  const { vagasOcupadas: _o, listaEspera: _l, ...grupoSalvar } = g;
  void _o; void _l;

  return (
    <form onSubmit={(e) => { e.preventDefault(); salvar({ grupo: grupoSalvar, club: c, linkGrupo: dados.linkGrupo }, "iBox Club salvo. Já vale no site."); }} style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1240 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <Cabecalho titulo="iBox Club" sub="Lote, vagas, ofertas de prova e membros do grupo." />
        <div style={{ display: "flex", gap: 8 }}><a className="btns" href="https://iboxprime.com.br/club/" target="_blank" rel="noreferrer">Ver página</a><button type="submit" className="btnp" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button></div>
      </div>
      {aviso && <p role="status" style={{ margin: 0, color: "var(--p-azul-2)" }}>{aviso}</p>}

      <section className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", overflow: "hidden" }} aria-label="Situação do lote">
        {[["Lote", String(c.lote ?? 1)], ["Situação", g.aberto ? "Aberto" : "Fechado"], ["Vagas ocupadas", `${g.vagasOcupadas ?? 0} de ${g.vagasTotal ?? 0}`], ["Restam", String(restam)], ["Lista de espera", String(g.listaEspera ?? 0)]].map(([r, v]) => (
          <div key={r} style={{ padding: "14px 16px", borderRight: "1px solid var(--p-linha-2)" }}><div className="rot">{r}</div><div className="dado" style={{ fontSize: 22 }}>{v}</div></div>
        ))}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18 }}>
        <section className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }} aria-labelledby="lote-t">
          <h2 id="lote-t" className="h2">Lote</h2>
          <label style={{ display: "flex", gap: 10, fontSize: 14 }}><input type="checkbox" checked={!!g.aberto} onChange={(e) => setG({ aberto: e.target.checked })} /> Lote aberto para cadastro</label>
          <label style={{ display: "flex", gap: 10, fontSize: 14 }}><input type="checkbox" checked={g.mostrar !== false} onChange={(e) => setG({ mostrar: e.target.checked })} /> Mostrar o Club na página de links</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label className="campo">Nº do lote<input type="number" min={1} value={c.lote ?? 1} onChange={(e) => setC({ lote: Number(e.target.value) || 1 })} /></label>
            <label className="campo">Total de vagas<input type="number" min={0} value={g.vagasTotal ?? 0} onChange={(e) => setG({ vagasTotal: Number(e.target.value) || 0 })} /></label>
          </div>
          <label className="campo">Fecha em (vazio = sem prazo)<input type="datetime-local" value={g.abertoAte ? g.abertoAte.slice(0, 16) : ""} onChange={(e) => setG({ abertoAte: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
          <label className="campo">Valor de entrada riscado (R$)<input type="number" min={0} value={c.entradaDe ?? 77} onChange={(e) => setC({ entradaDe: Number(e.target.value) || 0 })} /></label>
          <label className="campo">Aviso abaixo do botão<input value={g.nota ?? ""} onChange={(e) => setG({ nota: e.target.value })} /></label>
          <label className="campo">Link privado do grupo do WhatsApp (só quem entra recebe)<input value={dados.linkGrupo} onChange={(e) => setDados({ ...dados, linkGrupo: e.target.value })} placeholder="https://chat.whatsapp.com/…" /></label>
          <p className="rot" style={{ margin: 0 }}>Vagas ocupadas e lista de espera são contadas pelo site e nunca são sobrescritas daqui.</p>
        </section>
        <section className="card" style={{ padding: 18 }} aria-labelledby="vant-t">
          <h2 id="vant-t" className="h2">Vantagens que aparecem</h2>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {VANTAGENS.map(([k, n]) => <label key={k} style={{ display: "flex", gap: 10, fontSize: 14 }}><input type="checkbox" checked={vant.includes(k)} onChange={(e) => setC({ vantagens: e.target.checked ? [...vant, k] : vant.filter((x) => x !== k) })} /> {n}</label>)}
          </div>
        </section>
      </div>

      <section className="card" style={{ padding: 18 }} aria-labelledby="of-t">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 id="of-t" className="h2">Ofertas de prova</h2>
          <button type="button" className="btns" onClick={() => setC({ ofertas: [...ofertas, { nome: "", detalhe: "", foto: "", precoInsta: 0, precoClub: 0, selo: "oferta", tags: [], ativo: true }] })}>Adicionar oferta</button>
        </div>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {ofertas.map((o, i) => {
            const mud = (n: Partial<Oferta>) => setC({ ofertas: ofertas.map((x, k) => (k === i ? { ...x, ...n } : x)) });
            return (
              <div key={i} style={{ border: "1px solid var(--p-linha)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <Foto url={o.foto} alt="" style={{ height: 110, borderRadius: 8 }} />
                <label className="btns" style={{ cursor: "pointer" }}>Foto<input type="file" accept="image/*" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) mud({ foto: await enviarParaCloudinary(f, `media/club_oferta_${i}`) }); }} /></label>
                <label className="campo">Carro<input value={o.nome ?? ""} onChange={(e) => mud({ nome: e.target.value })} /></label>
                <label className="campo">Detalhe<input value={o.detalhe ?? ""} onChange={(e) => mud({ detalhe: e.target.value })} /></label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <label className="campo">Preço Instagram<input type="number" value={o.precoInsta ?? 0} onChange={(e) => mud({ precoInsta: Number(e.target.value) || 0 })} /></label>
                  <label className="campo">Preço Club<input type="number" value={o.precoClub ?? 0} onChange={(e) => mud({ precoClub: Number(e.target.value) || 0 })} /></label>
                </div>
                <label className="campo">Selo<select value={o.selo ?? "oferta"} onChange={(e) => mud({ selo: e.target.value })}>{SELOS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
                <label className="campo">Brindes (separados por vírgula)<input value={(o.tags ?? []).join(", ")} onChange={(e) => mud({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} /></label>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <label style={{ display: "flex", gap: 8, fontSize: 14 }}><input type="checkbox" checked={o.ativo !== false} onChange={(e) => mud({ ativo: e.target.checked })} /> Aparece</label>
                  <button type="button" className="btns" onClick={() => setC({ ofertas: ofertas.filter((_, k) => k !== i) })}>Remover</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card" style={{ overflowX: "auto" }} aria-labelledby="mem-t">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", gap: 10, flexWrap: "wrap" }}>
          <h2 id="mem-t" className="h2">Pessoas</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <div className="seg" role="group" aria-label="Filtro">
              <button type="button" aria-pressed={filtro === "membro"} onClick={() => setFiltro("membro")}>Membros</button>
              <button type="button" aria-pressed={filtro === "espera"} onClick={() => setFiltro("espera")}>Lista de espera</button>
            </div>
            <button type="button" className="btns" onClick={baixarCsv} disabled={!membros.length}>Baixar CSV</button>
          </div>
        </div>
        {membros.length === 0 ? <p className="rot" style={{ padding: "0 16px 16px", fontSize: 14 }}>Ninguém aqui ainda.</p> : (
          <table className="tab">
            <thead><tr><th scope="col">{filtro === "membro" ? "Nº" : "Posição"}</th><th scope="col">Nome</th><th scope="col">WhatsApp</th><th scope="col">Cadastro</th></tr></thead>
            <tbody>{membros.map((m) => <tr key={m.id}><td className="dado">{m.numero ?? m.posicao ?? "—"}</td><td>{m.nome ?? "—"}</td><td className="dado" style={{ fontWeight: 500 }}>{m.wa ?? m.id}</td><td>{m.criadoEm ? new Date(m.criadoEm).toLocaleDateString("pt-BR") : "—"}</td></tr>)}</tbody>
          </table>
        )}
      </section>
    </form>
  );
}
