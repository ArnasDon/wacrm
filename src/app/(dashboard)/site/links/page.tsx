"use client";

import { enviarParaCloudinary } from "@/lib/patio/cloudinary";
import { Cabecalho, useDocSite } from "../comum";

type Consultor = { nome?: string; cargo?: string; wa?: string; foto?: string; ativo?: boolean };
type Bloco = { mostrar?: boolean; titulo?: string; sub?: string; msg?: string; link?: string; wa?: string };
type Dia = { aberto?: boolean; abre?: string; fecha?: string };
type Pagina = {
  lojaWa?: string; faixa?: { icone?: string; texto?: string }[]; consultor?: Bloco; consultores?: Consultor[]; estoque?: Bloco; venda?: Bloco; entregas?: Bloco;
  loja?: { mostrar?: boolean; endereco?: string; linha1?: string; linha2?: string; dias?: Dia[]; agendar?: Bloco };
  redes?: { instagram?: string; youtube?: string; tiktok?: string; facebook?: string };
  [k: string]: unknown;
};
const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export default function PaginaLinks() {
  const { dados, setDados, erro, aviso, salvando, salvar } = useDocSite<{ pagina: Pagina; cliques: { alvo: string; cliques: number }[] }>("/api/site/links");
  if (erro) return <div className="card" style={{ padding: 20 }}>{erro}</div>;
  if (!dados) return <div className="card" style={{ padding: 20 }} aria-busy="true">Abrindo a página de links…</div>;
  const p = dados.pagina;
  const set = (novo: Partial<Pagina>) => setDados({ ...dados, pagina: { ...p, ...novo } });
  const bloco = (k: "consultor" | "estoque" | "venda" | "entregas", campos: [keyof Bloco, string][]) => {
    const b = (p[k] ?? {}) as Bloco;
    return (
      <section className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 600 }}><input type="checkbox" checked={b.mostrar !== false} onChange={(e) => set({ [k]: { ...b, mostrar: e.target.checked } })} /> {({ consultor: "Fale com um consultor", estoque: "Ver estoque", venda: "Venda seu carro", entregas: "Entregas recentes" })[k]}</label>
        {campos.map(([c, nome]) => (
          <label key={c} className="campo">{nome}{c === "msg" ? <textarea rows={2} value={String(b[c] ?? "")} onChange={(e) => set({ [k]: { ...b, [c]: e.target.value } })} /> : <input value={String(b[c] ?? "")} onChange={(e) => set({ [k]: { ...b, [c]: e.target.value } })} />}</label>
        ))}
      </section>
    );
  };
  const consultores = p.consultores ?? [];
  const setCons = (lista: Consultor[]) => set({ consultores: lista });
  const loja = p.loja ?? {};
  const dias = Array.from({ length: 7 }, (_, i) => loja.dias?.[i] ?? { aberto: i > 0, abre: "08:00", fecha: "18:00" });
  const faixa = Array.from({ length: 4 }, (_, i) => p.faixa?.[i] ?? { icone: "", texto: "" });
  const redes = p.redes ?? {};

  return (
    <form onSubmit={(e) => { e.preventDefault(); salvar({ pagina: { ...p, faixa, consultores, loja: { ...loja, dias } } }, "Página de links salva. Já vale no site."); }} style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1240 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <Cabecalho titulo="Página de links" sub="iboxprime.com.br/links — o link da bio do Instagram." />
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btns" href="https://iboxprime.com.br/links" target="_blank" rel="noreferrer">Ver página</a>
          <button type="submit" className="btnp" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
        </div>
      </div>
      {aviso && <p role="status" style={{ margin: 0, color: "var(--p-azul-2)" }}>{aviso}</p>}

      <section className="card" style={{ padding: 18 }} aria-labelledby="cl-t">
        <h2 id="cl-t" className="h2">Cliques nos últimos 30 dias</h2>
        {dados.cliques.length === 0 ? <p className="rot" style={{ fontSize: 14 }}>Nenhum clique registrado no período.</p> : (
          <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "6px 20px" }}>
            {dados.cliques.slice(0, 12).map((c) => <li key={c.alvo} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--p-linha-2)", padding: "6px 0" }}><span>{c.alvo}</span><span className="dado">{c.cliques}</span></li>)}
          </ul>
        )}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18 }}>
        {bloco("consultor", [["titulo", "Título"], ["sub", "Subtítulo"], ["msg", "Mensagem pronta ({nome} vira o nome do consultor)"]])}
        {bloco("estoque", [["titulo", "Título"], ["link", "Link"]])}
        {bloco("venda", [["titulo", "Título"], ["sub", "Subtítulo"], ["msg", "Mensagem pronta"], ["wa", "WhatsApp (vazio = o da loja)"]])}
        {bloco("entregas", [["titulo", "Título"]])}
      </div>

      <section className="card" style={{ padding: 18 }} aria-labelledby="cons-t">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 id="cons-t" className="h2">Consultores</h2>
          <button type="button" className="btns" onClick={() => setCons([...consultores, { nome: "", cargo: "", wa: "", foto: "", ativo: true }])}>Adicionar consultor</button>
        </div>
        <p className="rot" style={{ margin: "6px 0 12px" }}>Sem consultores, o botão leva direto ao WhatsApp da loja.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
          {consultores.map((c, i) => (
            <div key={i} style={{ border: "1px solid var(--p-linha)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {c.foto ? (
                  // eslint-disable-next-line @next/next/no-img-element -- foto do consultor no Cloudinary
                  <img src={c.foto} alt="" style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover" }} />
                ) : <span style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--foto)" }} />}
                <label className="btns" style={{ cursor: "pointer" }}>Foto<input type="file" accept="image/*" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const url = await enviarParaCloudinary(f, `media/consultor_${i}`); setCons(consultores.map((x, k) => (k === i ? { ...x, foto: url } : x))); } }} /></label>
              </div>
              <label className="campo">Nome<input value={c.nome ?? ""} onChange={(e) => setCons(consultores.map((x, k) => (k === i ? { ...x, nome: e.target.value } : x)))} /></label>
              <label className="campo">Cargo<input value={c.cargo ?? ""} onChange={(e) => setCons(consultores.map((x, k) => (k === i ? { ...x, cargo: e.target.value } : x)))} /></label>
              <label className="campo">WhatsApp<input value={c.wa ?? ""} inputMode="tel" onChange={(e) => setCons(consultores.map((x, k) => (k === i ? { ...x, wa: e.target.value } : x)))} /></label>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ display: "flex", gap: 8, fontSize: 14 }}><input type="checkbox" checked={c.ativo !== false} onChange={(e) => setCons(consultores.map((x, k) => (k === i ? { ...x, ativo: e.target.checked } : x)))} /> Aparece</label>
                <button type="button" className="btns" onClick={() => setCons(consultores.filter((_, k) => k !== i))}>Remover</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 18 }}>
        <section className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 8 }} aria-labelledby="loja-t">
          <h2 id="loja-t" className="h2">Loja e horários</h2>
          <label className="campo">Endereço (para o mapa)<input value={loja.endereco ?? ""} onChange={(e) => set({ loja: { ...loja, endereco: e.target.value } })} /></label>
          <label className="campo">Linha 1<input value={loja.linha1 ?? ""} onChange={(e) => set({ loja: { ...loja, linha1: e.target.value } })} /></label>
          <label className="campo">Linha 2<input value={loja.linha2 ?? ""} onChange={(e) => set({ loja: { ...loja, linha2: e.target.value } })} /></label>
          {dias.map((d, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "110px auto 1fr 1fr", gap: 8, alignItems: "center", fontSize: 14 }}>
              <span>{DIAS[i]}</span>
              <input type="checkbox" checked={!!d.aberto} aria-label={`${DIAS[i]} aberto`} onChange={(e) => set({ loja: { ...loja, dias: dias.map((x, k) => (k === i ? { ...x, aberto: e.target.checked } : x)) } })} />
              <input type="time" value={d.abre ?? ""} aria-label={`${DIAS[i]} abre`} disabled={!d.aberto} onChange={(e) => set({ loja: { ...loja, dias: dias.map((x, k) => (k === i ? { ...x, abre: e.target.value } : x)) } })} />
              <input type="time" value={d.fecha ?? ""} aria-label={`${DIAS[i]} fecha`} disabled={!d.aberto} onChange={(e) => set({ loja: { ...loja, dias: dias.map((x, k) => (k === i ? { ...x, fecha: e.target.value } : x)) } })} />
            </div>
          ))}
        </section>
        <section className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 8 }} aria-labelledby="faixa-t">
          <h2 id="faixa-t" className="h2">Faixa de benefícios e redes</h2>
          {faixa.map((f, i) => <label key={i} className="campo">Benefício {i + 1}<input value={f.texto ?? ""} onChange={(e) => set({ faixa: faixa.map((x, k) => (k === i ? { ...x, texto: e.target.value } : x)) })} /></label>)}
          <label className="campo">WhatsApp da loja<input value={p.lojaWa ?? ""} inputMode="tel" onChange={(e) => set({ lojaWa: e.target.value })} /></label>
          {(["instagram", "youtube", "tiktok", "facebook"] as const).map((r) => <label key={r} className="campo" style={{ textTransform: "capitalize" }}>{r}<input value={redes[r] ?? ""} onChange={(e) => set({ redes: { ...redes, [r]: e.target.value } })} /></label>)}
        </section>
      </div>
    </form>
  );
}
