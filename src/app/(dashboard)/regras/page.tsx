"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CAMPOS, GATILHOS, OPERADORES, frase, validar, type Acao, type Condicao, type Gatilho, type Operador, type Regra } from "@/lib/patio/regras";

const GRUPOS = ["IBOX PRIME | MARKETING", "IBOX PRIME | OPERACIONAL"];

export default function RegrasPage() {
  const [regras, setRegras] = useState<Regra[]>([]);
  const [nome, setNome] = useState("");
  const [gatilho, setGatilho] = useState<Gatilho>("carro");
  const [condicoes, setCondicoes] = useState<Condicao[]>([{ campo: CAMPOS.carro[0].id, op: ">", valor: 0 }]);
  const [avisarHoje, setAvisarHoje] = useState(true);
  const [grupo, setGrupo] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    createClient().from("regras").select("id, nome, ativo, gatilho, condicoes, acoes").order("criado_em").then(({ data, error }) => {
      if (error) setAviso("Não foi possível abrir as regras.");
      else setRegras((data ?? []) as Regra[]);
    });
  }, []);

  function trocarGatilho(g: Gatilho) {
    setGatilho(g);
    setCondicoes([{ campo: CAMPOS[g][0].id, op: ">", valor: 0 }]);
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    const acoes: Acao[] = [...(avisarHoje ? [{ tipo: "alerta_hoje" } as Acao] : []), ...(grupo ? [{ tipo: "whatsapp_grupo", grupo } as Acao] : [])];
    const v = validar({ nome, gatilho, condicoes, acoes });
    if (!v.ok) return setAviso(v.erro);
    const sb = createClient();
    const { data: marca } = await sb.rpc("my_branding");
    const orgId = (Array.isArray(marca) ? marca[0] : marca)?.organization_id;
    const { data, error } = await sb.from("regras").insert({ ...v.regra, org_id: orgId }).select("id, nome, ativo, gatilho, condicoes, acoes").single();
    if (error) return setAviso("Não foi possível criar. Só sócios e marketing criam regras.");
    setRegras([...regras, data as Regra]);
    setNome("");
    setAviso(`Regra “${v.regra.nome}” criada. Ela aparece em Hoje quando bater.`);
  }

  async function alternar(r: Regra) {
    const { error } = await createClient().from("regras").update({ ativo: !r.ativo, atualizado_em: new Date().toISOString() }).eq("id", r.id);
    if (!error) setRegras(regras.map((x) => (x.id === r.id ? { ...x, ativo: !r.ativo } : x)));
  }
  async function apagar(r: Regra) {
    if (!confirm(`Apagar a regra “${r.nome}”?`)) return;
    const { error } = await createClient().from("regras").delete().eq("id", r.id);
    if (!error) setRegras(regras.filter((x) => x.id !== r.id));
  }

  const sel = { font: "inherit", fontSize: 14, border: "1px solid var(--input)", borderRadius: 8, padding: "9px 10px", background: "var(--campo)", color: "var(--foreground)" } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1240 }}>
      <div>
        <h1 className="disp" style={{ margin: 0, fontSize: 40, lineHeight: 1.05 }}>Regras e alertas</h1>
        <p className="rot" style={{ margin: "6px 0 0", fontSize: 14 }}>Nada vem pronto: você monta cada regra. Quando todas as condições batem, o alerta aparece em Hoje.</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 18, alignItems: "start" }}>
        <form onSubmit={criar} className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }} aria-labelledby="nova-t">
          <h2 id="nova-t" className="h2">Nova regra</h2>
          <label className="campo">Nome<input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Carro parado sem conversa" /></label>
          <label className="campo">Olhar para<select value={gatilho} onChange={(e) => trocarGatilho(e.target.value as Gatilho)}>{Object.entries(GATILHOS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <legend className="rot" style={{ marginBottom: 6 }}>Se (todas precisam bater)</legend>
            {condicoes.map((c, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, .9fr) minmax(0, .7fr) auto", gap: 6 }}>
                <select aria-label="Campo" style={sel} value={c.campo} onChange={(e) => setCondicoes(condicoes.map((x, k) => (k === i ? { ...x, campo: e.target.value } : x)))}>{CAMPOS[gatilho].map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}</select>
                <select aria-label="Comparação" style={sel} value={c.op} onChange={(e) => setCondicoes(condicoes.map((x, k) => (k === i ? { ...x, op: e.target.value as Operador } : x)))}>{Object.entries(OPERADORES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
                <input aria-label="Valor" style={sel} type="number" value={c.valor} onChange={(e) => setCondicoes(condicoes.map((x, k) => (k === i ? { ...x, valor: Number(e.target.value) } : x)))} />
                <button type="button" className="btns" aria-label="Tirar condição" disabled={condicoes.length === 1} onClick={() => setCondicoes(condicoes.filter((_, k) => k !== i))}>✕</button>
              </div>
            ))}
            <button type="button" className="btns" style={{ alignSelf: "flex-start" }} onClick={() => setCondicoes([...condicoes, { campo: CAMPOS[gatilho][0].id, op: ">", valor: 0 }])}>+ Condição</button>
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <legend className="rot" style={{ marginBottom: 6 }}>Então</legend>
            <label style={{ display: "flex", gap: 10, fontSize: 14 }}><input type="checkbox" checked={avisarHoje} onChange={(e) => setAvisarHoje(e.target.checked)} /> Avisar em Hoje</label>
            <label className="campo">Mandar no grupo do WhatsApp<select value={grupo} onChange={(e) => setGrupo(e.target.value)}><option value="">Não mandar</option>{GRUPOS.map((g) => <option key={g}>{g}</option>)}</select></label>
            {grupo && <p className="rot" style={{ margin: 0 }}>O grupo recebe a lista uma vez por dia, de manhã, quando a regra tiver algo para avisar. O grupo precisa estar no WhatsApp conectado ao sistema.</p>}
          </fieldset>
          <button type="submit" className="btnp" style={{ alignSelf: "flex-start" }}>Criar regra</button>
          {aviso && <p role="status" style={{ margin: 0, fontSize: 14 }}>{aviso}</p>}
        </form>

        <section className="card" style={{ padding: "8px 18px" }} aria-labelledby="suas-t">
          <h2 id="suas-t" className="h2" style={{ padding: "12px 0 6px" }}>Suas regras · {regras.length}</h2>
          {regras.length === 0 && <p className="rot" style={{ fontSize: 14 }}>Nenhuma regra ainda.</p>}
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {regras.map((r) => (
              <li key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 0", borderTop: "1px solid var(--p-linha-2)" }}>
                <span style={{ minWidth: 0 }}><b>{r.nome}</b><span className="rot" style={{ display: "block", fontSize: 13 }}>{frase(r)}</span></span>
                <span style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button type="button" className="btns" role="switch" aria-checked={r.ativo} onClick={() => alternar(r)}>{r.ativo ? "Ligada" : "Desligada"}</button>
                  <button type="button" className="btns" onClick={() => apagar(r)} aria-label={`Apagar ${r.nome}`}>Apagar</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
