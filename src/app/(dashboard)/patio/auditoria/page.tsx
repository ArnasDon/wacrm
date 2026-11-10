"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { brl, Foto, STATUS_NOME, STATUS_SELO } from "../comum";
import type { LinhaPatio, Orfao, CampanhaLinha } from "@/lib/patio/auditoria";

type Dados = {
  papel: "socio" | "marketing" | "vendedor";
  linhas: LinhaPatio[];
  orfaos: Orfao[];
  semVinculo: CampanhaLinha[];
  totais: { carrosPatio: number; comAnuncio: number; comSugestao: number; investidoEmCarros: number; investidoOrfaos: number; investidoSemVinculo: number; investidoFinalidade: number };
};
type Aba = "patio" | "orfaos" | "soltas";
type Filtro = "todos" | "sugestao" | "sem" | "com" | "vendidos";

export default function AuditoriaPage() {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("patio");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [aberto, setAberto] = useState<string | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/patio/auditoria", { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.erro || "Não foi possível abrir.");
    setD(j);
  }, []);
  useEffect(() => {
    let vivo = true;
    fetch("/api/patio/auditoria", { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.erro || "Não foi possível abrir."); if (vivo) setD(j); })
      .catch((e: Error) => vivo && setErro(e.message));
    return () => { vivo = false; };
  }, []);

  async function ligar(veiculoId: string, carroId: string, silencioso = false) {
    const r = await fetch("/api/patio/auditoria", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ veiculoId, carroId }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || "Não foi possível ligar.");
    if (!silencioso) setAviso(j.como === "ligado" ? "Ligado." : `Ligado: ${j.campanhas} campanha(s) passaram para este carro.`);
  }
  async function umaLigacao(veiculoId: string, carroId: string) {
    setTrabalhando(true); setAviso(null);
    try { await ligar(veiculoId, carroId); await carregar(); } catch (e) { setAviso((e as Error).message); }
    setTrabalhando(false);
  }
  const sugestoes = useMemo(() => {
    if (!d) return [] as [string, string][];
    const pares = new Map<string, string>();
    for (const l of d.linhas) if (l.sugestao) pares.set(l.sugestao.veiculoId, l.id);
    for (const o of d.orfaos) if (o.sugestao && !pares.has(o.id) && o.sugestao.motivo === "placa igual") pares.set(o.id, o.sugestao.carroId);
    return [...pares];
  }, [d]);
  async function aceitarTodas() {
    if (!confirm(`Ligar ${sugestoes.length} par(es) sugeridos? Confira a lista antes: a sugestão é pela placa e pelo modelo.`)) return;
    setTrabalhando(true); setAviso(null);
    let ok = 0;
    for (const [v, c] of sugestoes) { try { await ligar(v, c, true); ok++; } catch { /* segue */ } }
    await carregar().catch(() => {});
    setAviso(`${ok} de ${sugestoes.length} ligados.`);
    setTrabalhando(false);
  }

  if (erro) return <div className="card" style={{ padding: 20 }}>{erro}</div>;
  if (!d) return <div className="card" style={{ padding: 20 }} aria-busy="true">Montando a auditoria (pátio, carros do Marketing e todo o gasto desde o início)…</div>;
  const socio = d.papel === "socio";
  const t = d.totais;
  const linhas = d.linhas.filter((l) =>
    filtro === "sugestao" ? !!l.sugestao : filtro === "sem" ? !l.campanhas.length : filtro === "com" ? l.campanhas.length > 0 : filtro === "vendidos" ? l.status === "sold" : true);
  const livresPatio = d.linhas.filter((l) => !l.veiculoId || !l.campanhas.length);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1400 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="rot" style={{ fontSize: 13 }}><Link href="/patio">Pátio</Link> · Auditoria</div>
          <h1 className="disp" style={{ margin: "4px 0 0" }}>Anúncios e custos por carro</h1>
          <p className="rot" style={{ margin: "6px 0 0", fontSize: 14, maxWidth: 760 }}>
            O carro do Pátio é o do site. As campanhas ficam ligadas ao cadastro do carro em Marketing → Carros. Aqui você vê os dois lado a lado, com o gasto desde o início, e liga o que falta.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/trafego/ligar" className="btns">Ligar campanhas uma a uma</Link>
          {sugestoes.length > 0 && <button type="button" className="btnp" disabled={trabalhando} onClick={aceitarTodas}>Ligar {sugestoes.length} sugestões</button>}
        </div>
      </div>

      <section className="card" aria-label="Resumo" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", overflow: "hidden" }}>
        {([
          ["Carros no pátio", String(t.carrosPatio), `${t.comAnuncio} com anúncio ligado`],
          ["Investido em carros", brl(t.investidoEmCarros), "desde o início, com imposto"],
          ["Em carros sem par no pátio", brl(t.investidoOrfaos), `${d.orfaos.length} cadastros do Marketing`],
          ["Campanhas com finalidade", brl(t.investidoFinalidade), "Instagram, site, marca…"],
          ["Campanhas sem vínculo", brl(t.investidoSemVinculo), `${d.semVinculo.length} campanhas`],
        ] as [string, string, string][]).map(([r, v, s]) => (
          <div key={r} style={{ padding: "16px 18px", borderRight: "1px solid var(--p-linha-2)" }}><div className="rot">{r}</div><div className="dado" style={{ fontSize: 22 }}>{v}</div><div className="rot" style={{ fontSize: 12 }}>{s}</div></div>
        ))}
      </section>

      {aviso && <p role="status" style={{ margin: 0, fontSize: 14 }}>{aviso}</p>}

      <div className="abas" role="tablist">
        {([["patio", `Carros do pátio · ${d.linhas.length}`], ["orfaos", `Cadastros sem par · ${d.orfaos.length}`], ["soltas", `Campanhas sem vínculo · ${d.semVinculo.length}`]] as [Aba, string][]).map(([id, n]) => (
          <button key={id} type="button" role="tab" className="aba" aria-selected={aba === id} onClick={() => setAba(id)}>{n}</button>
        ))}
      </div>

      {aba === "patio" && (
        <>
          <div role="group" aria-label="Filtrar" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {([["todos", "Todos"], ["sugestao", "Com sugestão de ligação"], ["sem", "Sem anúncio ligado"], ["com", "Com anúncio"], ["vendidos", "Vendidos"]] as [Filtro, string][]).map(([k, n]) => (
              <button key={k} type="button" className="chip" aria-pressed={filtro === k} onClick={() => setFiltro(k)}>{n}</button>
            ))}
          </div>
          <section className="card" style={{ overflowX: "auto" }} aria-label="Carros do pátio">
            <table className="tab">
              <thead>
                <tr>
                  <th scope="col">Carro do pátio</th><th scope="col">Situação</th><th scope="col">Anúncios</th>
                  <th scope="col" style={{ textAlign: "right" }}>Investido</th><th scope="col" style={{ textAlign: "right" }}>Conversas</th><th scope="col" style={{ textAlign: "right" }}>Custo/conversa</th>
                  {socio && <><th scope="col" style={{ textAlign: "right" }}>Custo do carro</th><th scope="col" style={{ textAlign: "right" }}>Lucro</th><th scope="col" style={{ textAlign: "right" }}>Lucro após tráfego</th></>}
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <Fragment key={l.id}>
                    <tr>
                      <td>
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <Foto url={l.img} alt="" style={{ width: 56, height: 40, borderRadius: 6, flex: "none" }} />
                          <span><Link href={`/patio/${l.id}`}><b>{l.nome}</b> {l.versao}</Link><span className="rot" style={{ display: "block", fontSize: 12 }}>{[l.ano, l.placa].filter(Boolean).join(" · ")}</span></span>
                        </div>
                      </td>
                      <td><span className={`selo ${STATUS_SELO[l.status] ?? "s-ne"}`}>{STATUS_NOME[l.status] ?? l.status}</span></td>
                      <td>
                        {l.campanhas.length ? (
                          <button type="button" className="btns" style={{ padding: "4px 9px" }} onClick={() => setAberto(aberto === l.id ? null : l.id)} aria-expanded={aberto === l.id}>{l.campanhas.length} campanha{l.campanhas.length > 1 ? "s" : ""}</button>
                        ) : l.sugestao ? (
                          <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <span className="rot" style={{ fontSize: 12 }}>Parece ser: <b style={{ color: "var(--p-ink)" }}>{l.sugestao.rotulo}</b> ({l.sugestao.motivo}{l.sugestao.investido ? ` · ${brl(l.sugestao.investido)} em anúncio` : ""})</span>
                            <button type="button" className="btns" style={{ padding: "4px 9px", alignSelf: "flex-start" }} disabled={trabalhando} onClick={() => umaLigacao(l.sugestao!.veiculoId, l.id)}>Ligar</button>
                          </span>
                        ) : <span className="rot" style={{ fontSize: 13 }}>{l.veiculoId ? "nenhuma campanha" : "sem cadastro no Marketing"}</span>}
                      </td>
                      <td className="dado" style={{ textAlign: "right" }}>{l.investido ? brl(l.investido, 2) : "—"}</td>
                      <td className="dado" style={{ textAlign: "right" }}>{l.msgs || "—"}</td>
                      <td className="dado" style={{ textAlign: "right" }}>{l.msgs ? brl(l.investido / l.msgs, 2) : "—"}</td>
                      {socio && <>
                        <td className="dado" style={{ textAlign: "right" }}>{l.custo != null ? brl(l.custo) : <span className="rot">sem custo</span>}</td>
                        <td className="dado" style={{ textAlign: "right" }}>{l.lucro != null ? brl(l.lucro) : "—"}</td>
                        <td className="dado" style={{ textAlign: "right", color: l.lucroAposTrafego != null && l.lucroAposTrafego < 0 ? "var(--ru)" : undefined }}>{l.lucroAposTrafego != null ? brl(l.lucroAposTrafego) : "—"}</td>
                      </>}
                    </tr>
                    {aberto === l.id && (
                      <tr>
                        <td colSpan={socio ? 9 : 6} style={{ background: "var(--p-suave)" }}>
                          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                            {l.campanhas.map((c) => <li key={c.id}>{c.nome} · <span className="dado">{brl(c.investido, 2)}</span> · {c.msgs} conversas{c.status ? ` · ${c.status === "ACTIVE" ? "ativa" : c.status === "PAUSED" ? "pausada" : c.status}` : ""}</li>)}
                          </ul>
                          {l.veiculoId && <Link href={`/trafego/carros/${l.veiculoId}`} style={{ fontSize: 13 }}>Ligar ou tirar campanhas deste carro</Link>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </section>
          <p className="rot" style={{ margin: 0, fontSize: 12 }}>Investido com o imposto de 12% do Meta, somando todas as campanhas ligadas ao carro desde o início.{socio ? " Custo do carro: compra (próprio) ou valor combinado (consignado) + custos extras." : ""}</p>
        </>
      )}

      {aba === "orfaos" && (
        <section className="card" style={{ overflowX: "auto" }} aria-label="Cadastros do Marketing sem par no pátio">
          {d.orfaos.length === 0 ? <p style={{ padding: 16, margin: 0 }}>Todos os cadastros do Marketing com anúncio estão ligados a um carro do pátio.</p> : (
            <table className="tab">
              <thead><tr><th scope="col">Cadastro no Marketing</th><th scope="col" style={{ textAlign: "right" }}>Investido</th><th scope="col" style={{ textAlign: "right" }}>Conversas</th><th scope="col">Ligar ao carro do pátio</th></tr></thead>
              <tbody>
                {d.orfaos.map((o) => (
                  <tr key={o.id}>
                    <td><b>{o.modelo || "(sem modelo)"}</b><span className="rot" style={{ display: "block", fontSize: 12 }}>{[o.ano, o.placa].filter(Boolean).join(" · ")} · {o.campanhas.length} campanha(s)</span></td>
                    <td className="dado" style={{ textAlign: "right" }}>{o.investido ? brl(o.investido, 2) : "—"}</td>
                    <td className="dado" style={{ textAlign: "right" }}>{o.msgs || "—"}</td>
                    <td>
                      <select defaultValue={o.sugestao?.carroId ?? ""} id={`sel-${o.id}`} aria-label={`Carro do pátio para ${o.modelo}`} style={{ font: "inherit", fontSize: 13, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--input)", background: "var(--campo)", color: "var(--foreground)", maxWidth: 320 }}>
                        <option value="">Escolher carro do pátio…</option>
                        {livresPatio.map((l) => <option key={l.id} value={l.id}>{[l.nome, l.versao, l.ano, l.placa].filter(Boolean).join(" · ")}{l.status === "sold" ? " (vendido)" : ""}</option>)}
                      </select>{" "}
                      <button type="button" className="btns" style={{ padding: "5px 10px" }} disabled={trabalhando} onClick={() => { const v = (document.getElementById(`sel-${o.id}`) as HTMLSelectElement).value; if (v) umaLigacao(o.id, v); }}>Ligar</button>
                      {o.sugestao && <span className="rot" style={{ display: "block", fontSize: 12, marginTop: 4 }}>Sugestão: {o.sugestao.rotulo} ({o.sugestao.motivo})</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {aba === "soltas" && (
        <section className="card" style={{ overflowX: "auto" }} aria-label="Campanhas sem vínculo">
          {d.semVinculo.length === 0 ? <p style={{ padding: 16, margin: 0 }}>Nenhuma campanha com gasto está sem vínculo.</p> : (
            <>
              <table className="tab">
                <thead><tr><th scope="col">Campanha</th><th scope="col" style={{ textAlign: "right" }}>Investido</th><th scope="col" style={{ textAlign: "right" }}>Conversas</th></tr></thead>
                <tbody>{d.semVinculo.map((c) => <tr key={c.id}><td>{c.nome}</td><td className="dado" style={{ textAlign: "right" }}>{brl(c.investido, 2)}</td><td className="dado" style={{ textAlign: "right" }}>{c.msgs}</td></tr>)}</tbody>
              </table>
              <p style={{ padding: "10px 16px", margin: 0, fontSize: 14 }}>Ligue cada uma a um carro ou a uma finalidade em <Link href="/trafego/campanhas">Marketing → Campanhas</Link> (o botão &quot;Aceitar sugestões&quot; faz a maioria de uma vez).</p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
