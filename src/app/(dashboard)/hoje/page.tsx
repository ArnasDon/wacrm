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
  };
  trafego: { investido: number; msgs: number; custoPorConversa: number; gastoForaDoPatio: number; qtdForaDoPatio: number; gastoSemCarro: number; qtdSemCarro: number; campanhas: unknown[] };
  clientes: { esperando: number; novos: number };
  avisos: string[];
};

const PERIODOS: [number, string][] = [[7, "7 dias"], [30, "30 dias"], [90, "90 dias"]];

function hojeExtenso() {
  return new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
}

export default function HojePage() {
  const [dias, setDias] = useState(30);
  const [r, setR] = useState<Resumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/resumo?dias=${dias}`, { cache: "no-store" })
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
  }, [dias]);

  const t = r?.trafego;
  const p = r?.patio;
  const vendas = p?.vendidosPeriodo ?? 0;
  const temTrafego = !!t && t.campanhas.length > 0;

  const alertas: { n: string; titulo: string; texto: string; href: string; acao: string; cor: string }[] = [];
  if (r) {
    if (t && t.qtdForaDoPatio > 0) alertas.push({ n: String(t.qtdForaDoPatio), titulo: "Campanhas de carros que já saíram do pátio", texto: `${brl(t.gastoForaDoPatio)} no período`, href: "/trafego/campanhas", acao: "Revisar", cor: "#8e2f22" });
    if (r.clientes.esperando > 0) alertas.push({ n: String(r.clientes.esperando), titulo: "Conversas esperando resposta", texto: "Com mensagens não lidas", href: "/inbox", acao: "Abrir", cor: "#8a4a10" });
    if (p && p.rascunhos > 0) alertas.push({ n: String(p.rascunhos), titulo: "Carros do grupo de entradas para aprovar", texto: "Ainda não aparecem no site", href: "/patio", acao: "Revisar", cor: "#8a4a10" });
    if (p && p.parados > 0) alertas.push({ n: String(p.parados), titulo: "Carros há mais de 45 dias no pátio", texto: "Anunciar, rever o preço ou repassar", href: "/patio", acao: "Ver", cor: "#8a4a10" });
    if (p && temTrafego && p.semAnuncio > 0) alertas.push({ n: String(p.semAnuncio), titulo: "Carros sem anúncio ligado", texto: "Ligue campanhas aos carros em Campanhas", href: "/trafego/campanhas", acao: "Ligar", cor: "#3e433f" });
    if (t && t.qtdSemCarro > 0) alertas.push({ n: String(t.qtdSemCarro), titulo: "Campanhas sem carro ligado", texto: `${brl(t.gastoSemCarro)} sem saber qual carro vendeu`, href: "/trafego/campanhas", acao: "Ligar", cor: "#3e433f" });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 1280 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div className="rot" style={{ fontSize: 13, textTransform: "capitalize" }}>{hojeExtenso()}</div>
          <h1 className="disp" style={{ margin: "4px 0 0", fontSize: 44, lineHeight: 1.02 }}>Hoje na loja</h1>
        </div>
        <div className="seg" role="group" aria-label="Período">
          {PERIODOS.map(([d, nome]) => (
            <button key={d} type="button" aria-pressed={dias === d} onClick={() => setDias(d)}>{nome}</button>
          ))}
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
        <div style={{ padding: "18px 20px", background: "var(--p-ink)", color: "var(--p-papel)" }}>
          <div style={{ fontSize: 12, color: "#b9bdb5" }}>Tráfego por carro vendido</div>
          <div className="dado" style={{ fontSize: 28, marginTop: 6, color: "var(--p-ouro)" }}>{t && vendas ? brl(t.investido / vendas) : "—"}</div>
          <div style={{ fontSize: 12, color: "#b9bdb5", marginTop: 4 }}>investido ÷ vendas</div>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20, alignItems: "start" }}>
        <section aria-labelledby="voce-t" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 id="voce-t" className="h2">Precisa de você</h2>
          {r && alertas.length === 0 && <div className="card" style={{ padding: 16, fontSize: 14 }}>Nada pendente agora.</div>}
          {alertas.map((a) => (
            <div key={a.titulo} className="card" style={{ padding: "14px 16px", display: "flex", gap: 14, alignItems: "center" }}>
              <span className="dado" style={{ fontSize: 22, color: a.cor, minWidth: 40 }}>{a.n}</span>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600 }}>{a.titulo}</div><div className="rot" style={{ fontSize: 13 }}>{a.texto}</div></div>
              <Link href={a.href} className="btns">{a.acao}</Link>
            </div>
          ))}
        </section>

        <section aria-labelledby="quente-t" className="card" style={{ padding: "18px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <h2 id="quente-t" className="h2">{p?.maisConversa.length ? "Carros que mais atraem conversa" : "Há mais tempo no pátio"}</h2>
            <Link href="/patio" style={{ fontSize: 13 }}>Pátio inteiro</Link>
          </div>
          <ol style={{ listStyle: "none", margin: "12px 0 0", padding: 0 }}>
            {(p?.maisConversa.length ? p.maisConversa : p?.maisParados ?? []).map((c) => (
              <li key={c.id} style={{ borderTop: "1px solid var(--p-linha-2)" }}>
                <Link href={`/patio/${c.id}`} style={{ display: "grid", gridTemplateColumns: "84px minmax(0, 1fr) auto", gap: 14, alignItems: "center", padding: "12px 0", color: "var(--p-ink)", textDecoration: "none" }}>
                  <Foto url={c.img} alt="" style={{ width: 84, height: 60, borderRadius: 8 }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 600, display: "block" }}>{c.nome} <span className="rot" style={{ fontSize: 13 }}>{c.ano}</span></span>
                    <span className="rot">{"msgs" in c ? `${c.msgs} conversas · ${brl(c.gasto / Math.max(c.msgs, 1), 2)} cada` : `${c.dias} dias no pátio`}</span>
                  </span>
                  <span className="tag">{brl(c.preco)}</span>
                </Link>
              </li>
            ))}
          </ol>
          {p && !p.maisConversa.length && <p className="rot" style={{ fontSize: 13, margin: "8px 0 0" }}>Quando as campanhas estiverem ligadas aos carros, aqui aparecem os carros que mais atraem conversa.</p>}
        </section>

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
