"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { buscarCarros, rotuloCarro, type CarroDoPatio, type LinhaLigacao } from "@/lib/trafego/ligacoes";

// Ligar campanhas: cada campanha do Meta vai para um carro do Pátio ou para
// uma finalidade, com um clique. A sugestão já vem pronta; a busca de carro
// procura direto no Pátio (nome, ano ou placa); dá para ligar várias de uma vez.

type Finalidade = { key: string; label: string };
type Aba = "ligar" | "ligadas" | "todas";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d: string | null) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "");
const card: React.CSSProperties = { background: "var(--tr-surface)", border: "1px solid var(--tr-border)", borderRadius: 12 };
const btn: React.CSSProperties = { border: "1px solid var(--tr-border)", borderRadius: 8, padding: "6px 10px", fontSize: 13, background: "transparent", cursor: "pointer", whiteSpace: "nowrap" };
const btnForte: React.CSSProperties = { ...btn, background: "var(--tr-gold-2)", color: "var(--primary-foreground)", border: "1px solid transparent", fontWeight: 600 };

export default function LigarPage() {
  const [linhas, setLinhas] = useState<LinhaLigacao[] | null>(null);
  const [patio, setPatio] = useState<CarroDoPatio[]>([]);
  const [finalidades, setFinalidades] = useState<Finalidade[]>([]);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<Aba>("ligar");
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState<Set<string>>(new Set());
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    let vivo = true;
    fetch("/api/trafego/ligar", { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => {
        if (!vivo) return;
        if (!ok) { setErro(d.erro || "Não consegui carregar as campanhas."); return; }
        setLinhas(d.linhas); setPatio(d.patio); setFinalidades(d.finalidades);
      });
    return () => { vivo = false; };
  }, []);

  const paraLigar = (l: LinhaLigacao) => l.situacao === "sem" || l.situacao === "fora";
  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (linhas ?? []).filter((l) => (aba === "todas" || (aba === "ligar" ? paraLigar(l) : !paraLigar(l))) && (!t || l.nome.toLowerCase().includes(t) || (l.ligadaA ?? "").toLowerCase().includes(t)));
  }, [linhas, aba, busca]);
  const pendentes = (linhas ?? []).filter(paraLigar);
  const valorPendente = pendentes.reduce((s, l) => s + l.investido, 0);
  const comSugestao = pendentes.filter((l) => l.sugestao);

  async function ligar(ids: string[], alvo: { patioId: string } | { finalidade: string } | { limpar: true }) {
    if (!ids.length) return;
    setOcupado((o) => new Set([...o, ...ids]));
    setAviso("");
    const r = await fetch("/api/trafego/ligar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campanhas: ids, ...alvo }) });
    const d = await r.json().catch(() => ({}));
    setOcupado((o) => { const n = new Set(o); ids.forEach((i) => n.delete(i)); return n; });
    if (!r.ok) { setAviso(d.erro || "Não consegui salvar."); return; }
    const carro = "patioId" in alvo ? patio.find((c) => c.id === alvo.patioId) : null;
    const fin = "finalidade" in alvo ? finalidades.find((f) => f.key === alvo.finalidade) : null;
    setLinhas((ls) => (ls ?? []).map((l) => {
      if (!ids.includes(l.id)) return l;
      if (carro) return { ...l, situacao: "carro", ligadaA: rotuloCarro(carro), patioId: carro.id, finalidade: null, foraId: null, sugestao: null };
      if (fin) return { ...l, situacao: "finalidade", ligadaA: fin.label, patioId: null, finalidade: fin.key, foraId: null, sugestao: null };
      return { ...l, situacao: "sem", ligadaA: null, patioId: null, finalidade: null, foraId: null };
    }));
    setSel((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; });
    const quanto = ids.length === 1 ? "Campanha ligada" : `${ids.length} campanhas ligadas`;
    setAviso("limpar" in alvo ? "Ligação desfeita." : `${quanto} a ${carro ? rotuloCarro(carro) : fin?.label}.`);
  }

  async function aceitarSugestoes() {
    const porCarro = new Map<string, string[]>();
    const porFin = new Map<string, string[]>();
    for (const l of comSugestao) {
      if (l.sugestao?.tipo === "carro") porCarro.set(l.sugestao.patioId, [...(porCarro.get(l.sugestao.patioId) ?? []), l.id]);
      else if (l.sugestao?.tipo === "finalidade") porFin.set(l.sugestao.chave, [...(porFin.get(l.sugestao.chave) ?? []), l.id]);
    }
    for (const [patioId, ids] of porCarro) await ligar(ids, { patioId });
    for (const [finalidade, ids] of porFin) await ligar(ids, { finalidade });
    setAviso(`${comSugestao.length} sugestões aceitas.`);
  }

  const todasMarcadas = visiveis.length > 0 && visiveis.every((l) => sel.has(l.id));
  const ids = [...sel];

  return (
    <main className="px-6 py-8 max-w-6xl mx-auto" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--tr-text-dim)" }}><Link href="/trafego/campanhas">Campanhas</Link> / Ligar</p>
          <h1 className="text-xl font-bold" style={{ margin: "4px 0 0" }}>Ligar campanhas</h1>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--tr-text-dim)", maxWidth: 680 }}>Cada campanha vai para um <b>carro do Pátio</b> ou para uma <b>finalidade</b> (Instagram, site, marca…). É isso que faz o gasto aparecer no custo de cada carro.</p>
        </div>
        {linhas && comSugestao.length > 0 && (
          <button type="button" style={btnForte} disabled={ocupado.size > 0} onClick={aceitarSugestoes}>Aceitar as {comSugestao.length} sugestões</button>
        )}
      </header>

      {erro && <p role="alert" style={{ color: "var(--tr-bad)", margin: 0 }}>{erro}</p>}
      {!linhas && !erro && <p style={{ margin: 0 }}>Carregando campanhas…</p>}

      {linhas && (
        <>
          <section style={{ ...card, padding: "12px 16px", display: "flex", gap: 24, flexWrap: "wrap", fontSize: 14 }}>
            <span><b style={{ fontSize: 18 }}>{pendentes.length}</b> campanhas para ligar</span>
            <span><b style={{ fontSize: 18 }}>{brl(valorPendente)}</b> investidos (com imposto) fora do custo dos carros</span>
            <span><b style={{ fontSize: 18 }}>{comSugestao.length}</b> com sugestão pronta</span>
          </section>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {([["ligar", `Para ligar · ${pendentes.length}`], ["ligadas", `Ligadas · ${linhas.length - pendentes.length}`], ["todas", `Todas · ${linhas.length}`]] as [Aba, string][]).map(([k, n]) => (
              <button key={k} type="button" onClick={() => { setAba(k); setSel(new Set()); }} aria-pressed={aba === k} style={{ ...btn, ...(aba === k ? { background: "var(--tr-surface-2)", fontWeight: 600 } : {}) }}>{n}</button>
            ))}
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar campanha ou carro…" style={{ ...btn, flex: 1, minWidth: 200, cursor: "text" }} aria-label="Buscar campanha" />
          </div>

          {aviso && <p role="status" style={{ margin: 0, fontSize: 14, color: "var(--tr-good)" }}>{aviso}</p>}

          {ids.length > 0 && (
            <section style={{ ...card, padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", position: "sticky", top: 8, zIndex: 5, borderColor: "var(--tr-gold-2)" }}>
              <b style={{ fontSize: 14 }}>{ids.length} selecionada(s):</b>
              <EscolherCarro patio={patio} rotulo="Ligar todas a um carro…" onEscolher={(c) => ligar(ids, { patioId: c.id })} />
              <EscolherFinalidade finalidades={finalidades} rotulo="ou a uma finalidade…" onEscolher={(f) => ligar(ids, { finalidade: f })} />
              <button type="button" style={btn} onClick={() => setSel(new Set())}>Cancelar</button>
            </section>
          )}

          {visiveis.length === 0 ? (
            <section style={{ ...card, padding: 20, fontSize: 14 }}>{aba === "ligar" ? "Nenhuma campanha para ligar. ✓" : "Nada por aqui."}</section>
          ) : (
            <section style={{ ...card, overflow: "visible" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: "1px solid var(--tr-border)", fontSize: 12, color: "var(--tr-text-dim)" }}>
                <input type="checkbox" checked={todasMarcadas} onChange={() => setSel(todasMarcadas ? new Set() : new Set(visiveis.map((l) => l.id)))} aria-label="Marcar todas" />
                <span>Marcar todas as {visiveis.length} da lista</span>
              </div>
              {visiveis.map((l) => (
                <Linha key={l.id} l={l} patio={patio} finalidades={finalidades} marcada={sel.has(l.id)} ocupada={ocupado.has(l.id)}
                  onMarcar={() => setSel((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}
                  onLigar={(alvo) => ligar([l.id], alvo)} />
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}

function Linha({ l, patio, finalidades, marcada, ocupada, onMarcar, onLigar }: {
  l: LinhaLigacao; patio: CarroDoPatio[]; finalidades: Finalidade[]; marcada: boolean; ocupada: boolean;
  onMarcar: () => void; onLigar: (alvo: { patioId: string } | { finalidade: string } | { limpar: true }) => void;
}) {
  const situ = {
    sem: { txt: "Sem ligação", cor: "var(--tr-bad)" },
    fora: { txt: `Carro fora do Pátio: ${l.ligadaA}`, cor: "var(--tr-bad)" },
    carro: { txt: `Carro: ${l.ligadaA}`, cor: "var(--tr-good)" },
    finalidade: { txt: `Finalidade: ${l.ligadaA}`, cor: "var(--tr-good)" },
  }[l.situacao];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto minmax(220px, 1.3fr) minmax(280px, 2fr)", gap: 12, alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--tr-border)", opacity: ocupada ? 0.5 : 1, background: marcada ? "var(--tr-surface-2)" : undefined }}>
      <input type="checkbox" checked={marcada} onChange={onMarcar} aria-label={`Marcar ${l.nome}`} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" }} title={l.nome}>{l.nome}</div>
        <div style={{ fontSize: 12, color: "var(--tr-text-dim)", marginTop: 2 }}>
          <span style={{ color: l.ativa ? "var(--tr-good)" : undefined }}>{l.ativa ? "● No ar" : "Pausada"}</span>
          {" · "}{brl(l.investido)} · {l.msgs} conversa(s){l.primeiroDia ? ` · ${dia(l.primeiroDia)} a ${dia(l.ultimoDia)}` : ""}
        </div>
        <div style={{ fontSize: 12, marginTop: 3, color: situ.cor }}>{situ.txt}</div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
        {l.sugestao && (
          <button type="button" style={btnForte} disabled={ocupada} title="Sugestão do sistema"
            onClick={() => onLigar(l.sugestao!.tipo === "carro" ? { patioId: l.sugestao!.patioId } : { finalidade: (l.sugestao as { chave: string }).chave })}>
            ✓ {l.sugestao.rotulo}
          </button>
        )}
        <EscolherCarro patio={patio} rotulo={l.situacao === "carro" ? "Trocar carro…" : "Carro…"} onEscolher={(c) => onLigar({ patioId: c.id })} />
        <EscolherFinalidade finalidades={finalidades} rotulo="Não é carro…" atual={l.finalidade} onEscolher={(f) => onLigar({ finalidade: f })} />
        {(l.situacao === "carro" || l.situacao === "finalidade") && <button type="button" style={{ ...btn, color: "var(--tr-text-dim)" }} onClick={() => onLigar({ limpar: true })}>Desfazer</button>}
      </div>
    </div>
  );
}

function EscolherCarro({ patio, rotulo, onEscolher }: { patio: CarroDoPatio[]; rotulo: string; onEscolher: (c: CarroDoPatio) => void }) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState("");
  const caixa = useRef<HTMLDivElement>(null);
  const achados = useMemo(() => buscarCarros(patio, termo), [patio, termo]);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);
  const escolher = (c: CarroDoPatio) => { setAberto(false); setTermo(""); onEscolher(c); };
  if (!aberto) return <button type="button" style={btn} onClick={() => setAberto(true)}>{rotulo}</button>;
  return (
    <div ref={caixa} style={{ position: "relative" }}>
      <input autoFocus value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Modelo, ano ou placa…" aria-label="Buscar carro do Pátio"
        onKeyDown={(e) => { if (e.key === "Escape") setAberto(false); if (e.key === "Enter" && achados[0]) escolher(achados[0]); }}
        style={{ ...btn, width: 230, cursor: "text" }} />
      {termo.trim() && (
        <ul role="listbox" style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 20, width: 340, maxHeight: 320, overflowY: "auto", listStyle: "none", margin: 0, padding: 4, background: "var(--tr-surface-2)", border: "1px solid var(--tr-border)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.15)" }}>
          {achados.length === 0 && <li style={{ padding: 10, fontSize: 13, color: "var(--tr-text-dim)" }}>Nenhum carro do Pátio com esse nome.</li>}
          {achados.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === 0}>
              <button type="button" onClick={() => escolher(c)} style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", textAlign: "left", padding: 6, border: 0, borderRadius: 8, background: i === 0 ? "var(--tr-surface)" : "transparent", cursor: "pointer" }}>
                {c.img ? <img src={c.img} alt="" width={48} height={36} style={{ objectFit: "cover", borderRadius: 5, flex: "none" }} /> : <span style={{ width: 48, height: 36, borderRadius: 5, background: "var(--tr-border)", flex: "none" }} />}
                <span style={{ fontSize: 13, minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600 }}>{c.nome}</span>
                  <span style={{ color: "var(--tr-text-dim)", fontSize: 12 }}>{[c.placa, c.status === "sold" ? "vendido" : null].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EscolherFinalidade({ finalidades, rotulo, atual, onEscolher }: { finalidades: Finalidade[]; rotulo: string; atual?: string | null; onEscolher: (k: string) => void }) {
  return (
    <select value="" onChange={(e) => { if (e.target.value) onEscolher(e.target.value); }} aria-label="Ligar a uma finalidade" style={{ ...btn, cursor: "pointer" }}>
      <option value="">{rotulo}</option>
      {finalidades.map((f) => <option key={f.key} value={f.key} disabled={f.key === atual}>{f.label}</option>)}
    </select>
  );
}
