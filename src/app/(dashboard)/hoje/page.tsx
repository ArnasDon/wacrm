"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { brl, Foto } from "../patio/comum";

type Resumo = {
  papel: "socio" | "marketing" | "vendedor";
  periodo: { de: string; ate: string };
  patio: null | {
    aVenda: number; valorEstoque: number; parados: number; semAnuncio: number; rascunhos: number; vendidosPeriodo: number; vendidosSemData: number;
    maisConversa: { id: string; nome: string; ano: string; preco: number; img: string; msgs: number; gasto: number }[];
    maisParados: { id: string; nome: string; ano: string; preco: number; img: string; dias: number }[];
    ranking?: { id: string; nome: string; ano: string; preco: number; img: string; msgs: number; gasto: number; status: string; cat: string; dias: number | null }[];
  };
  trafego: { investido: number; msgs: number; custoPorConversa: number; gastoForaDoPatio: number; qtdForaDoPatio: number; gastoSemCarro: number; qtdSemCarro: number; campanhas: unknown[] };
  clientes: { esperando: number; novos: number };
  avisos: string[];
  alertas: { regraId: string; regra: string; itens: { id: string; nome: string; href: string }[] }[];
};

// Períodos da tela (datas no fuso da loja). "datas" = escolhidas à mão.
type Periodo = "hoje" | "ontem" | "7" | "30" | "90" | "mes" | "mesPassado" | "ano" | "datas";
const PERIODOS: [Periodo, string][] = [["hoje", "Hoje"], ["ontem", "Ontem"], ["7", "7 dias"], ["30", "30 dias"], ["90", "90 dias"], ["mes", "Este mês"], ["mesPassado", "Mês passado"], ["ano", "Este ano"], ["datas", "Escolher datas"]];
const isoBahia = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(d);
function intervalo(p: Periodo, de: string, ate: string): { de: string; ate: string } | null {
  const hoje = new Date(isoBahia(new Date()) + "T12:00:00Z");
  const menos = (n: number) => { const d = new Date(hoje); d.setUTCDate(d.getUTCDate() - n); return isoBahia(d); };
  const y = hoje.getUTCFullYear(), m = hoje.getUTCMonth();
  switch (p) {
    case "hoje": return { de: menos(0), ate: menos(0) };
    case "ontem": return { de: menos(1), ate: menos(1) };
    case "7": return { de: menos(6), ate: menos(0) };
    case "30": return { de: menos(29), ate: menos(0) };
    case "90": return { de: menos(89), ate: menos(0) };
    case "mes": return { de: isoBahia(new Date(Date.UTC(y, m, 1, 12))), ate: menos(0) };
    case "mesPassado": return { de: isoBahia(new Date(Date.UTC(y, m - 1, 1, 12))), ate: isoBahia(new Date(Date.UTC(y, m, 0, 12))) };
    case "ano": return { de: `${y}-01-01`, ate: menos(0) };
    case "datas": return de && ate && de <= ate ? { de, ate } : null;
  }
}
const dataBr = (d: string) => d.split("-").reverse().join("/");
type Ordem = "conversas" | "custoMenor" | "investido" | "custoMaior";
type Filtros = { periodo: Periodo; de: string; ate: string; situacao: "venda" | "vendidos" | "todos"; ordem: Ordem; qtd: number; cat: string };
const PADRAO: Filtros = { periodo: "30", de: "", ate: "", situacao: "venda", ordem: "conversas", qtd: 5, cat: "" };
const CHAVE = "ibox.hoje.filtros.v1";

function hojeExtenso() {
  return new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
}

export default function HojePage() {
  const [f, setF] = useState<Filtros>(PADRAO);
  const [pronto, setPronto] = useState(false);
  const [r, setR] = useState<Resumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const mudar = (m: Partial<Filtros>) => setF((x) => { const n = { ...x, ...m }; try { localStorage.setItem(CHAVE, JSON.stringify(n)); } catch { /* sem armazenamento */ } return n; });
  const iv = intervalo(f.periodo, f.de, f.ate);
  const chaveBusca = iv ? `${iv.de}|${iv.ate}` : "";

  useEffect(() => {
    let salvo: Filtros = PADRAO;
    try { const v = localStorage.getItem(CHAVE); if (v) salvo = { ...PADRAO, ...JSON.parse(v) }; } catch { /* sem armazenamento */ }
    const t = setTimeout(() => { setF(salvo); setPronto(true); }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!pronto || !chaveBusca) return;
    const [de, ate] = chaveBusca.split("|");
    let vivo = true;
    fetch(`/api/resumo?de=${de}&ate=${ate}`, { cache: "no-store" })
      .then(async (res) => {
        const d = await res.json();
        if (!vivo) return;
        if (!res.ok) throw new Error(d.erro || "Não foi possível abrir.");
        setR(d);
        setErro(null);
      })
      .catch((e: Error) => vivo && setErro(e.message));
    return () => {
      vivo = false;
    };
  }, [chaveBusca, pronto]);

  const t = r?.trafego;
  const p = r?.patio;
  const vendas = p?.vendidosPeriodo ?? 0;
  const temTrafego = !!t && t.campanhas.length > 0;

  const alertas: { n: string; titulo: string; texto: string; href: string; acao: string; cor: string }[] = [];
  if (r) {
    if (t && t.qtdForaDoPatio > 0) alertas.push({ n: String(t.qtdForaDoPatio), titulo: "Campanhas de carros que já saíram do pátio", texto: `${brl(t.gastoForaDoPatio)} no período`, href: "/trafego/campanhas", acao: "Revisar", cor: "var(--ru)" });
    if (r.clientes.esperando > 0) alertas.push({ n: String(r.clientes.esperando), titulo: "Conversas esperando resposta", texto: "Com mensagens não lidas", href: "/inbox", acao: "Abrir", cor: "var(--at)" });
    if (p && p.rascunhos > 0) alertas.push({ n: String(p.rascunhos), titulo: "Carros do grupo de entradas para aprovar", texto: "Ainda não aparecem no site", href: "/patio", acao: "Revisar", cor: "var(--at)" });
    if (p && p.parados > 0) alertas.push({ n: String(p.parados), titulo: "Carros há mais de 45 dias no pátio", texto: "Anunciar, rever o preço ou repassar", href: "/patio", acao: "Ver", cor: "var(--at)" });
    if (p && temTrafego && p.semAnuncio > 0) alertas.push({ n: String(p.semAnuncio), titulo: "Carros sem anúncio ligado", texto: "Ligue campanhas aos carros em Ligar campanhas", href: "/trafego/ligar", acao: "Ligar", cor: "var(--ne)" });
    if (t && t.qtdSemCarro > 0) alertas.push({ n: String(t.qtdSemCarro), titulo: "Campanhas sem vínculo", texto: `${brl(t.gastoSemCarro)} sem carro nem finalidade — o sistema já sugere`, href: "/trafego/ligar", acao: "Ver sugestões", cor: "var(--ne)" });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 1280 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div className="rot" style={{ fontSize: 13, textTransform: "capitalize" }}>{hojeExtenso()}</div>
          <h1 className="disp" style={{ margin: "4px 0 0", fontSize: 44, lineHeight: 1.02 }}>Hoje na loja</h1>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <div className="seg" role="group" aria-label="Período" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
            {PERIODOS.map(([k, nome]) => (
              <button key={k} type="button" aria-pressed={f.periodo === k} onClick={() => mudar({ periodo: k })}>{nome}</button>
            ))}
          </div>
          {f.periodo === "datas" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <label className="campo mini" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>De <input type="date" value={f.de} onChange={(e) => mudar({ de: e.target.value })} /></label>
              <label className="campo mini" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>Até <input type="date" value={f.ate} onChange={(e) => mudar({ ate: e.target.value })} /></label>
            </div>
          )}
          <span className="rot" style={{ fontSize: 12.5 }}>{iv ? (iv.de === iv.ate ? dataBr(iv.de) : `${dataBr(iv.de)} a ${dataBr(iv.ate)}`) : "Escolha as duas datas"}</span>
        </div>
      </div>

      {erro && <div className="card" style={{ padding: 16 }}>{erro}</div>}
      {r?.avisos.map((a) => <div key={a} className="card" style={{ padding: 14, fontSize: 14 }}>{a}</div>)}

      <section aria-label="Números do período" className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", overflow: "hidden" }}>
        {[
          ["Investido no Meta", t ? brl(t.investido) : "…", "com imposto de 12%"],
          ["Conversas de anúncio", t ? String(t.msgs) : "…", "no período"],
          ["Custo por conversa", t ? brl(t.custoPorConversa, 2) : "…", "investido ÷ conversas"],
          ["Carros vendidos", p ? String(vendas) : "…", p?.vendidosSemData ? `${p.vendidosSemData} vendidos sem data de venda` : "com data de venda no período"],
        ].map(([rot, val, sub]) => (
          <div key={rot} style={{ padding: "18px 20px", borderRight: "1px solid var(--p-linha-2)" }}>
            <div className="rot">{rot}</div>
            <div className="dado" style={{ fontSize: 28, marginTop: 6 }}>{val}</div>
            <div className="rot" style={{ marginTop: 4 }}>{sub}</div>
          </div>
        ))}
        <div style={{ padding: "18px 20px", background: "var(--destaque)", color: "var(--destaque-tinta)" }}>
          <div style={{ fontSize: 12, color: "var(--destaque-mudo)" }}>Tráfego por carro vendido</div>
          <div className="dado" style={{ fontSize: 28, marginTop: 6, color: "var(--p-ouro)" }}>{t && vendas ? brl(t.investido / vendas) : "—"}</div>
          <div style={{ fontSize: 12, color: "var(--destaque-mudo)", marginTop: 4 }}>investido ÷ vendas</div>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20, alignItems: "start" }}>
        <section aria-labelledby="voce-t" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 id="voce-t" className="h2">Precisa de você</h2>
          {r?.alertas?.map((a) => (
            <div key={a.regraId} className="card" style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <span className="dado" style={{ fontSize: 22, color: "var(--az)", minWidth: 40 }}>{a.itens.length}</span>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600 }}>{a.regra}</div><div className="rot" style={{ fontSize: 13 }}>Sua regra</div></div>
              </div>
              <ul style={{ listStyle: "none", margin: "8px 0 0 54px", padding: 0, fontSize: 13 }}>
                {a.itens.slice(0, 5).map((it) => <li key={it.id}><Link href={it.href}>{it.nome}</Link></li>)}
                {a.itens.length > 5 && <li className="rot">e mais {a.itens.length - 5}</li>}
              </ul>
            </div>
          ))}
          {r && alertas.length === 0 && !r.alertas?.length && <div className="card" style={{ padding: 16, fontSize: 14 }}>Nada pendente agora. Crie seus próprios alertas em <Link href="/regras">Regras e alertas</Link>.</div>}
          {alertas.map((a) => (
            <div key={a.titulo} className="card" style={{ padding: "14px 16px", display: "flex", gap: 14, alignItems: "center" }}>
              <span className="dado" style={{ fontSize: 22, color: a.cor, minWidth: 40 }}>{a.n}</span>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600 }}>{a.titulo}</div><div className="rot" style={{ fontSize: 13 }}>{a.texto}</div></div>
              <Link href={a.href} className="btns">{a.acao}</Link>
            </div>
          ))}
        </section>

        <Ranking p={p} f={f} mudar={mudar} />

        <section aria-labelledby="patio-t" className="card" style={{ padding: "18px 20px" }}>
          <h2 id="patio-t" className="h2">Pátio agora</h2>
          <dl style={{ margin: "12px 0 0", display: "grid", gridTemplateColumns: "1fr auto", gap: "10px 16px", fontSize: 14 }}>
            <dt>À venda</dt><dd className="dado" style={{ margin: 0 }}>{p ? p.aVenda : "…"}</dd>
            <dt>Valor em estoque</dt><dd className="dado" style={{ margin: 0 }}>{p ? brl(p.valorEstoque) : "…"}</dd>
            <dt>Parados há +45 dias</dt><dd className="dado" style={{ margin: 0 }}>{p ? p.parados : "…"}</dd>
            <dt>Para aprovar</dt><dd className="dado" style={{ margin: 0 }}>{p ? p.rascunhos : "…"}</dd>
            <dt>Clientes novos no período</dt><dd className="dado" style={{ margin: 0 }}>{r ? r.clientes.novos : "…"}</dd>
          </dl>
          <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/patio/novo" className="btns">Cadastrar carro</Link>
            <Link href="/resultados" className="btns">Relatório</Link>
          </div>
        </section>
      </div>
      {!temTrafego && r && (
        <p className="rot" style={{ margin: 0, fontSize: 13 }}>
          Os números de anúncio aparecem depois que o Meta estiver conectado em <Link href="/trafego/conexoes">Ajustes → Conexões</Link>.
        </p>
      )}
    </div>
  );
}

function Ranking({ p, f, mudar }: { p: Resumo["patio"] | undefined; f: Filtros; mudar: (m: Partial<Filtros>) => void }) {
  const todos = p?.ranking ?? [];
  const cats = [...new Set(todos.map((c) => c.cat))].sort();
  const vendido = (c: { status: string }) => c.status === "sold";
  const cc = (c: { gasto: number; msgs: number }) => (c.msgs ? c.gasto / c.msgs : null);
  const lista = todos
    .filter((c) => f.situacao === "todos" || (f.situacao === "vendidos" ? vendido(c) : !vendido(c) && c.status !== "review"))
    .filter((c) => !f.cat || c.cat === f.cat)
    .filter((c) => (f.ordem === "custoMenor" || f.ordem === "custoMaior" ? c.msgs > 0 : true))
    .sort((a, b) =>
      f.ordem === "investido" ? b.gasto - a.gasto
      : f.ordem === "custoMenor" ? (cc(a) ?? Infinity) - (cc(b) ?? Infinity)
      : f.ordem === "custoMaior" ? (cc(b) ?? 0) - (cc(a) ?? 0)
      : b.msgs - a.msgs || a.gasto - b.gasto);
  const mostrar = f.qtd ? lista.slice(0, f.qtd) : lista;
  const titulo = { conversas: "Carros que mais atraem conversa", custoMenor: "Conversa mais barata", investido: "Onde mais foi investido", custoMaior: "Conversa mais cara" }[f.ordem];
  const usarParados = p && !todos.length;
  return (
    <section aria-labelledby="quente-t" className="card" style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h2 id="quente-t" className="h2">{usarParados ? "Há mais tempo no pátio" : titulo}</h2>
        <Link href="/patio" style={{ fontSize: 13 }}>Pátio inteiro</Link>
      </div>
      {!usarParados && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }} aria-label="Filtros do ranking">
          <select aria-label="Situação do carro" value={f.situacao} onChange={(e) => mudar({ situacao: e.target.value as Filtros["situacao"] })} className="campo-mini">
            <option value="venda">No estoque</option><option value="vendidos">Vendidos</option><option value="todos">Todos</option>
          </select>
          <select aria-label="Ordenar por" value={f.ordem} onChange={(e) => mudar({ ordem: e.target.value as Ordem })} className="campo-mini">
            <option value="conversas">Mais conversas</option><option value="custoMenor">Conversa mais barata</option><option value="custoMaior">Conversa mais cara</option><option value="investido">Mais investido</option>
          </select>
          {cats.length > 1 && (
            <select aria-label="Categoria" value={f.cat} onChange={(e) => mudar({ cat: e.target.value })} className="campo-mini">
              <option value="">Todas as categorias</option>{cats.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          )}
          <select aria-label="Quantos mostrar" value={f.qtd} onChange={(e) => mudar({ qtd: Number(e.target.value) })} className="campo-mini">
            <option value={5}>Top 5</option><option value={10}>Top 10</option><option value={0}>Todos ({lista.length})</option>
          </select>
        </div>
      )}
      <ol style={{ listStyle: "none", margin: "12px 0 0", padding: 0 }}>
        {(usarParados ? p.maisParados : mostrar).map((c) => (
          <li key={c.id} style={{ borderTop: "1px solid var(--p-linha-2)" }}>
            <Link href={`/patio/${c.id}`} style={{ display: "grid", gridTemplateColumns: "84px minmax(0, 1fr) auto", gap: 14, alignItems: "center", padding: "12px 0", color: "var(--p-ink)", textDecoration: "none" }}>
              <Foto url={c.img} alt="" style={{ width: 84, height: 60, borderRadius: 8 }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 600, display: "block" }}>{c.nome} <span className="rot" style={{ fontSize: 13 }}>{c.ano}</span></span>
                <span className="rot">{"msgs" in c ? `${c.msgs} conversas · ${c.msgs ? brl(c.gasto / c.msgs, 2) + " cada" : "sem conversa"} · ${brl(c.gasto)} investido${"status" in c && c.status === "sold" ? " · vendido" : ""}` : `${c.dias} dias no pátio`}</span>
              </span>
              <span className="tag">{brl(c.preco)}</span>
            </Link>
          </li>
        ))}
      </ol>
      {!usarParados && p && mostrar.length === 0 && <p className="rot" style={{ fontSize: 13, margin: "10px 0 0" }}>Nenhum carro com anúncio nesse filtro e período.</p>}
      {usarParados && <p className="rot" style={{ fontSize: 13, margin: "8px 0 0" }}>Nenhum carro teve anúncio no período. Ligue campanhas em <Link href="/trafego/ligar">Marketing → Ligar campanhas</Link>.</p>}
    </section>
  );
}
