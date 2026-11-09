"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { brl } from "../patio/comum";
import type { ResumoCrm } from "@/lib/patio/crm-resumo";
import type { ResumoSite } from "@/lib/patio/ga4";
import { CATEGORIAS, POSSE } from "@/lib/patio/filtros";

type Campanha = { id: string; nome: string; status: string | null; gasto: number; msgs: number; carro: "ok" | "vendido" | "sem" };
type Resumo = {
  papel: "socio" | "marketing" | "vendedor";
  periodo: { de: string; ate: string };
  patio: null | {
    aVenda: number; valorEstoque: number; capitalParado: number; parados: number; semAnuncio: number; rascunhos: number;
    composicao?: { posse: Record<string, Record<string, number>>; categorias: Record<string, number>; faixas: { nome: string; carros: number; valor: number }[]; semPreco: number };
    vendidosPeriodo: number; vendidosSemData: number; receitaPeriodo: number; lucroPeriodo: number; vendidosAte30Dias: number;
  };
  trafego: { investido: number; msgs: number; custoPorConversa: number; gastoForaDoPatio: number; qtdForaDoPatio: number; campanhas: Campanha[] };
  clientes: { esperando: number; novos: number };
  crm?: ResumoCrm | null;
  site?: ResumoSite | null;
  siteLigado?: boolean;
};
type Secao = "frase" | "numeros" | "campanhas" | "atendimento" | "vendedores" | "site" | "patio" | "composicao" | "financeiro";
type Config = { secoes: Record<Secao, boolean>; campanhas: "todas" | "ligadas"; situacao?: "todas" | "ok" | "vendido" | "sem"; minGasto?: number; comparar: boolean };
type Modelo = { id: string; nome: string; config: Config };

const NOMES: [Secao, string][] = [
  ["frase", "Resumo em uma frase"], ["numeros", "Números principais"], ["campanhas", "Campanhas"], ["atendimento", "Clientes e atendimento"],
  ["vendedores", "Vendedores"], ["site", "Site (GA4)"], ["patio", "Pátio e vendas"], ["composicao", "Como está o pátio"], ["financeiro", "Financeiro (só sócios)"],
];
const PADRAO: Config = { secoes: { frase: true, numeros: true, campanhas: true, atendimento: true, vendedores: true, site: true, patio: true, composicao: true, financeiro: true }, campanhas: "todas", situacao: "todas", minGasto: 0, comparar: true };
const STATUS_PT: Record<string, string> = { available: "À venda", reserved: "Reservado", unavailable: "Indisponível" };
const minutos = (m: number | null | undefined) => (m == null ? "—" : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${(m / 60).toFixed(1).replace(".", ",")} h` : `${(m / 1440).toFixed(1).replace(".", ",")} dias`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const IMPOSTO = 1.12;

function variacao(atual: number, antes: number | undefined) {
  if (antes == null || !antes) return null;
  const v = ((atual - antes) / antes) * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(0)}% vs. período anterior`;
}

export default function ResultadosPage() {
  const hoje = new Date();
  const [de, setDe] = useState(iso(new Date(hoje.getTime() - 29 * 86_400_000)));
  const [ate, setAte] = useState(iso(hoje));
  const [cfg, setCfg] = useState<Config>(PADRAO);
  const [r, setR] = useState<Resumo | null>(null);
  const [antes, setAntes] = useState<Resumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);

  const buscar = useCallback(async (a: string, b: string) => {
    const res = await fetch(`/api/resumo?de=${a}&ate=${b}&com=crm,site`, { cache: "no-store" });
    const d = await res.json();
    if (!res.ok) throw new Error(d.erro || "Não foi possível montar o relatório.");
    return d as Resumo;
  }, []);

  useEffect(() => {
    let vivo = true;
    const ini = Date.parse(de), fim = Date.parse(ate);
    const dur = fim - ini + 86_400_000;
    Promise.all([buscar(de, ate), buscar(iso(new Date(ini - dur)), iso(new Date(ini - 86_400_000)))])
      .then(([atual, anterior]) => { if (vivo) { setR(atual); setAntes(anterior); setErro(null); } })
      .catch((e: Error) => vivo && setErro(e.message));
    return () => { vivo = false; };
  }, [de, ate, buscar]);

  useEffect(() => {
    createClient().from("relatorio_modelos").select("id, nome, config").order("criado_em")
      .then(({ data }) => setModelos((data ?? []) as Modelo[]));
  }, []);

  const campanhas = useMemo(
    () => (r?.trafego.campanhas ?? []).filter((c) => (cfg.campanhas === "todas" || c.carro !== "sem") && (!cfg.situacao || cfg.situacao === "todas" || c.carro === cfg.situacao) && c.gasto * IMPOSTO >= (cfg.minGasto ?? 0)),
    [r, cfg.campanhas, cfg.situacao, cfg.minGasto],
  );
  const investido = campanhas.reduce((s, c) => s + c.gasto, 0) * IMPOSTO;
  const msgs = campanhas.reduce((s, c) => s + c.msgs, 0);
  const vendas = r?.patio?.vendidosPeriodo ?? 0;
  const ehSocio = r?.papel === "socio";
  const ver = (s: Secao) => (cfg.secoes[s] ?? true) && (s !== "financeiro" || ehSocio);

  async function salvarModelo() {
    const nome = prompt("Nome do modelo de relatório:", "Sócios · mensal");
    if (!nome) return;
    const sb = createClient();
    const { data: org } = await sb.rpc("my_branding");
    const orgId = (Array.isArray(org) ? org[0] : org)?.organization_id;
    const { data, error } = await sb.from("relatorio_modelos").insert({ org_id: orgId, nome, config: cfg }).select("id, nome, config").single();
    if (error) setAviso("Não foi possível salvar o modelo.");
    else { setModelos([...modelos, data as Modelo]); setAviso(`Modelo “${nome}” salvo.`); }
  }

  const fmtData = (s: string) => new Date(s + "T12:00:00").toLocaleDateString("pt-BR");

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start", maxWidth: 1360 }}>
      <aside className="card relatorio-filtros" aria-labelledby="montar-t" style={{ flex: "1 1 250px", maxWidth: 290, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="montar-t" className="h2">Montar relatório</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label className="campo">De<input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} /></label>
          <label className="campo">Até<input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} /></label>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[[7, "7 dias"], [30, "30 dias"], [90, "90 dias"]].map(([n, nome]) => (
            <button key={n} type="button" className="chip" onClick={() => { setAte(iso(hoje)); setDe(iso(new Date(hoje.getTime() - (Number(n) - 1) * 86_400_000))); }}>{nome}</button>
          ))}
          <button type="button" className="chip" onClick={() => { const a = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1); const b = new Date(hoje.getFullYear(), hoje.getMonth(), 0); setDe(iso(a)); setAte(iso(b)); }}>Mês passado</button>
        </div>
        <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <legend className="rot" style={{ marginBottom: 6 }}>Seções</legend>
          {NOMES.filter(([s]) => s !== "financeiro" || ehSocio).map(([s, nome]) => (
            <label key={s} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}>
              <input type="checkbox" checked={cfg.secoes[s] ?? true} onChange={() => setCfg({ ...cfg, secoes: { ...cfg.secoes, [s]: !(cfg.secoes[s] ?? true) } })} /> {nome}
            </label>
          ))}
        </fieldset>
        <label className="campo">Campanhas<select value={cfg.campanhas} onChange={(e) => setCfg({ ...cfg, campanhas: e.target.value as Config["campanhas"] })}><option value="todas">Todas</option><option value="ligadas">Só as ligadas a um carro</option></select></label>
        <label className="campo">Carro da campanha<select value={cfg.situacao ?? "todas"} onChange={(e) => setCfg({ ...cfg, situacao: e.target.value as Config["situacao"] })}><option value="todas">Qualquer</option><option value="ok">No pátio</option><option value="vendido">Fora do pátio</option><option value="sem">Sem carro ligado</option></select></label>
        <label className="campo">Gasto mínimo por campanha (R$)<input inputMode="numeric" value={cfg.minGasto ? String(cfg.minGasto) : ""} placeholder="0" onChange={(e) => setCfg({ ...cfg, minGasto: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></label>
        <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}><input type="checkbox" checked={cfg.comparar} onChange={() => setCfg({ ...cfg, comparar: !cfg.comparar })} /> Comparar com o período anterior</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btns" onClick={salvarModelo}>Salvar como modelo</button>
          <button type="button" className="btnp" onClick={() => window.print()}>Baixar PDF</button>
        </div>
        {modelos.length > 0 && (
          <div className="rot" style={{ fontSize: 13 }}>
            Modelos: {modelos.map((m, i) => (<span key={m.id}>{i > 0 && " · "}<button type="button" onClick={() => setCfg({ ...PADRAO, ...m.config, secoes: { ...PADRAO.secoes, ...m.config.secoes } })} style={{ border: 0, background: "none", color: "var(--p-azul)", cursor: "pointer", padding: 0, font: "inherit" }}>{m.nome}</button></span>))}
          </div>
        )}
        {aviso && <p role="status" style={{ margin: 0, fontSize: 13 }}>{aviso}</p>}
      </aside>

      <div style={{ flex: "999 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <div className="rot" style={{ fontSize: 13 }}>Relatório de resultado · iBox Prime</div>
          <h1 className="disp" style={{ margin: "4px 0 0", fontSize: 40, lineHeight: 1.05 }}>{fmtData(de)} a {fmtData(ate)}</h1>
        </div>
        {erro && <div className="card" style={{ padding: 16 }}>{erro}</div>}

        {r && ver("frase") && (
          <section className="card" style={{ padding: "22px 24px", background: "var(--destaque)", color: "var(--destaque-tinta)", borderColor: "var(--destaque)" }}>
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--destaque-mudo)" }}>Em uma frase</h2>
            <p className="disp" style={{ margin: "8px 0 0", fontSize: 24, lineHeight: 1.3, fontWeight: 700 }}>
              {investido ? <>{brl(investido)} em anúncios geraram {msgs} conversas{msgs ? ` a ${brl(investido / msgs, 2)} cada` : ""}. </> : <>Sem dados de anúncio no período. </>}
              A loja vendeu {vendas} {vendas === 1 ? "carro" : "carros"}{investido && vendas ? `, com ${brl(investido / vendas)} de tráfego por venda` : ""}.
            </p>
            {r.trafego.qtdForaDoPatio > 0 && <p style={{ margin: "12px 0 0", color: "var(--p-ouro)", fontSize: 14 }}>Atenção: {brl(r.trafego.gastoForaDoPatio)} foram para campanhas de carros que já saíram do pátio.</p>}
          </section>
        )}

        {r && ver("numeros") && (
          <section className="card" aria-label="Números principais" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", overflow: "hidden" }}>
            {[
              ["Investido", brl(investido), cfg.comparar ? variacao(investido, antes ? antes.trafego.investido : undefined) : null],
              ["Conversas", String(msgs), cfg.comparar ? variacao(msgs, antes?.trafego.msgs) : null],
              ["Custo por conversa", msgs ? brl(investido / msgs, 2) : "—", null],
              ["Carros vendidos", String(vendas), cfg.comparar ? variacao(vendas, antes?.patio?.vendidosPeriodo) : null],
              ["Clientes novos", String(r.clientes.novos), cfg.comparar ? variacao(r.clientes.novos, antes?.clientes.novos) : null],
            ].map(([rot, val, sub]) => (
              <div key={rot as string} style={{ padding: "16px 18px", borderRight: "1px solid var(--p-linha-2)" }}>
                <div className="rot">{rot}</div><div className="dado" style={{ fontSize: 24 }}>{val}</div>{sub && <div className="rot">{sub}</div>}
              </div>
            ))}
          </section>
        )}

        {r && ver("campanhas") && (
          <section className="card" style={{ overflowX: "auto" }} aria-labelledby="camp-t">
            <h2 id="camp-t" className="h2" style={{ padding: "18px 16px 4px" }}>Campanhas</h2>
            {campanhas.length === 0 ? <p className="rot" style={{ padding: "0 16px 16px", fontSize: 14 }}>Nenhuma campanha com gasto no período. Conecte o Meta em <Link href="/trafego/conexoes">Conexões</Link>.</p> : (
              <table className="tab">
                <thead><tr><th scope="col">Campanha</th><th scope="col">Carro</th><th scope="col" style={{ textAlign: "right" }}>Investido</th><th scope="col" style={{ textAlign: "right" }}>Conversas</th><th scope="col" style={{ textAlign: "right" }}>Custo</th></tr></thead>
                <tbody>
                  {campanhas.map((c) => (
                    <tr key={c.id}>
                      <td>{c.nome}</td>
                      <td>{c.carro === "ok" ? <span className="selo s-ok">no pátio</span> : c.carro === "vendido" ? <span className="selo s-at">fora do pátio</span> : <span className="selo s-ne">sem carro</span>}</td>
                      <td className="dado" style={{ textAlign: "right" }}>{brl(c.gasto * IMPOSTO, 2)}</td>
                      <td className="dado" style={{ textAlign: "right" }}>{c.msgs}</td>
                      <td className="dado" style={{ textAlign: "right" }}>{c.msgs ? brl((c.gasto * IMPOSTO) / c.msgs, 2) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {r?.crm && ver("atendimento") && (
          <section className="card" style={{ padding: "18px 20px" }} aria-labelledby="at-t">
            <h2 id="at-t" className="h2">Clientes e atendimento</h2>
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 1, background: "var(--p-linha-2)", border: "1px solid var(--p-linha-2)", borderRadius: 10, overflow: "hidden" }}>
              {([
                ["Conversas novas", String(r.crm.conversasNovas), cfg.comparar ? variacao(r.crm.conversasNovas, antes?.crm?.conversasNovas) : null],
                ["Mensagens de clientes", String(r.crm.msgsRecebidas), null],
                ["Respostas da loja", String(r.crm.msgsEnviadas), null],
                ["Tempo de resposta (mediana)", minutos(r.crm.resposta.mediana), r.crm.resposta.amostras ? `${r.crm.resposta.amostras} respostas medidas` : "sem respostas no período"],
                ["Respondidas em até 5 min", r.crm.resposta.ate5min == null ? "—" : `${Math.round(r.crm.resposta.ate5min * 100)}%`, null],
                ["Visitas na loja", `${r.crm.visitas.realizadas} de ${r.crm.visitas.agendadas}`, r.crm.visitas.faltou ? `${r.crm.visitas.faltou} faltaram` : "realizadas / agendadas"],
                ["Negócios criados", String(r.crm.funil.criados), `${r.crm.funil.ganhos} ganhos · ${r.crm.funil.perdidos} perdidos`],
                ["Valor dos negócios ganhos", brl(r.crm.funil.valorGanho), null],
              ] as [string, string, string | null][]).map(([rot, val, sub]) => (
                <div key={rot} style={{ background: "var(--p-papel)", padding: 14 }}><div className="rot">{rot}</div><div className="dado" style={{ fontSize: 20 }}>{val}</div>{sub && <div className="rot" style={{ fontSize: 12 }}>{sub}</div>}</div>
              ))}
            </div>
            {r.crm.origens.length > 0 && (
              <>
                <h3 className="rot" style={{ margin: "16px 0 6px", fontSize: 13 }}>De onde vieram os clientes novos</h3>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {r.crm.origens.map((o) => {
                    const max = Math.max(...r.crm!.origens.map((x) => x.clientes));
                    return (
                      <li key={o.origem} style={{ display: "grid", gridTemplateColumns: "170px 1fr 48px", gap: 10, alignItems: "center", fontSize: 14 }}>
                        <span>{o.origem}</span>
                        <span style={{ height: 10, background: "var(--p-linha-2)", borderRadius: 5, overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${(o.clientes / max) * 100}%`, background: "var(--chart-1)" }} /></span>
                        <span className="dado" style={{ textAlign: "right" }}>{o.clientes}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            <p className="rot" style={{ fontSize: 12, margin: "10px 0 0" }}>Tempo de resposta: da primeira mensagem do cliente até a primeira resposta de uma pessoa da equipe (o robô não conta).{r.crm.resposta.parcial ? " Período longo: medido nas primeiras 30 mil mensagens." : ""} Negócios: os criados no período, pela situação de hoje.</p>
          </section>
        )}
        {r && r.crm === null && ver("atendimento") && <div className="card" style={{ padding: 16, fontSize: 14 }}>Não foi possível ler os números do CRM agora.</div>}

        {r?.crm && ver("vendedores") && r.crm.vendedores.length > 0 && (
          <section className="card" style={{ overflowX: "auto" }} aria-labelledby="vd-t">
            <h2 id="vd-t" className="h2" style={{ padding: "18px 16px 4px" }}>Vendedores</h2>
            <table className="tab">
              <thead><tr><th scope="col">Pessoa</th><th scope="col" style={{ textAlign: "right" }}>Conversas novas</th><th scope="col" style={{ textAlign: "right" }}>Negócios</th><th scope="col" style={{ textAlign: "right" }}>Ganhos</th><th scope="col" style={{ textAlign: "right" }}>Conversão</th></tr></thead>
              <tbody>
                {r.crm.vendedores.map((v) => (
                  <tr key={v.id}><td>{v.nome}</td><td className="dado" style={{ textAlign: "right" }}>{v.conversas}</td><td className="dado" style={{ textAlign: "right" }}>{v.negocios}</td><td className="dado" style={{ textAlign: "right" }}>{v.ganhos}</td><td className="dado" style={{ textAlign: "right" }}>{v.negocios ? `${Math.round((v.ganhos / v.negocios) * 100)}%` : "—"}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="rot" style={{ fontSize: 12, margin: 0, padding: "8px 16px 14px" }}>Pela pessoa responsável pela conversa e pelo negócio no CRM.</p>
          </section>
        )}

        {r && ver("site") && r.site !== undefined && (
          <section className="card" style={{ padding: "18px 20px" }} aria-labelledby="st-t">
            <h2 id="st-t" className="h2">Site</h2>
            {!r.siteLigado ? <p style={{ fontSize: 14, margin: "8px 0 0" }}>Ligue o Google Analytics em <Link href="/ajustes/conexoes">Ajustes → Conexões</Link> para ver as visitas do site.</p>
              : !r.site ? <p style={{ fontSize: 14, margin: "8px 0 0" }}>Não foi possível ler o Google Analytics agora.</p> : (
              <>
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 1, background: "var(--p-linha-2)", border: "1px solid var(--p-linha-2)", borderRadius: 10, overflow: "hidden" }}>
                  {([
                    ["Visitas", r.site.sessoes.toLocaleString("pt-BR"), cfg.comparar ? variacao(r.site.sessoes, antes?.site?.sessoes) : null],
                    ["Pessoas", r.site.usuarios.toLocaleString("pt-BR"), null],
                    ["Cliques no WhatsApp", r.site.cliquesWhatsapp.toLocaleString("pt-BR"), r.site.sessoes ? `${((r.site.cliquesWhatsapp / r.site.sessoes) * 100).toFixed(1).replace(".", ",")}% das visitas` : null],
                    ["Fichas de carro abertas", r.site.carrosVistos.toLocaleString("pt-BR"), null],
                  ] as [string, string, string | null][]).map(([rot, val, sub]) => (
                    <div key={rot} style={{ background: "var(--p-papel)", padding: 14 }}><div className="rot">{rot}</div><div className="dado" style={{ fontSize: 20 }}>{val}</div>{sub && <div className="rot" style={{ fontSize: 12 }}>{sub}</div>}</div>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18, marginTop: 16 }}>
                  {([
                    ["Cliques no WhatsApp por botão", r.site.porOrigem?.map((x) => [x.origem, x.cliques] as [string, number]) ?? null, "Crie a dimensão personalizada \"source\" no GA4 (Administrador → Definições personalizadas) para ver de qual botão veio cada clique."],
                    ["Carros mais vistos no site", r.site.maisVistos?.map((x) => [x.nome, x.vistas] as [string, number]) ?? null, "Crie a dimensão personalizada \"vehicle_name\" no GA4 para ver este ranking."],
                    ["Visitas por canal", r.site.canais.map((x) => [x.canal, x.sessoes] as [string, number]), ""],
                  ] as [string, [string, number][] | null, string][]).map(([titulo, linhas, dica]) => (
                    <div key={titulo}>
                      <h3 className="rot" style={{ margin: "0 0 6px", fontSize: 13 }}>{titulo}</h3>
                      {!linhas ? <p className="rot" style={{ fontSize: 13, margin: 0 }}>{dica}</p> : !linhas.length ? <p className="rot" style={{ fontSize: 13, margin: 0 }}>Sem dados no período.</p> : (
                        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 14, display: "flex", flexDirection: "column", gap: 4 }}>
                          {linhas.slice(0, 8).map(([n, v]) => <li key={n}><span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>{n}</span><span className="dado">{v.toLocaleString("pt-BR")}</span></span></li>)}
                        </ol>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {r?.patio && ver("patio") && (
          <section className="card" style={{ padding: "18px 20px" }} aria-labelledby="pt-t">
            <h2 id="pt-t" className="h2">Pátio e vendas</h2>
            <dl style={{ margin: "12px 0 0", display: "grid", gridTemplateColumns: "1fr auto", gap: "10px 16px", fontSize: 14, maxWidth: 520 }}>
              <dt>Vendidos no período</dt><dd className="dado" style={{ margin: 0 }}>{r.patio.vendidosPeriodo}</dd>
              <dt>Vendidos com até 30 dias no pátio</dt><dd className="dado" style={{ margin: 0 }}>{r.patio.vendidosAte30Dias}</dd>
              <dt>À venda hoje</dt><dd className="dado" style={{ margin: 0 }}>{r.patio.aVenda}</dd>
              <dt>Valor em estoque</dt><dd className="dado" style={{ margin: 0 }}>{brl(r.patio.valorEstoque)}</dd>
              <dt>Parados há +45 dias</dt><dd className="dado" style={{ margin: 0 }}>{r.patio.parados}</dd>
            </dl>
            {r.patio.vendidosSemData > 0 && <p className="rot" style={{ fontSize: 13, margin: "10px 0 0" }}>{r.patio.vendidosSemData} carros vendidos estão sem data de venda e não entram no período. Preencha em Financeiro, na ficha do carro.</p>}
          </section>
        )}

        {r?.patio?.composicao && ver("composicao") && (
          <section className="card" style={{ padding: "18px 20px" }} aria-labelledby="cp-t">
            <h2 id="cp-t" className="h2">Como está o pátio hoje</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20, marginTop: 12 }}>
              <div>
                <h3 className="rot" style={{ margin: "0 0 6px", fontSize: 13 }}>Posse × situação</h3>
                <table className="tab" style={{ fontSize: 13 }}>
                  <thead><tr><th scope="col">Posse</th>{Object.keys(STATUS_PT).map((k) => <th key={k} scope="col" style={{ textAlign: "right" }}>{STATUS_PT[k]}</th>)}</tr></thead>
                  <tbody>
                    {Object.entries(r.patio.composicao.posse).map(([p, st]) => (
                      <tr key={p}><td>{POSSE[p] ?? p}</td>{Object.keys(STATUS_PT).map((k) => <td key={k} className="dado" style={{ textAlign: "right" }}>{st[k] ?? 0}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h3 className="rot" style={{ margin: "0 0 6px", fontSize: 13 }}>Categorias</h3>
                <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "1fr auto", gap: "6px 16px", fontSize: 14 }}>
                  {Object.entries(r.patio.composicao.categorias).flatMap(([k, n]) => [<dt key={`${k}-n`}>{CATEGORIAS[k] ?? k}</dt>, <dd key={`${k}-v`} className="dado" style={{ margin: 0 }}>{n}</dd>])}
                </dl>
              </div>
              <div>
                <h3 className="rot" style={{ margin: "0 0 6px", fontSize: 13 }}>Faixas de preço</h3>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {r.patio.composicao.faixas.map((f) => {
                    const max = Math.max(1, ...r.patio!.composicao!.faixas.map((x) => x.carros));
                    return (
                      <li key={f.nome} style={{ display: "grid", gridTemplateColumns: "130px 1fr 32px", gap: 8, alignItems: "center", fontSize: 13 }}>
                        <span>{f.nome}</span>
                        <span style={{ height: 10, background: "var(--p-linha-2)", borderRadius: 5, overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${(f.carros / max) * 100}%`, background: "var(--chart-1)" }} /></span>
                        <span className="dado" style={{ textAlign: "right" }}>{f.carros}</span>
                      </li>
                    );
                  })}
                </ul>
                {r.patio.composicao.semPreco > 0 && <p className="rot" style={{ fontSize: 12, margin: "6px 0 0" }}>{r.patio.composicao.semPreco} sem preço.</p>}
              </div>
            </div>
          </section>
        )}

        {r?.patio && ver("financeiro") && (
          <section className="card" style={{ padding: "18px 20px" }} aria-labelledby="fin-t">
            <h2 id="fin-t" className="h2">Financeiro <span className="selo s-ne">só sócios</span></h2>
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 1, background: "var(--p-linha-2)", border: "1px solid var(--p-linha-2)", borderRadius: 10, overflow: "hidden" }}>
              {[["Receita das vendas", brl(r.patio.receitaPeriodo)], ["Lucro (venda − custo)", brl(r.patio.lucroPeriodo)], ["Lucro após tráfego", r.patio.lucroPeriodo ? brl(r.patio.lucroPeriodo - investido) : "—"], ["Capital no pátio", brl(r.patio.capitalParado)]].map(([rot, val]) => (
                <div key={rot} style={{ background: "var(--p-papel)", padding: 14 }}><div className="rot">{rot}</div><div className="dado" style={{ fontSize: 20 }}>{val}</div></div>
              ))}
            </div>
            <p className="rot" style={{ fontSize: 13, margin: "10px 0 0" }}>Lucro só conta carros vendidos com custo lançado: compra (próprio) ou valor combinado com o dono (consignado), mais os custos extras.</p>
          </section>
        )}
        <p className="rot" style={{ margin: 0, fontSize: 12 }}>Gerado pelo Sistema iBox. Anúncios: Meta (com 12% de imposto). Vendas e financeiro: Pátio. Clientes: CRM. Site: Google Analytics 4.</p>
      </div>
      <style>{`@media print { nav, header, aside.relatorio-filtros { display: none !important; } .modulo-patio { background: #fff !important; } }`}</style>
    </div>
  );
}
