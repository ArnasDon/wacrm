"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { lerCard } from "@/lib/patio/entrada-card";
import { brl } from "../comum";

type Form = {
  cat: string; brand: string; model: string; versao: string; year: string; mileage: string; color: string; plate: string;
  combustivel: string; cambio: string; ipva: string; revisoes: string; chave_manual: boolean; laudo: string; pneus: string; captacao: string;
  sale_price: string; purchase_price: string; fipe_value: string; obs: string; description: string;
};

const VAZIO: Form = {
  cat: "carros", brand: "", model: "", versao: "", year: "", mileage: "", color: "", plate: "", combustivel: "", cambio: "",
  ipva: "", revisoes: "", chave_manual: false, laudo: "", pneus: "", captacao: "", sale_price: "", purchase_price: "", fipe_value: "", obs: "", description: "",
};

const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(/\./g, "").replace(",", ".")) || 0);

export default function NovoCarroPage() {
  const router = useRouter();
  const [card, setCard] = useState("");
  const [lido, setLido] = useState<string | null>(null);
  const [f, setF] = useState<Form>(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; id?: string } | null>(null);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value });

  function preencher() {
    const { veiculo, interno, faltando } = lerCard(card);
    const t = (v: unknown) => (v == null ? "" : String(v));
    setF({
      cat: t(veiculo.cat) || "carros", brand: t(veiculo.brand), model: t(veiculo.model), versao: t(veiculo.versao), year: t(veiculo.year),
      mileage: t(veiculo.mileage), color: t(veiculo.color), plate: t(veiculo.plate), combustivel: t(veiculo.combustivel), cambio: t(veiculo.cambio),
      ipva: t(veiculo.ipva), revisoes: t(veiculo.revisoes), chave_manual: !!veiculo.chave_manual, laudo: t(interno.laudo), pneus: t(interno.pneus),
      captacao: t(interno.captacao), sale_price: veiculo.sale_price ? t(veiculo.sale_price) : "", purchase_price: interno.purchase_price ? t(interno.purchase_price) : "",
      fipe_value: interno.fipe_value ? t(interno.fipe_value) : "", obs: t(interno.obs), description: t(veiculo.description),
    });
    setLido(faltando.length ? `Card lido. Falta: ${faltando.join(", ")}.` : "Card lido. Confira os campos e cadastre.");
  }

  async function cadastrar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setAviso(null);
    try {
      const dados = { ...f, sale_price: num(f.sale_price), purchase_price: num(f.purchase_price), fipe_value: num(f.fipe_value) };
      const r = await fetch("/api/patio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dados, card: lido ? card : undefined }) });
      const d = await r.json();
      if (!r.ok) {
        setAviso({ texto: d.erro || "Não foi possível cadastrar.", id: d.id });
        return;
      }
      router.push(`/patio/${d.id}`);
    } catch {
      setAviso({ texto: "Sem conexão. Tente de novo." });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1100 }}>
      <nav aria-label="Caminho" className="rot" style={{ fontSize: 13 }}><Link href="/patio">Pátio</Link> / Cadastrar carro</nav>
      <h1 className="disp" style={{ margin: 0, fontSize: 40, lineHeight: 1.02 }}>Cadastrar carro</h1>

      <section className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }} aria-labelledby="card-t">
        <h2 id="card-t" className="h2">Colar card do grupo de entradas</h2>
        <p className="rot" style={{ margin: 0, fontSize: 13 }}>Copie o card do grupo IBOX PRIME | ENTRADA VEÍCULOS, cole aqui e clique em Preencher. Custo, FIPE e laudo ficam só para a equipe.</p>
        <label className="campo"><span className="sr-only">Card do WhatsApp</span>
          <textarea rows={6} value={card} onChange={(e) => setCard(e.target.value)} placeholder={"*MARCA:* TOYOTA\n*MODELO:* HILUX\n*PLACA* : RCO-1A97\n…"} />
        </label>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btns" onClick={preencher} disabled={!card.trim()}>Preencher</button>
          {lido && <span role="status" style={{ fontSize: 14, color: "var(--p-azul-2)" }}>{lido}</span>}
        </div>
      </section>

      <form onSubmit={cadastrar} className="card" style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14 }}>
        <label className="campo">Categoria<select value={f.cat} onChange={set("cat")}><option value="carros">Carros</option><option value="motos">Motos</option><option value="nautico">Náutico</option><option value="utv">UTV / Quadriciclo</option></select></label>
        <label className="campo">Marca *<input value={f.brand} onChange={set("brand")} required /></label>
        <label className="campo">Modelo *<input value={f.model} onChange={set("model")} required /></label>
        <label className="campo">Versão<input value={f.versao} onChange={set("versao")} /></label>
        <label className="campo">Ano<input value={f.year} onChange={set("year")} placeholder="2021/2022" /></label>
        <label className="campo">KM<input value={f.mileage} onChange={set("mileage")} /></label>
        <label className="campo">Cor<input value={f.color} onChange={set("color")} /></label>
        <label className="campo">Placa<input value={f.plate} onChange={set("plate")} /></label>
        <label className="campo">Combustível<input value={f.combustivel} onChange={set("combustivel")} /></label>
        <label className="campo">Câmbio<input value={f.cambio} onChange={set("cambio")} /></label>
        <label className="campo">IPVA<input value={f.ipva} onChange={set("ipva")} /></label>
        <label className="campo">Revisões<input value={f.revisoes} onChange={set("revisoes")} /></label>
        <label className="campo">Laudo<input value={f.laudo} onChange={set("laudo")} /></label>
        <label className="campo">Pneus<input value={f.pneus} onChange={set("pneus")} /></label>
        <label className="campo">Captação<input value={f.captacao} onChange={set("captacao")} /></label>
        <label className="campo">Preço de venda (R$)<input value={f.sale_price} onChange={set("sale_price")} inputMode="numeric" /></label>
        <label className="campo">Custo de compra (R$)<input value={f.purchase_price} onChange={set("purchase_price")} inputMode="numeric" /></label>
        <label className="campo">FIPE (R$)<input value={f.fipe_value} onChange={set("fipe_value")} inputMode="numeric" /></label>
        <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}><input type="checkbox" checked={f.chave_manual} onChange={set("chave_manual")} /> Chave reserva e manual</label>
        <label className="campo" style={{ gridColumn: "1 / -1" }}>Observação interna<input value={f.obs} onChange={set("obs")} /></label>
        <label className="campo" style={{ gridColumn: "1 / -1" }}>Descrição para o site<textarea rows={6} value={f.description} onChange={set("description")} /></label>
        <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span className="rot" style={{ fontSize: 13 }}>
            Entra como <b>Aguardando revisão</b>: só vai para o site quando alguém aprovar na ficha.
            {num(f.sale_price) > 0 && <> Preço: <span className="dado">{brl(num(f.sale_price))}</span>.</>}
          </span>
          <button type="submit" className="btnp" disabled={salvando}>{salvando ? "Cadastrando…" : "Cadastrar e adicionar fotos"}</button>
        </div>
        {aviso && (
          <p role="alert" style={{ gridColumn: "1 / -1", margin: 0, color: "var(--ru)" }}>
            {aviso.texto} {aviso.id && <Link href={`/patio/${aviso.id}`}>Abrir o carro que já existe</Link>}
          </p>
        )}
      </form>
    </div>
  );
}
