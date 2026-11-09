"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CabecalhoAjustes } from "../comum";

type Pessoa = { user_id: string; nome: string; email: string; papel: "socio" | "marketing" | "vendedor"; escolhido: boolean; conta: string };
const PAPEL: Record<Pessoa["papel"], [string, string]> = {
  socio: ["Sócio", "Vê e muda tudo, inclusive custos, lucro, venda e documentos"],
  marketing: ["Marketing", "Mexe no site, nos anúncios, nas regras e no pátio, sem ver custos e lucro"],
  vendedor: ["Vendedor", "Atende os clientes e consulta o pátio, sem alterar"],
};

export default function EquipePage() {
  const [pessoas, setPessoas] = useState<Pessoa[] | null>(null);
  const [eu, setEu] = useState("");
  const [podeMudar, setPodeMudar] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/equipe", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro || "Não foi possível abrir.");
        setPessoas(d.pessoas); setEu(d.eu); setPodeMudar(d.podeMudar);
      })
      .catch((e: Error) => setAviso(e.message));
  }, []);

  async function mudar(p: Pessoa, papel: Pessoa["papel"]) {
    if (papel === p.papel) return;
    if (p.user_id === eu && papel !== "socio" && !confirm("Você vai deixar de ser sócio e perder o acesso ao financeiro. Continuar?")) return;
    setSalvando(p.user_id); setAviso(null);
    const r = await fetch("/api/equipe", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: p.user_id, papel }) });
    const d = await r.json().catch(() => ({}));
    setSalvando(null);
    if (!r.ok) { setAviso(d.erro || "Não foi possível salvar."); return; }
    setPessoas(d.pessoas);
    setAviso(`${p.nome} agora é ${PAPEL[papel][0].toLowerCase()}.`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 1000 }}>
      <CabecalhoAjustes titulo="Equipe e papéis" sub="O papel decide o que cada pessoa vê e muda no sistema. Convites e senhas ficam em Ajustes do CRM → Membros." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 12 }}>
        {(Object.keys(PAPEL) as Pessoa["papel"][]).map((k) => (
          <div key={k} className="card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 600 }}>{PAPEL[k][0]} <span className="rot">· {pessoas?.filter((p) => p.papel === k).length ?? "…"}</span></div>
            <div className="rot" style={{ fontSize: 13, marginTop: 4 }}>{PAPEL[k][1]}</div>
          </div>
        ))}
      </div>
      {aviso && <p role="status" style={{ margin: 0, fontSize: 14 }}>{aviso}</p>}
      <section className="card" style={{ overflowX: "auto" }} aria-label="Pessoas da loja">
        <table className="tab">
          <thead><tr><th>Pessoa</th><th>Conta</th><th>Papel</th></tr></thead>
          <tbody>
            {pessoas?.map((p) => (
              <tr key={p.user_id}>
                <td><b>{p.nome}</b>{p.user_id === eu && <span className="rot"> (você)</span>}<div className="rot" style={{ fontSize: 12 }}>{p.email}</div></td>
                <td className="rot">{p.conta}</td>
                <td>
                  {podeMudar ? (
                    <select value={p.papel} disabled={salvando === p.user_id} onChange={(e) => mudar(p, e.target.value as Pessoa["papel"])} aria-label={`Papel de ${p.nome}`}>
                      {(Object.keys(PAPEL) as Pessoa["papel"][]).map((k) => <option key={k} value={k}>{PAPEL[k][0]}</option>)}
                    </select>
                  ) : PAPEL[p.papel][0]}
                  {!p.escolhido && <div className="rot" style={{ fontSize: 12 }}>pelo cargo no CRM</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pessoas && !pessoas.length && <p style={{ padding: 16 }}>Ninguém na equipe ainda. Convide em <Link href="/settings?tab=members">Ajustes do CRM → Membros</Link>.</p>}
      </section>
    </div>
  );
}
