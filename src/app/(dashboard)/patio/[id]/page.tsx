"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import type { AnunciosDoCarro } from "@/lib/patio/anuncios";
import { enviarParaCloudinary } from "@/lib/patio/cloudinary";
import { brl, Foto, nomeCarro, seloDias, STATUS_NOME, STATUS_SELO, type CarroUI, type Papel } from "../comum";

type Historico = { criado_em: string; quem: string | null; acao: string; campos: string[]; antes: Record<string, unknown> | null; depois: Record<string, unknown> | null };
type Aba = "geral" | "site" | "fotos" | "anuncios" | "clientes" | "financeiro" | "dono" | "docs" | "historico";
type Cliente = { id: string; name: string | null; phone: string; origem: string | null; created_at: string };
type VisitaCarro = { id: string; contact_id: string; quando: string; status: string };
type Mapa = Record<string, unknown>;

const txt = (v: unknown) => (v == null ? "" : String(v));
const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(/\./g, "").replace(",", ".")) || 0);

export default function FichaCarroPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [carro, setCarro] = useState<CarroUI | null>(null);
  const [anuncios, setAnuncios] = useState<AnunciosDoCarro | null>(null);
  const [historico, setHistorico] = useState<Historico[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [visitas, setVisitas] = useState<VisitaCarro[]>([]);
  const [papel, setPapel] = useState<Papel>("vendedor");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aba, setAba] = useState<Aba>("geral");

  async function carregar() {
    const r = await fetch(`/api/patio/${id}`, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.erro || "Não foi possível abrir este carro.");
    setCarro(d.carro);
    setAnuncios(d.anuncios);
    setHistorico(d.historico ?? []);
    setClientes(d.clientes ?? []);
    setVisitas(d.visitas ?? []);
    setPapel(d.papel);
  }

  useEffect(() => {
    carregar().catch((e: Error) => setErro(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function salvar(mudanca: Mapa, pronto?: string) {
    setSalvando(true);
    setAviso(null);
    try {
      const r = await fetch(`/api/patio/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mudanca) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro || "Não foi possível salvar.");
      if (!d.mudou?.length) setAviso("Nada mudou.");
      else {
        setAviso(pronto ?? (d.siteAtualizando ? "Salvo. O site está sendo atualizado (leva uns minutos)." : "Salvo."));
        await carregar();
      }
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const ehSocio = papel === "socio";
  const podeEditar = papel !== "vendedor";
  const abas = useMemo(() => {
    const base: [Aba, string][] = [["geral", "Visão geral"], ["site", "Dados do site"], ["fotos", "Fotos"], ["anuncios", "Anúncios"], ["clientes", `Clientes · ${clientes.length}`]];
    if (ehSocio) base.push(["financeiro", "Financeiro"], ["dono", "Dono"], ["docs", "Documentos"], ["historico", "Histórico"]);
    return base;
  }, [ehSocio, clientes.length]);

  if (erro) {
    return (
      <div className="card" style={{ padding: 24, maxWidth: 640 }}>
        <Link href="/patio">← Pátio</Link>
        <p style={{ marginTop: 12 }}>{erro}</p>
      </div>
    );
  }
  if (!carro) return <div className="card" style={{ padding: 24 }} aria-busy="true">Abrindo a ficha…</div>;

  const preco = Number(carro.finance?.sale_price) || 0;
  const cpl = anuncios?.msgs ? anuncios.gasto / anuncios.msgs : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1280 }}>
      <nav aria-label="Caminho" className="rot" style={{ fontSize: 13 }}><Link href="/patio">Pátio</Link> / {nomeCarro(carro)}</nav>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <Foto url={carro.img} alt={`${nomeCarro(carro)} ${carro.versao ?? ""}`} style={{ height: 300, borderRadius: 14 }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8 }}>
            {(carro.images ?? []).slice(1, 5).map((f, i) => <Foto key={f.url + i} url={f.url} alt="" style={{ height: 64, borderRadius: 8 }} />)}
            {(carro.images?.length ?? 0) > 5 && (
              <button type="button" className="btns" style={{ height: 64 }} onClick={() => setAba("fotos")}>+ {(carro.images?.length ?? 0) - 5} fotos</button>
            )}
          </div>
        </div>
        <div style={{ flex: "1 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className={`selo ${STATUS_SELO[carro.status ?? ""] ?? "s-ne"}`}>{STATUS_NOME[carro.status ?? ""] ?? carro.status}</span>
            {anuncios?.campanhas.length ? <span className="selo s-az">Anúncio ligado</span> : <span className="selo s-ne">Sem anúncio</span>}
            <span className="selo s-ne">{carro.ownership_type === "consignado" ? "Consignado" : "Veículo próprio"}</span>
            {carro.oferta && <span className="selo s-at">Oferta</span>}
          </div>
          <h1 className="disp" style={{ margin: 0, fontSize: 44, lineHeight: 1 }}>{nomeCarro(carro)}</h1>
          <div style={{ fontSize: 16, color: "#3e433f" }}>
            {[carro.versao, carro.combustivel, carro.cambio].filter(Boolean).join(" · ")} · <span className="dado">{txt(carro.year)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <span className="tag" style={{ fontSize: 22, padding: "8px 16px 8px 26px" }}>{brl(preco)}</span>
            {Number(carro.finance?.old_price) > 0 && <span className="rot" style={{ fontSize: 14 }}>de <s>{brl(carro.finance?.old_price)}</s></span>}
          </div>
          <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderRight: "1px solid var(--p-linha-2)" }}><div className="rot">No pátio</div><div className="dado" style={{ fontSize: 22 }}>{carro.dias != null ? <span className={seloDias(carro.dias)} style={{ fontSize: 16 }}>{carro.dias} dias</span> : "—"}</div></div>
            <div style={{ padding: "14px 16px", borderRight: "1px solid var(--p-linha-2)" }}><div className="rot">Conversas em 30 dias</div><div className="dado" style={{ fontSize: 22 }}>{anuncios?.msgs || "—"}</div></div>
            <div style={{ padding: "14px 16px" }}><div className="rot">Custo por conversa</div><div className="dado" style={{ fontSize: 22 }}>{cpl ? brl(cpl, 2) : "—"}</div></div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {carro.status === "review" && podeEditar && (
              <button type="button" className="btnp" disabled={salvando} onClick={() => salvar({ status: "available" }, "Aprovado e publicado. O site está sendo atualizado.")}>Aprovar e publicar no site</button>
            )}
            {podeEditar && <button type="button" className="btns" onClick={() => setAba("site")}>Editar dados do site</button>}
            {ehSocio && carro.status !== "sold" && (
              <button type="button" className="btns" disabled={salvando} onClick={() => { if (confirm("Marcar como vendido? O carro sai da vitrine do site.")) salvar({ status: "sold" }, "Marcado como vendido. Preencha os dados da venda em Financeiro."); }}>
                Marcar como vendido
              </button>
            )}
          </div>
          {aviso && <p role="status" style={{ margin: 0, fontSize: 14, color: "var(--p-azul-2)" }}>{aviso}</p>}
        </div>
      </div>

      <div className="abas" role="tablist">
        {abas.map(([a, nome]) => (
          <button key={a} type="button" role="tab" className="aba" aria-selected={aba === a} onClick={() => setAba(a)}>{nome}</button>
        ))}
      </div>

      {aba === "geral" && <VisaoGeral carro={carro} anuncios={anuncios} />}
      {aba === "site" && <DadosSite key={carro.atualizado_em ?? "novo"} carro={carro} podeEditar={podeEditar} salvando={salvando} salvar={salvar} />}
      {aba === "fotos" && <Fotos carro={carro} podeEditar={podeEditar} salvando={salvando} salvar={salvar} />}
      {aba === "anuncios" && <Anuncios anuncios={anuncios} />}
      {aba === "clientes" && <ClientesDoCarro clientes={clientes} visitas={visitas} />}
      {aba === "financeiro" && ehSocio && <Financeiro key={carro.atualizado_em ?? "novo"} carro={carro} anuncios={anuncios} salvando={salvando} salvar={salvar} />}
      {aba === "dono" && ehSocio && <Dono key={carro.atualizado_em ?? "novo"} carro={carro} salvando={salvando} salvar={salvar} />}
      {aba === "docs" && ehSocio && <Documentos carro={carro} />}
      {aba === "historico" && ehSocio && <HistoricoTab itens={historico} />}
    </div>
  );
}

function VisaoGeral({ carro, anuncios }: { carro: CarroUI; anuncios: AnunciosDoCarro | null }) {
  const ck = carro.checklist ?? {};
  const linha = (rotulo: string, valor: unknown) => (
    <>
      <dt className="rot" style={{ fontSize: 13 }}>{rotulo}</dt>
      <dd style={{ margin: 0 }}>{txt(valor) || "—"}</dd>
    </>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18 }}>
      <section className="card" style={{ padding: "18px 20px" }} aria-labelledby="ft">
        <h2 id="ft" className="h2">Ficha técnica</h2>
        <dl style={{ margin: "12px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "9px 18px", fontSize: 14 }}>
          {linha("Marca", carro.brand)}{linha("Modelo", carro.model)}{linha("Versão", carro.versao)}{linha("Ano", carro.year)}
          {linha("KM", carro.mileage)}{linha("Cor", carro.color)}{linha("Combustível", carro.combustivel)}{linha("Câmbio", carro.cambio)}{linha("Placa", carro.plate)}
        </dl>
      </section>
      <section className="card" style={{ padding: "18px 20px" }} aria-labelledby="ck">
        <h2 id="ck" className="h2">Checagem</h2>
        <dl style={{ margin: "12px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "9px 18px", fontSize: 14 }}>
          {linha("IPVA", ck.ipva)}{linha("Revisões", ck.revisoes)}{linha("Chave reserva e manual", ck.chave_manual ? "Sim" : "Não")}
          {linha("Laudo", ck.laudo)}{linha("Pneus", ck.pneus)}{linha("Captação", ck.captacao)}
        </dl>
      </section>
      <section className="card" style={{ padding: "18px 20px" }} aria-labelledby="an">
        <h2 id="an" className="h2">Anúncios nos últimos 30 dias</h2>
        {anuncios?.campanhas.length ? (
          <p style={{ margin: "12px 0 0" }}>
            <span className="dado">{brl(anuncios.gasto, 2)}</span> no Meta trouxeram <span className="dado">{anuncios.msgs}</span> conversas
            {anuncios.msgs ? <> (<span className="dado">{brl(anuncios.gasto / anuncios.msgs, 2)}</span> cada)</> : null}.
          </p>
        ) : (
          <p className="rot" style={{ fontSize: 14, margin: "12px 0 0" }}>Nenhuma campanha ligada a este carro. Ligue uma em Tráfego → Campanhas.</p>
        )}
      </section>
    </div>
  );
}

function DadosSite({ carro, podeEditar, salvando, salvar }: { carro: CarroUI; podeEditar: boolean; salvando: boolean; salvar: (m: Mapa) => void }) {
  const inicial = {
      cat: txt(carro.cat || "carros"), status: txt(carro.status || "available"), brand: txt(carro.brand), model: txt(carro.model), versao: txt(carro.versao),
      year: txt(carro.year), mileage: txt(carro.mileage), color: txt(carro.color), plate: txt(carro.plate), badge: txt(carro.badge),
      combustivel: txt(carro.combustivel), cambio: txt(carro.cambio), description: txt(carro.description), video: txt(carro.video),
      ordem: txt(carro.ordem || ""), oferta: !!carro.oferta,
      sale_price: txt(carro.finance?.sale_price || ""), old_price: txt(carro.finance?.old_price || ""),
      ipva: txt(carro.checklist?.ipva), revisoes: txt(carro.checklist?.revisoes), chave_manual: !!carro.checklist?.chave_manual,
      laudo: txt(carro.checklist?.laudo), pneus: txt(carro.checklist?.pneus), captacao: txt(carro.checklist?.captacao),
      motivo: txt((carro.unavailable as Mapa | null)?.reason),
  };
  const [f, setF] = useState(inicial);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value });

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const m: Mapa = {};
    for (const k of ["cat", "status", "brand", "model", "versao", "year", "mileage", "color", "plate", "badge", "combustivel", "cambio", "description", "video", "oferta"] as const) {
      if (f[k] !== inicial[k]) m[k] = f[k];
    }
    if (f.ordem !== inicial.ordem) m.ordem = Number(f.ordem) || 0;
    const fin: Mapa = {};
    if (f.sale_price !== inicial.sale_price) fin.sale_price = num(f.sale_price);
    if (f.old_price !== inicial.old_price) fin.old_price = num(f.old_price);
    if (Object.keys(fin).length) m.finance = fin;
    const ck: Mapa = {};
    for (const k of ["ipva", "revisoes", "chave_manual", "laudo", "pneus", "captacao"] as const) if (f[k] !== inicial[k]) ck[k] = f[k];
    if (Object.keys(ck).length) m.checklist = ck;
    if (f.status === "unavailable" && (f.motivo !== inicial.motivo || f.status !== inicial.status)) {
      m.unavailable = { reason: f.motivo, since: (carro.unavailable as Mapa | null)?.since || new Date().toISOString() };
    }
    if (f.status !== "unavailable" && inicial.status === "unavailable") m.unavailable = null;
    salvar(m);
  }

  const dis = !podeEditar;
  return (
    <form onSubmit={enviar} className="card" style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
      <label className="campo">Categoria<select value={f.cat} onChange={set("cat")} disabled={dis}><option value="carros">Carros</option><option value="motos">Motos</option><option value="nautico">Náutico</option><option value="utv">UTV / Quadriciclo</option></select></label>
      <label className="campo">Situação<select value={f.status} onChange={set("status")} disabled={dis}>
        {Object.entries(STATUS_NOME).map(([v, n]) => <option key={v} value={v} disabled={v === "sold"}>{n}</option>)}
      </select></label>
      {f.status === "unavailable" && <label className="campo">Motivo (só a equipe vê)<input value={f.motivo} onChange={set("motivo")} disabled={dis} maxLength={200} placeholder="Ex.: na oficina" /></label>}
      <label className="campo">Marca<input value={f.brand} onChange={set("brand")} disabled={dis} /></label>
      <label className="campo">Modelo<input value={f.model} onChange={set("model")} disabled={dis} /></label>
      <label className="campo">Versão<input value={f.versao} onChange={set("versao")} disabled={dis} /></label>
      <label className="campo">Ano<input value={f.year} onChange={set("year")} disabled={dis} /></label>
      <label className="campo">KM<input value={f.mileage} onChange={set("mileage")} disabled={dis} inputMode="numeric" /></label>
      <label className="campo">Cor<input value={f.color} onChange={set("color")} disabled={dis} /></label>
      <label className="campo">Placa<input value={f.plate} onChange={set("plate")} disabled={dis} /></label>
      <label className="campo">Combustível<input value={f.combustivel} onChange={set("combustivel")} disabled={dis} /></label>
      <label className="campo">Câmbio<input value={f.cambio} onChange={set("cambio")} disabled={dis} /></label>
      <label className="campo">Etiqueta no site<input value={f.badge} onChange={set("badge")} disabled={dis} /></label>
      <label className="campo">Preço no site (R$)<input value={f.sale_price} onChange={set("sale_price")} disabled={dis} inputMode="numeric" /></label>
      <label className="campo">Preço “de” (R$)<input value={f.old_price} onChange={set("old_price")} disabled={dis} inputMode="numeric" placeholder="Vazio se não houver" /></label>
      <label className="campo">Posição na vitrine<input value={f.ordem} onChange={set("ordem")} disabled={dis} inputMode="numeric" /></label>
      <label className="campo">Vídeo (link)<input value={f.video} onChange={set("video")} disabled={dis} /></label>
      <label className="campo" style={{ gridColumn: "1 / -1" }}>Descrição exibida no site<textarea rows={4} value={f.description} onChange={set("description")} disabled={dis} /></label>
      <label className="campo">IPVA<input value={f.ipva} onChange={set("ipva")} disabled={dis} /></label>
      <label className="campo">Revisões<input value={f.revisoes} onChange={set("revisoes")} disabled={dis} /></label>
      <label className="campo">Laudo<input value={f.laudo} onChange={set("laudo")} disabled={dis} /></label>
      <label className="campo">Pneus<input value={f.pneus} onChange={set("pneus")} disabled={dis} /></label>
      <label className="campo">Captação<input value={f.captacao} onChange={set("captacao")} disabled={dis} /></label>
      <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}><input type="checkbox" checked={f.chave_manual} onChange={set("chave_manual")} disabled={dis} /> Chave reserva e manual</label>
      <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}><input type="checkbox" checked={f.oferta} onChange={set("oferta")} disabled={dis} /> Marcar como oferta (vitrine “Ofertas”)</label>
      {podeEditar && (
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btns" onClick={() => setF(inicial)} disabled={salvando}>Desfazer</button>
          <button type="submit" className="btnp" disabled={salvando}>{salvando ? "Salvando…" : "Salvar e atualizar o site"}</button>
        </div>
      )}
    </form>
  );
}

function Fotos({ carro, podeEditar, salvando, salvar }: { carro: CarroUI; podeEditar: boolean; salvando: boolean; salvar: (m: Mapa) => void }) {
  const fotos = carro.images ?? [];
  const [enviando, setEnviando] = useState<string | null>(null);
  const mover = (i: number) => salvar({ images: [fotos[i], ...fotos.filter((_, j) => j !== i)] });
  async function adicionar(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!arquivos.length) return;
    const novas: { url: string; ts: number }[] = [];
    try {
      for (const [i, arq] of arquivos.entries()) {
        setEnviando(`Enviando foto ${i + 1} de ${arquivos.length}…`);
        const url = await enviarParaCloudinary(arq, `media/veh_${carro.id}_${Date.now().toString(36)}${i}`);
        novas.push({ url, ts: Date.now() });
      }
    } catch (err) {
      setEnviando(`Uma foto não subiu (${(err as Error).message}). As que subiram serão salvas.`);
    }
    if (novas.length) {
      setEnviando(null);
      salvar({ images: [...fotos, ...novas] });
    }
  }
  const remover = (i: number) => {
    if (confirm("Tirar esta foto do anúncio? Ela some do site.")) salvar({ images: fotos.filter((_, j) => j !== i) });
  };
  return (
    <section className="card" style={{ padding: 20 }} aria-label="Fotos do carro">
      {fotos.length === 0 ? (
        <p className="rot" style={{ fontSize: 14, margin: 0 }}>Este carro ainda não tem fotos.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
          {fotos.map((f, i) => (
            <li key={f.url + i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Foto url={f.url} alt={`Foto ${i + 1}`} style={{ height: 140, borderRadius: 10, outline: i === 0 ? "3px solid var(--p-azul)" : undefined }} />
              {i === 0 ? <span className="rot">Capa</span> : podeEditar ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" className="btns" disabled={salvando} onClick={() => mover(i)}>Usar como capa</button>
                  <button type="button" className="btns" disabled={salvando} onClick={() => remover(i)} aria-label={`Remover foto ${i + 1}`}>Remover</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {podeEditar && (
        <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label className="btnp" style={{ cursor: salvando || enviando ? "default" : "pointer" }}>
            Adicionar fotos
            <input type="file" accept="image/*" multiple onChange={adicionar} disabled={salvando || !!enviando} className="sr-only" />
          </label>
          <span className="rot" style={{ fontSize: 13 }} role="status">{enviando ?? "Fotos em 1200×900 (4:3) ficam melhor no site. A primeira é a capa."}</span>
        </div>
      )}
    </section>
  );
}

function Anuncios({ anuncios }: { anuncios: AnunciosDoCarro | null }) {
  if (!anuncios?.campanhas.length) {
    return <section className="card" style={{ padding: 20 }}><p style={{ margin: 0 }}>Nenhuma campanha ligada. Em <Link href="/trafego/campanhas">Tráfego → Campanhas</Link> você escolhe o carro de cada campanha.</p></section>;
  }
  return (
    <section className="card" style={{ overflowX: "auto" }}>
      <table className="tab">
        <thead><tr><th scope="col">Campanha</th><th scope="col">Situação</th><th scope="col" style={{ textAlign: "right" }}>Gasto (30 dias)</th><th scope="col" style={{ textAlign: "right" }}>Conversas</th><th scope="col" style={{ textAlign: "right" }}>Custo por conversa</th></tr></thead>
        <tbody>
          {anuncios.campanhas.map((c) => (
            <tr key={c.id}>
              <td><b>{c.nome}</b></td><td>{c.status ?? "—"}</td>
              <td className="dado" style={{ textAlign: "right" }}>{brl(c.gasto, 2)}</td>
              <td className="dado" style={{ textAlign: "right" }}>{c.msgs}</td>
              <td className="dado" style={{ textAlign: "right" }}>{c.msgs ? brl(c.gasto / c.msgs, 2) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Financeiro({ carro, anuncios, salvando, salvar }: { carro: CarroUI; anuncios: AnunciosDoCarro | null; salvando: boolean; salvar: (m: Mapa) => void }) {
  const fin = (carro.finance ?? {}) as Mapa;
  const venda = (carro.sale ?? {}) as Mapa;
  const custos = Array.isArray(fin.costs) ? (fin.costs as { description?: string; value?: number }[]) : [];
  const somaCustos = custos.reduce((s, c) => s + (Number(c.value) || 0), 0);
  const inicial = {
    purchase_price: txt(fin.purchase_price || ""), purchase_date: txt(fin.purchase_date), fipe_value: txt(fin.fipe_value || ""), fipe_date: txt(fin.fipe_date),
    repasse_value: txt(fin.repasse_value || ""), buyer_name: txt(fin.buyer_name), notes: txt(fin.notes),
    final_price: txt(venda.final_price || ""), date: txt(venda.date), payment: txt(venda.payment), discount: txt(venda.discount || ""),
  };
  const [f, setF] = useState(inicial);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const compra = Number(fin.purchase_price) || 0;
  const precoVenda = Number(venda.final_price) || Number(fin.sale_price) || 0;
  const gastoAnuncio = anuncios?.gasto ?? 0;
  const margem = compra && precoVenda ? precoVenda - compra - somaCustos - gastoAnuncio : 0;

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const mf: Mapa = {};
    for (const k of ["purchase_price", "fipe_value", "repasse_value"] as const) if (f[k] !== inicial[k]) mf[k] = num(f[k]);
    for (const k of ["purchase_date", "fipe_date", "buyer_name", "notes"] as const) if (f[k] !== inicial[k]) mf[k] = f[k];
    const ms: Mapa = { ...venda };
    let mudouVenda = false;
    for (const k of ["final_price", "discount"] as const) if (f[k] !== inicial[k]) { ms[k] = num(f[k]); mudouVenda = true; }
    for (const k of ["date", "payment"] as const) if (f[k] !== inicial[k]) { ms[k] = f[k]; mudouVenda = true; }
    const m: Mapa = {};
    if (Object.keys(mf).length) m.finance = mf;
    if (mudouVenda) m.sale = ms;
    salvar(m);
  }

  return (
    <form onSubmit={enviar} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section className="card" style={{ padding: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 1, background: "var(--p-linha-2)", border: "1px solid var(--p-linha-2)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ background: "var(--p-papel)", padding: 14 }}><div className="rot">Compra</div><div className="dado" style={{ fontSize: 20 }}>{brl(compra)}</div></div>
          <div style={{ background: "var(--p-papel)", padding: 14 }}><div className="rot">Custos ({custos.length})</div><div className="dado" style={{ fontSize: 20 }}>{brl(somaCustos)}</div></div>
          <div style={{ background: "var(--p-papel)", padding: 14 }}><div className="rot">Anúncio (30 dias)</div><div className="dado" style={{ fontSize: 20 }}>{brl(gastoAnuncio, 2)}</div></div>
          <div style={{ background: "var(--p-papel)", padding: 14 }}><div className="rot">FIPE</div><div className="dado" style={{ fontSize: 20 }}>{brl(fin.fipe_value)}</div></div>
          <div style={{ background: "var(--p-papel)", padding: 14 }}><div className="rot">{venda.final_price ? "Vendido por" : "Preço"}</div><div className="dado" style={{ fontSize: 20 }}>{brl(precoVenda)}</div></div>
          <div style={{ background: "var(--p-ink)", color: "var(--p-papel)", padding: 14 }}><div style={{ fontSize: 12, color: "#b9bdb5" }}>Margem após tráfego</div><div className="dado" style={{ fontSize: 20, color: "var(--p-ouro)" }}>{margem ? brl(margem) : "—"}</div></div>
        </div>
        <p className="rot" style={{ margin: "10px 0 0" }}>Margem = preço (ou valor final da venda) − compra − custos − gasto em anúncio dos últimos 30 dias.</p>
      </section>
      <section className="card" style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
        <label className="campo">Valor de compra (R$)<input value={f.purchase_price} onChange={set("purchase_price")} inputMode="numeric" /></label>
        <label className="campo">Data de compra<input type="date" value={f.purchase_date} onChange={set("purchase_date")} /></label>
        <label className="campo">FIPE (R$)<input value={f.fipe_value} onChange={set("fipe_value")} inputMode="numeric" /></label>
        <label className="campo">Data da consulta FIPE<input type="date" value={f.fipe_date} onChange={set("fipe_date")} /></label>
        <label className="campo">Valor combinado com o consignante (R$)<input value={f.repasse_value} onChange={set("repasse_value")} inputMode="numeric" /></label>
        <label className="campo">Comprador<input value={f.buyer_name} onChange={set("buyer_name")} /></label>
        <label className="campo">Valor final vendido (R$)<input value={f.final_price} onChange={set("final_price")} inputMode="numeric" /></label>
        <label className="campo">Data da venda<input type="date" value={f.date} onChange={set("date")} /></label>
        <label className="campo">Forma de pagamento<input value={f.payment} onChange={set("payment")} /></label>
        <label className="campo">Desconto concedido (R$)<input value={f.discount} onChange={set("discount")} inputMode="numeric" /></label>
        <label className="campo" style={{ gridColumn: "1 / -1" }}>Observações da negociação<textarea rows={3} value={f.notes} onChange={set("notes")} /></label>
        {custos.length > 0 && (
          <div style={{ gridColumn: "1 / -1" }}>
            <div className="rot" style={{ marginBottom: 6 }}>Custos lançados</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>{custos.map((c, i) => <li key={i}>{c.description || "Custo"}: <span className="dado">{brl(c.value)}</span></li>)}</ul>
          </div>
        )}
        <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btns" onClick={() => setF(inicial)} disabled={salvando}>Desfazer</button>
          <button type="submit" className="btnp" disabled={salvando}>{salvando ? "Salvando…" : "Salvar financeiro"}</button>
        </div>
      </section>
    </form>
  );
}

function Dono({ carro, salvando, salvar }: { carro: CarroUI; salvando: boolean; salvar: (m: Mapa) => void }) {
  const s = (carro.seller ?? {}) as Mapa;
  const inicial = {
    ownership_type: txt(carro.ownership_type || "proprio"), name: txt(s.name), document: txt(s.document), phone: txt(s.phone),
    email: txt(s.email), address: txt(s.address), bank_info: txt(s.bank_info),
  };
  const [f, setF] = useState(inicial);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const m: Mapa = {};
    if (f.ownership_type !== inicial.ownership_type) m.ownership_type = f.ownership_type;
    const campos = ["name", "document", "phone", "email", "address", "bank_info"] as const;
    if (campos.some((k) => f[k] !== inicial[k])) {
      const novo: Mapa = { ...s };
      for (const k of campos) novo[k] = f[k];
      m.seller = novo;
    }
    salvar(m);
  }
  return (
    <form onSubmit={enviar} className="card" style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
      <label className="campo">Tipo de posse<select value={f.ownership_type} onChange={set("ownership_type")}><option value="proprio">Veículo próprio</option><option value="consignado">Consignado</option></select></label>
      <label className="campo">Nome completo<input value={f.name} onChange={set("name")} /></label>
      <label className="campo">CPF ou CNPJ<input value={f.document} onChange={set("document")} /></label>
      <label className="campo">Telefone ou WhatsApp<input value={f.phone} onChange={set("phone")} inputMode="tel" /></label>
      <label className="campo">E-mail<input value={f.email} onChange={set("email")} type="email" /></label>
      <label className="campo">Endereço completo<input value={f.address} onChange={set("address")} /></label>
      <label className="campo" style={{ gridColumn: "1 / -1" }}>Dados bancários (para pagamento)<textarea rows={2} value={f.bank_info} onChange={set("bank_info")} /></label>
      <p className="rot" style={{ gridColumn: "1 / -1", margin: 0 }}>Só sócios veem e alteram estes dados. Cada alteração fica no histórico.</p>
      <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}><button type="submit" className="btnp" disabled={salvando}>{salvando ? "Salvando…" : "Salvar dados do dono"}</button></div>
    </form>
  );
}

function Documentos({ carro }: { carro: CarroUI }) {
  const docs = (carro.documents ?? []) as { id?: string; name?: string; type?: string; url?: string; file_url?: string }[];
  return (
    <section className="card" style={{ padding: "8px 16px" }}>
      {docs.length === 0 ? (
        <p className="rot" style={{ fontSize: 14 }}>Nenhum documento neste carro.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {docs.map((d, i) => {
            const link = d.url || d.file_url;
            return (
              <li key={d.id ?? i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "12px 0", borderBottom: i < docs.length - 1 ? "1px solid var(--p-linha-2)" : 0 }}>
                <span><b>{d.name || "Documento"}</b> {d.type && <span className="rot">· {d.type}</span>}</span>
                {link ? <a href={link} target="_blank" rel="noreferrer">Abrir</a> : <span className="rot">sem arquivo</span>}
              </li>
            );
          })}
        </ul>
      )}
      <p className="rot" style={{ margin: "8px 0 12px" }}>Enviar documento novo ainda é pelo admin do site; entra aqui na próxima etapa.</p>
    </section>
  );
}

function HistoricoTab({ itens }: { itens: Historico[] }) {
  if (!itens.length) return <section className="card" style={{ padding: 20 }}><p style={{ margin: 0 }}>Nenhuma alteração feita pelo sistema ainda. As feitas no admin antigo não aparecem aqui.</p></section>;
  return (
    <section className="card" style={{ overflowX: "auto" }}>
      <table className="tab">
        <thead><tr><th scope="col">Quando</th><th scope="col">Quem</th><th scope="col">O que mudou</th></tr></thead>
        <tbody>
          {itens.map((h, i) => (
            <tr key={i}>
              <td className="dado" style={{ whiteSpace: "nowrap" }}>{new Date(h.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
              <td>{h.quem ?? "—"}</td>
              <td>{h.acao === "editou" ? h.campos.join(", ") : h.acao}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const SIT: Record<string, string> = { agendada: "Agendada", realizada: "Veio", faltou: "Não veio", cancelada: "Cancelada" };

function ClientesDoCarro({ clientes, visitas }: { clientes: Cliente[]; visitas: VisitaCarro[] }) {
  if (!clientes.length) {
    return (
      <section className="card" style={{ padding: 20 }}>
        <p style={{ margin: 0 }}>Nenhum cliente ligado a este carro ainda. Na Caixa de entrada, abra a conversa e escolha o carro em “Carro de interesse”.</p>
      </section>
    );
  }
  return (
    <section className="card" style={{ overflowX: "auto" }}>
      <table className="tab">
        <thead><tr><th scope="col">Cliente</th><th scope="col">Telefone</th><th scope="col">De onde veio</th><th scope="col">Visita</th><th scope="col">Desde</th></tr></thead>
        <tbody>
          {clientes.map((c) => {
            const v = visitas.find((x) => x.contact_id === c.id);
            return (
              <tr key={c.id}>
                <td><Link href={`/inbox?contact=${c.id}`}><b>{c.name || "Sem nome"}</b></Link></td>
                <td className="dado" style={{ fontWeight: 500 }}>{c.phone}</td>
                <td>{c.origem ?? "—"}</td>
                <td>{v ? `${SIT[v.status] ?? v.status} · ${new Date(v.quando).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : "—"}</td>
                <td className="dado" style={{ fontWeight: 500 }}>{new Date(c.created_at).toLocaleDateString("pt-BR")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
