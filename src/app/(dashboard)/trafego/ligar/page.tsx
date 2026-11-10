"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { lerCard } from "@/lib/patio/entrada-card";
import Link from "next/link";
import { buscarCarros, rotuloCarro, type CarroDoPatio, type LinhaLigacao, type Situacao } from "@/lib/trafego/ligacoes";

// Ligar campanhas — duas formas de trabalhar:
//   • Por campanha: filtra (situação, sugestão, veiculação, período, conversas,
//     gasto), ordena e liga uma a uma, em lote ou aceitando as sugestões da lista.
//   • Por carro: escolhe um carro do Pátio e vê as campanhas que citam o carro
//     no nome, as já ligadas e o resultado dele; liga com um clique.
// Os filtros ficam guardados neste navegador.

type Finalidade = { key: string; label: string };
type Modo = "campanha" | "carro";
type Alvo = { patioId: string } | { finalidade: string } | { limpar: true };
type FiltroSug = "todas" | "carro" | "opcoes" | "finalidade" | "nenhuma";
type Ordem = "gasto" | "recente" | "conversas" | "custoMenor" | "custoMaior" | "nome";
type Filtros = {
  situacoes: Situacao[]; sug: FiltroSug; veic: "todas" | "ar" | "pausada"; dias: 0 | 7 | 30 | 90;
  conversas: "todas" | "com" | "sem"; gastoMin: string; ordem: Ordem; busca: string;
};

const PADRAO: Filtros = { situacoes: ["sem", "fora"], sug: "todas", veic: "todas", dias: 0, conversas: "todas", gastoMin: "", ordem: "gasto", busca: "" };
const CHAVE = "ibox.ligar.filtros.v1";
const CHAVE_RECUSA = "ibox.ligar.recusadas.v1";
const ler = <T,>(k: string, padrao: T): T => { try { const v = localStorage.getItem(k); return v ? { ...padrao, ...JSON.parse(v) } : padrao; } catch { return padrao; } };
const gravar = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brl0 = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dia = (d: string | null) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "");
const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(new Date());
const menosDias = (n: number) => { const d = new Date(hoje() + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const custoConversa = (l: Pick<LinhaLigacao, "investido" | "msgs">) => (l.msgs > 0 ? l.investido / l.msgs : null);

const card: React.CSSProperties = { background: "var(--tr-surface)", border: "1px solid var(--tr-border)", borderRadius: 12 };
const btn: React.CSSProperties = { border: "1px solid var(--tr-border)", borderRadius: 8, padding: "6px 10px", fontSize: 13, background: "transparent", cursor: "pointer", whiteSpace: "nowrap", color: "inherit" };
const btnForte: React.CSSProperties = { ...btn, background: "var(--tr-gold-2)", color: "var(--primary-foreground)", border: "1px solid transparent", fontWeight: 600 };
const chip = (on: boolean): React.CSSProperties => ({ ...btn, padding: "4px 10px", borderRadius: 999, fontSize: 12.5, ...(on ? { background: "var(--tr-text)", color: "var(--tr-bg, var(--tr-surface))", borderColor: "var(--tr-text)", fontWeight: 600 } : {}) });
const rotuloFiltro: React.CSSProperties = { fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--tr-text-dim)", minWidth: 86 };

const SITUACOES: [Situacao, string][] = [["sem", "Sem ligação"], ["fora", "Carro fora do Pátio"], ["carro", "Ligada a carro"], ["dividida", "Dividida entre carros"], ["finalidade", "Ligada a finalidade"]];
const SUGESTOES: [FiltroSug, string][] = [["todas", "Todas"], ["carro", "Carro sugerido"], ["opcoes", "Qual destes?"], ["finalidade", "Finalidade sugerida"], ["nenhuma", "Sem sugestão"]];
const ORDENS: [Ordem, string][] = [["gasto", "Mais investido"], ["recente", "Mais recente"], ["conversas", "Mais conversas"], ["custoMenor", "Menor custo por conversa"], ["custoMaior", "Maior custo por conversa"], ["nome", "Nome"]];

// Qualquer busca de carro da tela pode cadastrar um carro novo na hora.
const CadastroCtx = createContext<{ cadastrar: (termo: string, depois: (c: CarroDoPatio) => void) => void }>({ cadastrar: () => {} });

const statusCarro = (c: CarroDoPatio) => (c.status === "sold" ? "vendido" : c.status === "review" ? "aguardando revisão" : null);

export default function LigarPage() {
  const [linhas, setLinhas] = useState<LinhaLigacao[] | null>(null);
  const [patio, setPatio] = useState<CarroDoPatio[]>([]);
  const [finalidades, setFinalidades] = useState<Finalidade[]>([]);
  const [erro, setErro] = useState("");
  const [modo, setModo] = useState<Modo>("campanha");
  const [f, setF] = useState<Filtros>(PADRAO);
  const [recusadas, setRecusadas] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState<Set<string>>(new Set());
  const [aviso, setAviso] = useState("");
  const [dividindo, setDividindo] = useState<LinhaLigacao | null>(null);
  const [cadastro, setCadastro] = useState<{ termo: string; depois: (c: CarroDoPatio) => void } | null>(null);
  const ctx = useMemo(() => ({ cadastrar: (termo: string, depois: (c: CarroDoPatio) => void) => setCadastro({ termo, depois }) }), []);

  async function recarregar() {
    const r = await fetch("/api/trafego/ligar", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (r.ok) setLinhas(d.linhas);
  }

  useEffect(() => {
    let vivo = true;
    const filtrosSalvos = ler<Filtros>(CHAVE, PADRAO);
    const recusaSalva = ler<{ ids: string[] }>(CHAVE_RECUSA, { ids: [] });
    fetch("/api/trafego/ligar", { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => {
        if (!vivo) return;
        setF(filtrosSalvos);
        setRecusadas(new Set(recusaSalva.ids));
        if (!ok) { setErro(d.erro || "Não consegui carregar as campanhas."); return; }
        setLinhas(d.linhas); setPatio(d.patio); setFinalidades(d.finalidades);
      });
    return () => { vivo = false; };
  }, []);

  const mudar = (m: Partial<Filtros>) => setF((x) => { const n = { ...x, ...m }; gravar(CHAVE, n); return n; });
  const recusar = (id: string) => setRecusadas((r) => { const n = new Set(r); n.add(id); gravar(CHAVE_RECUSA, { ids: [...n] }); return n; });

  // a sugestão some quando a pessoa recusa
  const comRecusa = useMemo(() => (linhas ?? []).map((l) => (recusadas.has(l.id) ? { ...l, sugestao: null, opcoes: [] } : l)), [linhas, recusadas]);
  const tipoSug = (l: LinhaLigacao): FiltroSug => (l.sugestao?.tipo === "carro" ? "carro" : l.sugestao?.tipo === "finalidade" ? "finalidade" : l.opcoes.length ? "opcoes" : "nenhuma");

  async function ligar(ids: string[], alvo: Alvo, silencioso = false) {
    if (!ids.length) return false;
    setOcupado((o) => new Set([...o, ...ids]));
    if (!silencioso) setAviso("");
    const r = await fetch("/api/trafego/ligar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campanhas: ids, ...alvo }) });
    const d = await r.json().catch(() => ({}));
    setOcupado((o) => { const n = new Set(o); ids.forEach((i) => n.delete(i)); return n; });
    if (!r.ok) { setAviso(d.erro || "Não consegui salvar."); return false; }
    const carro = "patioId" in alvo ? patio.find((c) => c.id === alvo.patioId) : null;
    const fin = "finalidade" in alvo ? finalidades.find((x) => x.key === alvo.finalidade) : null;
    setLinhas((ls) => (ls ?? []).map((l) => {
      if (!ids.includes(l.id)) return l;
      if (carro) return { ...l, situacao: "carro", ligadaA: rotuloCarro(carro), patioId: carro.id, finalidade: null, foraId: null, sugestao: null, opcoes: [], divisao: null, partes: [] };
      if (fin) return { ...l, situacao: "finalidade", ligadaA: fin.label, patioId: null, finalidade: fin.key, foraId: null, sugestao: null, opcoes: [], divisao: null, partes: [] };
      return { ...l, situacao: "sem", ligadaA: null, patioId: null, finalidade: null, foraId: null, divisao: null, partes: [] };
    }));
    setSel((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; });
    if (!silencioso) {
      const quanto = ids.length === 1 ? "1 campanha" : `${ids.length} campanhas`;
      setAviso("limpar" in alvo ? `Ligação desfeita (${quanto}).` : `${quanto} ligada(s) a ${carro ? rotuloCarro(carro) : fin?.label}.`);
    }
    return true;
  }

  async function aceitarSugestoes(lista: LinhaLigacao[]) {
    const grupos = new Map<string, { alvo: Alvo; ids: string[] }>();
    for (const l of lista) {
      if (!l.sugestao) continue;
      const k = l.sugestao.tipo === "carro" ? `c:${l.sugestao.patioId}` : `f:${l.sugestao.chave}`;
      const alvo: Alvo = l.sugestao.tipo === "carro" ? { patioId: l.sugestao.patioId } : { finalidade: l.sugestao.chave };
      grupos.set(k, { alvo, ids: [...(grupos.get(k)?.ids ?? []), l.id] });
    }
    let n = 0;
    for (const g of grupos.values()) if (await ligar(g.ids, g.alvo, true)) n += g.ids.length;
    setAviso(`${n} sugestão(ões) aceita(s).`);
  }

  return (
    <CadastroCtx.Provider value={ctx}>
    <main className="px-6 py-8 max-w-7xl mx-auto" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--tr-text-dim)" }}><Link href="/trafego/campanhas">Campanhas</Link> / Ligar</p>
          <h1 className="text-xl font-bold" style={{ margin: "4px 0 0" }}>Ligar campanhas</h1>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--tr-text-dim)", maxWidth: 720 }}>Cada campanha vai para um <b>carro do Pátio</b> ou para uma <b>finalidade</b> (Instagram, site, marca…). É isso que coloca o gasto no custo de cada carro.</p>
        </div>
        <div role="tablist" aria-label="Forma de trabalhar" style={{ display: "flex", gap: 4, padding: 4, ...card }}>
          {([["campanha", "Por campanha"], ["carro", "Por carro do Pátio"]] as [Modo, string][]).map(([k, n]) => (
            <button key={k} role="tab" aria-selected={modo === k} type="button" onClick={() => { setModo(k); setSel(new Set()); }} style={{ ...btn, border: 0, ...(modo === k ? { background: "var(--tr-surface-2)", fontWeight: 600 } : {}) }}>{n}</button>
          ))}
        </div>
      </header>

      {erro && <p role="alert" style={{ color: "var(--tr-bad)", margin: 0 }}>{erro}</p>}
      {!linhas && !erro && <p style={{ margin: 0 }}>Carregando campanhas…</p>}
      {aviso && <p role="status" style={{ margin: 0, fontSize: 14, color: "var(--tr-good)" }}>{aviso}</p>}

      {linhas && <Placar linhas={comRecusa} />}

      {linhas && modo === "campanha" && (
        <PorCampanha linhas={comRecusa} patio={patio} finalidades={finalidades} f={f} mudar={mudar} tipoSug={tipoSug}
          sel={sel} setSel={setSel} ocupado={ocupado} ligar={ligar} aceitarSugestoes={aceitarSugestoes} recusar={recusar}
          restaurarRecusas={recusadas.size ? () => { setRecusadas(new Set()); gravar(CHAVE_RECUSA, { ids: [] }); } : null} onDividir={setDividindo} />
      )}
      {linhas && modo === "carro" && <PorCarro linhas={comRecusa} patio={patio} ocupado={ocupado} ligar={ligar} onDividir={setDividindo} />}
      {cadastro && (
        <CadastroRapido termo={cadastro.termo} onFechar={() => setCadastro(null)}
          onCriado={(c) => { setPatio((ps) => (ps.some((x) => x.id === c.id) ? ps : [...ps, c].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")))); const depois = cadastro.depois; setCadastro(null); depois(c); }} />
      )}
      {dividindo && <PainelDivisao linha={dividindo} patio={patio} onFechar={() => setDividindo(null)} onSalvo={async (txt) => { setDividindo(null); setAviso(txt); await recarregar(); }} />}
    </main>
    </CadastroCtx.Provider>
  );
}

// ---------- placar do topo ----------
function Placar({ linhas }: { linhas: LinhaLigacao[] }) {
  const total = linhas.reduce((s, l) => s + l.investido, 0);
  const soma = (sit: Situacao[]) => linhas.filter((l) => sit.includes(l.situacao)).reduce((s, l) => s + l.investido, 0);
  const noCarro = soma(["carro", "dividida"]), naFinalidade = soma(["finalidade"]), solto = soma(["sem", "fora"]);
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  const barras: [string, number, string][] = [["Em carros do Pátio", noCarro, "var(--tr-good)"], ["Em finalidades", naFinalidade, "var(--tr-text-dim)"], ["Sem destino certo", solto, "var(--tr-bad)"]];
  return (
    <section style={{ ...card, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }} aria-label="Onde está o investimento">
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "baseline" }}>
        <span style={{ fontSize: 13, color: "var(--tr-text-dim)" }}>Investido desde o início (com imposto): <b style={{ fontSize: 18, color: "var(--tr-text)" }}>{brl(total)}</b></span>
        {barras.map(([n, v, cor]) => (
          <span key={n} style={{ fontSize: 13 }}><span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: cor, marginRight: 6 }} />{n}: <b>{brl0(v)}</b> <span style={{ color: "var(--tr-text-dim)" }}>({pct(v)}%)</span></span>
        ))}
      </div>
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--tr-border)" }}>
        {barras.map(([n, v, cor]) => <span key={n} title={`${n}: ${brl(v)}`} style={{ width: `${total ? (v / total) * 100 : 0}%`, background: cor }} />)}
      </div>
    </section>
  );
}

// ---------- por campanha ----------
function PorCampanha(p: {
  linhas: LinhaLigacao[]; patio: CarroDoPatio[]; finalidades: Finalidade[]; f: Filtros; mudar: (m: Partial<Filtros>) => void;
  tipoSug: (l: LinhaLigacao) => FiltroSug; sel: Set<string>; setSel: React.Dispatch<React.SetStateAction<Set<string>>>; ocupado: Set<string>;
  ligar: (ids: string[], alvo: Alvo) => Promise<boolean>; aceitarSugestoes: (l: LinhaLigacao[]) => void; recusar: (id: string) => void; restaurarRecusas: (() => void) | null;
  onDividir: (l: LinhaLigacao) => void;
}) {
  const { linhas, f, mudar, tipoSug, sel, setSel } = p;
  const desde = f.dias ? menosDias(f.dias) : null;
  const antesDaSugestao = useMemo(() => {
    const t = f.busca.trim().toLowerCase();
    const min = Number(String(f.gastoMin).replace(",", ".")) || 0;
    return linhas.filter((l) =>
      f.situacoes.includes(l.situacao) &&
      (f.veic === "todas" || (f.veic === "ar" ? l.ativa : !l.ativa)) &&
      (!desde || (l.ultimoDia && l.ultimoDia >= desde) || l.ativa) &&
      (f.conversas === "todas" || (f.conversas === "com" ? l.msgs > 0 : l.msgs === 0)) &&
      l.investido >= min &&
      (!t || l.nome.toLowerCase().includes(t) || (l.ligadaA ?? "").toLowerCase().includes(t)));
  }, [linhas, f, desde]);
  const contaSug = (k: FiltroSug) => (k === "todas" ? antesDaSugestao.length : antesDaSugestao.filter((l) => tipoSug(l) === k).length);
  const lista = useMemo(() => {
    const x = antesDaSugestao.filter((l) => f.sug === "todas" || tipoSug(l) === f.sug);
    const cc = (l: LinhaLigacao) => custoConversa(l);
    const ord: Record<Ordem, (a: LinhaLigacao, b: LinhaLigacao) => number> = {
      gasto: (a, b) => Number(b.ativa) - Number(a.ativa) || b.investido - a.investido,
      recente: (a, b) => String(b.ultimoDia ?? "").localeCompare(String(a.ultimoDia ?? "")),
      conversas: (a, b) => b.msgs - a.msgs,
      custoMenor: (a, b) => (cc(a) ?? Infinity) - (cc(b) ?? Infinity),
      custoMaior: (a, b) => (cc(b) ?? -1) - (cc(a) ?? -1),
      nome: (a, b) => a.nome.localeCompare(b.nome, "pt-BR"),
    };
    return [...x].sort(ord[f.ordem]);
  }, [antesDaSugestao, f.sug, f.ordem, tipoSug]);

  const contaSit = (s: Situacao) => linhas.filter((l) => l.situacao === s).length;
  const tot = lista.reduce((a, l) => ({ g: a.g + l.investido, m: a.m + l.msgs }), { g: 0, m: 0 });
  const sugeridas = lista.filter((l) => l.sugestao);
  const todasMarcadas = lista.length > 0 && lista.every((l) => sel.has(l.id));
  const ids = [...sel];
  const filtrosMexidos = JSON.stringify({ ...f, busca: "" }) !== JSON.stringify({ ...PADRAO, busca: "" }) || f.busca;

  return (
    <>
      <section style={{ ...card, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }} aria-label="Filtros">
        <Grupo nome="Situação">
          {SITUACOES.map(([k, n]) => {
            const on = f.situacoes.includes(k);
            return <button key={k} type="button" aria-pressed={on} style={chip(on)} onClick={() => mudar({ situacoes: on ? f.situacoes.filter((x) => x !== k) : [...f.situacoes, k] })}>{n} · {contaSit(k)}</button>;
          })}
        </Grupo>
        <Grupo nome="Sugestão">
          {SUGESTOES.map(([k, n]) => <button key={k} type="button" aria-pressed={f.sug === k} style={chip(f.sug === k)} onClick={() => mudar({ sug: k })}>{n} · {contaSug(k)}</button>)}
        </Grupo>
        <Grupo nome="Veiculação">
          {([["todas", "Todas"], ["ar", "No ar"], ["pausada", "Pausadas"]] as const).map(([k, n]) => <button key={k} type="button" aria-pressed={f.veic === k} style={chip(f.veic === k)} onClick={() => mudar({ veic: k })}>{n}</button>)}
          <span style={{ width: 12 }} />
          <span style={{ ...rotuloFiltro, minWidth: 0 }}>Gastou nos últimos</span>
          {([[0, "Qualquer data"], [7, "7 dias"], [30, "30 dias"], [90, "90 dias"]] as const).map(([k, n]) => <button key={k} type="button" aria-pressed={f.dias === k} style={chip(f.dias === k)} onClick={() => mudar({ dias: k })}>{n}</button>)}
        </Grupo>
        <Grupo nome="Resultado">
          {([["todas", "Todas"], ["com", "Com conversas"], ["sem", "Sem conversas"]] as const).map(([k, n]) => <button key={k} type="button" aria-pressed={f.conversas === k} style={chip(f.conversas === k)} onClick={() => mudar({ conversas: k })}>{n}</button>)}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginLeft: 12 }}>Investido acima de R$
            <input inputMode="decimal" value={f.gastoMin} onChange={(e) => mudar({ gastoMin: e.target.value.replace(/[^\d,.]/g, "") })} style={{ ...btn, width: 80, cursor: "text", padding: "4px 8px" }} aria-label="Investido mínimo" />
          </label>
        </Grupo>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input type="search" value={f.busca} onChange={(e) => mudar({ busca: e.target.value })} placeholder="Buscar campanha ou carro ligado…" style={{ ...btn, flex: 1, minWidth: 220, cursor: "text" }} aria-label="Buscar campanha" />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>Ordenar
            <select value={f.ordem} onChange={(e) => mudar({ ordem: e.target.value as Ordem })} style={btn}>{ORDENS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          </label>
          {filtrosMexidos && <button type="button" style={{ ...btn, color: "var(--tr-text-dim)" }} onClick={() => mudar(PADRAO)}>Limpar filtros</button>}
          {p.restaurarRecusas && <button type="button" style={{ ...btn, color: "var(--tr-text-dim)" }} onClick={p.restaurarRecusas}>Mostrar sugestões recusadas</button>}
        </div>
      </section>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <p style={{ margin: 0, fontSize: 14 }}>
          <b>{lista.length}</b> campanha(s) · <b>{brl(tot.g)}</b> · <b>{tot.m}</b> conversas{tot.m ? <> · <b>{brl(tot.g / tot.m)}</b> por conversa</> : null}
        </p>
        {sugeridas.length > 0 && <button type="button" style={btnForte} disabled={p.ocupado.size > 0} onClick={() => p.aceitarSugestoes(sugeridas)}>Aceitar as {sugeridas.length} sugestões desta lista</button>}
      </div>

      {ids.length > 0 && (
        <section style={{ ...card, padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", position: "sticky", top: 8, zIndex: 6, borderColor: "var(--tr-gold-2)" }} aria-label="Ações em lote">
          <b style={{ fontSize: 14 }}>{ids.length} marcada(s):</b>
          <EscolherCarro patio={p.patio} rotulo="Ligar a um carro…" onEscolher={(c) => p.ligar(ids, { patioId: c.id })} />
          <EscolherFinalidade finalidades={p.finalidades} rotulo="Ligar a uma finalidade…" onEscolher={(k) => p.ligar(ids, { finalidade: k })} />
          {lista.some((l) => sel.has(l.id) && l.sugestao) && <button type="button" style={btn} onClick={() => p.aceitarSugestoes(lista.filter((l) => sel.has(l.id)))}>Aceitar sugestões das marcadas</button>}
          {lista.some((l) => sel.has(l.id) && (l.situacao === "carro" || l.situacao === "finalidade" || l.situacao === "dividida")) && <button type="button" style={btn} onClick={() => p.ligar(ids, { limpar: true })}>Desfazer ligação</button>}
          <button type="button" style={{ ...btn, color: "var(--tr-text-dim)" }} onClick={() => setSel(new Set())}>Cancelar</button>
        </section>
      )}

      {lista.length === 0 ? (
        <section style={{ ...card, padding: 20, fontSize: 14 }}>Nenhuma campanha com esses filtros.{filtrosMexidos ? " Tente limpar os filtros." : ""}</section>
      ) : (
        <section style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: "1px solid var(--tr-border)", fontSize: 12, color: "var(--tr-text-dim)" }}>
            <input type="checkbox" checked={todasMarcadas} onChange={() => setSel(todasMarcadas ? new Set() : new Set(lista.map((l) => l.id)))} aria-label="Marcar todas da lista" />
            <span>Marcar as {lista.length} da lista</span>
          </div>
          {lista.map((l) => (
            <LinhaCampanha key={l.id} l={l} patio={p.patio} finalidades={p.finalidades} marcada={sel.has(l.id)} ocupada={p.ocupado.has(l.id)}
              onMarcar={() => setSel((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}
              onLigar={(alvo) => p.ligar([l.id], alvo)} onRecusar={() => p.recusar(l.id)} onDividir={() => p.onDividir(l)} />
          ))}
        </section>
      )}
    </>
  );
}

function Grupo({ nome, children }: { nome: string; children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}><span style={rotuloFiltro}>{nome}</span>{children}</div>;
}

function Situacao({ l }: { l: LinhaLigacao }) {
  const s = {
    sem: { txt: "Sem ligação", cor: "var(--tr-bad)" },
    fora: { txt: `Ligada a carro fora do Pátio: ${l.ligadaA}`, cor: "var(--tr-bad)" },
    carro: { txt: `Carro: ${l.ligadaA}`, cor: "var(--tr-good)" },
    finalidade: { txt: `Finalidade: ${l.ligadaA}`, cor: "var(--tr-good)" },
    dividida: { txt: l.ligadaA ?? "Dividida", cor: "var(--tr-good)" },
  }[l.situacao];
  return <div style={{ fontSize: 12, marginTop: 3, color: s.cor }}>{s.txt}</div>;
}

function Metricas({ l }: { l: LinhaLigacao }) {
  const cc = custoConversa(l);
  return (
    <div style={{ fontSize: 12, color: "var(--tr-text-dim)", marginTop: 2 }}>
      <span style={{ color: l.ativa ? "var(--tr-good)" : undefined }}>{l.ativa ? "● No ar" : "Pausada"}</span>
      {" · "}{brl(l.investido)} · {l.msgs} conversa(s){cc != null ? ` · ${brl(cc)}/conversa` : ""}{l.primeiroDia ? ` · ${dia(l.primeiroDia)} a ${dia(l.ultimoDia)}` : ""}
    </div>
  );
}

function LinhaCampanha({ l, patio, finalidades, marcada, ocupada, onMarcar, onLigar, onRecusar, onDividir }: {
  l: LinhaLigacao; patio: CarroDoPatio[]; finalidades: Finalidade[]; marcada: boolean; ocupada: boolean;
  onMarcar: () => void; onLigar: (alvo: Alvo) => void; onRecusar: () => void; onDividir: () => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto minmax(240px, 1.2fr) minmax(300px, 2fr)", gap: 12, alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--tr-border)", opacity: ocupada ? 0.5 : 1, background: marcada ? "var(--tr-surface-2)" : undefined }}>
      <input type="checkbox" checked={marcada} onChange={onMarcar} aria-label={`Marcar ${l.nome}`} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.nome}>{l.nome}</div>
        <Metricas l={l} />
        <Situacao l={l} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
        {l.sugestao && (
          <span style={{ display: "inline-flex" }}>
            <button type="button" style={{ ...btnForte, borderTopRightRadius: 0, borderBottomRightRadius: 0 }} disabled={ocupada} title="Aceitar a sugestão"
              onClick={() => onLigar(l.sugestao!.tipo === "carro" ? { patioId: l.sugestao!.patioId } : { finalidade: (l.sugestao as { chave: string }).chave })}>✓ {l.sugestao.rotulo}</button>
            <button type="button" style={{ ...btnForte, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: "1px solid rgba(0,0,0,.15)", padding: "6px 8px" }} disabled={ocupada} onClick={onRecusar} title="Recusar a sugestão" aria-label="Recusar a sugestão">✕</button>
          </span>
        )}
        {!l.sugestao && l.opcoes.length > 0 && (
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
            <span style={{ fontSize: 12, color: "var(--tr-text-dim)" }}>Qual destes?</span>
            {l.opcoes.map((o) => <button key={o.patioId} type="button" style={{ ...btn, borderColor: "var(--tr-gold-2)" }} disabled={ocupada} onClick={() => onLigar({ patioId: o.patioId })}>{o.rotulo}</button>)}
          </span>
        )}
        <EscolherCarro patio={patio} rotulo={l.situacao === "carro" ? "Trocar carro…" : l.opcoes.length || l.sugestao ? "Outro carro…" : "Carro…"} onEscolher={(c) => onLigar({ patioId: c.id })} />
        <button type="button" style={btn} onClick={onDividir} title="Campanha com anúncios de carros diferentes, ou um anúncio com mais de um carro">{l.situacao === "dividida" ? "Ver divisão…" : "Dividir…"}</button>
        <EscolherFinalidade finalidades={finalidades} rotulo="Não é carro…" atual={l.finalidade} onEscolher={(k) => onLigar({ finalidade: k })} />
        {(l.situacao === "carro" || l.situacao === "finalidade" || l.situacao === "dividida") && <button type="button" style={{ ...btn, color: "var(--tr-text-dim)" }} onClick={() => onLigar({ limpar: true })}>Desfazer</button>}
      </div>
    </div>
  );
}

// ---------- por carro do Pátio ----------
function PorCarro({ linhas, patio, ocupado, ligar, onDividir }: { linhas: LinhaLigacao[]; patio: CarroDoPatio[]; ocupado: Set<string>; ligar: (ids: string[], alvo: Alvo) => Promise<boolean>; onDividir: (l: LinhaLigacao) => void }) {
  const [busca, setBusca] = useState("");
  const [estado, setEstado] = useState<"venda" | "vendidos" | "todos">("venda");
  const [soSemAnuncio, setSoSemAnuncio] = useState(false);
  const [ordem, setOrdem] = useState<"possiveis" | "investido" | "nome">("possiveis");
  const [aberto, setAberto] = useState<string | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [buscaCamp, setBuscaCamp] = useState("");

  const porCarro = useMemo(() => {
    const m = new Map<string, { ligadas: LinhaLigacao[]; possiveis: LinhaLigacao[] }>();
    for (const c of patio) m.set(c.id, { ligadas: [], possiveis: [] });
    for (const l of linhas) {
      if (l.situacao === "carro" && l.patioId) m.get(l.patioId)?.ligadas.push(l);
      // dividida: entra em cada carro só com a parte dele
      if (l.situacao === "dividida") for (const p of l.partes) m.get(p.patioId)?.ligadas.push({ ...l, investido: p.investido, msgs: p.msgs });
      if (l.situacao === "sem" || l.situacao === "fora") for (const id of l.candidatos) m.get(id)?.possiveis.push(l);
    }
    return m;
  }, [linhas, patio]);

  const carros = useMemo(() => {
    const t = busca.trim();
    const base = t ? buscarCarros(patio, t, 500) : patio;
    return base
      .filter((c) => estado === "todos" || (estado === "vendidos" ? c.status === "sold" : c.status !== "sold"))
      .filter((c) => !soSemAnuncio || !(porCarro.get(c.id)?.ligadas.length))
      .map((c) => {
        const d = porCarro.get(c.id)!;
        return { c, investido: d.ligadas.reduce((s, l) => s + l.investido, 0), msgs: d.ligadas.reduce((s, l) => s + l.msgs, 0), nLigadas: d.ligadas.length, nPossiveis: d.possiveis.length };
      })
      .sort((a, b) => (ordem === "nome" ? a.c.nome.localeCompare(b.c.nome, "pt-BR") : ordem === "investido" ? b.investido - a.investido : b.nPossiveis - a.nPossiveis || b.investido - a.investido));
  }, [patio, busca, estado, soSemAnuncio, ordem, porCarro]);

  const atual = carros.find((x) => x.c.id === aberto) ?? carros.at(0) ?? null;
  const dados = atual ? porCarro.get(atual.c.id)! : null;
  const outras = useMemo(() => {
    const t = buscaCamp.trim().toLowerCase();
    if (!t || !atual) return [];
    return linhas.filter((l) => (l.situacao === "sem" || l.situacao === "fora") && !l.candidatos.includes(atual.c.id) && l.nome.toLowerCase().includes(t)).slice(0, 30);
  }, [buscaCamp, linhas, atual]);

  const ligarAqui = async (ids: string[]) => { if (atual && (await ligar(ids, { patioId: atual.c.id }))) setMarcadas(new Set()); };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 16, alignItems: "start" }}>
      <section style={{ ...card, display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 220px)", position: "sticky", top: 8 }} aria-label="Carros do Pátio">
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, borderBottom: "1px solid var(--tr-border)" }}>
          <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Modelo, ano ou placa…" style={{ ...btn, cursor: "text" }} aria-label="Buscar carro do Pátio" />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {([["venda", "No estoque"], ["vendidos", "Vendidos"], ["todos", "Todos"]] as const).map(([k, n]) => <button key={k} type="button" aria-pressed={estado === k} style={chip(estado === k)} onClick={() => setEstado(k)}>{n}</button>)}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", fontSize: 12.5 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={soSemAnuncio} onChange={(e) => setSoSemAnuncio(e.target.checked)} />Só sem campanha ligada</label>
            <select value={ordem} onChange={(e) => setOrdem(e.target.value as typeof ordem)} style={{ ...btn, padding: "4px 8px", fontSize: 12.5 }} aria-label="Ordenar carros">
              <option value="possiveis">Mais campanhas para ligar</option><option value="investido">Mais investido</option><option value="nome">Nome</option>
            </select>
          </div>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 6, overflowY: "auto" }}>
          {carros.length === 0 && <li style={{ padding: 12, fontSize: 13, color: "var(--tr-text-dim)" }}>Nenhum carro com esses filtros.</li>}
          {carros.map((x) => (
            <li key={x.c.id}>
              <button type="button" onClick={() => { setAberto(x.c.id); setMarcadas(new Set()); setBuscaCamp(""); }} aria-current={atual?.c.id === x.c.id}
                style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", textAlign: "left", padding: 8, border: 0, borderRadius: 10, cursor: "pointer", color: "inherit", background: atual?.c.id === x.c.id ? "var(--tr-surface-2)" : "transparent" }}>
                <Foto src={x.c.img} w={56} h={42} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.c.nome}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--tr-text-dim)" }}>{[x.c.placa, statusCarro(x.c)].filter(Boolean).join(" · ")}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--tr-text-dim)" }}>{x.nLigadas ? `${brl0(x.investido)} · ${x.nLigadas} campanha(s)` : "Sem campanha ligada"}</span>
                </span>
                {x.nPossiveis > 0 && <span title="Campanhas sem ligação que citam este carro" style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "var(--tr-gold-2)", color: "var(--primary-foreground)" }}>{x.nPossiveis}</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {atual && dados ? (
        <section style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-label={`Campanhas de ${atual.c.nome}`}>
          <div style={{ ...card, padding: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Foto src={atual.c.img} w={120} h={90} />
            <div style={{ flex: 1, minWidth: 220 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{atual.c.nome}</h2>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--tr-text-dim)" }}>{[atual.c.placa, atual.c.status === "sold" ? "Vendido" : "No estoque", atual.c.preco ? brl0(atual.c.preco) : null].filter(Boolean).join(" · ")}</p>
              <div style={{ display: "flex", gap: 20, marginTop: 10, flexWrap: "wrap", fontSize: 13 }}>
                <span>Investido <b>{brl(atual.investido)}</b></span>
                <span>Conversas <b>{atual.msgs}</b></span>
                <span>Por conversa <b>{atual.msgs ? brl(atual.investido / atual.msgs) : "—"}</b></span>
                {atual.c.preco ? <span>Anúncio sobre o preço <b>{((atual.investido / atual.c.preco) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</b></span> : null}
              </div>
            </div>
            <Link href={`/patio/${atual.c.id}`} style={btn}>Abrir no Pátio</Link>
          </div>

          <div style={{ ...card }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--tr-border)", flexWrap: "wrap" }}>
              <b style={{ fontSize: 14 }}>Campanhas que podem ser deste carro · {dados.possiveis.length}</b>
              {dados.possiveis.length > 0 && (
                <span style={{ display: "flex", gap: 8 }}>
                  <button type="button" style={btn} onClick={() => setMarcadas(marcadas.size === dados.possiveis.length ? new Set() : new Set(dados.possiveis.map((l) => l.id)))}>{marcadas.size === dados.possiveis.length ? "Desmarcar" : "Marcar todas"}</button>
                  <button type="button" style={btnForte} disabled={!marcadas.size || ocupado.size > 0} onClick={() => ligarAqui([...marcadas])}>Ligar {marcadas.size || ""} a este carro</button>
                </span>
              )}
            </div>
            {dados.possiveis.length === 0 && <p style={{ margin: 0, padding: 14, fontSize: 13, color: "var(--tr-text-dim)" }}>Nenhuma campanha sem ligação cita este carro no nome. Use a busca abaixo para achar outra.</p>}
            {dados.possiveis.map((l) => (
              <div key={l.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--tr-border)", opacity: ocupado.has(l.id) ? 0.5 : 1 }}>
                <input type="checkbox" checked={marcadas.has(l.id)} onChange={() => setMarcadas((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} aria-label={`Marcar ${l.nome}`} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{l.nome}</div>
                  <Metricas l={l} />
                  {l.situacao === "fora" && <Situacao l={l} />}
                  {l.candidatos.length > 1 && <div style={{ fontSize: 12, color: "var(--tr-text-dim)", marginTop: 2 }}>Também pode ser de outros {l.candidatos.length - 1} carro(s) do mesmo modelo.</div>}
                </div>
                <button type="button" style={btnForte} disabled={ocupado.has(l.id)} onClick={() => ligarAqui([l.id])}>Ligar</button>
              </div>
            ))}
            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <input type="search" value={buscaCamp} onChange={(e) => setBuscaCamp(e.target.value)} placeholder="Buscar outra campanha sem ligação pelo nome…" style={{ ...btn, cursor: "text" }} aria-label="Buscar outra campanha" />
              {outras.map((l) => (
                <div key={l.id} style={{ display: "flex", gap: 12, alignItems: "center", opacity: ocupado.has(l.id) ? 0.5 : 1 }}>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 600 }}>{l.nome}</div><Metricas l={l} /></div>
                  <button type="button" style={btn} disabled={ocupado.has(l.id)} onClick={() => ligarAqui([l.id])}>Ligar a este carro</button>
                </div>
              ))}
              {buscaCamp.trim() && outras.length === 0 && <span style={{ fontSize: 12.5, color: "var(--tr-text-dim)" }}>Nenhuma outra campanha sem ligação com esse nome.</span>}
            </div>
          </div>

          <div style={{ ...card }}>
            <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--tr-border)" }}><b style={{ fontSize: 14 }}>Campanhas ligadas · {dados.ligadas.length}</b></div>
            {dados.ligadas.length === 0 && <p style={{ margin: 0, padding: 14, fontSize: 13, color: "var(--tr-text-dim)" }}>Ainda nenhuma.</p>}
            {[...dados.ligadas].sort((a, b) => b.investido - a.investido).map((l) => (
              <div key={l.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--tr-border)", opacity: ocupado.has(l.id) ? 0.5 : 1 }}>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 13.5 }}>{l.nome}</div><Metricas l={l} />{l.situacao === "dividida" && <Situacao l={l} />}</div>
                {l.situacao === "dividida"
                  ? <button type="button" style={btn} onClick={() => onDividir(l)}>Ver divisão…</button>
                  : <button type="button" style={{ ...btn, color: "var(--tr-text-dim)" }} disabled={ocupado.has(l.id)} onClick={() => ligar([l.id], { limpar: true })}>Desfazer</button>}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section style={{ ...card, padding: 20, fontSize: 14 }}>Escolha um carro na lista.</section>
      )}
    </div>
  );
}

function Foto({ src, w, h }: { src: string | null; w: number; h: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" width={w} height={h} style={{ objectFit: "cover", borderRadius: 8, flex: "none", width: w, height: h }} /> : <span style={{ width: w, height: h, borderRadius: 8, background: "var(--tr-border)", flex: "none", display: "inline-block" }} />;
}

// ---------- seletores ----------
function EscolherCarro({ patio, rotulo, onEscolher }: { patio: CarroDoPatio[]; rotulo: string; onEscolher: (c: CarroDoPatio) => void }) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState("");
  const [foco, setFoco] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const achados = useMemo(() => buscarCarros(patio, termo), [patio, termo]);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    // a lista fica presa à tela (position: fixed), sempre inteira e visível,
    // mesmo dentro do painel lateral ou perto da borda
    const medir = () => {
      const r = campo.current?.getBoundingClientRect();
      if (!r) return;
      const largura = Math.min(380, window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - largura - 8));
      const embaixo = window.innerHeight - r.bottom;
      setPos({ top: embaixo < 260 && r.top > embaixo ? Math.max(8, r.top - 344) : r.bottom + 4, left, width: largura });
    };
    medir();
    document.addEventListener("mousedown", fora);
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, true);
    return () => { document.removeEventListener("mousedown", fora); window.removeEventListener("resize", medir); window.removeEventListener("scroll", medir, true); };
  }, [aberto]);
  const { cadastrar } = useContext(CadastroCtx);
  const escolher = (c: CarroDoPatio) => { setAberto(false); setTermo(""); setFoco(0); onEscolher(c); };
  const novo = () => { const t = termo; setAberto(false); setTermo(""); cadastrar(t, onEscolher); };
  if (!aberto) return <button type="button" style={btn} onClick={() => setAberto(true)}>{rotulo}</button>;
  return (
    <div ref={caixa} style={{ position: "relative" }}>
      <input ref={campo} autoFocus value={termo} onChange={(e) => { setTermo(e.target.value); setFoco(0); }} placeholder="Modelo, ano ou placa…" aria-label="Buscar carro do Pátio"
        onKeyDown={(e) => {
          if (e.key === "Escape") setAberto(false);
          if (e.key === "ArrowDown") { e.preventDefault(); setFoco((i) => Math.min(i + 1, achados.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setFoco((i) => Math.max(i - 1, 0)); }
          if (e.key === "Enter" && achados[foco]) escolher(achados[foco]);
        }}
        style={{ ...btn, width: 230, cursor: "text" }} />
      {termo.trim() && pos && (
        <ul role="listbox" style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 80, width: pos.width, maxHeight: 340, overflowY: "auto", listStyle: "none", margin: 0, padding: 4, background: "var(--tr-surface-2)", border: "1px solid var(--tr-border)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.15)" }}>
          {achados.length === 0 && <li style={{ padding: "10px 10px 4px", fontSize: 13, color: "var(--tr-text-dim)" }}>Nenhum carro do Pátio com esse nome.</li>}
          {achados.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === foco}>
              <button type="button" onMouseEnter={() => setFoco(i)} onClick={() => escolher(c)} style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", textAlign: "left", padding: 6, border: 0, borderRadius: 8, color: "inherit", background: i === foco ? "var(--tr-surface)" : "transparent", cursor: "pointer" }}>
                <Foto src={c.img} w={48} h={36} />
                <span style={{ fontSize: 13, minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600 }}>{c.nome}</span>
                  <span style={{ color: "var(--tr-text-dim)", fontSize: 12 }}>{[c.placa, statusCarro(c), c.preco ? brl0(c.preco) : null].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
            </li>
          ))}
          <li style={{ borderTop: "1px solid var(--tr-border)", marginTop: 4, paddingTop: 4 }}>
            <button type="button" onClick={novo} style={{ width: "100%", textAlign: "left", padding: "8px 10px", border: 0, borderRadius: 8, background: "transparent", color: "inherit", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              + Cadastrar carro novo{termo.trim() ? ` “${termo.trim()}”` : ""} <span style={{ fontWeight: 400, color: "var(--tr-text-dim)" }}>— não está no Pátio</span>
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

function EscolherFinalidade({ finalidades, rotulo, atual, onEscolher }: { finalidades: Finalidade[]; rotulo: string; atual?: string | null; onEscolher: (k: string) => void }) {
  return (
    <select value="" onChange={(e) => { if (e.target.value) onEscolher(e.target.value); }} aria-label="Ligar a uma finalidade" style={{ ...btn, cursor: "pointer" }}>
      <option value="">{rotulo}</option>
      {finalidades.map((x) => <option key={x.key} value={x.key} disabled={x.key === atual}>{x.label}</option>)}
    </select>
  );
}

// ---------- dividir uma campanha entre carros ----------
type AnuncioDiv = { id: string; nome: string; conjunto: string | null; status: string | null; gasto: number; msgs: number; patioId: string | null; sugestao: string | null; candidatos: string[] };
type DadosDivisao = { campanha: { id: string; nome: string; divisao: string | null; gasto: number }; anuncios: AnuncioDiv[]; divisoes: { patioId: string; peso: number }[]; aviso: string };

function PainelDivisao({ linha, patio, onFechar, onSalvo }: { linha: LinhaLigacao; patio: CarroDoPatio[]; onFechar: () => void; onSalvo: (aviso: string) => void }) {
  const [d, setD] = useState<DadosDivisao | null>(null);
  const [erro, setErro] = useState("");
  const [modo, setModo] = useState<"anuncio" | "manual">("anuncio");
  const [carroDoAnuncio, setCarroDoAnuncio] = useState<Record<string, string | null>>({});
  const [partes, setPartes] = useState<{ patioId: string; peso: number }[]>([]);
  const [salvando, setSalvando] = useState(false);
  const porId = useMemo(() => new Map(patio.map((c) => [c.id, c])), [patio]);
  const nomeCarro = (id: string | null) => (id ? (porId.get(id) ? rotuloCarro(porId.get(id)!) : "carro") : "Sem carro");

  useEffect(() => {
    let vivo = true;
    fetch(`/api/trafego/dividir?campanha=${linha.id}`, { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => ({})) }))
      .then(({ ok, j }) => {
        if (!vivo) return;
        if (!ok) { setErro(j.erro || "Não consegui abrir a divisão."); return; }
        const dados = j as DadosDivisao;
        setD(dados);
        setModo(dados.campanha.divisao === "manual" || (dados.anuncios.length < 2 && !dados.campanha.divisao) ? "manual" : "anuncio");
        setCarroDoAnuncio(Object.fromEntries(dados.anuncios.map((a) => [a.id, a.patioId ?? a.sugestao ?? null])));
        setPartes(dados.divisoes.length ? dados.divisoes : linha.candidatos.slice(0, 2).map((id) => ({ patioId: id, peso: 50 })));
      });
    return () => { vivo = false; };
  }, [linha.id, linha.candidatos]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onFechar]);

  async function salvar(corpo: Record<string, unknown>, txt: string) {
    setSalvando(true); setErro("");
    const r = await fetch("/api/trafego/dividir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campanha: linha.id, ...corpo }) });
    const j = await r.json().catch(() => ({}));
    setSalvando(false);
    if (!r.ok) { setErro(j.erro || "Não consegui salvar."); return; }
    onSalvo(txt);
  }

  // resumo da divisão por anúncio
  const resumoAnuncio = useMemo(() => {
    const m = new Map<string | null, { gasto: number; msgs: number }>();
    for (const a of d?.anuncios ?? []) { const k = carroDoAnuncio[a.id] ?? null; const x = m.get(k) ?? { gasto: 0, msgs: 0 }; x.gasto += a.gasto; x.msgs += a.msgs; m.set(k, x); }
    return [...m.entries()].sort((a, b) => b[1].gasto - a[1].gasto);
  }, [d, carroDoAnuncio]);
  const totalPeso = partes.reduce((s, p) => s + (Number(p.peso) || 0), 0);
  const carrosAnuncio = new Set(Object.values(carroDoAnuncio).filter(Boolean)).size;

  return (
    <div role="dialog" aria-modal="true" aria-label={`Dividir ${linha.nome}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.35)", display: "flex", justifyContent: "flex-end" }}>
      <div style={{ width: "min(760px, 100%)", height: "100%", overflowY: "auto", background: "var(--tr-bg, var(--tr-surface))", borderLeft: "1px solid var(--tr-border)", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div>
            <p style={{ margin: 0, fontSize: 12, color: "var(--tr-text-dim)" }}>Dividir campanha entre carros</p>
            <h2 style={{ margin: "4px 0 0", fontSize: 18 }}>{linha.nome}</h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--tr-text-dim)" }}>{brl(linha.investido)} investidos (com imposto) · {linha.msgs} conversas</p>
          </div>
          <button type="button" style={btn} onClick={onFechar} aria-label="Fechar">Fechar</button>
        </div>

        {erro && <p role="alert" style={{ margin: 0, color: "var(--tr-bad)", fontSize: 14 }}>{erro}</p>}
        {!d && !erro && <p style={{ margin: 0, fontSize: 14 }}>Buscando os anúncios desta campanha no Facebook…</p>}

        {d && (
          <>
            {d.aviso && <p style={{ margin: 0, fontSize: 13, color: "var(--tr-bad)" }}>{d.aviso}</p>}
            <div role="tablist" style={{ display: "flex", gap: 4, padding: 4, ...card }}>
              <button role="tab" aria-selected={modo === "anuncio"} type="button" onClick={() => setModo("anuncio")} style={{ ...btn, border: 0, flex: 1, ...(modo === "anuncio" ? { background: "var(--tr-surface-2)", fontWeight: 600 } : {}) }}>Por anúncio · gasto real ({d.anuncios.length})</button>
              <button role="tab" aria-selected={modo === "manual"} type="button" onClick={() => setModo("manual")} style={{ ...btn, border: 0, flex: 1, ...(modo === "manual" ? { background: "var(--tr-surface-2)", fontWeight: 600 } : {}) }}>Dividir em partes</button>
            </div>

            {modo === "anuncio" && (
              <>
                <p style={{ margin: 0, fontSize: 13, color: "var(--tr-text-dim)" }}>Cada anúncio vai para um carro. O carro recebe o gasto e as conversas reais daquele anúncio, dia a dia, direto do Facebook. Use quando cada anúncio ou conjunto é de um carro diferente.</p>
                {d.anuncios.length === 0 && <p style={{ margin: 0, fontSize: 14 }}>O Facebook não devolveu anúncios para esta campanha. Use “Dividir em partes”.</p>}
                <div style={{ ...card }}>
                  {d.anuncios.map((a) => {
                    const atual = carroDoAnuncio[a.id] ?? null;
                    return (
                      <div key={a.id} style={{ padding: "12px 14px", borderBottom: "1px solid var(--tr-border)", display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{a.nome}</div>
                            <div style={{ fontSize: 12, color: "var(--tr-text-dim)" }}>{[a.conjunto ? `Conjunto: ${a.conjunto}` : null, a.status === "ACTIVE" ? "● No ar" : "Pausado", brl(a.gasto), `${a.msgs} conversa(s)`].filter(Boolean).join(" · ")}</div>
                          </div>
                          <span style={{ fontSize: 12.5, whiteSpace: "nowrap", color: atual ? "var(--tr-good)" : "var(--tr-text-dim)" }}>{nomeCarro(atual)}</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          {a.candidatos.map((id) => <button key={id} type="button" aria-pressed={atual === id} style={chip(atual === id)} onClick={() => setCarroDoAnuncio((m) => ({ ...m, [a.id]: id }))}>{nomeCarro(id)}</button>)}
                          <EscolherCarro patio={patio} rotulo="Outro carro…" onEscolher={(c) => setCarroDoAnuncio((m) => ({ ...m, [a.id]: c.id }))} />
                          <button type="button" aria-pressed={!atual} style={chip(!atual)} onClick={() => setCarroDoAnuncio((m) => ({ ...m, [a.id]: null }))}>Sem carro</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {d.anuncios.length > 0 && (
                  <div style={{ ...card, padding: "12px 14px", fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
                    <b>Como fica</b>
                    {resumoAnuncio.map(([id, x]) => <span key={id ?? "sem"} style={{ color: id ? undefined : "var(--tr-text-dim)" }}>{nomeCarro(id)}: <b>{brl(x.gasto)}</b> · {x.msgs} conversa(s)</span>)}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  {d.campanha.divisao && <button type="button" style={{ ...btn, color: "var(--tr-text-dim)" }} disabled={salvando} onClick={() => salvar({ modo: "nenhuma" }, "Divisão desfeita. A campanha voltou para “sem ligação”.")}>Desfazer divisão</button>}
                  <button type="button" style={btnForte} disabled={salvando || !carrosAnuncio} onClick={() => salvar({ modo: "anuncio", anuncios: d.anuncios.map((a) => ({ id: a.id, patioId: carroDoAnuncio[a.id] ?? null })) }, `Campanha dividida por anúncio entre ${carrosAnuncio} carro(s).`)}>
                    {salvando ? "Salvando…" : "Salvar divisão por anúncio"}
                  </button>
                </div>
              </>
            )}

            {modo === "manual" && (
              <>
                <p style={{ margin: 0, fontSize: 13, color: "var(--tr-text-dim)" }}>O gasto e as conversas da campanha são repartidos entre os carros. Use quando um mesmo anúncio mostra mais de um carro. Comece em partes iguais e ajuste a porcentagem se quiser.</p>
                <div style={{ ...card }}>
                  {partes.map((p, i) => (
                    <div key={p.patioId} style={{ padding: "10px 14px", borderBottom: "1px solid var(--tr-border)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ flex: 1, minWidth: 200, fontSize: 13.5, fontWeight: 600 }}>{nomeCarro(p.patioId)}</span>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                        <input inputMode="decimal" value={String(p.peso)} aria-label={`Porcentagem de ${nomeCarro(p.patioId)}`}
                          onChange={(e) => { const v = Number(e.target.value.replace(",", ".")) || 0; setPartes((ps) => ps.map((x, k) => (k === i ? { ...x, peso: v } : x))); }}
                          style={{ ...btn, width: 70, cursor: "text", textAlign: "right" }} />%
                      </label>
                      <span style={{ fontSize: 12.5, color: "var(--tr-text-dim)", width: 110, textAlign: "right" }}>{totalPeso ? brl((linha.investido * (Number(p.peso) || 0)) / totalPeso) : "—"}</span>
                      <button type="button" style={{ ...btn, color: "var(--tr-text-dim)" }} onClick={() => setPartes((ps) => ps.filter((_, k) => k !== i))} aria-label={`Tirar ${nomeCarro(p.patioId)}`}>Tirar</button>
                    </div>
                  ))}
                  <div style={{ padding: "10px 14px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {linha.candidatos.filter((id) => !partes.some((p) => p.patioId === id)).slice(0, 4).map((id) => (
                      <button key={id} type="button" style={{ ...btn, borderColor: "var(--tr-gold-2)" }} onClick={() => setPartes((ps) => [...ps, { patioId: id, peso: 0 }])}>+ {nomeCarro(id)}</button>
                    ))}
                    <EscolherCarro patio={patio} rotulo="+ Adicionar carro…" onEscolher={(c) => setPartes((ps) => (ps.some((x) => x.patioId === c.id) ? ps : [...ps, { patioId: c.id, peso: 0 }]))} />
                    {partes.length > 1 && <button type="button" style={btn} onClick={() => setPartes((ps) => ps.map((x) => ({ ...x, peso: Math.round((100 / ps.length) * 100) / 100 })))}>Partes iguais</button>}
                  </div>
                </div>
                <p style={{ margin: 0, fontSize: 13, color: Math.abs(totalPeso - 100) < 0.05 ? "var(--tr-text-dim)" : "var(--tr-bad)" }}>Total: {totalPeso.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%{Math.abs(totalPeso - 100) < 0.05 ? "" : " — precisa somar 100%"}</p>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  {d.campanha.divisao && <button type="button" style={{ ...btn, color: "var(--tr-text-dim)" }} disabled={salvando} onClick={() => salvar({ modo: "nenhuma" }, "Divisão desfeita. A campanha voltou para “sem ligação”.")}>Desfazer divisão</button>}
                  <button type="button" style={btnForte} disabled={salvando || partes.filter((p) => p.peso > 0).length < 2 || Math.abs(totalPeso - 100) >= 0.05}
                    onClick={() => salvar({ modo: "manual", carros: partes.filter((p) => p.peso > 0) }, `Campanha dividida entre ${partes.filter((p) => p.peso > 0).length} carros.`)}>
                    {salvando ? "Salvando…" : "Salvar divisão"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------- cadastro rápido de carro (não estava no Pátio) ----------
function CadastroRapido({ termo, onFechar, onCriado }: { termo: string; onFechar: () => void; onCriado: (c: CarroDoPatio) => void }) {
  const palavras = termo.trim().split(/\s+/).filter(Boolean);
  const [ficha, setFicha] = useState("");
  const [lida, setLida] = useState("");
  const [f, setF] = useState({ brand: "", model: palavras.join(" "), versao: "", year: "", plate: "", color: "", sale_price: "", purchase_price: "" });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const muda = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const num = (v: string) => Number(String(v).replace(/[^\d,]/g, "").replace(",", ".")) || 0;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onFechar]);

  function lerFicha(texto: string) {
    setFicha(texto);
    if (texto.trim().length < 15) return;
    try {
      const { veiculo, interno, faltando } = lerCard(texto);
      const t = (v: unknown) => (v == null ? "" : String(v));
      setF((x) => ({
        brand: t(veiculo.brand) || x.brand, model: t(veiculo.model) || x.model, versao: t(veiculo.versao) || x.versao, year: t(veiculo.year) || x.year,
        plate: t(veiculo.plate) || x.plate, color: t(veiculo.color) || x.color,
        sale_price: veiculo.sale_price ? String(veiculo.sale_price) : x.sale_price, purchase_price: interno.purchase_price ? String(interno.purchase_price) : x.purchase_price,
      }));
      setLida(faltando.length ? `Ficha lida. Não achei: ${faltando.slice(0, 4).join(", ")}.` : "Ficha lida. Confira e salve.");
    } catch { setLida("Não consegui ler a ficha. Preencha os campos abaixo."); }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.brand.trim() || !f.model.trim()) { setErro("Informe pelo menos marca e modelo."); return; }
    setSalvando(true); setErro("");
    const dados = { cat: "carros", brand: f.brand.trim(), model: f.model.trim(), versao: f.versao.trim(), year: f.year.trim(), plate: f.plate.trim(), color: f.color.trim(), sale_price: num(f.sale_price), purchase_price: num(f.purchase_price) };
    const r = await fetch("/api/patio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dados, card: ficha.trim() ? ficha : undefined }) });
    const d = await r.json().catch(() => ({}));
    setSalvando(false);
    const id = r.ok ? d.id : r.status === 409 ? d.id : null; // placa que já existe: usa o carro que já está no Pátio
    if (!id) { setErro(d.erro || "Não consegui cadastrar."); return; }
    const nome = [dados.brand, dados.model, dados.versao, dados.year].filter(Boolean).join(" ");
    onCriado({ id, nome, placa: dados.plate || null, ano: Number(dados.year.slice(0, 4)) || null, status: r.ok ? "review" : "available", img: null, modelo: dados.model, preco: dados.sale_price || null });
  }

  const campo = (rot: string, k: keyof typeof f, ph = "", largura = 1) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, gridColumn: `span ${largura}` }}>{rot}
      <input value={f[k]} onChange={muda(k)} placeholder={ph} style={{ ...btn, cursor: "text", padding: "8px 10px" }} />
    </label>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="Cadastrar carro novo" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}
      style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <form onSubmit={salvar} style={{ width: "min(620px, 100%)", maxHeight: "100%", overflowY: "auto", background: "var(--tr-bg, var(--tr-surface))", border: "1px solid var(--tr-border)", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Cadastrar carro novo</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--tr-text-dim)" }}>O carro entra no Pátio como <b>Aguardando revisão</b> — não aparece no site — e já fica ligado à campanha. Depois você completa fotos e preço no Pátio, se quiser.</p>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5 }}>Colar a ficha do WhatsApp (opcional)
          <textarea value={ficha} onChange={(e) => lerFicha(e.target.value)} rows={4} placeholder="Cole aqui o card do carro, do jeito que vai no grupo de entradas…" style={{ ...btn, cursor: "text", whiteSpace: "normal", padding: "8px 10px", resize: "vertical", fontFamily: "inherit" }} />
        </label>
        {lida && <p style={{ margin: 0, fontSize: 12.5, color: "var(--tr-good)" }}>{lida}</p>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {campo("Marca *", "brand", "Hyundai", 2)}
          {campo("Modelo *", "model", "Creta", 2)}
          {campo("Versão", "versao", "Platinum", 2)}
          {campo("Ano", "year", "2022/2022")}
          {campo("Placa", "plate", "ABC1D23")}
          {campo("Cor", "color", "Branco")}
          {campo("Preço de venda", "sale_price", "R$")}
          {campo("Custo (só sócio vê)", "purchase_price", "R$", 2)}
        </div>
        {erro && <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--tr-bad)" }}>{erro}</p>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={btn} onClick={onFechar}>Cancelar</button>
          <button type="submit" style={btnForte} disabled={salvando}>{salvando ? "Cadastrando…" : "Cadastrar e ligar"}</button>
        </div>
      </form>
    </div>
  );
}
