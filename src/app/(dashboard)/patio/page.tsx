"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { brl, Foto, nomeCarro, seloDias, STATUS_NOME, STATUS_SELO, type CarroUI, type Papel } from "./comum";

type Aba = "venda" | "rascunho" | "vendidos";
type Filtro = "todos" | "parado" | "anuncio" | "sem" | "ate80" | "80a150" | "acima150";

const FILTROS: [Filtro, string][] = [
  ["todos", "Todos"],
  ["parado", "Parados há +45 dias"],
  ["anuncio", "Com anúncio"],
  ["sem", "Sem anúncio"],
  ["ate80", "Até R$ 80 mil"],
  ["80a150", "R$ 80–150 mil"],
  ["acima150", "Acima de R$ 150 mil"],
];

const preco = (c: CarroUI) => Number(c.finance?.sale_price) || 0;

function passa(c: CarroUI, f: Filtro): boolean {
  switch (f) {
    case "parado": return (c.dias ?? 0) > 45;
    case "anuncio": return !!c.anuncios?.campanhas.length;
    case "sem": return !c.anuncios?.campanhas.length;
    case "ate80": return preco(c) > 0 && preco(c) <= 80_000;
    case "80a150": return preco(c) > 80_000 && preco(c) <= 150_000;
    case "acima150": return preco(c) > 150_000;
    default: return true;
  }
}

export default function PatioPage() {
  const [carros, setCarros] = useState<CarroUI[] | null>(null);
  const [papel, setPapel] = useState<Papel>("vendedor");
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("venda");
  const [modo, setModo] = useState<"quadro" | "lista">("quadro");
  const [filtro, setFiltro] = useState<Filtro>("todos");
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
    const q = busca.trim().toLowerCase();
    return porAba[aba]
      .filter((c) => passa(c, filtro))
      .filter((c) => !q || [c.brand, c.model, c.versao, c.plate, c.year].join(" ").toLowerCase().includes(q))
      .sort((a, b) => (Number(a.ordem) || 999) - (Number(b.ordem) || 999) || (b.dias ?? 0) - (a.dias ?? 0));
  }, [porAba, aba, filtro, busca]);

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
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Modelo, versão, placa ou ano…" autoComplete="off" spellCheck={false} />
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

      <div role="group" aria-label="Filtrar carros" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {FILTROS.map(([id, nome]) => (
          <button key={id} type="button" className="chip" aria-pressed={filtro === id} onClick={() => setFiltro(id)}>
            {nome} <span className="dado" style={{ fontSize: 12, opacity: 0.7 }}>{porAba[aba].filter((c) => passa(c, id)).length}</span>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "999 1 560px", minWidth: 0 }}>
          {!carros ? (
            <div className="quadro" aria-busy="true" style={{ minHeight: 320 }} />
          ) : visiveis.length === 0 ? (
            <div className="card" style={{ padding: 24 }}>
              Nenhum carro aqui com esse filtro.{" "}
              <button type="button" className="btns" onClick={() => { setFiltro("todos"); setBusca(""); }}>Limpar filtros</button>
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
                  <tr><th scope="col">Carro</th><th scope="col">Ano</th><th scope="col">Preço</th><th scope="col">No pátio</th><th scope="col">Visitas no site (30 dias)</th><th scope="col">Conversas (30 dias)</th><th scope="col">Situação</th></tr>
                </thead>
                <tbody>
                  {visiveis.map((c) => (
                    <tr key={c.id}>
                      <td><Link href={`/patio/${c.id}`}><b style={{ color: "var(--p-ink)" }}>{nomeCarro(c)}</b> {c.versao}</Link></td>
                      <td className="dado">{String(c.year ?? "")}</td>
                      <td><span className="tag">{brl(preco(c))}</span></td>
                      <td>{c.dias != null ? <span className={seloDias(c.dias)}>{c.dias} dias</span> : "—"}</td>
                      <td className="dado">{c.visitas ?? "—"}</td>
                      <td className="dado">{c.anuncios?.campanhas.length ? c.anuncios.msgs : "—"}</td>
                      <td><span className={`selo ${STATUS_SELO[c.status ?? ""] ?? "s-ne"}`}>{STATUS_NOME[c.status ?? ""] ?? c.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <p className="rot" style={{ margin: "12px 0 0" }}>
            Dias no pátio contam desde o cadastro no site. Selo verde até 30 dias, âmbar até 60, vermelho acima.
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
