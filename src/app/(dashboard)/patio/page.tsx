"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { brl, Foto, nomeCarro, seloDias, STATUS_NOME, STATUS_SELO, type CarroUI, type Papel } from "./comum";
import { CATEGORIAS, COLUNAS, COLUNAS_PADRAO, COLUNAS_RENTABILIDADE, FILTROS_VAZIOS, ORDENS, POSSE, buscaCasa, ordenar, passaFiltros, planilha, type Filtros, type Ordem } from "@/lib/patio/filtros";
import { createClient } from "@/lib/supabase/client";

type Aba = "venda" | "rascunho" | "vendidos" | "documentos";
type Doc = { id?: string; name?: string; type?: string; date?: string; url?: string; file_url?: string; storage_path?: string };

const preco = (c: CarroUI) => Number(c.finance?.sale_price) || 0;
const CHAVE_FILTROS = "ibox.patio.filtros";
const CHAVE_COLUNAS = "ibox.patio.colunas";

function ler<T>(chave: string, padrao: T): T {
  try { const v = localStorage.getItem(chave); return v ? { ...padrao, ...JSON.parse(v) } : padrao; } catch { return padrao; }
}
function lerLista(chave: string, padrao: string[]): string[] {
  try { const v = JSON.parse(localStorage.getItem(chave) || "null"); return Array.isArray(v) ? v : padrao; } catch { return padrao; }
}
function guardar(chave: string, v: unknown) { try { localStorage.setItem(chave, JSON.stringify(v)); } catch { /* sem armazenamento */ } }

function baixar(nome: string, conteudo: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement("a");
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function celula(col: string, v: string | number | null) {
  if (v == null || v === "") return "—";
  if (["preco", "compra", "custo", "fipe", "lucro", "vs_fipe", "venda"].includes(col)) return brl(v);
  if (["gasto", "cpc"].includes(col)) return brl(v, 2);
  if (col === "margem") return `${String(v).replace(".", ",")}%`;
  if (col === "situacao") return STATUS_NOME[String(v)] ?? String(v);
  if (col === "data_venda") return new Date(String(v) + "T12:00:00").toLocaleDateString("pt-BR");
  return String(v);
}

export default function PatioPage() {
  const [carros, setCarros] = useState<CarroUI[] | null>(null);
  const [papel, setPapel] = useState<Papel>("vendedor");
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("venda");
  const [modo, setModo] = useState<"quadro" | "lista">("quadro");
  const [f, setF] = useState<Filtros>(FILTROS_VAZIOS);
  const [colunas, setColunas] = useState<string[]>(COLUNAS_PADRAO);
  const [verColunas, setVerColunas] = useState(false);
  useEffect(() => {
    // Preferências deste aparelho (filtros e colunas escolhidos por último).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lê o localStorage só depois de montar, para não divergir do HTML do servidor
    setF(ler(CHAVE_FILTROS, FILTROS_VAZIOS));
    setColunas(lerLista(CHAVE_COLUNAS, COLUNAS_PADRAO));
  }, []);
  const mudarF = (m: Partial<Filtros>) => { const n = { ...f, ...m }; setF(n); guardar(CHAVE_FILTROS, n); };
  const mudarColunas = (n: string[]) => { setColunas(n); guardar(CHAVE_COLUNAS, n); };
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/patio", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!vivo) return;
        if (!r.ok) throw new Error(d.erro || "Não foi possível abrir o pátio.");
        setCarros(d.carros);
        setPapel(d.papel);
      })
      .catch((e: Error) => vivo && setErro(e.message));
    return () => {
      vivo = false;
    };
  }, []);

  const porAba = useMemo(() => {
    const todos = carros ?? [];
    return {
      venda: todos.filter((c) => ["available", "reserved", "unavailable"].includes(c.status ?? "available")),
      rascunho: todos.filter((c) => c.status === "review"),
      vendidos: todos.filter((c) => c.status === "sold"),
    };
  }, [carros]);

  const visiveis = useMemo(() => {
    if (aba === "documentos") return [];
    const base = porAba[aba].filter((c) => passaFiltros(c, f) && buscaCasa(c, busca));
    return ordenar(base, aba === "vendidos" && f.ordem === "vitrine" ? "recentes" : f.ordem);
  }, [porAba, aba, f, busca]);
  const filtrosAtivos = (Object.keys(FILTROS_VAZIOS) as (keyof Filtros)[]).filter((k) => k !== "ordem" && f[k]).length;
  const socio = papel === "socio";
  const colsVisiveis = COLUNAS.filter((c) => colunas.includes(c.id) && (socio || !c.socio));
  const documentos = useMemo(
    () => (carros ?? []).flatMap((c) => ((c.documents ?? []) as Doc[]).map((d) => ({ ...d, carro: c }))).filter((d) => buscaCasa(d.carro, busca) || (d.name ?? "").toLowerCase().includes(busca.trim().toLowerCase())),
    [carros, busca],
  );
  async function abrirDoc(d: Doc) {
    if (d.url || d.file_url) { window.open(d.url || d.file_url, "_blank", "noopener"); return; }
    if (!d.storage_path) return;
    const { data } = await createClient().storage.from("patio-docs").createSignedUrl(d.storage_path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  }

  const aVenda = porAba.venda;
  const totalEstoque = aVenda.reduce((s, c) => s + preco(c), 0);
  const sel = aberto ? (carros ?? []).find((c) => c.id === aberto) ?? null : null;

  if (erro) {
    return (
      <div className="card" style={{ padding: 24, maxWidth: 640 }}>
        <h1 className="disp" style={{ margin: 0, fontSize: 32 }}>Pátio</h1>
        <p style={{ marginTop: 12 }}>{erro}</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1400 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 className="disp" style={{ margin: 0, fontSize: 44, lineHeight: 1.02 }}>Pátio</h1>
          <p style={{ margin: "6px 0 0", color: "var(--p-mudo)" }}>
            {carros ? (
              <>
                <span className="dado" style={{ color: "var(--p-ink)" }}>{aVenda.length}</span> à venda ·{" "}
                <span className="dado" style={{ color: "var(--p-ink)" }}>{brl(totalEstoque)}</span> em estoque ·{" "}
                <span className="dado" style={{ color: "var(--p-ink)" }}>{porAba.vendidos.length}</span> vendidos
              </>
            ) : (
              "Carregando o estoque do site…"
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label className="busca">
            <span className="sr-only">Buscar no pátio</span>
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Modelo, versão, placa, ano ou cor…" autoComplete="off" spellCheck={false} />
          </label>
          {carros && papel !== "vendedor" && <Link href="/patio/novo" className="btnp">Cadastrar carro</Link>}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
        <div className="abas" role="tablist">
          {([
            ["venda", `À venda · ${porAba.venda.length}`],
            ["rascunho", `Do grupo de entradas · ${porAba.rascunho.length}`],
            ["vendidos", `Vendidos · ${porAba.vendidos.length}`],
            ...(socio ? [["documentos", "Documentos"] as [Aba, string]] : []),
          ] as [Aba, string][]).map(([id, nome]) => (
            <button key={id} type="button" role="tab" className="aba" aria-selected={aba === id} onClick={() => setAba(id)}>
              {nome}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Modo de ver">
          <button type="button" aria-pressed={modo === "quadro"} onClick={() => setModo("quadro")}>Quadro</button>
          <button type="button" aria-pressed={modo === "lista"} onClick={() => setModo("lista")}>Lista</button>
        </div>
      </div>

      {aba !== "documentos" && (
        <section className="card filtros" aria-label="Filtros" style={{ padding: "12px 14px", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <label className="campo mini">Categoria
            <select value={f.categoria} onChange={(e) => mudarF({ categoria: e.target.value })}><option value="">Todas</option>{Object.entries(CATEGORIAS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          </label>
          <label className="campo mini">Posse
            <select value={f.posse} onChange={(e) => mudarF({ posse: e.target.value })}><option value="">Todas</option>{Object.entries(POSSE).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          </label>
          {aba === "venda" && (
            <label className="campo mini">Situação
              <select value={f.situacao} onChange={(e) => mudarF({ situacao: e.target.value })}><option value="">Todas</option>{["available", "reserved", "unavailable"].map((k) => <option key={k} value={k}>{STATUS_NOME[k]}</option>)}</select>
            </label>
          )}
          <label className="campo mini">Preço de<input value={f.precoMin} onChange={(e) => mudarF({ precoMin: e.target.value })} inputMode="numeric" placeholder="R$" style={{ width: 110 }} /></label>
          <label className="campo mini">até<input value={f.precoMax} onChange={(e) => mudarF({ precoMax: e.target.value })} inputMode="numeric" placeholder="R$" style={{ width: 110 }} /></label>
          <label className="campo mini">Dias no pátio
            <select value={f.dias} onChange={(e) => mudarF({ dias: e.target.value })}><option value="">Todos</option><option value="30">Até 30</option><option value="31-60">31 a 60</option><option value="45+">Mais de 45</option><option value="60+">Mais de 60</option></select>
          </label>
          <label className="campo mini">Anúncio
            <select value={f.anuncio} onChange={(e) => mudarF({ anuncio: e.target.value })}><option value="">Todos</option><option value="com">Com anúncio</option><option value="sem">Sem anúncio</option></select>
          </label>
          <label className="campo mini">Ordenar
            <select value={f.ordem} onChange={(e) => mudarF({ ordem: e.target.value as Ordem })}>{(Object.keys(ORDENS) as Ordem[]).filter((k) => socio || k !== "maior_lucro").map((k) => <option key={k} value={k}>{ORDENS[k]}</option>)}</select>
          </label>
          <span className="rot" style={{ marginLeft: "auto", fontSize: 13 }}><span className="dado">{visiveis.length}</span> de {porAba[aba].length}</span>
          {filtrosAtivos > 0 && <button type="button" className="btns" onClick={() => mudarF({ ...FILTROS_VAZIOS, ordem: f.ordem })}>Limpar {filtrosAtivos} filtro{filtrosAtivos > 1 ? "s" : ""}</button>}
        </section>
      )}

      {aba !== "documentos" && modo === "lista" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="btns" aria-expanded={verColunas} onClick={() => setVerColunas(!verColunas)}>Colunas · {colsVisiveis.length}</button>
          {socio && <button type="button" className="btns" onClick={() => mudarColunas(COLUNAS_RENTABILIDADE)}>Ver rentabilidade</button>}
          <button type="button" className="btns" onClick={() => mudarColunas(COLUNAS_PADRAO)}>Colunas padrão</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btns" disabled={!visiveis.length} onClick={() => baixar(`patio-${aba}-${new Date().toISOString().slice(0, 10)}.csv`, planilha(visiveis, colunas, socio), "text/csv;charset=utf-8")}>Baixar planilha</button>
          {socio && <button type="button" className="btns" disabled={!carros?.length} onClick={() => baixar(`copia-estoque-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ geradoEm: new Date().toISOString(), carros }, null, 2), "application/json")}>Cópia de segurança</button>}
        </div>
      )}
      {verColunas && modo === "lista" && aba !== "documentos" && (
        <fieldset className="card" style={{ padding: 14, display: "flex", flexWrap: "wrap", gap: "8px 18px", border: 0 }}>
          <legend className="sr-only">Colunas da lista</legend>
          {COLUNAS.filter((c) => socio || !c.socio).map((c) => (
            <label key={c.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14 }}>
              <input type="checkbox" checked={colunas.includes(c.id)} onChange={(e) => mudarColunas(e.target.checked ? COLUNAS.map((x) => x.id).filter((id) => id === c.id || colunas.includes(id)) : colunas.filter((x) => x !== c.id))} />
              {c.nome}
            </label>
          ))}
        </fieldset>
      )}

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "999 1 560px", minWidth: 0 }}>
          {aba === "documentos" ? (
            <section className="card" aria-label="Documentos de todos os carros" style={{ overflowX: "auto" }}>
              <table className="tab">
                <thead><tr><th scope="col">Documento</th><th scope="col">Tipo</th><th scope="col">Carro</th><th scope="col">Data</th><th scope="col"><span className="sr-only">Abrir</span></th></tr></thead>
                <tbody>
                  {documentos.map((d, i) => (
                    <tr key={`${d.carro.id}-${d.id ?? i}`}>
                      <td><b>{d.name || "Sem nome"}</b></td>
                      <td className="rot">{d.type || "—"}</td>
                      <td><Link href={`/patio/${d.carro.id}`}>{nomeCarro(d.carro)} {d.carro.versao}</Link> <span className="rot">{d.carro.plate}</span></td>
                      <td className="dado">{d.date ? new Date(d.date + "T12:00:00").toLocaleDateString("pt-BR") : "—"}</td>
                      <td>{(d.url || d.file_url || d.storage_path) ? <button type="button" className="btns" onClick={() => abrirDoc(d)}>Abrir</button> : <span className="rot">sem arquivo</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {carros && !documentos.length && <p style={{ padding: 16, margin: 0 }}>Nenhum documento{busca ? " com essa busca" : " lançado ainda"}. Os documentos entram pela aba Documentos de cada carro.</p>}
            </section>
          ) : !carros ? (
            <div className="quadro" aria-busy="true" style={{ minHeight: 320 }} />
          ) : visiveis.length === 0 ? (
            <div className="card" style={{ padding: 24 }}>
              Nenhum carro aqui com esse filtro.{" "}
              <button type="button" className="btns" onClick={() => { mudarF({ ...FILTROS_VAZIOS, ordem: f.ordem }); setBusca(""); }}>Limpar filtros</button>
            </div>
          ) : modo === "quadro" ? (
            <section className="quadro" aria-label="Quadro de chaves">
              <div className="ganchos">
                {visiveis.map((c) => (
                  <div className="gancho" key={c.id}>
                    <button
                      type="button"
                      className="chave"
                      onClick={() => setAberto(c.id)}
                      aria-label={`${nomeCarro(c)} ${c.versao ?? ""} ${c.year ?? ""}, ${brl(preco(c))}${c.dias != null ? `, ${c.dias} dias no pátio` : ""}`}
                    >
                      <Foto url={c.img} alt="" style={{ height: 104, borderRadius: 8 }} />
                      <span className="placa"><b>BRASIL</b><span>{c.model || "—"}</span></span>
                      <span style={{ display: "block", fontSize: 13, color: "var(--p-mudo)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {[c.brand, c.versao].filter(Boolean).join(" · ")} · <span className="dado">{String(c.year ?? "")}</span>
                      </span>
                      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginTop: 10 }}>
                        <span className="tag">{brl(preco(c))}</span>
                        {c.dias != null && <span className={seloDias(c.dias)}>{c.dias} d</span>}
                      </span>
                      <span style={{ display: "block", marginTop: 8, fontSize: 12, color: "var(--p-mudo)" }}>
                        {c.anuncios?.campanhas.length ? `${c.anuncios.msgs} conversas em 30 dias` : c.status !== "available" ? STATUS_NOME[c.status ?? ""] : "Sem anúncio ligado"}
                        {c.visitas != null && ` · ${c.visitas} visitas`}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <section className="card" aria-label="Lista de carros" style={{ overflowX: "auto" }}>
              <table className="tab">
                <thead>
                  <tr><th scope="col">Carro</th>{colsVisiveis.map((c) => <th key={c.id} scope="col" style={{ textAlign: c.id === "situacao" || c.id === "posse" || c.id === "categoria" ? "left" : "right" }}>{c.nome}</th>)}</tr>
                </thead>
                <tbody>
                  {visiveis.map((c) => (
                    <tr key={c.id}>
                      <td><Link href={`/patio/${c.id}`}><b style={{ color: "var(--p-ink)" }}>{nomeCarro(c)}</b> {c.versao}</Link></td>
                      {colsVisiveis.map((col) => {
                        const v = col.valor(c);
                        if (col.id === "situacao") return <td key={col.id}><span className={`selo ${STATUS_SELO[c.status ?? ""] ?? "s-ne"}`}>{STATUS_NOME[c.status ?? ""] ?? c.status}</span></td>;
                        if (col.id === "dias") return <td key={col.id} style={{ textAlign: "right" }}>{c.dias != null ? <span className={seloDias(c.dias)}>{c.dias} dias</span> : "—"}</td>;
                        if (col.id === "preco") return <td key={col.id} style={{ textAlign: "right" }}><span className="tag">{brl(v)}</span></td>;
                        const texto = ["categoria", "posse", "placa", "cor"].includes(col.id);
                        const negativo = typeof v === "number" && v < 0;
                        return <td key={col.id} className={texto ? undefined : "dado"} style={{ textAlign: texto ? "left" : "right", color: negativo ? "var(--ru)" : undefined }}>{celula(col.id, v)}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <p className="rot" style={{ margin: "12px 0 0" }}>
            Dias no pátio contam da data de compra/entrada (Financeiro); sem ela, do cadastro no site. Selo verde até 30 dias, âmbar até 60, vermelho acima. Anúncio já com o imposto de 12%.
          </p>
        </div>

        {sel && (
          <aside aria-label="Resumo do carro" className="card" style={{ flex: "1 1 320px", maxWidth: 360, padding: 20, position: "sticky", top: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div className="rot">Resumo</div>
                <h2 className="disp" style={{ margin: "2px 0 0", fontSize: 24, lineHeight: 1.05 }}>{nomeCarro(sel)}</h2>
                <div className="rot" style={{ fontSize: 14, marginTop: 4 }}>{sel.versao} · <span className="dado">{String(sel.year ?? "")}</span></div>
              </div>
              <button type="button" className="btns" onClick={() => setAberto(null)} aria-label="Fechar resumo" style={{ padding: "6px 10px" }}>✕</button>
            </div>
            <Foto url={sel.img} alt={`${nomeCarro(sel)} ${sel.versao ?? ""}`} style={{ marginTop: 14, height: 180, borderRadius: 10 }} />
            <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="tag" style={{ fontSize: 18, padding: "6px 14px 6px 22px" }}>{brl(preco(sel))}</span>
              {sel.dias != null && <span className={seloDias(sel.dias)}>{sel.dias} dias no pátio</span>}
            </div>
            <dl style={{ margin: "16px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "9px 16px", fontSize: 14 }}>
              <dt className="rot" style={{ fontSize: 13 }}>Situação</dt><dd style={{ margin: 0 }}>{STATUS_NOME[sel.status ?? ""] ?? sel.status}</dd>
              <dt className="rot" style={{ fontSize: 13 }}>Anúncio</dt>
              <dd style={{ margin: 0 }}>{sel.anuncios?.campanhas.length ? `${sel.anuncios.campanhas.length} campanha(s) · ${brl(sel.anuncios.gasto, 2)} em 30 dias` : "Nenhum ligado"}</dd>
              <dt className="rot" style={{ fontSize: 13 }}>Visitas no site</dt><dd style={{ margin: 0 }} className="dado">{sel.visitas ?? "—"}</dd>
              <dt className="rot" style={{ fontSize: 13 }}>Conversas</dt><dd style={{ margin: 0 }} className="dado">{sel.anuncios?.msgs || "—"}</dd>
              <dt className="rot" style={{ fontSize: 13 }}>Custo por conversa</dt>
              <dd style={{ margin: 0 }} className="dado">{sel.anuncios?.msgs ? brl(sel.anuncios.gasto / sel.anuncios.msgs, 2) : "—"}</dd>
            </dl>
            <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
              <Link href={`/patio/${sel.id}`} className="btnp">Abrir ficha completa</Link>
            </div>
            {papel === "vendedor" && <p className="rot" style={{ margin: "12px 0 0" }}>Você pode consultar o pátio. Alterações ficam com sócios e marketing.</p>}
          </aside>
        )}
      </div>
    </div>
  );
}
