"use client";

import { useState } from "react";
import { enviarParaCloudinary, novoId } from "@/lib/patio/cloudinary";
import { Foto } from "../../patio/comum";
import { Cabecalho, useDocSite } from "../comum";

type Slide = { active?: boolean; type?: string; url?: string; filename?: string; tag?: string; name?: string; title?: string; year?: string; km?: string; price?: string; w?: number; h?: number };
type Conteudo = {
  hero?: { slides?: Slide[] };
  about?: { title?: string; text1?: string; text2?: string; mainImg?: string; floatImg?: string; stats?: { value?: string; label?: string }[] };
  experience?: { bg?: string; title?: string; text?: string };
  categories?: { bg?: string; title?: string; count?: string }[];
  vendidosFotos?: { url: string }[];
  [k: string]: unknown;
};

const VAZIO: Slide = { active: false, type: "image", filename: "", url: "", tag: "", name: "", title: "", year: "", km: "", price: "" };

export default function ConteudoSite() {
  const { dados, setDados, erro, aviso, salvando, salvar } = useDocSite<{ conteudo: Conteudo }>("/api/site/conteudo");
  const [enviando, setEnviando] = useState<string | null>(null);
  if (erro) return <div className="card" style={{ padding: 20 }}>{erro}</div>;
  if (!dados) return <div className="card" style={{ padding: 20 }} aria-busy="true">Abrindo o conteúdo do site…</div>;

  const c = dados.conteudo;
  const slides: Slide[] = Array.from({ length: 4 }, (_, i) => ({ ...VAZIO, ...(c.hero?.slides?.[i] ?? {}) }));
  const about = c.about ?? {};
  const stats = Array.from({ length: 3 }, (_, i) => about.stats?.[i] ?? { value: "", label: "" });
  const exp = c.experience ?? {};
  const cats = Array.from({ length: 4 }, (_, i) => c.categories?.[i] ?? { bg: "", title: "", count: "" });
  const mudar = (novo: Partial<Conteudo>) => setDados({ conteudo: { ...c, ...novo } });
  const mudarSlide = (i: number, s: Partial<Slide>) => mudar({ hero: { slides: slides.map((x, k) => (k === i ? { ...x, ...s } : x)) } });

  async function enviarSlide(i: number, arq: File | undefined) {
    if (!arq) return;
    try {
      setEnviando(`Enviando o banner ${i + 1}…`);
      const url = await enviarParaCloudinary(arq, `media/hero_${i}`);
      mudarSlide(i, { url, filename: arq.name, type: arq.type.startsWith("video/") ? "video" : "image", active: true });
      setEnviando(null);
    } catch (e) {
      setEnviando(`O envio falhou (${(e as Error).message}).`);
    }
  }
  async function enviarImagem(arq: File | undefined, aplicar: (url: string) => void, nome: string) {
    if (!arq) return;
    try { setEnviando("Enviando imagem…"); aplicar(await enviarParaCloudinary(arq, `media/${nome}`)); setEnviando(null); }
    catch (e) { setEnviando(`O envio falhou (${(e as Error).message}).`); }
  }
  const ativos = slides.filter((s) => s.active && s.url).length;
  const fotosVendidos = (c.vendidosFotos ?? []).filter((f) => f && f.url);
  async function enviarVendidos(arqs: FileList | null) {
    if (!arqs?.length) return;
    const novas: { url: string }[] = [];
    try {
      for (let i = 0; i < arqs.length; i++) {
        setEnviando(`Enviando foto ${i + 1} de ${arqs.length}…`);
        novas.push({ url: await enviarParaCloudinary(arqs[i], `media/vendido_${novoId()}`) });
      }
      setEnviando(null);
    } catch (e) {
      setEnviando(`O envio falhou (${(e as Error).message}).`);
    }
    if (novas.length) mudar({ vendidosFotos: [...fotosVendidos, ...novas] });
  }
  const moverVendido = (i: number, d: number) => {
    const l = [...fotosVendidos]; const j = i + d;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    mudar({ vendidosFotos: l });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); salvar({ conteudo: { ...c, hero: { slides }, about: { ...about, stats }, experience: exp, categories: cats } }, "Conteúdo salvo."); }} style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1240 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <Cabecalho titulo="Conteúdo da página inicial" sub="Banners do topo, Sobre nós, iBox Experience e categorias da vitrine." />
        <button type="submit" className="btnp" disabled={salvando}>{salvando ? "Salvando…" : "Salvar e atualizar o site"}</button>
      </div>
      {(aviso || enviando) && <p role="status" style={{ margin: 0, color: "var(--p-azul-2)" }}>{enviando ?? aviso}</p>}

      <section className="card" style={{ padding: 20 }} aria-labelledby="hero-t">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <h2 id="hero-t" className="h2">Banners do topo</h2>
          {ativos === 0 ? <span className="selo s-ru">Vazio: o topo do site não mostra nada</span> : <span className="selo s-ok">{ativos} no ar</span>}
        </div>
        <p className="rot" style={{ margin: "6px 0 14px" }}>Até 4. Imagem em 1920×600 ou vídeo MP4 de até 30 MB.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          {slides.map((s, i) => (
            <div key={i} style={{ border: "1px solid var(--p-linha)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {s.url && s.type !== "video" ? <Foto url={s.url} alt={`Banner ${i + 1}`} style={{ height: 100, borderRadius: 8 }} /> : s.url ? <video src={s.url} muted style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 8 }} /> : <div className="foto" style={{ height: 100, borderRadius: 8 }}><span className="semfoto">Banner {i + 1} vazio</span></div>}
              <label className="btns" style={{ cursor: "pointer" }}>Escolher imagem ou vídeo<input type="file" accept="image/*,video/mp4" className="sr-only" onChange={(e) => enviarSlide(i, e.target.files?.[0])} /></label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}><input type="checkbox" checked={!!s.active} onChange={(e) => mudarSlide(i, { active: e.target.checked })} disabled={!s.url} /> Mostrar no site</label>
              <label className="campo">Etiqueta<input value={s.tag ?? ""} onChange={(e) => mudarSlide(i, { tag: e.target.value })} /></label>
              <label className="campo">Nome<input value={s.name ?? ""} onChange={(e) => mudarSlide(i, { name: e.target.value })} /></label>
              <label className="campo">Título<input value={s.title ?? ""} onChange={(e) => mudarSlide(i, { title: e.target.value })} /></label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                <label className="campo">Ano<input value={s.year ?? ""} onChange={(e) => mudarSlide(i, { year: e.target.value })} /></label>
                <label className="campo">KM<input value={s.km ?? ""} onChange={(e) => mudarSlide(i, { km: e.target.value })} /></label>
                <label className="campo">Preço<input value={s.price ?? ""} onChange={(e) => mudarSlide(i, { price: e.target.value })} /></label>
              </div>
              {s.url && <button type="button" className="btns" onClick={() => mudarSlide(i, { ...VAZIO })}>Limpar banner</button>}
            </div>
          ))}
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 18 }}>
        <section className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }} aria-labelledby="sobre-t">
          <h2 id="sobre-t" className="h2">Sobre nós</h2>
          <label className="campo">Título<input value={about.title ?? ""} onChange={(e) => mudar({ about: { ...about, title: e.target.value } })} /></label>
          <label className="campo">Parágrafo 1<textarea rows={3} value={about.text1 ?? ""} onChange={(e) => mudar({ about: { ...about, text1: e.target.value } })} /></label>
          <label className="campo">Parágrafo 2<textarea rows={3} value={about.text2 ?? ""} onChange={(e) => mudar({ about: { ...about, text2: e.target.value } })} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {stats.map((st, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label className="campo">Número {i + 1}<input value={st.value ?? ""} onChange={(e) => mudar({ about: { ...about, stats: stats.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) } })} /></label>
                <label className="campo">Legenda<input value={st.label ?? ""} onChange={(e) => mudar({ about: { ...about, stats: stats.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) } })} /></label>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label className="btns" style={{ cursor: "pointer" }}>Imagem principal<input type="file" accept="image/*" className="sr-only" onChange={(e) => enviarImagem(e.target.files?.[0], (url) => mudar({ about: { ...about, mainImg: url } }), "sobre_principal")} /></label>
            <label className="btns" style={{ cursor: "pointer" }}>Imagem flutuante<input type="file" accept="image/*" className="sr-only" onChange={(e) => enviarImagem(e.target.files?.[0], (url) => mudar({ about: { ...about, floatImg: url } }), "sobre_flutuante")} /></label>
          </div>
        </section>
        <section className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }} aria-labelledby="exp-t">
          <h2 id="exp-t" className="h2">iBox Experience</h2>
          <label className="campo">Título<input value={exp.title ?? ""} onChange={(e) => mudar({ experience: { ...exp, title: e.target.value } })} /></label>
          <label className="campo">Texto<textarea rows={4} value={exp.text ?? ""} onChange={(e) => mudar({ experience: { ...exp, text: e.target.value } })} /></label>
          <label className="btns" style={{ cursor: "pointer", alignSelf: "flex-start" }}>Imagem ou vídeo de fundo<input type="file" accept="image/*,video/mp4" className="sr-only" onChange={(e) => enviarImagem(e.target.files?.[0], (url) => mudar({ experience: { ...exp, bg: url } }), "experience")} /></label>
          {exp.bg && <span className="rot">Fundo atual definido.</span>}
        </section>
      </div>

      <section className="card" style={{ padding: 20 }} aria-labelledby="cat-t">
        <h2 id="cat-t" className="h2">Categorias da vitrine</h2>
        <p className="rot" style={{ margin: "6px 0 14px" }}>Categoria sem carro à venda some sozinha do site.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          {cats.map((ct, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Foto url={ct.bg} alt="" style={{ height: 90, borderRadius: 8 }} />
              <label className="btns" style={{ cursor: "pointer" }}>Trocar foto<input type="file" accept="image/*" className="sr-only" onChange={(e) => enviarImagem(e.target.files?.[0], (url) => mudar({ categories: cats.map((x, k) => (k === i ? { ...x, bg: url } : x)) }), `categoria_${i}`)} /></label>
              <label className="campo">Título<input value={ct.title ?? ""} onChange={(e) => mudar({ categories: cats.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })} /></label>
              <label className="campo">Subtexto<input value={ct.count ?? ""} onChange={(e) => mudar({ categories: cats.map((x, k) => (k === i ? { ...x, count: e.target.value } : x)) })} /></label>
            </div>
          ))}
        </div>
      </section>
      <section className="card" style={{ padding: 20 }} aria-labelledby="vf-t">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 id="vf-t" className="h2">Fotos de carros vendidos <span className="rot">· {fotosVendidos.length}</span></h2>
          <label className="btns" style={{ cursor: "pointer" }}>Adicionar fotos<input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { enviarVendidos(e.target.files); e.target.value = ""; }} /></label>
        </div>
        <p className="rot" style={{ margin: "6px 0 14px" }}>Passam em carrossel na página inicial, nesta ordem. Salve no fim para valer no site.</p>
        {fotosVendidos.length === 0 ? <p style={{ fontSize: 14, margin: 0 }}>Nenhuma foto ainda.</p> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
            {fotosVendidos.map((f, i) => (
              <div key={f.url} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <Foto url={f.url} alt={`Vendido ${i + 1}`} style={{ height: 100, borderRadius: 8 }} />
                <div style={{ display: "flex", gap: 4 }}>
                  <button type="button" className="btns" style={{ padding: "4px 8px" }} disabled={i === 0} onClick={() => moverVendido(i, -1)} aria-label="Mover para antes">←</button>
                  <button type="button" className="btns" style={{ padding: "4px 8px" }} disabled={i === fotosVendidos.length - 1} onClick={() => moverVendido(i, 1)} aria-label="Mover para depois">→</button>
                  <button type="button" className="btns" style={{ padding: "4px 8px", marginLeft: "auto" }} onClick={() => mudar({ vendidosFotos: fotosVendidos.filter((_, k) => k !== i) })}>Remover</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </form>
  );
}
